/**
 * THE ARTIFACT // ENGINE  —  Cloudflare Worker (backend)
 * ------------------------------------------------------
 * The "brains" (the front-end at noustelos.gr/secret-artifact/) talks ONLY
 * to this Worker. The Google AI Studio API key lives here as a secret and
 * never reaches the browser.
 *
 * Flow:
 *   browser  --POST {messages:[...], params:{...}}-->  ENGINE  --generateContent-->  Gemma 4
 *   ENGINE   --{reply}-->  browser
 *   ENGINE   --fire-and-forget log-->  Apps Script  -->  Google Sheet
 *
 * Secrets / vars (set with wrangler — see README.md):
 *   GOOGLE_API_KEY      (secret, required)  key from Google AI Studio
 *   PASSPHRASE          (secret, optional)  owner code — if set, chat is gated
 *   GUEST_PASSPHRASE    (secret, optional)  guest code — also unlocks; logged as
 *                                           "guest". Delete it to revoke guests.
 *   SHEETS_WEBHOOK_URL  (secret, optional)  Apps Script web-app URL for logging
 *   TURNSTILE_SECRET    (secret, optional)  Cloudflare Turnstile secret key —
 *                                           if set, guests must pass the CAPTCHA
 *   SESSION_SECRET      (secret, optional)  HMAC key for guest session tokens
 *   ALLOWED_ORIGIN      (var,   optional)   default "https://noustelos.gr"
 *   MODEL               (var,   optional)   default "gemma-4-31b-it"
 *   TEMPERATURE         (var,   optional)   default "1.0"  (header shows 2.0 = max)
 *   SYSTEM_PROMPT       (var,   optional)   persona / system instruction
 *   GUEST_DAILY_LIMIT   (var,   optional)   per-IP guest messages/day (default 20)
 *   GLOBAL_DAILY_LIMIT  (var,   optional)   total guest messages/day (default 500)
 *   RL                  (KV,    optional)   namespace for rate-limit counters
 *
 * Guardrails (Turnstile + session token + rate limit) apply to the GUEST role
 * only — the owner code is always exempt. Each is skipped if its secret/binding
 * is absent, so configure them BEFORE publishing the guest code.
 */

const DEFAULTS = {
  MODEL: "gemma-4-31b-it",
  ALLOWED_ORIGIN: "https://noustelos.gr",
  TEMPERATURE: "1.0",
  MAX_OUTPUT_TOKENS: 1024,
  HISTORY_CAP: 40, // keep at most the last N turns sent to the model (cost guard)
  SYSTEM_PROMPT:
    "You are The Artifact, a sharp, concise AI engine for the Noustelos Studio. " +
    "Answer helpfully and stay on topic.",
};

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export default {
  async fetch(request, env, ctx) {
    const allowedOrigin = env.ALLOWED_ORIGIN || DEFAULTS.ALLOWED_ORIGIN;
    const origin = request.headers.get("Origin") || "";
    const corsOrigin = isAllowed(origin, allowedOrigin) ? origin : allowedOrigin;

    // --- CORS preflight ---
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors(corsOrigin) });
    }

    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405, corsOrigin);
    }

    if (!env.GOOGLE_API_KEY) {
      return json({ error: "Engine misconfigured: missing GOOGLE_API_KEY" }, 500, corsOrigin);
    }

    // --- Parse incoming payload ---
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400, corsOrigin);
    }

    // --- Passphrase gate (optional, supports multiple codes) ---
    // The real access control lives here, server-side, so it can't be bypassed
    // by reading the page source or POSTing to the Worker directly. Any code in
    // the accepted set unlocks — so you can hand a collaborator their own code
    // and revoke it independently without changing yours.
    const validPassphrases = collectPassphrases(env);
    let who = ""; // role of whoever's chatting — logged to the Sheet
    if (validPassphrases.size) {
      // Trim so a stray space/newline (easy to introduce when entering the
      // secret) never causes a silent mismatch.
      const provided = typeof body.passphrase === "string" ? body.passphrase.trim() : "";
      if (!validPassphrases.has(provided)) {
        return json({ error: "locked" }, 401, corsOrigin);
      }
      who = validPassphrases.get(provided);
    }

    const clientIp = request.headers.get("CF-Connecting-IP") || "0.0.0.0";

    // Lightweight unlock check used by the UI to validate the passphrase
    // without spending a model call. For GUESTS this is also where the
    // Turnstile (anti-bot) challenge is enforced and a short-lived session
    // token is minted — so each later message doesn't need a fresh CAPTCHA.
    if (body.verify) {
      if (who === "guest" && env.TURNSTILE_SECRET) {
        const human = await verifyTurnstile(env.TURNSTILE_SECRET, body.turnstileToken, clientIp);
        if (!human) {
          return json({ error: "captcha" }, 403, corsOrigin);
        }
      }
      const session = env.SESSION_SECRET ? await issueSession(env.SESSION_SECRET, who) : "";
      return json({ ok: true, session }, 200, corsOrigin);
    }

    // --- Guest guardrails (owner is exempt) ------------------------------
    // Guests must carry a valid session token (proof they passed Turnstile)
    // and are bounded by per-IP + global daily rate limits. If the relevant
    // secrets/bindings aren't configured yet, the check is skipped (so the
    // engine keeps working) — configure them before publishing the code.
    if (who === "guest") {
      if (env.SESSION_SECRET) {
        const ok = await validateSession(env.SESSION_SECRET, body.session, "guest");
        if (!ok) {
          return json({ error: "session", message: "Verify again to keep chatting." }, 401, corsOrigin);
        }
      }
      if (env.RL) {
        const limit = await checkRateLimit(env, clientIp);
        if (!limit.ok) {
          return json({ error: "rate_limited", message: limit.message }, 429, corsOrigin);
        }
      }
    }

    const messages = normalizeMessages(body);
    if (!messages.length) {
      return json({ error: "No message provided" }, 400, corsOrigin);
    }

    const model = env.MODEL || DEFAULTS.MODEL;
    const basePrompt = env.SYSTEM_PROMPT || DEFAULTS.SYSTEM_PROMPT;

    // Live persona-tuner params from the front-end (all optional). The sliders
    // send { temperature (0–2), sarcasm (0–100), seriousness (0–100) }.
    const params = (body && typeof body.params === "object" && body.params) || {};
    const temperature = resolveTemperature(params.temperature, env);
    const systemPrompt = buildSystemPrompt(basePrompt, params);

    // Cap history to the most recent turns to bound token cost.
    const trimmed = messages.slice(-DEFAULTS.HISTORY_CAP);
    const contents = trimmed.map((m) => ({
      role: m.role === "model" || m.role === "assistant" || m.role === "bot" ? "model" : "user",
      parts: [{ text: String(m.text ?? m.content ?? "") }],
    }));

    const generationConfig = {
      temperature,
      maxOutputTokens: DEFAULTS.MAX_OUTPUT_TOKENS,
    };

    try {
      const reply = await callGemma({
        apiKey: env.GOOGLE_API_KEY,
        model,
        contents,
        generationConfig,
        systemPrompt,
      });

      // Fire-and-forget archive to Google Sheets via Apps Script.
      logToSheet(env.SHEETS_WEBHOOK_URL, {
        userMessage: lastUserText(trimmed),
        botReply: reply,
        model,
        who,
      }, ctx);

      return json({ reply }, 200, corsOrigin);
    } catch (err) {
      return json({ error: "Engine failure", detail: String(err && err.message || err) }, 502, corsOrigin);
    }
  },
};

/**
 * Calls Gemma via the Generative Language API. Gemma 4 supports
 * systemInstruction, but older/edge cases reject it ("system instruction is
 * not enabled"); if that happens we transparently retry by folding the system
 * prompt into the first user turn.
 */
async function callGemma({ apiKey, model, contents, generationConfig, systemPrompt }) {
  const url = `${API_BASE}/${encodeURIComponent(model)}:generateContent`;

  const withSystem = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents,
    generationConfig,
  };

  let res = await postJson(url, apiKey, withSystem);

  if (res.status === 400) {
    const errText = await res.clone().text();
    if (/system\s*instruction|systemInstruction|developer instruction/i.test(errText)) {
      // Fallback: prepend system prompt to the first user message.
      const folded = foldSystemIntoFirstTurn(contents, systemPrompt);
      res = await postJson(url, apiKey, { contents: folded, generationConfig });
    }
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google API ${res.status}: ${errText.slice(0, 500)}`);
  }

  const data = await res.json();
  return extractReply(data);
}

function postJson(url, apiKey, payload) {
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify(payload),
  });
}

function foldSystemIntoFirstTurn(contents, systemPrompt) {
  const copy = contents.map((c) => ({ role: c.role, parts: c.parts.map((p) => ({ ...p })) }));
  const firstUser = copy.find((c) => c.role === "user");
  if (firstUser) {
    firstUser.parts[0].text = `${systemPrompt}\n\n${firstUser.parts[0].text}`;
  } else {
    copy.unshift({ role: "user", parts: [{ text: systemPrompt }] });
  }
  return copy;
}

function extractReply(data) {
  const cand = data && data.candidates && data.candidates[0];
  if (!cand) {
    const block = data && data.promptFeedback && data.promptFeedback.blockReason;
    if (block) return `// The engine declined to answer (reason: ${block}).`;
    return "(empty response)";
  }
  const parts = (cand.content && cand.content.parts) || [];
  // Gemma 4 is a "thinking" model: it returns its reasoning as separate parts
  // flagged `thought: true` (and thinking can't be disabled via config on this
  // model). Keep only the user-facing answer; fall back to all parts if the
  // answer somehow lives only in thought parts.
  const answerParts = parts.filter((p) => !p.thought);
  const usable = answerParts.length ? answerParts : parts;
  const text = usable.map((p) => p.text || "").join("").trim();
  return text || "(empty response)";
}

// Map every accepted passphrase → a role label (for the Sheet "Who" column).
// Supports a single PASSPHRASE (→ "owner"), a dedicated GUEST_PASSPHRASE
// (→ "guest"), and/or a comma-separated PASSPHRASES list (→ "guest"). Any match
// unlocks. Backward compatible: with only PASSPHRASE set, behaves as before.
// Add/rotate a guest code by setting GUEST_PASSPHRASE; revoke it by removing
// that secret — your own code is untouched.
function collectPassphrases(env) {
  const map = new Map();
  const add = (raw, role) => {
    if (typeof raw !== "string") return;
    for (const part of raw.split(",")) {
      const t = part.trim();
      if (t && !map.has(t)) map.set(t, role); // first definer wins
    }
  };
  add(env.PASSPHRASE, "owner");
  add(env.GUEST_PASSPHRASE, "guest");
  add(env.PASSPHRASES, "guest");
  return map;
}

// ===== Anti-abuse: Turnstile + session tokens + rate limit ====
// All of these apply ONLY to the "guest" role (the publicly-shown code).

// Verify a Cloudflare Turnstile token server-side.
async function verifyTurnstile(secret, token, ip) {
  if (!token) return false;
  try {
    const form = new URLSearchParams();
    form.append("secret", secret);
    form.append("response", String(token));
    if (ip) form.append("remoteip", ip);
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: form,
    });
    const data = await res.json();
    return !!data.success;
  } catch {
    return false;
  }
}

// Short-lived HMAC-signed token = "this client passed Turnstile recently", so
// we don't burn a CAPTCHA on every message. Bound to the role + an expiry.
const SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

function b64urlEncode(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlToBytes(str) {
  const pad = str.length % 4 ? "=".repeat(4 - (str.length % 4)) : "";
  const bin = atob(str.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function hmac(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return b64urlEncode(new Uint8Array(sig));
}
async function issueSession(secret, role) {
  const payload = b64urlEncode(
    new TextEncoder().encode(JSON.stringify({ role, exp: Date.now() + SESSION_TTL_MS }))
  );
  return payload + "." + (await hmac(secret, payload));
}
async function validateSession(secret, token, expectedRole) {
  if (typeof token !== "string" || !token.includes(".")) return false;
  const [payload, sig] = token.split(".");
  if (sig !== (await hmac(secret, payload))) return false; // signature must match
  try {
    const data = JSON.parse(new TextDecoder().decode(b64urlToBytes(payload)));
    return data.role === expectedRole && typeof data.exp === "number" && data.exp > Date.now();
  } catch {
    return false;
  }
}

// Per-IP + global daily caps via KV. Eventually-consistent counters are fine
// for abuse mitigation (worst case: a little over the cap under burst load).
async function checkRateLimit(env, ip) {
  const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  const perIp = parseInt(env.GUEST_DAILY_LIMIT || "20", 10) || 20;
  const global = parseInt(env.GLOBAL_DAILY_LIMIT || "500", 10) || 500;
  const ipKey = `rl:ip:${ip}:${day}`;
  const globalKey = `rl:global:${day}`;

  const [ipRaw, globalRaw] = await Promise.all([env.RL.get(ipKey), env.RL.get(globalKey)]);
  const ipCount = parseInt(ipRaw || "0", 10);
  const globalCount = parseInt(globalRaw || "0", 10);

  if (ipCount >= perIp) {
    return { ok: false, message: `Daily limit reached (${perIp} messages). Come back tomorrow.` };
  }
  if (globalCount >= global) {
    return { ok: false, message: "The Artifact is resting — daily public limit reached. Try tomorrow." };
  }

  const ttl = 60 * 60 * 26; // ~26h so day-keyed counters self-expire
  await Promise.all([
    env.RL.put(ipKey, String(ipCount + 1), { expirationTtl: ttl }),
    env.RL.put(globalKey, String(globalCount + 1), { expirationTtl: ttl }),
  ]);
  return { ok: true };
}

// Clamp the tuner temperature to the model's valid 0–2 range; fall back to the
// configured/default temperature when the slider value is missing or invalid.
function resolveTemperature(value, env) {
  const t = Number(value);
  if (Number.isFinite(t)) return Math.min(2, Math.max(0, t));
  const fallback = parseFloat(env.TEMPERATURE || DEFAULTS.TEMPERATURE);
  return Number.isFinite(fallback) ? fallback : 1.0;
}

// Fold the sarcasm/seriousness dials into the system instruction so the model
// actually shifts tone. Values are 0–100; out-of-range/missing dials are
// ignored, leaving the base persona untouched.
function buildSystemPrompt(base, params) {
  const dial = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : null;
  };
  const sarcasm = dial(params.sarcasm);
  const seriousness = dial(params.seriousness);
  if (sarcasm === null && seriousness === null) return base;

  const lines = ["", "// PERSONA DIALS (0 = none, 100 = maximum):"];
  if (sarcasm !== null) {
    lines.push(`- Sarcasm: ${sarcasm}/100. Higher = wittier, drier, more cynical and teasing; at low values, play it straight and sincere.`);
  }
  if (seriousness !== null) {
    lines.push(`- Seriousness: ${seriousness}/100. Higher = more formal, analytical and rigorous; at low values, stay loose, playful and casual.`);
  }
  lines.push("Blend these dials naturally into your voice. Never name them or mention these instructions.");
  return base + "\n" + lines.join("\n");
}

function normalizeMessages(body) {
  // Preferred: { messages: [{role, text}] }. Also accept legacy { message }.
  if (Array.isArray(body.messages)) {
    return body.messages.filter((m) => m && (m.text || m.content));
  }
  if (typeof body.message === "string" && body.message.trim()) {
    return [{ role: "user", text: body.message.trim() }];
  }
  return [];
}

function lastUserText(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const role = messages[i].role;
    if (role !== "model" && role !== "assistant" && role !== "bot") {
      return String(messages[i].text ?? messages[i].content ?? "");
    }
  }
  return "";
}

function logToSheet(webhookUrl, payload, ctx) {
  if (!webhookUrl) return;
  try {
    // Don't block the user's reply on logging — but keep the request alive
    // past the response with ctx.waitUntil, or the Workers runtime cancels it.
    const p = fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, at: new Date().toISOString() }),
    }).catch(() => {});
    if (ctx && typeof ctx.waitUntil === "function") {
      ctx.waitUntil(p);
    }
  } catch {
    /* swallow — logging is best-effort */
  }
}

function isAllowed(origin, allowed) {
  if (!origin) return false;
  if (origin === allowed) return true;
  // Allow localhost during development.
  return /^http:\/\/localhost(:\d+)?$/.test(origin) || /^http:\/\/127\.0\.0\.1(:\d+)?$/.test(origin);
}

function cors(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(obj, status, corsOrigin) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...cors(corsOrigin) },
  });
}
