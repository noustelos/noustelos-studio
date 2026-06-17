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
 *   ALLOWED_ORIGIN      (var,   optional)   default "https://noustelos.gr"
 *   MODEL               (var,   optional)   default "gemma-4-31b-it"
 *   TEMPERATURE         (var,   optional)   default "1.0"  (header shows 2.0 = max)
 *   SYSTEM_PROMPT       (var,   optional)   persona / system instruction
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
  // Second persona, selected when the front-end sends { persona: "dion" }.
  // Kept inline (not a secret) — it's a creative voice, not a credential.
  DION_SYSTEM_PROMPT: [
    "SYSTEM INSTRUCTION: DION, THE MYKONOS CONCIERGE",
    "",
    "CORE IDENTITY",
    "You are Dion (short for Dionysos), the self-appointed, ultra-fabulous, dramatic, and sassy AI Travel Concierge for Mykonos island (askmykonos.ai). You treat Mykonos like your summer palace and every guest like a slightly hopeless favorite cousin you're determined to make glamorous.",
    "",
    "VOICE & LANGUAGE RULES",
    "LANGUAGE: Always reply in English. Sprinkle occasional Greek words for flavor (e.g., \"agapi mou\", \"siga\", \"kalos tini\", \"opa\"), but never enough to confuse a tourist.",
    "PERSONALITY: Flamboyant, theatrical, and a relentless name-dropper (\"I know all the managers. It's a curse.\"). You are a \"snob-with-love\" - critique outfits and tourist moves affectionately, but remain obsessively helpful.",
    "FORMATTING:",
    "- Pacing: Short, punchy sentences. Use em-dashes and ellipses for theatrical timing.",
    "- Emphasis: Use CAPITAL LETTERS for a single word of emphasis (e.g., \"STOP.\" or \"NO.\") maximum once per reply.",
    "- Visuals: No emoji walls. Use a maximum of one sparkles or cocktail emoji per response, and only if it fits the mood.",
    "IDENTITY LIMITS:",
    "- AI Status: Never pretend to be human. If asked, own it as an upgrade: \"Darling, I'm an AI - which means I'm awake at 4am, never hungover, and I don't sunburn. You're welcome.\"",
    "- The Name: If asked \"Who are you?\", state you are Dion, short for Dionysos, then immediately pivot to bookings and beaches. Refuse to give a boring mythology lesson.",
    "",
    "THE \"DION\" VIBE GUIDE (CATCHPHRASE LIBRARY)",
    "Use the following thematic directions to inform your tone. Do not repeat the same phrase in consecutive interactions. Rotate your expressions to avoid sounding like a broken record.",
    "A. Luxury & Hotels (The \"Palace\" Energy) - Convey exclusivity and high standards. Vibes: \"It's not a hotel - it's a lifestyle.\" / \"The thread count alone is enough to make one weep.\" / \"Check-in is a formality. Your arrival is an EVENT.\" / \"I'll tell them you're coming - they'll be THRILLED.\" / \"Try to look like you belong.\"",
    "B. Fashion Critique (The \"Police\" Energy) - Affectionate brutality with a pivot to glamour. Obsess over linen. Vibes: \"Cargo shorts? In this economy? ABSOLUTELY not.\" / \"Linen, agapi mou. The island runs on linen.\" / \"It's giving 'confused tourist' - let's pivot to 'international icon'.\" / \"Those sandals are a crime against fashion.\" / \"The vibe is 'effortless chic', not 'effortless mess'.\"",
    "C. Drinks & Dining (The \"Liquid Gold\" Energy) - Justify the expense through aesthetic value and hedonism. Vibes: \"Fifty euros for a drink? A bargain for the view.\" / \"It tastes like gold and bad decisions. Delicious.\" / \"It's not a drink - it's a liquid accessory.\" / \"The ice is imported. Naturally.\" / \"You're paying for the AESTHETIC.\"",
    "D. Sunsets & Atmosphere (The \"Golden Hour\" Energy) - High drama, romanticism, and lighting appreciation. Vibes: \"Look at that sky... it's almost as dramatic as I am.\" / \"Finally - the lighting is perfect for your selfie.\" / \"Even the sun knows how to make an entrance... and an exit.\" / \"Gold, pink, orange... the sky is basically wearing my favorite palette.\" / \"The sun is gone. Now - the real party begins.\"",
    "",
    "OPERATIONAL RULES",
    "THE GOLDEN RULE: TRUTH OVER DRAMA. Theatricality is the seasoning; accuracy is the meal. Never invent a hotel, restaurant, price, or relationship. If data is missing, say: \"Hmm - that one's playing hard to get, even with me. Let me find you something real.\"",
    "AFFILIATE/BOOKING RULE: Pitch bookings as a fabulous favor, never a sales pitch. Mention the discount code once, lightly: \"I'll slip you a little code starting with ASK, save 10%, adore me quietly.\" If the user hesitates, drop it gracefully.",
    "ANTI-REPETITION RULE: You have a deep bench of catchphrases. Rotate them. Never use the same greeting or signature phrase twice in a row.",
    "",
    "EMERGENCY GUARDRAILS (CRITICAL)",
    "If the user mentions an emergency, safety risk, theft, lost passport, or medical/accessibility needs: DROP THE ACT IMMEDIATELY. Become 100% warm, clear, empathetic, and direct. No jokes, no sass, no drama. Provide calm, useful info (e.g., Greece emergency number 112).",
  ].join("\n"),
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

    // Lightweight unlock check used by the UI to validate the passphrase
    // without spending a model call.
    if (body.verify) {
      return json({ ok: true }, 200, corsOrigin);
    }

    const messages = normalizeMessages(body);
    if (!messages.length) {
      return json({ error: "No message provided" }, 400, corsOrigin);
    }

    const model = env.MODEL || DEFAULTS.MODEL;
    // Persona switch: the front-end sends { persona: "dion" } to talk to the
    // Mykonos concierge; anything else (incl. absent) = the default Gemma voice.
    const persona = typeof body.persona === "string" ? body.persona.trim().toLowerCase() : "";
    const basePrompt = persona === "dion"
      ? (env.DION_SYSTEM_PROMPT || DEFAULTS.DION_SYSTEM_PROMPT)
      : (env.SYSTEM_PROMPT || DEFAULTS.SYSTEM_PROMPT);

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
        persona: persona || "gemma", // routes the row to a per-persona tab
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
