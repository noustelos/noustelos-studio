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
 *                                           AND owner memory (Memory tab)
 *   MEM_TOKEN           (secret, optional)  shared secret sent on mem-* calls;
 *                                           must match the Apps Script MEM_TOKEN
 *                                           Script Property if that's set
 *   KILL_SWITCH         (secret, optional)  SECRET PHRASE: when the OWNER types
 *                                           it in the chat, the engine goes
 *                                           OFFLINE for everyone. No terminal kill.
 *   ANTIDOTE            (secret, optional)  SECRET PHRASE: owner types it to bring
 *                                           the engine back ONLINE.
 *   KILL_MESSAGE        (var,   optional)   text shown while killed
 *   ARTIFACT_KV         (KV binding, req.   stores the on/off "kill" flag so it
 *                        for kill switch)   persists across requests (see toml)
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
  KILL_MESSAGE: "// The Artifact is offline right now. Please try again later.",
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

    // Lightweight unlock check used by the UI. Allowed even while the engine is
    // killed, so the owner can unlock and then type the ANTIDOTE to revive.
    if (body.verify) {
      return json({ ok: true }, 200, corsOrigin);
    }

    // --- Owner memory commands (θυμήσου/μνήμη/forget) ---
    // The front-end routes these here (it can't touch the Sheet directly — no
    // token). Owner-only and exempt from the offline gate, so the owner can curate
    // memory even while the engine is killed. Mutates the Sheet "Memory" tab.
    if (body.memoryOp && typeof body.memoryOp === "object") {
      if (who !== "owner") return json({ error: "forbidden" }, 403, corsOrigin);
      return handleMemoryOp(env, body.memoryOp, corsOrigin);
    }

    // --- Owner Drive ops: /my_profile (Profile list), /lib + /read (Library) ---
    if (body.driveOp && typeof body.driveOp === "object") {
      if (who !== "owner") return json({ error: "forbidden" }, 403, corsOrigin);
      return handleDriveOp(env, body.driveOp, corsOrigin);
    }

    const messages = normalizeMessages(body);
    if (!messages.length) {
      return json({ error: "No message provided" }, 400, corsOrigin);
    }

    // --- Chat kill switch (owner-only; NO terminal control) ---
    // KILL_SWITCH and ANTIDOTE are secret PHRASES. When the OWNER types one as a
    // chat message, toggle the persisted KV flag. Checked BEFORE the offline gate
    // so the owner can always revive; never triggers for guests. Guessing the
    // phrase is useless without the owner passphrase (which gates this whole
    // request server-side).
    if (who === "owner") {
      const kind = matchControlPhrase(lastUserText(messages), env);
      if (kind) return setKill(env, kind === "kill", corsOrigin);
    }

    // --- Offline gate ---
    // While the KV "kill" flag is on, refuse all chat. (verify above is exempt,
    // so the owner can still unlock to type the ANTIDOTE.)
    if (await isKilled(env)) {
      return json({ error: "offline", reply: env.KILL_MESSAGE || DEFAULTS.KILL_MESSAGE }, 503, corsOrigin);
    }

    const model = env.MODEL || DEFAULTS.MODEL;
    // Persona switch: the front-end sends { persona: "dion" } to talk to the
    // Mykonos concierge; anything else (incl. absent) = the default Gemma voice.
    const persona = typeof body.persona === "string" ? body.persona.trim().toLowerCase() : "";
    let basePrompt = persona === "dion"
      ? (env.DION_SYSTEM_PROMPT || DEFAULTS.DION_SYSTEM_PROMPT)
      : (env.SYSTEM_PROMPT || DEFAULTS.SYSTEM_PROMPT);

    // Owner context (Gemma only): durable MEMORY (Sheet "Memory" tab, cross-
    // device), the always-on PROFILE (Drive Artifact/Profile/, Global Context),
    // and any LIBRARY files the owner loaded with /read (names in body.libFiles,
    // for THIS conversation only). DION has no memory/docs; guests get none.
    // These reads run CONCURRENTLY (not sequentially) and each fails open on a
    // slow cold read — they happen BEFORE streaming starts, so a serial stall
    // here would leave the browser staring at silence until it cuts the
    // connection ("SIGNAL LOST" on the first, cache-cold turn).
    if (persona !== "dion" && who === "owner") {
      const libFiles = Array.isArray(body.libFiles)
        ? body.libFiles.filter((n) => typeof n === "string" && n)
        : [];
      const [memory, profile, library] = await Promise.all([
        getOwnerMemory(env),
        getProfileContent(env),
        libFiles.length ? getLibraryContent(env, libFiles) : Promise.resolve(""),
      ]);
      basePrompt += renderMemoryBlock(memory);
      basePrompt += renderProfileBlock(profile);
      if (libFiles.length) basePrompt += renderLibraryBlock(library);
    }

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

    // Web search opt-in (Gemma only): the user grounds a single answer in live
    // Google Search by either a leading verb ("ψάξε …", "search …") or a
    // web/internet phrase ("στο ίντερνετ …", "google it"). When detected we
    // attach tools:[{googleSearch:{}}] for THIS turn only — off by default, and
    // never for DION (a creative voice, not a research tool). See detectSearch.
    let tools;
    if (persona !== "dion") {
      for (let i = contents.length - 1; i >= 0; i--) {
        if (contents[i].role !== "user") continue;
        const det = detectSearch(contents[i].parts[0].text);
        if (det.search) {
          tools = [{ googleSearch: {} }];
          if (det.query) contents[i].parts[0].text = det.query; // leading-verb form: drop the verb
        }
        break;
      }
    }

    // --- Streaming path (Server-Sent Events) ---
    // The front-end sends { stream: true } to get tokens as they're produced,
    // instead of waiting for the whole reply. We proxy Google's SSE stream,
    // strip the model's "thinking" parts, and emit `data: {"delta":"…"}` lines.
    // The full answer is logged to the Sheet once the stream finishes.
    if (body.stream === true || body.stream === "true") {
      return streamReply({
        apiKey: env.GOOGLE_API_KEY,
        model,
        contents,
        generationConfig,
        systemPrompt,
        tools,
        corsOrigin,
        ctx,
        onComplete: (full) => logToSheet(env.SHEETS_WEBHOOK_URL, {
          userMessage: lastUserText(trimmed),
          botReply: full,
          model,
          who,
          persona: persona || "gemma",
        }, ctx),
      });
    }

    try {
      const reply = await callGemma({
        apiKey: env.GOOGLE_API_KEY,
        model,
        contents,
        generationConfig,
        systemPrompt,
        tools,
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
async function callGemma({ apiKey, model, contents, generationConfig, systemPrompt, tools }) {
  const url = `${API_BASE}/${encodeURIComponent(model)}:generateContent`;
  const toolsField = tools && tools.length ? { tools } : {};

  const withSystem = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents,
    generationConfig,
    ...toolsField,
  };

  let res = await postJson(url, apiKey, withSystem);

  if (res.status === 400) {
    const errText = await res.clone().text();
    if (/system\s*instruction|systemInstruction|developer instruction/i.test(errText)) {
      // Fallback: prepend system prompt to the first user message.
      const folded = foldSystemIntoFirstTurn(contents, systemPrompt);
      res = await postJson(url, apiKey, { contents: folded, generationConfig, ...toolsField });
    }
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google API ${res.status}: ${errText.slice(0, 500)}`);
  }

  const data = await res.json();
  return extractReply(data);
}

/**
 * Streams Gemma's answer to the browser as Server-Sent Events. Calls Google's
 * :streamGenerateContent?alt=sse endpoint, parses its SSE chunks, drops the
 * `thought:true` reasoning parts, and forwards only answer text as
 * `data: {"delta":"…"}` events — ending with `data: {"done":true}`. The same
 * systemInstruction-400 fallback as callGemma is applied before streaming
 * starts (we still have the status/headers then). onComplete(fullText) fires
 * once the stream finishes, for fire-and-forget Sheet logging.
 */
async function streamReply({ apiKey, model, contents, generationConfig, systemPrompt, tools, corsOrigin, ctx, onComplete }) {
  const url = `${API_BASE}/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
  const toolsField = tools && tools.length ? { tools } : {};

  let upstream = await postJson(url, apiKey, {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents,
    generationConfig,
    ...toolsField,
  });

  if (upstream.status === 400) {
    const errText = await upstream.clone().text();
    if (/system\s*instruction|systemInstruction|developer instruction/i.test(errText)) {
      const folded = foldSystemIntoFirstTurn(contents, systemPrompt);
      upstream = await postJson(url, apiKey, { contents: folded, generationConfig, ...toolsField });
    }
  }

  const sseHeaders = {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    ...cors(corsOrigin),
  };

  if (!upstream.ok || !upstream.body) {
    const errText = upstream.body ? (await upstream.text()).slice(0, 500) : "no stream body";
    console.error("artifact stream upstream FAIL", upstream.status, errText);
    const enc = new TextEncoder();
    const msg = `Google API ${upstream.status}: ${errText}`;
    return new Response(
      enc.encode(`data: ${JSON.stringify({ error: msg })}\n\n`),
      { status: 200, headers: sseHeaders }
    );
  }

  console.log("artifact stream upstream", upstream.status, "body:", !!upstream.body);

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const pump = (async () => {
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let full = "";
    let hb = 0;
    try {
      // Open the pipe immediately so the client connection never sits idle (a
      // long "thinking" phase emits no answer tokens, and an idle SSE stream can
      // get cut by the browser/proxy → "SIGNAL LOST"). ":" lines are SSE
      // comments the client ignores.
      await writer.write(encoder.encode(`: open\n\n`));
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let emitted = false;
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).replace(/\r$/, "");
          buf = buf.slice(nl + 1);
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          let data;
          try { data = JSON.parse(payload); } catch { continue; }
          const delta = extractDelta(data);
          if (delta) {
            full += delta;
            emitted = true;
            await writer.write(encoder.encode(`data: ${JSON.stringify({ delta })}\n\n`));
          }
        }
        // Chunk carried only thinking / non-text → keep the connection warm.
        if (!emitted) { hb++; await writer.write(encoder.encode(`: hb\n\n`)); }
      }
      await writer.write(encoder.encode(`data: ${JSON.stringify({ done: true })}\n\n`));
      console.log("artifact stream done", "chars:", full.length, "heartbeats:", hb);
    } catch (err) {
      console.error("artifact stream error:", String((err && err.stack) || err));
      await writer.write(encoder.encode(`data: ${JSON.stringify({ error: String((err && err.message) || err) })}\n\n`));
    } finally {
      try { await writer.close(); } catch { /* already closed */ }
      if (onComplete) {
        try { onComplete(full.trim()); } catch { /* logging is best-effort */ }
      }
    }
  })();

  if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(pump);

  return new Response(readable, { status: 200, headers: sseHeaders });
}

// Pull the user-facing text delta out of one streamed chunk, skipping the
// model's `thought:true` reasoning parts (same filter as extractReply).
function extractDelta(data) {
  const cand = data && data.candidates && data.candidates[0];
  const parts = (cand && cand.content && cand.content.parts) || [];
  return parts.filter((p) => !p.thought).map((p) => p.text || "").join("");
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

// Render the user's pinned memory as a system-prompt block. Defensive caps keep
// the token cost bounded even if the front-end ever sends more than it should.
const MEMORY_MAX_FACTS = 100;
const MEMORY_MAX_CHARS = 500;
function renderMemoryBlock(memory) {
  if (!Array.isArray(memory)) return "";
  const facts = memory
    .filter((m) => typeof m === "string" && m.trim())
    .slice(0, MEMORY_MAX_FACTS)
    .map((m) => "- " + m.trim().slice(0, MEMORY_MAX_CHARS));
  if (!facts.length) return "";
  return "\n\n// PERSISTENT MEMORY — durable facts the user asked you to remember across sessions. " +
    "Treat them as true and use them when relevant; do not mention or list them unless asked:\n" +
    facts.join("\n");
}

// --- Owner long-term memory, backed by the Sheet "Memory" tab (owner-only) ---
// The Worker is the ONLY thing that talks to the Sheet (the front-end has no
// token), so the list stays owner-private. Reads are cached in KV for 60s so a
// chat turn doesn't pay an Apps Script round-trip every time; mutations write
// through the cache. A manual edit of the Memory tab shows up within the TTL.
const MEMORY_CACHE_TTL = 60 * 1000;

// Cap each Apps Script round-trip so a slow cold read can't stall a chat turn.
// These run BEFORE streaming starts (memory/profile/library), so an unbounded
// wait here = the browser sees silence and cuts the connection. On timeout we
// fail open (return {ok:false} → empty block this turn) rather than hang.
const SHEETS_TIMEOUT_MS = 6000;

async function sheetsMemoryCall(env, action, extra) {
  if (!env.SHEETS_WEBHOOK_URL) return { ok: false, error: "unconfigured" };
  try {
    const res = await fetch(env.SHEETS_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, token: env.MEM_TOKEN || "", ...(extra || {}) }),
      signal: AbortSignal.timeout(SHEETS_TIMEOUT_MS),
    });
    return await res.json();
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
}

async function putMemoryCache(env, facts) {
  if (!env.ARTIFACT_KV) return;
  try { await env.ARTIFACT_KV.put("mem:cache", JSON.stringify({ at: Date.now(), facts })); } catch { /* best effort */ }
}

// The list folded into each owner turn. KV-cached (fast path); on a miss/expiry
// it reads the Sheet live and refreshes the cache. Never throws — on any failure
// it degrades to the last cache or an empty list (memory simply goes quiet).
async function getOwnerMemory(env) {
  if (!env.SHEETS_WEBHOOK_URL) return [];
  let cached = null;
  if (env.ARTIFACT_KV) {
    try {
      const raw = await env.ARTIFACT_KV.get("mem:cache");
      if (raw) {
        cached = JSON.parse(raw);
        if (cached && Array.isArray(cached.facts) && (Date.now() - cached.at) < MEMORY_CACHE_TTL) {
          return cached.facts;
        }
      }
    } catch { /* fall through to a live read */ }
  }
  const data = await sheetsMemoryCall(env, "mem-list");
  if (data && data.ok && Array.isArray(data.memory)) {
    await putMemoryCache(env, data.memory);
    return data.memory;
  }
  return cached && Array.isArray(cached.facts) ? cached.facts : [];
}

// Handle an owner memory command routed from the front-end: mutate the Sheet,
// refresh the KV cache, and return the canonical list + a status the UI renders.
async function handleMemoryOp(env, op, corsOrigin) {
  if (!env.SHEETS_WEBHOOK_URL) return json({ error: "memory-unconfigured" }, 200, corsOrigin);
  const type = op && typeof op.type === "string" ? op.type : "";
  let data;
  if (type === "list") {
    data = await sheetsMemoryCall(env, "mem-list");
  } else if (type === "add") {
    data = await sheetsMemoryCall(env, "mem-add", { fact: String(op.fact || "").slice(0, MEMORY_MAX_CHARS) });
  } else if (type === "import") {
    const facts = Array.isArray(op.facts) ? op.facts.slice(0, MEMORY_MAX_FACTS) : [];
    data = await sheetsMemoryCall(env, "mem-import", { facts });
  } else if (type === "forget") {
    // A numeric index drops just that fact; absent index = clear all.
    data = op.index ? await sheetsMemoryCall(env, "mem-forget", { index: op.index })
                    : await sheetsMemoryCall(env, "mem-clear", {});
  } else if (type === "clear") {
    data = await sheetsMemoryCall(env, "mem-clear", {});
  } else {
    return json({ error: "bad-op" }, 200, corsOrigin);
  }
  const ok = !!(data && data.ok);
  const facts = ok && Array.isArray(data.memory) ? data.memory : [];
  if (ok) await putMemoryCache(env, facts);
  return json({ ok, memory: facts, status: data && data.status, fact: data && data.fact, error: data && data.error }, 200, corsOrigin);
}

// --- Owner Drive folder ("Artifact"), read via the same Apps Script /exec ---
// Two tiers: PROFILE (Artifact/Profile/, always-on) and LIBRARY (Artifact/
// Library/, loaded by name on /read). Owner-only, KV-cached (longer TTL — files
// change less often than chat).
const DRIVE_CACHE_TTL = 5 * 60 * 1000;

// Generic cached read: `action` + optional `extra` (e.g. {names}) → text. The KV
// key namespaces the cache (profile vs a specific library selection).
async function cachedDriveText(env, key, action, extra) {
  if (!env.SHEETS_WEBHOOK_URL) return "";
  if (env.ARTIFACT_KV) {
    try {
      const raw = await env.ARTIFACT_KV.get(key);
      if (raw) {
        const c = JSON.parse(raw);
        if (c && typeof c.text === "string" && (Date.now() - c.at) < DRIVE_CACHE_TTL) return c.text;
      }
    } catch { /* fall through to a live read */ }
  }
  const data = await sheetsMemoryCall(env, action, extra);
  const text = data && data.ok && typeof data.text === "string" ? data.text : "";
  if (env.ARTIFACT_KV) {
    try { await env.ARTIFACT_KV.put(key, JSON.stringify({ at: Date.now(), text })); } catch { /* best effort */ }
  }
  return text;
}

// Profile = Artifact/Profile/ — always folded into every owner Gemma turn.
function getProfileContent(env) {
  return cachedDriveText(env, "profile:cache", "drive-read");
}

// Library = the named Artifact/Library/ files the owner loaded with /read. Cache
// key includes the (sorted) selection so different /read sets don't collide.
function getLibraryContent(env, names) {
  if (!names.length) return Promise.resolve("");
  const key = "lib:" + names.slice().sort().join("|");
  return cachedDriveText(env, key, "lib-read", { names });
}

function renderProfileBlock(text) {
  if (!text || !text.trim()) return "";
  return "\n\n// PROFILE (GLOBAL CONTEXT) — the user's own profile, placed in their " +
    "Drive 'Artifact/Profile' folder. Always treat it as authoritative background " +
    "about the user:\n" + text;
}

function renderLibraryBlock(text) {
  if (!text || !text.trim()) return "";
  return "\n\n// LIBRARY — reference files the user explicitly loaded for THIS " +
    "conversation with /read. Treat them as authoritative context and use them " +
    "when relevant:\n" + text;
}

// Drive ops routed from the front-end (/my_profile, /lib, /read). Owner-gated by
// the caller. type: "list" (Profile files), "lib-list" (Library files),
// "lib-read" {names} (load the named Library files, returns what actually read).
async function handleDriveOp(env, op, corsOrigin) {
  if (!env.SHEETS_WEBHOOK_URL) return json({ error: "drive-unconfigured" }, 200, corsOrigin);
  const type = op && typeof op.type === "string" ? op.type : "";

  if (type === "list" || type === "lib-list") {
    const action = type === "lib-list" ? "lib-list" : "drive-list";
    const data = await sheetsMemoryCall(env, action);
    return json({
      ok: !!(data && data.ok),
      folderFound: !!(data && data.folderFound),
      files: (data && Array.isArray(data.files)) ? data.files : [],
      error: data && data.error,
    }, 200, corsOrigin);
  }

  if (type === "lib-read") {
    const names = Array.isArray(op.names) ? op.names.filter((n) => typeof n === "string" && n) : [];
    const data = await sheetsMemoryCall(env, "lib-read", { names });
    const text = data && data.ok && typeof data.text === "string" ? data.text : "";
    // Warm the same cache the chat turns will read for this selection.
    if (env.ARTIFACT_KV && names.length) {
      const key = "lib:" + names.slice().sort().join("|");
      try { await env.ARTIFACT_KV.put(key, JSON.stringify({ at: Date.now(), text })); } catch { /* best effort */ }
    }
    return json({
      ok: !!(data && data.ok),
      folderFound: !!(data && data.folderFound),
      read: (data && Array.isArray(data.read)) ? data.read : [],
      chars: text.length,
      error: data && data.error,
    }, 200, corsOrigin);
  }

  return json({ error: "bad-op" }, 200, corsOrigin);
}

// Engine offline iff the chat-set KV "kill" flag is on. State lives ONLY in KV
// (no terminal kill) — if KV isn't bound, the engine is simply never killed.
async function isKilled(env) {
  if (env && env.ARTIFACT_KV) {
    try { return (await env.ARTIFACT_KV.get("kill")) === "on"; } catch { return false; }
  }
  return false;
}

// Does this message exactly match one of the secret control phrases? Returns
// "kill" / "antidote" / null. Exact (trimmed) match — the phrases are secrets.
function matchControlPhrase(text, env) {
  const t = (text || "").trim();
  if (!t) return null;
  if (env.KILL_SWITCH && t === String(env.KILL_SWITCH).trim()) return "kill";
  if (env.ANTIDOTE && t === String(env.ANTIDOTE).trim()) return "antidote";
  return null;
}

// Web-search opt-in. Two ways in (Greek isn't ASCII \w, so we anchor with a
// separator lookahead instead of \b — same caveat as the memory commands):
//   (A) a LEADING verb (ψάξε/ψάξτε/γκουγκλάρισε/search/…) → search + the verb
//       is stripped from the prompt, so the query reads clean.
//   (B) a web/internet PHRASE anywhere ("στο ίντερνετ", "search the web",
//       "google it", …) → search, prompt left intact (it's natural language).
const SEARCH_TRIGGER = /^\s*(?:\/?search|ψάξε|ψαξε|ψάξτε|ψαξτε|γκούγκλαρε|γκουγκλαρε|γκουγκλάρισε|γκουγκλαρισε)(?=[\s,.:!;·]|$)/iu;
const SEARCH_PHRASE = /(?:στο|στον|στη|στην|από\s+το)\s+(?:ίντερνετ|ιντερνετ|διαδίκτυο|διαδικτυο|δίκτυο|δικτυο|google|γκουγκλ)|search\s+(?:the\s+)?(?:web|internet|online)|on\s+the\s+(?:web|internet)|google\s+(?:it|that|this)|look\s+(?:it|that|this)\s+up/iu;

// Decide whether this turn wants web search. Returns { search, query }: when a
// leading verb matched, `query` is the prompt with the verb stripped (null if
// nothing followed it → caller keeps the original); for a phrase match `query`
// is null (don't mangle the sentence).
function detectSearch(text) {
  const s = String(text || "");
  const m = s.match(SEARCH_TRIGGER);
  if (m) {
    const q = s.slice(m[0].length).replace(/^[\s,.:!;·]+/, "").trim();
    return { search: true, query: q || null };
  }
  if (SEARCH_PHRASE.test(s)) return { search: true, query: null };
  return { search: false, query: null };
}

// Toggle the persisted kill flag. Needs a bound ARTIFACT_KV namespace; without
// it we report "kv-missing" so the UI can tell the owner to finish setup.
async function setKill(env, on, corsOrigin) {
  const control = on ? "kill" : "antidote";
  if (!env.ARTIFACT_KV) {
    return json({ control, ok: false, error: "kv-missing" }, 200, corsOrigin);
  }
  try {
    await env.ARTIFACT_KV.put("kill", on ? "on" : "off");
  } catch {
    return json({ control, ok: false, error: "kv-error" }, 200, corsOrigin);
  }
  return json({ control, ok: true, killed: on }, 200, corsOrigin);
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
