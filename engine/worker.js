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
  // Gemma 4 is a THINKING model — reasoning tokens count against this budget, so
  // a low cap truncates the visible answer mid-sentence once it has thought for a
  // while. Owner gets a generous budget (effectively no cut); other roles a
  // smaller baseline. Both env-overridable. Spend is bounded by the Google
  // billing cap, not by clipping the owner's answers.
  MAX_OUTPUT_TOKENS: 2048,        // baseline (guests, if ever re-enabled)
  OWNER_MAX_OUTPUT_TOKENS: 8192,  // owner — room for long thinking + full answer
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

    // --- SaaS Readiness Scanner (separate, passphrase-gated AI Lab tool) ---
    // A standalone utility that SHARES this Worker (and the GOOGLE_API_KEY) but
    // NONE of the Artifact's logic: its own passphrase, its own system prompt
    // (a SaaS strategist — no Artifact persona), structured-JSON output, no
    // persona/memory/Drive/kill-switch, no user-input logging. Routed by PATH so
    // the Artifact chat (which ignores the path) is completely untouched. See the
    // handleSaasScan block below.
    if (new URL(request.url).pathname === "/api/saas-scan") {
      return handleSaasScan(body, env, ctx, corsOrigin);
    }

    // --- Website Quality Scanner (separate, passphrase-gated AI Lab tool) ---
    // A second standalone utility on the SAME Worker, decoupled from BOTH the
    // Artifact and the SaaS scanner: its own route, its own system prompt (a
    // website strategist / SEO + conversion auditor) and its own richer JSON
    // schema. Bilingual — the front-end (split EN/EL pages) sends lang:"en"|"el"
    // and the report comes back in that language. Same passphrases, no logging.
    if (new URL(request.url).pathname === "/api/website-scan") {
      return handleWebsiteScan(body, env, ctx, corsOrigin);
    }

    // --- GDPR Auto-Scanner (third standalone, passphrase-gated AI Lab tool) ---
    // A static GDPR-compliance pre-audit on the SAME Worker, decoupled from the
    // Artifact, SaaS scanner AND website scanner: its own route, its own GDPR
    // extraction (trackers / CMP / policy links / cookie-setting embeds), its own
    // prompt + schema. Like the website scanner it FETCHES the URL (Option B
    // refusal if it can't), reuses fetchPageSignals + SSRF guards, and is bilingual
    // (lang:"en"|"el"). Same passphrases, no user-input logging. See handleGdprScan.
    if (new URL(request.url).pathname === "/api/gdpr-scan") {
      return handleGdprScan(body, env, ctx, corsOrigin);
    }

    // --- AI Visibility Scanner (fourth standalone, passphrase-gated AI Lab tool) ---
    // Evaluates how easily AI assistants (ChatGPT, Gemini, Claude, Perplexity) can
    // discover, parse and cite a site. Like the website + GDPR scanners it FETCHES
    // the URL (reuses fetchPageSignals + SSRF guards) PLUS three root files
    // (/robots.txt, /sitemap.xml, /llms.txt). The score is DETERMINISTIC (15
    // weighted checks summing to 100) — the model only writes the summary + 3
    // recommendations, so every point traces to a real, checkable signal. Bilingual
    // (lang:"en"|"el"). Same passphrases, no user-input logging. See handleAiVisibilityScan.
    if (new URL(request.url).pathname === "/api/ai-visibility-scan") {
      return handleAiVisibilityScan(body, env, ctx, corsOrigin);
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

    // Owner answers never get clipped by a low budget (thinking tokens count too);
    // any other role uses the smaller baseline. Both env-overridable.
    const maxOutputTokens = who === "owner"
      ? Number(env.OWNER_MAX_OUTPUT_TOKENS || DEFAULTS.OWNER_MAX_OUTPUT_TOKENS)
      : Number(env.MAX_OUTPUT_TOKENS || DEFAULTS.MAX_OUTPUT_TOKENS);
    const generationConfig = {
      temperature,
      maxOutputTokens,
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

  let res = await postJsonWithRetry(url, apiKey, withSystem, "call");

  if (res.status === 400) {
    const errText = await res.clone().text();
    if (/system\s*instruction|systemInstruction|developer instruction/i.test(errText)) {
      // Fallback: prepend system prompt to the first user message.
      const folded = foldSystemIntoFirstTurn(contents, systemPrompt);
      res = await postJsonWithRetry(url, apiKey, { contents: folded, generationConfig, ...toolsField }, "call-folded");
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

  let upstream = await postJsonWithRetry(url, apiKey, {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents,
    generationConfig,
    ...toolsField,
  }, "stream");

  if (upstream.status === 400) {
    const errText = await upstream.clone().text();
    if (/system\s*instruction|systemInstruction|developer instruction/i.test(errText)) {
      const folded = foldSystemIntoFirstTurn(contents, systemPrompt);
      upstream = await postJsonWithRetry(url, apiKey, { contents: folded, generationConfig, ...toolsField }, "stream-folded");
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

function postJson(url, apiKey, payload, timeoutMs) {
  const opts = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify(payload),
  };
  // Optional per-request timeout. The scanners pass one so a hung/overloaded
  // Google response aborts (→ retry → clean failure) instead of stalling the
  // request for 30s+. The Artifact chat omits it (streaming sends heartbeats).
  if (timeoutMs) opts.signal = AbortSignal.timeout(timeoutMs);
  return fetch(url, opts);
}

// Transient upstream statuses worth a retry. Google's Generative Language API
// occasionally returns a one-off 500 "Internal error encountered." (also 502/
// 503/504) — a short backoff + retry hides it instead of surfacing SIGNAL LOST.
// Deliberately NOT 429 (quota — retrying just burns the cap) nor 400/401/403
// (the caller handles those, e.g. the systemInstruction-400 fallback).
const TRANSIENT_STATUSES = new Set([500, 502, 503, 504]);
const MAX_UPSTREAM_RETRIES = 2; // total attempts = 1 + retries
const RETRY_BASE_DELAY_MS = 400; // linear backoff: 400ms, then 800ms

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// postJson with auto-retry on transient Google errors and network throws. Runs
// BEFORE streaming starts (while we still own the status/headers), so a single
// transient 500 is absorbed without the client ever seeing it. Non-transient
// statuses return on the first response untouched.
async function postJsonWithRetry(url, apiKey, payload, label, timeoutMs, maxRetries) {
  const retries = (typeof maxRetries === "number") ? maxRetries : MAX_UPSTREAM_RETRIES;
  let res;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      res = await postJson(url, apiKey, payload, timeoutMs);
    } catch (err) {
      if (attempt < retries) {
        console.log(`artifact ${label} retry ${attempt + 1} after throw:`, String((err && err.message) || err));
        await sleep(RETRY_BASE_DELAY_MS * (attempt + 1));
        continue;
      }
      throw err;
    }
    if (!TRANSIENT_STATUSES.has(res.status) || attempt === retries) return res;
    console.log(`artifact ${label} retry ${attempt + 1} after status ${res.status}`);
    try { await res.body?.cancel(); } catch { /* discard the failed body before retry */ }
    await sleep(RETRY_BASE_DELAY_MS * (attempt + 1));
  }
  return res;
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
// The /lib and /read commands (handleDriveOp) are STANDALONE requests with no
// stream to protect — and a COLD Apps Script container adds seconds of spin-up
// (so even a fast lib-list can miss 6s on the first call), while a lib-read also
// opens each Doc via DocumentApp.openById (slow). Give that path a longer cap so
// the first /lib and /read complete; the 6s cap stays for the per-turn pre-stream
// folds (memory/profile/library) where a slow wait would trip SIGNAL LOST.
const DRIVE_OP_TIMEOUT_MS = 20000;

async function sheetsMemoryCall(env, action, extra, timeoutMs) {
  if (!env.SHEETS_WEBHOOK_URL) return { ok: false, error: "unconfigured" };
  try {
    const res = await fetch(env.SHEETS_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, token: env.MEM_TOKEN || "", ...(extra || {}) }),
      signal: AbortSignal.timeout(timeoutMs || SHEETS_TIMEOUT_MS),
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
    const data = await sheetsMemoryCall(env, action, null, DRIVE_OP_TIMEOUT_MS);
    return json({
      ok: !!(data && data.ok),
      folderFound: !!(data && data.folderFound),
      files: (data && Array.isArray(data.files)) ? data.files : [],
      error: data && data.error,
    }, 200, corsOrigin);
  }

  if (type === "lib-read") {
    const names = Array.isArray(op.names) ? op.names.filter((n) => typeof n === "string" && n) : [];
    const data = await sheetsMemoryCall(env, "lib-read", { names }, DRIVE_OP_TIMEOUT_MS);
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

/* ============================================================================
 * SaaS Readiness Scanner  —  POST /api/saas-scan
 * ----------------------------------------------------------------------------
 * A standalone Noustelos AI Lab utility, NOT part of The Artifact. It shares
 * this Worker (and the GOOGLE_API_KEY secret) but has its OWN passphrase, its
 * OWN system prompt (a senior SaaS product strategist — no Artifact persona),
 * and emits STRUCTURED JSON (Gemini responseSchema) that the front-end renders
 * as cards. No persona/memory/Drive/kill-switch, and it does NOT log user input.
 *
 * Access: gated by the SAME passphrases as the Artifact chat (owner PASSPHRASE +
 * guest GUEST_PASSPHRASE/PASSPHRASES) — no separate secret. So whoever has an
 * Artifact code can run the scanner with it; revoking the guest code revokes both.
 *
 * Vars (engine/wrangler.toml):
 *   SCANNER_MODEL  (var, optional) default "gemini-2.5-flash" — a fast, cheap
 *                  Gemini tier with reliable structured output (the Artifact's
 *                  thinking Gemma is NOT used here).
 * ==========================================================================*/

const SCAN_MIN_CHARS = 40;     // reject thin input (front-end mirrors this)
const SCAN_MAX_CHARS = 4000;   // cap the description to bound token cost
const SCAN_DEFAULT_MODEL = "gemini-2.5-flash";
// Per-attempt timeout on the scanners' Google call. Bounds a hung/overloaded
// response so the request fails cleanly (→ retry, then scan_failed) instead of
// stalling for 30s+. Generous so it does NOT cut a valid-but-slow report (a full
// 11-field JSON with a 7-axis breakdown can legitimately take ~10-15s).
const SCANNER_AI_TIMEOUT_MS = 18000;
// Gemini intermittently 503s "overloaded" or stalls. A couple of retries absorb a
// transient blip without making the user wait through many timeouts during a real
// outage (worst case ≈ (retries+1) × timeout).
const SCANNER_MAX_RETRIES = 2; // 3 attempts

const SCAN_SYSTEM_PROMPT =
  "You are a senior SaaS product strategist and technical analyst. Your job is " +
  "to evaluate whether a digital project can become a scalable SaaS product. " +
  "Analyze productization potential, repeatability, technical architecture, " +
  "deployment model, market clarity, monetization paths, operational risks and " +
  "buyer appeal. Be practical, direct and specific. Do not exaggerate. Avoid " +
  "vague filler like \"great potential\" unless you give a concrete, grounded " +
  "reason. Write in clear, professional English.\n\n" +
  "Scoring bands — set score_label to match the numeric score:\n" +
  "- 0-30: Weak SaaS Fit\n" +
  "- 31-55: Early Potential\n" +
  "- 56-75: Promising SaaS Candidate\n" +
  "- 76-90: Strong SaaS Candidate\n" +
  "- 91-100: Highly Scalable SaaS Opportunity\n\n" +
  "Return ONLY structured JSON matching the required schema. Each list holds " +
  "3-7 concise, specific items. executive_summary is 2-4 sentences; " +
  "final_verdict is a single clear sentence.";

// Gemini structured-output schema (OpenAPI subset). propertyOrdering keeps a
// stable, render-friendly field order.
const SCAN_FIELDS = [
  "score", "score_label", "executive_summary", "strengths", "risks",
  "technical_gaps", "monetization_paths", "recommended_next_steps", "final_verdict",
];
const SCAN_SCHEMA = {
  type: "object",
  properties: {
    score: { type: "integer" },
    score_label: { type: "string" },
    executive_summary: { type: "string" },
    strengths: { type: "array", items: { type: "string" } },
    risks: { type: "array", items: { type: "string" } },
    technical_gaps: { type: "array", items: { type: "string" } },
    monetization_paths: { type: "array", items: { type: "string" } },
    recommended_next_steps: { type: "array", items: { type: "string" } },
    final_verdict: { type: "string" },
  },
  required: SCAN_FIELDS,
  propertyOrdering: SCAN_FIELDS,
};

async function handleSaasScan(body, env, ctx, corsOrigin) {
  if (!env.GOOGLE_API_KEY) {
    return json({ error: "scan_failed" }, 500, corsOrigin);
  }

  // --- Passphrase gate — SAME codes as the Artifact chat ---
  // Reuses collectPassphrases (owner PASSPHRASE + guest GUEST_PASSPHRASE/
  // PASSPHRASES), so anyone who can open the Artifact can run the scanner with
  // the same code — no separate secret to set. The role isn't used here (the
  // scanner has no per-role behavior); we only need "is this a valid code".
  const valid = collectPassphrases(env);
  if (valid.size) {
    const provided = typeof body.passphrase === "string" ? body.passphrase.trim() : "";
    if (!valid.has(provided)) return json({ error: "locked" }, 401, corsOrigin);
  }
  // Lightweight unlock check for the UI (validates the code, spends no model call).
  if (body.verify) return json({ ok: true }, 200, corsOrigin);

  // --- Validate input ---
  const description = (typeof body.description === "string" ? body.description : "").trim();
  if (description.length < SCAN_MIN_CHARS) {
    return json({ error: "too_short" }, 400, corsOrigin);
  }

  const clean = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const projectName = clean(body.projectName, 120);
  const targetMarket = clean(body.targetMarket, 60);
  const stage = clean(body.stage, 60);
  const url = clean(body.url, 300);

  const lines = [];
  if (projectName) lines.push(`Project Name: ${projectName}`);
  if (targetMarket) lines.push(`Target Market: ${targetMarket}`);
  if (stage) lines.push(`Current Stage: ${stage}`);
  if (url) lines.push(`Existing URL (context only — NOT fetched): ${url}`);
  lines.push("", "Project Description:", description.slice(0, SCAN_MAX_CHARS));
  const userText = lines.join("\n");

  // --- Call the model for structured JSON ---
  let result;
  try {
    result = await callScanner({
      apiKey: env.GOOGLE_API_KEY,
      model: env.SCANNER_MODEL || SCAN_DEFAULT_MODEL,
      userText,
    });
  } catch (err) {
    console.error("saas-scan error:", String((err && err.message) || err));
    return json({ error: "scan_failed" }, 502, corsOrigin);
  }
  if (!result) return json({ error: "bad_format" }, 502, corsOrigin);

  return json({ result }, 200, corsOrigin);
}

async function callScanner({ apiKey, model, userText }) {
  const apiUrl = `${API_BASE}/${encodeURIComponent(model)}:generateContent`;
  const payload = {
    systemInstruction: { parts: [{ text: SCAN_SYSTEM_PROMPT }] },
    contents: [{ role: "user", parts: [{ text: userText }] }],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 2048,
      responseMimeType: "application/json",
      responseSchema: SCAN_SCHEMA,
      // Gemini 2.5 Flash is a thinking model; disable thinking so the whole
      // budget goes to the JSON answer (faster, cheaper, never clips the JSON).
      thinkingConfig: { thinkingBudget: 0 },
    },
  };
  // Reuse the transient-500 retry the Artifact uses, so a one-off Google blip
  // doesn't surface as a scan failure.
  const res = await postJsonWithRetry(apiUrl, apiKey, payload, "saas-scan", SCANNER_AI_TIMEOUT_MS, SCANNER_MAX_RETRIES);
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google API ${res.status}: ${errText.slice(0, 300)}`);
  }
  const data = await res.json();
  return parseScanJson(extractReply(data));
}

// Parse the model's JSON answer defensively (strip stray code fences) and
// normalize into the exact shape the front-end renders. Returns null if the
// payload can't be salvaged into a usable result.
function parseScanJson(text) {
  if (!text) return null;
  let raw = String(text).trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) raw = fence[1].trim();
  let obj;
  try { obj = JSON.parse(raw); } catch { return null; }
  if (!obj || typeof obj !== "object") return null;

  const list = (v) => Array.isArray(v)
    ? v.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim()).slice(0, 10)
    : [];
  const str = (v) => (typeof v === "string" ? v.trim() : "");
  let score = Number(obj.score);
  if (!Number.isFinite(score)) score = 0;
  score = Math.min(100, Math.max(0, Math.round(score)));

  const result = {
    score,
    score_label: str(obj.score_label) || scoreLabelFor(score),
    executive_summary: str(obj.executive_summary),
    strengths: list(obj.strengths),
    risks: list(obj.risks),
    technical_gaps: list(obj.technical_gaps),
    monetization_paths: list(obj.monetization_paths),
    recommended_next_steps: list(obj.recommended_next_steps),
    final_verdict: str(obj.final_verdict),
  };
  // Require at least the core fields, else treat as unusable (→ bad_format).
  if (!result.executive_summary && !result.final_verdict) return null;
  return result;
}

function scoreLabelFor(score) {
  if (score <= 30) return "Weak SaaS Fit";
  if (score <= 55) return "Early Potential";
  if (score <= 75) return "Promising SaaS Candidate";
  if (score <= 90) return "Strong SaaS Candidate";
  return "Highly Scalable SaaS Opportunity";
}

/* ============================================================================
 * Website Quality Scanner  —  POST /api/website-scan
 * ----------------------------------------------------------------------------
 * A standalone Noustelos AI Lab utility, sibling to the SaaS scanner above and
 * fully decoupled from The Artifact. Shares this Worker + GOOGLE_API_KEY but has
 * its OWN system prompt (a senior website strategist / SEO + conversion auditor)
 * and its OWN richer JSON schema (overall score, a 7-axis score breakdown, what
 * works / holds back, client-dependent improvements, a realistic "what would
 * raise the score" projection, next steps, verdict). Emits structured JSON the
 * front-end renders as cards. No persona/memory/Drive/kill-switch; user input is
 * NOT logged. The Worker FETCHES the provided URL (server-rendered HTML only) and
 * extracts coarse public signals (fetchPageSignals/extractSignals) BEFORE the AI
 * call, so the audit is grounded in real page data — not assumptions. If the fetch
 * fails it REFUSES to produce a scored report (Option B); see websiteFetchRefusal.
 * Full SSRF guards (http/https only, private/metadata IPs blocked, redirect cap,
 * timeout, size cap). NOT a full crawl/Lighthouse/CWV/ranking audit.
 *
 * Bilingual: the split EN/EL front-end sends lang:"en"|"el" and the model writes
 * every string value (labels, notes, summaries, lists, verdict) in that language.
 *
 * Access: SAME passphrases as the Artifact chat + SaaS scanner (collectPassphrases).
 * Model: SCANNER_MODEL (default gemini-2.5-flash), thinkingBudget:0.
 * ==========================================================================*/

const WEBSITE_SCAN_MAX_NOTES = 2000;
const WEBSITE_SCORE_AXES = [
  "design_visual_trust", "message_clarity", "seo_readiness", "conversion_readiness",
  "trust_signals", "content_completeness", "technical_basics",
];

// EN/EL score-band labels for the overall readiness score, keyed by language.
const WEBSITE_BANDS = {
  en: [
    [30, "Not Ready"],
    [55, "Needs Major Work"],
    [75, "Usable but Needs Improvement"],
    [89, "Strong Launch Candidate"],
    [100, "Premium Ready"],
  ],
  el: [
    [30, "Δεν είναι έτοιμο"],
    [55, "Θέλει σημαντική δουλειά"],
    [75, "Χρησιμοποιήσιμο αλλά θέλει βελτίωση"],
    [89, "Δυνατό για launch"],
    [100, "Premium επίπεδο ετοιμότητας"],
  ],
};

function websiteScoreLabel(score, lang) {
  const bands = WEBSITE_BANDS[lang] || WEBSITE_BANDS.en;
  for (const [max, label] of bands) { if (score <= max) return label; }
  return bands[bands.length - 1][1];
}

function buildWebsitePrompt(lang) {
  const isEl = lang === "el";
  const langName = isEl ? "Greek" : "English";
  const bandLines = (WEBSITE_BANDS[lang] || WEBSITE_BANDS.en)
    .map(([max, label], i, arr) => {
      const min = i === 0 ? 0 : arr[i - 1][0] + 1;
      return `- ${min}-${max}: ${label}`;
    }).join("\n");
  return (
    "You are a senior website strategist, SEO auditor and conversion consultant. " +
    "Your job is to evaluate a website's launch readiness, clarity, SEO foundation, " +
    "trust signals, conversion flow, content completeness and technical basics. Be " +
    "practical, honest and specific. Do not exaggerate.\n\n" +
    "DATA SOURCE: You are given REAL public page signals that were fetched and " +
    "extracted from the provided URL's server-rendered HTML (page title, meta " +
    "description, headings, canonical, Open Graph, viewport, robots, visible word " +
    "count, image/alt counts, internal/external link counts, phone/email/CTA/" +
    "structured-data presence, and a visible-text excerpt). BASE YOUR AUDIT ON THESE " +
    "EXTRACTED SIGNALS — not on assumptions. Frame the report as based on public page " +
    "signals extracted from the provided URL: begin executive_summary with that " +
    "framing (e.g. \"Based on public page signals extracted from the provided URL...\"). " +
    "Treat a missing/empty signal as a FINDING (e.g. no meta description, no H1, no " +
    "structured data) rather than inventing detail.\n\n" +
    "HONESTY RULES: You have STATIC HTML signals only — not rendered output, not " +
    "performance metrics, not analytics. Do NOT claim you ran a full crawl, a full " +
    "technical audit, a Lighthouse or Core Web Vitals measurement, or any Google " +
    "ranking prediction. Do not give legal or financial advice. Clearly SEPARATE " +
    "builder-controlled improvements from client-dependent improvements (testimonials, " +
    "real project photos, reviews, certifications, case studies, pricing, FAQs, " +
    "local-business proof). Always give realistic score-improvement logic: a good " +
    "site may be 85-90% ready but capped below 95-100% without client-provided proof. " +
    "The disclaimer field MUST state the report is based only on public HTML page " +
    "signals — not a full technical audit, Lighthouse, Core Web Vitals, full SEO " +
    "crawl or ranking prediction.\n\n" +
    `Scoring bands — set overall_label to match overall_score:\n${bandLines}\n\n` +
    "Each score_breakdown axis is 0-100 with one short note grounded in the signals. " +
    "Lists hold 3-7 concise, specific items. executive_summary is 2-4 sentences; " +
    "final_verdict is a single clear sentence.\n\n" +
    `IMPORTANT: Write EVERY string value in the report (labels, notes, summaries, ` +
    `list items, ranges, verdict, disclaimer) in ${langName}. Return ONLY structured ` +
    "JSON matching the required schema."
  );
}

// Nested Gemini schema. Each breakdown axis is {score, note}; the raise-score
// projection is a small object. propertyOrdering keeps render order stable.
const WEBSITE_AXIS_SCHEMA = {
  type: "object",
  properties: { score: { type: "integer" }, note: { type: "string" } },
  required: ["score", "note"],
  propertyOrdering: ["score", "note"],
};
const WEBSITE_BREAKDOWN_SCHEMA = {
  type: "object",
  properties: WEBSITE_SCORE_AXES.reduce((acc, k) => { acc[k] = WEBSITE_AXIS_SCHEMA; return acc; }, {}),
  required: WEBSITE_SCORE_AXES,
  propertyOrdering: WEBSITE_SCORE_AXES,
};
const WEBSITE_RAISE_SCHEMA = {
  type: "object",
  properties: {
    current_estimate: { type: "string" },
    realistic_improved_range: { type: "string" },
    required_improvements: { type: "array", items: { type: "string" } },
  },
  required: ["current_estimate", "realistic_improved_range", "required_improvements"],
  propertyOrdering: ["current_estimate", "realistic_improved_range", "required_improvements"],
};
const WEBSITE_SCAN_FIELDS = [
  "overall_score", "overall_label", "executive_summary", "score_breakdown",
  "what_works_well", "what_holds_it_back", "client_dependent_improvements",
  "what_would_raise_the_score", "recommended_next_steps", "final_verdict", "disclaimer",
];
const WEBSITE_SCAN_SCHEMA = {
  type: "object",
  properties: {
    overall_score: { type: "integer" },
    overall_label: { type: "string" },
    executive_summary: { type: "string" },
    score_breakdown: WEBSITE_BREAKDOWN_SCHEMA,
    what_works_well: { type: "array", items: { type: "string" } },
    what_holds_it_back: { type: "array", items: { type: "string" } },
    client_dependent_improvements: { type: "array", items: { type: "string" } },
    what_would_raise_the_score: WEBSITE_RAISE_SCHEMA,
    recommended_next_steps: { type: "array", items: { type: "string" } },
    final_verdict: { type: "string" },
    disclaimer: { type: "string" },
  },
  required: WEBSITE_SCAN_FIELDS,
  propertyOrdering: WEBSITE_SCAN_FIELDS,
};

/* ---- Real page fetch + public-signal extraction ------------------------- *
 * The website scanner now ACTUALLY fetches the provided URL (server-rendered
 * HTML only) and extracts coarse public signals BEFORE calling the AI, so the
 * report is grounded in real page data, not assumptions. If the fetch fails we
 * REFUSE to produce a scored report (Option B) — see fetchPageSignals callers.
 * Full SSRF guards: http/https only, private/loopback/metadata IPs blocked,
 * manual redirect cap (each hop re-validated), per-hop timeout, response-size
 * cap. We present as a normal browser UA (owner controls the URLs). NOTE: we
 * cannot DNS-resolve in the Worker, so a hostname that resolves to a private IP
 * is not caught — best-effort, acceptable for this owner-facing tool. */
const WEBSITE_FETCH_TIMEOUT_MS = 9000;
const WEBSITE_FETCH_MAX_BYTES = 1_500_000;
const WEBSITE_MAX_REDIRECTS = 5;
const WEBSITE_MIN_CONTENT_WORDS = 25;
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const CTA_WORDS = [
  "contact", "get started", "sign up", "subscribe", "book now", "book a",
  "buy now", "order now", "get a quote", "request a", "call now", "learn more",
  "get in touch", "schedule", "free trial", "download", "shop now", "join",
  "start now", "επικοινων", "κλείσε", "κράτηση", "αγορά", "ξεκίνα", "εγγραφ",
  "μάθε περισσότερα", "ζήτησε", "καλέστε", "παραγγελ", "δωρεάν",
];

// Best-effort SSRF guard for a literal host (no DNS resolution available).
function isPrivateHost(hostname) {
  const h = String(hostname || "").toLowerCase().replace(/\.$/, "");
  if (!h) return true;
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") ||
      h.endsWith(".internal") || h === "metadata.google.internal") return true;
  if (h.includes(":")) { // IPv6 literal
    if (h === "::1" || h === "::") return true;
    if (/^fe80:/.test(h) || /^f[cd][0-9a-f]{2}:/.test(h)) return true; // fe80::/10, fc00::/7
    return false;
  }
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const o = m.slice(1).map(Number);
    if (o.some((n) => n > 255)) return true;
    if (o[0] === 10 || o[0] === 127 || o[0] === 0) return true;
    if (o[0] === 169 && o[1] === 254) return true;          // link-local / cloud metadata
    if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return true;
    if (o[0] === 192 && o[1] === 168) return true;
    if (o[0] === 100 && o[1] >= 64 && o[1] <= 127) return true; // CGNAT
    return false;
  }
  return false; // a normal public hostname
}

function parseSafeUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (isPrivateHost(u.hostname)) return null;
  return u;
}

function normalizeFetchUrl(raw) {
  let s = String(raw || "").trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) {
    // ok as-is
  } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    return null; // explicit non-http(s) scheme (ftp://, file://, …)
  } else {
    s = "https://" + s; // bare domain or host:port
  }
  return parseSafeUrl(s);
}

// Manual redirect follow so every hop is re-validated against the SSRF guard.
async function fetchFollow(startUrl) {
  let next = startUrl; // URL object or string
  for (let i = 0; i <= WEBSITE_MAX_REDIRECTS; i++) {
    const u = (typeof next === "string") ? parseSafeUrl(next) : next;
    if (!u) return { ok: false, reason: "blocked" };
    const res = await fetch(u.href, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(WEBSITE_FETCH_TIMEOUT_MS),
      headers: {
        "User-Agent": BROWSER_UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,el;q=0.8",
      },
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return { ok: true, res, url: u.href };
      let target;
      try { target = new URL(loc, u.href); } catch { return { ok: false, reason: "network" }; }
      const safe = parseSafeUrl(target.href);
      if (!safe) return { ok: false, reason: "blocked" };
      next = safe;
      continue;
    }
    return { ok: true, res, url: u.href };
  }
  return { ok: false, reason: "too_many_redirects" };
}

// Read a response body up to maxBytes, then stop (cap memory/CPU).
async function readCapped(res, maxBytes) {
  if (!res.body || !res.body.getReader) {
    const t = await res.text();
    return t.length > maxBytes ? t.slice(0, maxBytes) : t;
  }
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value && value.length) {
      chunks.push(value);
      total += value.length;
      if (total >= maxBytes) { try { await reader.cancel(); } catch (_e) {} break; }
    }
  }
  const cap = Math.min(total, maxBytes);
  const buf = new Uint8Array(cap);
  let off = 0;
  for (const c of chunks) {
    if (off >= cap) break;
    const slice = (off + c.length > cap) ? c.subarray(0, cap - off) : c;
    buf.set(slice, off);
    off += slice.length;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(buf);
}

async function fetchPageSignals(rawUrl, extractor) {
  const extract = extractor || extractSignals;
  const start = normalizeFetchUrl(rawUrl);
  if (!start) return { ok: false, reason: "blocked" };

  let hop;
  try {
    hop = await fetchFollow(start);
  } catch (err) {
    const msg = String((err && err.message) || err);
    if (/timed out|timeout|aborted|signal/i.test(msg)) return { ok: false, reason: "timeout" };
    return { ok: false, reason: "network" };
  }
  if (!hop.ok) return hop;

  const res = hop.res;
  if (res.status < 200 || res.status >= 300) {
    // Cloudflare origin errors (520-527, 530) mean the Worker couldn't reach the
    // site at all (DNS fail, connection refused, origin down) — report as such,
    // not as an opaque "HTTP 530".
    if (res.status === 530 || (res.status >= 520 && res.status <= 527)) {
      return { ok: false, reason: "network" };
    }
    return { ok: false, reason: "http", status: res.status };
  }
  const ct = (res.headers.get("content-type") || "").toLowerCase();
  if (ct && !/(text\/html|application\/xhtml\+xml|text\/plain)/.test(ct)) {
    return { ok: false, reason: "not_html" };
  }

  let html;
  try {
    html = await readCapped(res, WEBSITE_FETCH_MAX_BYTES);
  } catch (err) {
    const msg = String((err && err.message) || err);
    if (/timed out|timeout|aborted/i.test(msg)) return { ok: false, reason: "timeout" };
    return { ok: false, reason: "network" };
  }

  const signals = extract(html, hop.url);
  // Thin / JS-rendered shell → almost no readable HTML → refuse (no assumptions).
  if (signals.word_count < WEBSITE_MIN_CONTENT_WORDS) {
    return { ok: false, reason: "thin" };
  }
  return { ok: true, signals };
}

function decodeEntities(s) {
  if (!s) return "";
  return String(s)
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(parseInt(n, 10)); } catch { return _; } })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => { try { return String.fromCodePoint(parseInt(n, 16)); } catch { return _; } })
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

// Find the content of a <meta> whose name OR property equals key (any order).
function metaContentOf(html, key) {
  const re = new RegExp("<meta\\b[^>]*\\b(?:name|property)\\s*=\\s*[\"']" + key + "[\"'][^>]*>", "i");
  const tag = html.match(re);
  if (!tag) return "";
  const c = tag[0].match(/\bcontent\s*=\s*["']([^"']*)["']/i);
  return c ? decodeEntities(c[1]).replace(/\s+/g, " ").trim() : "";
}

function extractSignals(html, baseUrl) {
  const stripTags = (s) =>
    decodeEntities(String(s).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

  const titleM = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleM ? stripTags(titleM[1]) : "";

  const canM = html.match(/<link\b[^>]*\brel\s*=\s*["']canonical["'][^>]*>/i);
  let canonical = "";
  if (canM) {
    const h = canM[0].match(/\bhref\s*=\s*["']([^"']+)["']/i);
    canonical = h ? decodeEntities(h[1]).trim() : "";
  }

  const h1M = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  const h1 = h1M ? stripTags(h1M[1]) : "";

  const collectHeads = (tag) => {
    const re = new RegExp("<" + tag + "\\b[^>]*>([\\s\\S]*?)<\\/" + tag + ">", "gi");
    const out = [];
    let m;
    while ((m = re.exec(html)) && out.length < 40) {
      const t = stripTags(m[1]);
      if (t) out.push(t);
    }
    return out;
  };
  const h2s = collectHeads("h2");
  const h3s = collectHeads("h3");

  const imgTags = html.match(/<img\b[^>]*>/gi) || [];
  const imgCount = imgTags.length;
  const imgAlt = imgTags.filter((t) => /\balt\s*=\s*["'][^"']*\S[^"']*["']/i.test(t)).length;

  let baseHost = "";
  try { baseHost = new URL(baseUrl).host.replace(/^www\./i, "").toLowerCase(); } catch (_e) {}
  let internal = 0, external = 0, hasEmail = false, hasPhone = false;
  const linkRe = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi;
  let lm;
  while ((lm = linkRe.exec(html))) {
    const href = lm[1].trim();
    if (/^mailto:/i.test(href)) { hasEmail = true; continue; }
    if (/^tel:/i.test(href)) { hasPhone = true; continue; }
    if (/^(#|javascript:|data:)/i.test(href)) continue;
    let host = "";
    try { host = new URL(href, baseUrl).host.replace(/^www\./i, "").toLowerCase(); } catch { continue; }
    if (!host || host === baseHost) internal++; else external++;
  }

  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ");
  text = decodeEntities(text).replace(/\s+/g, " ").trim();
  const words = text ? text.split(" ").filter(Boolean).length : 0;
  const excerpt = text.slice(0, 320);

  if (!hasEmail && /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(text)) hasEmail = true;
  if (!hasPhone && /\+?\d[\d\s().-]{7,}\d/.test(text)) hasPhone = true;

  const lc = text.toLowerCase();
  const ctaSamples = CTA_WORDS.filter((w) => lc.includes(w)).slice(0, 6);

  const hasSchema =
    /<script\b[^>]*type\s*=\s*["']application\/ld\+json["']/i.test(html) ||
    /\bitemscope\b/i.test(html) ||
    /itemtype\s*=\s*["'][^"']*schema\.org/i.test(html);
  const schemaTypes = [];
  {
    const re = /"@type"\s*:\s*"([^"]+)"/gi;
    let sm;
    while ((sm = re.exec(html)) && schemaTypes.length < 8) {
      if (!schemaTypes.includes(sm[1])) schemaTypes.push(sm[1]);
    }
  }

  return {
    final_url: baseUrl,
    title,
    meta_description: metaContentOf(html, "description"),
    h1,
    h2_count: h2s.length,
    h2_samples: h2s.slice(0, 8),
    h3_count: h3s.length,
    h3_samples: h3s.slice(0, 8),
    canonical,
    og_title: metaContentOf(html, "og:title"),
    og_description: metaContentOf(html, "og:description"),
    viewport: metaContentOf(html, "viewport"),
    robots: metaContentOf(html, "robots"),
    word_count: words,
    image_count: imgCount,
    image_with_alt_count: imgAlt,
    internal_link_count: internal,
    external_link_count: external,
    has_phone: hasPhone,
    has_email: hasEmail,
    has_cta: ctaSamples.length > 0,
    cta_samples: ctaSamples,
    has_schema_org: hasSchema,
    schema_types: schemaTypes,
    excerpt,
  };
}

// Render extracted signals as a plain-text block fed to the model.
function renderSignalsBlock(s, heading) {
  const yn = (b) => (b ? "yes" : "no");
  const lines = [];
  if (heading) lines.push(heading);
  lines.push(`Fetched URL: ${s.final_url}`);
  lines.push(`Page title: ${s.title || "(none)"}`);
  lines.push(`Meta description: ${s.meta_description || "(none)"}`);
  lines.push(`H1: ${s.h1 || "(none)"}`);
  lines.push(`H2 headings (${s.h2_count}): ${s.h2_samples.join(" | ") || "(none)"}`);
  lines.push(`H3 headings (${s.h3_count}): ${s.h3_samples.join(" | ") || "(none)"}`);
  lines.push(`Canonical URL: ${s.canonical || "(none)"}`);
  lines.push(`Open Graph title: ${s.og_title || "(none)"}`);
  lines.push(`Open Graph description: ${s.og_description || "(none)"}`);
  lines.push(`Viewport meta: ${s.viewport || "(none)"}`);
  lines.push(`Robots meta: ${s.robots || "(none)"}`);
  lines.push(`Visible word count: ${s.word_count}`);
  lines.push(`Images: ${s.image_count} (with alt text: ${s.image_with_alt_count})`);
  lines.push(`Internal links: ${s.internal_link_count}; External links: ${s.external_link_count}`);
  lines.push(`Phone present: ${yn(s.has_phone)}; Email present: ${yn(s.has_email)}`);
  lines.push(`CTA-like words present: ${yn(s.has_cta)}${s.cta_samples.length ? " (" + s.cta_samples.join(", ") + ")" : ""}`);
  lines.push(`Structured data (schema.org) detected: ${yn(s.has_schema_org)}${s.schema_types.length ? " [" + s.schema_types.join(", ") + "]" : ""}`);
  lines.push(`Visible text excerpt: ${s.excerpt || "(none)"}`);
  return lines.join("\n");
}

// Localized Option-B refusal message (no scored report when the fetch fails).
function websiteFetchRefusal(reason, lang, opts) {
  const o = opts || {};
  const el = lang === "el";
  const reasons = el ? {
    timeout: "η σελίδα άργησε πολύ να απαντήσει (timeout)",
    http: `ο διακομιστής επέστρεψε HTTP ${o.status || "error"}`,
    blocked: "το URL δεν μπορούσε να ανακτηθεί με ασφάλεια",
    not_html: "το URL δεν επέστρεψε σελίδα HTML",
    thin: "η σελίδα επέστρεψε σχεδόν καθόλου αναγνώσιμο HTML (είτε φορτώνεται με JavaScript, είτε είναι σχεδόν κενή), οπότε δεν υπάρχει αρκετό περιεχόμενο για ουσιαστική server-side ανάλυση",
    too_many_redirects: "το URL έκανε υπερβολικά πολλές ανακατευθύνσεις",
    network: "δεν ήταν δυνατή η σύνδεση με τη σελίδα",
  } : {
    timeout: "the page took too long to respond (timeout)",
    http: `the server returned HTTP ${o.status || "error"}`,
    blocked: "the URL could not be fetched safely",
    not_html: "the URL did not return an HTML page",
    thin: "the page returned almost no readable HTML (it is either JavaScript-rendered or nearly empty), so there is not enough content for a meaningful server-side scan",
    too_many_redirects: "the URL redirected too many times",
    network: "the page could not be reached",
  };
  const why = reasons[reason] || reasons.network;
  const who = o.siteLabel ? `${o.siteLabel}: ` : "";
  if (el) {
    return `Περιορισμένη ανάλυση: ${who}${why}. Δεν δημιουργήθηκε βαθμολογημένη αναφορά, γιατί δεν στηρίζουμε αξιολόγηση σε υποθέσεις. Έλεγξε το URL και δοκίμασε ξανά.`;
  }
  return `Limited analysis: ${who}${why}. No scored report was produced, because we will not base an assessment on assumptions. Check the URL and try again.`;
}

async function handleWebsiteScan(body, env, ctx, corsOrigin) {
  if (!env.GOOGLE_API_KEY) {
    return json({ error: "scan_failed" }, 500, corsOrigin);
  }

  // --- Passphrase gate — SAME codes as the Artifact chat / SaaS scanner ---
  const valid = collectPassphrases(env);
  if (valid.size) {
    const provided = typeof body.passphrase === "string" ? body.passphrase.trim() : "";
    if (!valid.has(provided)) return json({ error: "locked" }, 401, corsOrigin);
  }
  if (body.verify) return json({ ok: true }, 200, corsOrigin);

  const lang = body.lang === "el" ? "el" : "en";

  // --- Validate input. URL is the only hard requirement (context only). ---
  const clean = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  // Loose URL shape check — must look like a domain/URL, not full validation.
  const urlOk = (u) => /^(https?:\/\/)?[^\s.]+\.[^\s]{2,}$/i.test(u);
  const url = clean(body.url, 300);
  if (!url || !urlOk(url)) {
    return json({ error: "url_required" }, 400, corsOrigin);
  }

  const businessType = clean(body.businessType, 80);
  const goal = clean(body.goal, 80);
  const stage = clean(body.stage, 80);
  const notes = clean(body.notes, WEBSITE_SCAN_MAX_NOTES);
  const model = env.SCANNER_MODEL || SCAN_DEFAULT_MODEL;

  const sharedContext = [];
  if (businessType) sharedContext.push(`Business Type: ${businessType}`);
  if (goal) sharedContext.push(`Website Goal: ${goal}`);
  if (stage) sharedContext.push(`Current Stage: ${stage}`);

  // --- Comparison mode (web scanner only): two sites → a comparison report. ---
  // Triggered by `compare:true` + a second URL. The Business Type/Goal/Stage are
  // SHARED context (both sites judged for the same purpose); Site B adds only a URL
  // + optional notes. Same passphrase/model, its own prompt + schema (mode:"compare").
  if (body.compare === true) {
    const urlB = clean(body.urlB, 300);
    if (!urlB || !urlOk(urlB)) {
      return json({ error: "url_required" }, 400, corsOrigin);
    }
    const notesB = clean(body.notesB, WEBSITE_SCAN_MAX_NOTES);

    // Fetch BOTH sites' real signals. Option B: if EITHER fails, no comparison.
    const [fa, fb] = await Promise.all([fetchPageSignals(url), fetchPageSignals(urlB)]);
    if (!fa.ok) {
      return json({ error: "unreachable", message: websiteFetchRefusal(fa.reason, lang, { status: fa.status, siteLabel: hostFromUrl(url) }) }, 200, corsOrigin);
    }
    if (!fb.ok) {
      return json({ error: "unreachable", message: websiteFetchRefusal(fb.reason, lang, { status: fb.status, siteLabel: hostFromUrl(urlB) }) }, 200, corsOrigin);
    }

    const cmpLines = ["Compare these two websites for the SAME purpose, using the REAL extracted page signals below."];
    if (sharedContext.length) cmpLines.push("", "Shared context:", ...sharedContext);
    cmpLines.push("", renderSignalsBlock(fa.signals, "=== SITE A ==="));
    if (notes) cmpLines.push("Site A owner notes:", notes);
    cmpLines.push("", renderSignalsBlock(fb.signals, "=== SITE B ==="));
    if (notesB) cmpLines.push("Site B owner notes:", notesB);

    let cmp;
    try {
      cmp = await callWebsiteCompare({
        apiKey: env.GOOGLE_API_KEY,
        model,
        userText: cmpLines.join("\n"),
        lang,
        labelA: hostFromUrl(url),
        labelB: hostFromUrl(urlB),
      });
    } catch (err) {
      console.error("website-compare error:", String((err && err.message) || err));
      return json({ error: "scan_failed" }, 502, corsOrigin);
    }
    if (!cmp) return json({ error: "bad_format" }, 502, corsOrigin);
    return json({ result: cmp }, 200, corsOrigin);
  }

  // --- Single-site report (default). ---
  // Fetch + extract real signals first. Option B: refuse if we can't read it.
  const fetched = await fetchPageSignals(url);
  if (!fetched.ok) {
    return json({ error: "unreachable", message: websiteFetchRefusal(fetched.reason, lang, { status: fetched.status }) }, 200, corsOrigin);
  }
  const lines = [renderSignalsBlock(fetched.signals)];
  if (sharedContext.length) lines.push("", "User-provided context:", ...sharedContext);
  if (notes) lines.push("", "Owner Notes:", notes);
  const userText = lines.join("\n");

  let result;
  try {
    result = await callWebsiteScanner({
      apiKey: env.GOOGLE_API_KEY,
      model,
      userText,
      lang,
    });
  } catch (err) {
    console.error("website-scan error:", String((err && err.message) || err));
    return json({ error: "scan_failed" }, 502, corsOrigin);
  }
  if (!result) return json({ error: "bad_format" }, 502, corsOrigin);

  return json({ result }, 200, corsOrigin);
}

async function callWebsiteScanner({ apiKey, model, userText, lang }) {
  const apiUrl = `${API_BASE}/${encodeURIComponent(model)}:generateContent`;
  const payload = {
    systemInstruction: { parts: [{ text: buildWebsitePrompt(lang) }] },
    contents: [{ role: "user", parts: [{ text: userText }] }],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 3072,
      responseMimeType: "application/json",
      responseSchema: WEBSITE_SCAN_SCHEMA,
      thinkingConfig: { thinkingBudget: 0 },
    },
  };
  const res = await postJsonWithRetry(apiUrl, apiKey, payload, "website-scan", SCANNER_AI_TIMEOUT_MS, SCANNER_MAX_RETRIES);
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google API ${res.status}: ${errText.slice(0, 300)}`);
  }
  const data = await res.json();
  return parseWebsiteScanJson(extractReply(data), lang);
}

// Parse + normalize the website report defensively into the exact shape the
// front-end renders. Returns null if it can't be salvaged (→ bad_format).
function parseWebsiteScanJson(text, lang) {
  if (!text) return null;
  let raw = String(text).trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) raw = fence[1].trim();
  let obj;
  try { obj = JSON.parse(raw); } catch { return null; }
  if (!obj || typeof obj !== "object") return null;

  const list = (v) => Array.isArray(v)
    ? v.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim()).slice(0, 12)
    : [];
  const str = (v) => (typeof v === "string" ? v.trim() : "");
  const clampScore = (v) => {
    let n = Number(v);
    if (!Number.isFinite(n)) n = 0;
    return Math.min(100, Math.max(0, Math.round(n)));
  };

  const overall = clampScore(obj.overall_score);

  // Normalize the 7-axis breakdown; drop axes the model omitted.
  const srcBreak = (obj.score_breakdown && typeof obj.score_breakdown === "object") ? obj.score_breakdown : {};
  const breakdown = {};
  for (const axis of WEBSITE_SCORE_AXES) {
    const a = srcBreak[axis];
    if (a && typeof a === "object") {
      breakdown[axis] = { score: clampScore(a.score), note: str(a.note) };
    }
  }

  const srcRaise = (obj.what_would_raise_the_score && typeof obj.what_would_raise_the_score === "object")
    ? obj.what_would_raise_the_score : {};

  const result = {
    mode: "single",
    language: lang,
    overall_score: overall,
    overall_label: str(obj.overall_label) || websiteScoreLabel(overall, lang),
    executive_summary: str(obj.executive_summary),
    score_breakdown: breakdown,
    what_works_well: list(obj.what_works_well),
    what_holds_it_back: list(obj.what_holds_it_back),
    client_dependent_improvements: list(obj.client_dependent_improvements),
    what_would_raise_the_score: {
      current_estimate: str(srcRaise.current_estimate),
      realistic_improved_range: str(srcRaise.realistic_improved_range),
      required_improvements: list(srcRaise.required_improvements),
    },
    recommended_next_steps: list(obj.recommended_next_steps),
    final_verdict: str(obj.final_verdict),
    disclaimer: str(obj.disclaimer),
  };
  if (!result.executive_summary && !result.final_verdict) return null;
  return result;
}

/* ---- Website comparison (two sites → a comparison table) ---------------- */

function hostFromUrl(u) {
  const s = String(u || "").trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  const host = s.split(/[\/?#]/)[0];
  return host || s;
}

const WEBSITE_COMPARE_FIELDS = [
  "site_a_label", "site_b_label", "executive_summary", "site_a_overall",
  "site_b_overall", "comparison", "site_a_strengths", "site_b_strengths",
  "recommendation", "final_verdict", "disclaimer",
];
const WEBSITE_COMPARE_ROW_SCHEMA = {
  type: "object",
  properties: {
    criterion: { type: "string" },
    site_a_score: { type: "integer" },
    site_b_score: { type: "integer" },
    winner: { type: "string", enum: ["a", "b", "tie"] },
    note: { type: "string" },
  },
  required: ["criterion", "site_a_score", "site_b_score", "winner", "note"],
  propertyOrdering: ["criterion", "site_a_score", "site_b_score", "winner", "note"],
};
const WEBSITE_COMPARE_SCHEMA = {
  type: "object",
  properties: {
    site_a_label: { type: "string" },
    site_b_label: { type: "string" },
    executive_summary: { type: "string" },
    site_a_overall: { type: "integer" },
    site_b_overall: { type: "integer" },
    comparison: { type: "array", items: WEBSITE_COMPARE_ROW_SCHEMA },
    site_a_strengths: { type: "array", items: { type: "string" } },
    site_b_strengths: { type: "array", items: { type: "string" } },
    recommendation: { type: "string" },
    final_verdict: { type: "string" },
    disclaimer: { type: "string" },
  },
  required: WEBSITE_COMPARE_FIELDS,
  propertyOrdering: WEBSITE_COMPARE_FIELDS,
};

function buildWebsiteComparePrompt(lang) {
  const langName = lang === "el" ? "Greek" : "English";
  return (
    "You are a senior website strategist, SEO auditor and conversion consultant. " +
    "You are given TWO websites (Site A and Site B) to compare for the SAME business " +
    "purpose. For BOTH sites you are given REAL public page signals fetched and " +
    "extracted from each URL's server-rendered HTML (title, meta description, " +
    "headings, canonical, Open Graph, viewport, robots, visible word count, image/alt " +
    "counts, link counts, phone/email/CTA/structured-data presence, text excerpt). " +
    "BASE THE COMPARISON ON THESE EXTRACTED SIGNALS, not assumptions. You have static " +
    "HTML only: do NOT claim you ran a full crawl, full technical audit, Lighthouse or " +
    "Core Web Vitals measurement, or ranking predictions. Be practical, honest and " +
    "specific; treat a missing signal as a finding rather than inventing detail. The " +
    "disclaimer MUST note the comparison is based only on public HTML page signals.\n\n" +
    "Score BOTH sites 0-100 on each of these criteria, IN THIS ORDER: Overall " +
    "Readiness, Design & Visual Trust, Message Clarity, SEO Readiness, Conversion " +
    "Readiness, Trust Signals, Content Completeness, Technical Basics. Return one " +
    "`comparison` row per criterion with both scores, a `winner` of \"a\", \"b\" or " +
    "\"tie\", and a short note. Set site_a_overall / site_b_overall to the Overall " +
    "Readiness scores. Give 3-5 top strengths per site, a 2-4 sentence " +
    "executive_summary comparing them, a recommendation (which is stronger and what " +
    "each should prioritise) and a one-sentence final_verdict. If information is " +
    "missing, say so rather than inventing detail.\n\n" +
    `Write EVERY string value (criteria names, notes, summaries, lists, recommendation, ` +
    `verdict, disclaimer) in ${langName}. Return ONLY structured JSON matching the schema.`
  );
}

async function callWebsiteCompare({ apiKey, model, userText, lang, labelA, labelB }) {
  const apiUrl = `${API_BASE}/${encodeURIComponent(model)}:generateContent`;
  const payload = {
    systemInstruction: { parts: [{ text: buildWebsiteComparePrompt(lang) }] },
    contents: [{ role: "user", parts: [{ text: userText }] }],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 4096, // two sites + a table needs more room than a single scan
      responseMimeType: "application/json",
      responseSchema: WEBSITE_COMPARE_SCHEMA,
      thinkingConfig: { thinkingBudget: 0 },
    },
  };
  const res = await postJsonWithRetry(apiUrl, apiKey, payload, "website-compare", SCANNER_AI_TIMEOUT_MS, SCANNER_MAX_RETRIES);
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google API ${res.status}: ${errText.slice(0, 300)}`);
  }
  const data = await res.json();
  return parseWebsiteCompareJson(extractReply(data), labelA, labelB);
}

function parseWebsiteCompareJson(text, labelA, labelB) {
  if (!text) return null;
  let raw = String(text).trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) raw = fence[1].trim();
  let obj;
  try { obj = JSON.parse(raw); } catch { return null; }
  if (!obj || typeof obj !== "object") return null;

  const str = (v) => (typeof v === "string" ? v.trim() : "");
  const list = (v) => Array.isArray(v)
    ? v.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim()).slice(0, 8)
    : [];
  const clampScore = (v) => {
    let n = Number(v);
    if (!Number.isFinite(n)) n = 0;
    return Math.min(100, Math.max(0, Math.round(n)));
  };

  const rows = Array.isArray(obj.comparison) ? obj.comparison : [];
  const comparison = rows.map((r) => {
    if (!r || typeof r !== "object") return null;
    let w = String(r.winner || "").toLowerCase();
    if (w !== "a" && w !== "b") w = "tie";
    return {
      criterion: str(r.criterion),
      site_a_score: clampScore(r.site_a_score),
      site_b_score: clampScore(r.site_b_score),
      winner: w,
      note: str(r.note),
    };
  }).filter((r) => r && r.criterion).slice(0, 12);

  if (!comparison.length) return null;

  return {
    mode: "compare",
    site_a_label: str(obj.site_a_label) || labelA,
    site_b_label: str(obj.site_b_label) || labelB,
    executive_summary: str(obj.executive_summary),
    site_a_overall: clampScore(obj.site_a_overall),
    site_b_overall: clampScore(obj.site_b_overall),
    comparison,
    site_a_strengths: list(obj.site_a_strengths),
    site_b_strengths: list(obj.site_b_strengths),
    recommendation: str(obj.recommendation),
    final_verdict: str(obj.final_verdict),
    disclaimer: str(obj.disclaimer),
  };
}

/* ============================================================================
 * GDPR Auto-Scanner  —  POST /api/gdpr-scan
 * ----------------------------------------------------------------------------
 * A third standalone Noustelos AI Lab utility, sibling to the SaaS + Website
 * scanners and fully decoupled from The Artifact. Shares this Worker +
 * GOOGLE_API_KEY but has its OWN GDPR-specific HTML extraction
 * (extractGdprSignals: privacy/cookie/terms links, known consent platforms,
 * a generic cookie-banner heuristic, third-party tracking scripts grouped by
 * category, cookie-setting embeds, hotlinked Google Fonts, form data-collection)
 * and its OWN prompt + schema (a compliance score, a 5-axis breakdown, the
 * detected trackers annotated with a GDPR concern, what's in place, key risks,
 * next steps, verdict). Like the website scanner it FETCHES the URL (reusing
 * fetchPageSignals + the full SSRF guards) and REFUSES to score if it can't read
 * the page (Option B; websiteFetchRefusal). Bilingual (lang:"en"|"el"). User
 * input is NOT logged. This is a STATIC pre-audit of public HTML — it cannot
 * verify runtime consent behaviour (whether trackers fire BEFORE consent), real
 * cookie storage, or the legal completeness of a policy. NOT legal advice.
 *
 * Access: SAME passphrases as the Artifact chat / other scanners (collectPassphrases).
 * Model: SCANNER_MODEL (live override gemini-2.5-flash-lite), thinkingBudget:0.
 * ==========================================================================*/

const GDPR_SCORE_AXES = [
  "privacy_transparency", "cookie_consent", "tracking_footprint",
  "data_collection", "third_party_exposure",
];

// EN/EL score-band labels — a SIGNAL posture, not a legal verdict.
const GDPR_BANDS = {
  en: [
    [40, "High Risk"],
    [60, "Significant Gaps"],
    [80, "Partially Aligned"],
    [92, "Mostly Aligned"],
    [100, "Strong Posture"],
  ],
  el: [
    [40, "Υψηλός κίνδυνος"],
    [60, "Σημαντικά κενά"],
    [80, "Μερική συμμόρφωση"],
    [92, "Σε μεγάλο βαθμό συμμορφωμένο"],
    [100, "Ισχυρή στάση συμμόρφωσης"],
  ],
};

function gdprScoreLabel(score, lang) {
  const bands = GDPR_BANDS[lang] || GDPR_BANDS.en;
  for (const [max, label] of bands) { if (score <= max) return label; }
  return bands[bands.length - 1][1];
}

// Known third-party tracking / marketing scripts, grouped by GDPR-relevant
// category. First matching signature wins per vendor; matched on lowercased HTML.
const GDPR_TRACKERS = [
  { name: "Google Analytics", category: "analytics", sig: ["google-analytics.com", "googletagmanager.com/gtag", "gtag(", "ga('create", "/gtag/js"] },
  { name: "Google Tag Manager", category: "tag manager", sig: ["googletagmanager.com/gtm.js", "gtm.start", "'gtm-"] },
  { name: "Google Ads / Remarketing", category: "advertising", sig: ["googleadservices.com", "googlesyndication.com", "doubleclick.net", "google_conversion"] },
  { name: "Meta (Facebook) Pixel", category: "advertising", sig: ["connect.facebook.net", "fbq(", "facebook.com/tr"] },
  { name: "Hotjar", category: "behaviour / heatmaps", sig: ["static.hotjar.com", "hotjar.com", "hj("] },
  { name: "Microsoft Clarity", category: "behaviour / heatmaps", sig: ["clarity.ms", "(c,l,a,r,i,t,y)"] },
  { name: "LinkedIn Insight Tag", category: "advertising", sig: ["snap.licdn.com", "_linkedin_partner_id"] },
  { name: "TikTok Pixel", category: "advertising", sig: ["analytics.tiktok.com", "ttq.load", "ttq.page"] },
  { name: "X (Twitter) Pixel", category: "advertising", sig: ["static.ads-twitter.com", "twq("] },
  { name: "Pinterest Tag", category: "advertising", sig: ["ct.pinterest.com", "pintrk("] },
  { name: "Snapchat Pixel", category: "advertising", sig: ["sc-static.net", "snaptr("] },
  { name: "Yandex Metrica", category: "analytics", sig: ["mc.yandex.ru", "ym("] },
  { name: "Matomo / Piwik", category: "analytics", sig: ["matomo.js", "piwik.js", "_paq"] },
  { name: "HubSpot", category: "marketing", sig: ["js.hs-scripts.com", "js.hs-analytics.net", "hs-scripts"] },
  { name: "Segment", category: "analytics", sig: ["cdn.segment.com"] },
  { name: "Mixpanel", category: "analytics", sig: ["cdn.mxpanel", "mixpanel"] },
  { name: "Intercom", category: "marketing / chat", sig: ["widget.intercom.io", "intercomsettings"] },
  { name: "Live chat (Tawk/Crisp/Drift)", category: "marketing / chat", sig: ["tawk.to", "crisp.chat", "driftt.com", "drift.com/"] },
];

// Known Consent Management Platforms (CMPs). Presence = a real cookie banner.
const GDPR_CMPS = [
  { name: "Cookiebot", sig: ["consent.cookiebot", "cookiebot"] },
  { name: "OneTrust", sig: ["onetrust", "optanon", "cookielaw.org"] },
  { name: "CookieYes", sig: ["cookieyes", "cookie-law-info", "cky-consent"] },
  { name: "Iubenda", sig: ["iubenda"] },
  { name: "Complianz", sig: ["complianz", "cmplz"] },
  { name: "Quantcast Choice", sig: ["quantcast"] },
  { name: "Usercentrics", sig: ["usercentrics"] },
  { name: "Termly", sig: ["termly"] },
  { name: "Borlabs Cookie", sig: ["borlabs-cookie"] },
  { name: "Osano", sig: ["osano"] },
  { name: "TrustArc", sig: ["trustarc", "consent.truste"] },
  { name: "Didomi", sig: ["didomi"] },
  { name: "Cookie Notice (WP)", sig: ["cookie-notice"] },
];

// Third-party embeds that typically set cookies / transfer data to non-EU hosts.
function detectGdprEmbeds(html, lc) {
  const out = [];
  // YouTube standard embed sets cookies; the -nocookie variant does not.
  if (/youtube\.com\/embed/i.test(html) && !/youtube-nocookie\.com/i.test(html)) {
    out.push("YouTube (standard embed — sets cookies)");
  }
  if (/(maps\.google\.|google\.[a-z.]+\/maps|maps\.googleapis\.com)/i.test(html)) out.push("Google Maps");
  if (/player\.vimeo\.com/i.test(html)) out.push("Vimeo");
  if (/(instagram\.com\/embed|facebook\.com\/plugins)/i.test(html)) out.push("Instagram / Facebook embed");
  if (/gravatar\.com/i.test(lc)) out.push("Gravatar");
  if (/disqus\.com/i.test(lc)) out.push("Disqus comments");
  return out;
}

// GDPR-specific signal extraction. Reuses extractSignals() for the base page
// signals (title, word_count for the thin-page check, links) and layers the
// privacy/consent/tracking signals on top. Matched on the raw + lowercased HTML.
function extractGdprSignals(html, baseUrl) {
  const base = extractSignals(html, baseUrl);
  const lc = String(html).toLowerCase();

  const isHttps = /^https:\/\//i.test(base.final_url || baseUrl);

  // --- Policy links: scan every anchor's href + visible text. ---
  let privacyHref = "", privacyFound = false, cookieLinkFound = false, termsFound = false;
  const anchorRe = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let am;
  while ((am = anchorRe.exec(html))) {
    const href = am[1];
    const text = decodeEntities(am[2].replace(/<[^>]+>/g, " ")).toLowerCase();
    const hay = (href + " " + text).toLowerCase();
    if (/privacy|απόρρητο|προσωπικ.{0,4}δεδομέν|πολιτικ.{0,8}απορρ/.test(hay)) {
      privacyFound = true;
      if (!privacyHref) { try { privacyHref = new URL(href, baseUrl).href; } catch { privacyHref = href; } }
    }
    if (/cookie/.test(hay) && /(policy|polic|πολιτικ|notice|settings|consent|cookies)/.test(hay)) cookieLinkFound = true;
    if (/terms|όρο.{0,8}χρήσ|terms of (use|service)|terms & conditions/.test(hay)) termsFound = true;
  }

  // --- CMPs + generic cookie-banner heuristic. ---
  const cmps = [];
  for (const c of GDPR_CMPS) {
    if (c.sig.some((s) => lc.includes(s))) cmps.push(c.name);
  }
  const bannerById = /(id|class)\s*=\s*["'][^"']*(cookie-consent|cookie-banner|cookie-notice|cookie-bar|cc-window|cc-banner|gdpr|consent-banner|cmplz|cky-)/i.test(html);
  const bannerByText = /(cookie|cookies|απόρρητο|cookies)[\s\S]{0,400}(accept|agree|consent|allow|αποδοχ|συναίν|αποδέχ|απορρίψ|reject|decline)/i.test(lc);
  const consentBannerHeuristic = cmps.length > 0 || bannerById || bannerByText;

  // --- Tracking / marketing scripts. ---
  const trackers = [];
  for (const t of GDPR_TRACKERS) {
    if (t.sig.some((s) => lc.includes(s))) trackers.push({ name: t.name, category: t.category });
  }

  const embeds = detectGdprEmbeds(html, lc);
  const googleFontsHotlinked = /fonts\.(googleapis|gstatic)\.com/i.test(lc);

  // --- Forms / data collection. ---
  const formCount = (html.match(/<form\b/gi) || []).length;
  const collectsEmail = /<input\b[^>]*type\s*=\s*["']email["']/i.test(html) || /name\s*=\s*["'][^"']*e?mail/i.test(html);
  const collectsPhone = /<input\b[^>]*type\s*=\s*["']tel["']/i.test(html);
  // A consent checkbox NEAR a form: checkbox whose name/id/label hints at consent.
  const formConsentCheckbox =
    /<input\b[^>]*type\s*=\s*["']checkbox["'][^>]*(name|id)\s*=\s*["'][^"']*(consent|gdpr|privacy|agree|terms|accept|optin|opt-in)/i.test(html) ||
    /(consent|gdpr|privacy|αποδέχομαι|συναιν|απόρρητο)[\s\S]{0,120}<input\b[^>]*type\s*=\s*["']checkbox/i.test(lc);

  return {
    // base signals reused for context + the thin-page guard
    final_url: base.final_url,
    title: base.title,
    word_count: base.word_count,
    external_link_count: base.external_link_count,
    // GDPR signals
    is_https: isHttps,
    privacy_policy_found: privacyFound,
    privacy_policy_url: privacyHref,
    cookie_policy_link_found: cookieLinkFound,
    terms_link_found: termsFound,
    cmps_detected: cmps,
    consent_banner_detected: consentBannerHeuristic,
    trackers,
    third_party_embeds: embeds,
    google_fonts_hotlinked: googleFontsHotlinked,
    form_count: formCount,
    collects_email: collectsEmail,
    collects_phone: collectsPhone,
    form_consent_checkbox: formConsentCheckbox,
  };
}

// Render the GDPR signals as a plain-text block fed to the model.
function renderGdprSignalsBlock(s) {
  const yn = (b) => (b ? "yes" : "no");
  const lines = [];
  lines.push(`Fetched URL: ${s.final_url}`);
  lines.push(`Page title: ${s.title || "(none)"}`);
  lines.push(`Served over HTTPS: ${yn(s.is_https)}`);
  lines.push(`Privacy Policy link found: ${yn(s.privacy_policy_found)}${s.privacy_policy_url ? " (" + s.privacy_policy_url + ")" : ""}`);
  lines.push(`Cookie Policy link found: ${yn(s.cookie_policy_link_found)}`);
  lines.push(`Terms link found: ${yn(s.terms_link_found)}`);
  lines.push(`Consent Management Platform (CMP) detected: ${s.cmps_detected.length ? s.cmps_detected.join(", ") : "none"}`);
  lines.push(`Cookie-consent banner detected (heuristic): ${yn(s.consent_banner_detected)}`);
  lines.push(`Tracking / marketing scripts detected (${s.trackers.length}): ${s.trackers.length ? s.trackers.map((t) => `${t.name} [${t.category}]`).join("; ") : "none"}`);
  lines.push(`Cookie-setting third-party embeds: ${s.third_party_embeds.length ? s.third_party_embeds.join(", ") : "none"}`);
  lines.push(`Google Fonts hotlinked from Google: ${yn(s.google_fonts_hotlinked)}`);
  lines.push(`Forms on page: ${s.form_count} (collects email: ${yn(s.collects_email)}, phone: ${yn(s.collects_phone)}, has a consent checkbox: ${yn(s.form_consent_checkbox)})`);
  return lines.join("\n");
}

function buildGdprPrompt(lang) {
  const isEl = lang === "el";
  const langName = isEl ? "Greek" : "English";
  const bandLines = (GDPR_BANDS[lang] || GDPR_BANDS.en)
    .map(([max, label], i, arr) => {
      const min = i === 0 ? 0 : arr[i - 1][0] + 1;
      return `- ${min}-${max}: ${label}`;
    }).join("\n");
  return (
    "You are a senior privacy and GDPR readiness consultant performing a STATIC, " +
    "signals-based pre-audit of a website's basic GDPR / ePrivacy posture. Be " +
    "practical, specific and honest. Do not exaggerate and do not reassure.\n\n" +
    "DATA SOURCE: You are given REAL public signals extracted from the page's " +
    "server-rendered HTML — whether a privacy/cookie/terms link was found, whether a " +
    "known Consent Management Platform (CMP) or generic cookie banner was detected, " +
    "the third-party tracking/marketing scripts found (grouped by category), " +
    "cookie-setting embeds, whether Google Fonts are hotlinked from Google, HTTPS, " +
    "and form data-collection. BASE YOUR ANALYSIS ONLY ON THESE EXTRACTED SIGNALS — " +
    "do not invent trackers, banners or policies that are not listed. For " +
    "detected_trackers, use ONLY the scripts in the signals; for each, give its " +
    "category and a short, concrete GDPR concern (e.g. sets cookies / transfers data " +
    "to a non-EU processor / needs prior consent). Treat a missing signal as a finding " +
    "(e.g. no privacy policy link, trackers present but no consent banner).\n\n" +
    "GDPR REASONING: The biggest red flag is tracking/advertising scripts present " +
    "WITHOUT a consent banner/CMP — under the ePrivacy Directive non-essential " +
    "cookies need PRIOR consent. A missing privacy policy link, hotlinked Google " +
    "Fonts (a known EU data-transfer issue), and forms collecting personal data " +
    "without a consent checkbox or privacy link are also risks. HTTPS is expected.\n\n" +
    "HONESTY RULES — CRITICAL: You analysed STATIC HTML only. You CANNOT verify " +
    "whether trackers actually fire BEFORE consent, whether cookies are truly set, the " +
    "lawful basis, the contents or legal completeness of any policy, data-retention or " +
    "DPA/processor agreements. Do NOT claim a full legal audit or certified compliance. " +
    "This is NOT legal advice. The disclaimer field MUST state that this is an " +
    "indicative, signals-based pre-audit of public HTML — not a full audit, not " +
    "verification of runtime consent behaviour, and not legal advice.\n\n" +
    `Scoring bands — set compliance_label to match compliance_score:\n${bandLines}\n\n` +
    "Each score_breakdown axis is 0-100 with one short note grounded in the signals. " +
    "Lists hold 3-7 concise, specific items. executive_summary is 2-4 sentences and " +
    "should begin by framing the report as based on public page signals (e.g. \"Based " +
    "on public page signals extracted from the provided URL...\"). final_verdict is a " +
    "single clear sentence.\n\n" +
    `IMPORTANT: Write EVERY string value (labels, notes, concerns, summaries, list ` +
    `items, verdict, disclaimer) in ${langName}. Return ONLY structured JSON matching ` +
    "the required schema."
  );
}

const GDPR_AXIS_SCHEMA = {
  type: "object",
  properties: { score: { type: "integer" }, note: { type: "string" } },
  required: ["score", "note"],
  propertyOrdering: ["score", "note"],
};
const GDPR_BREAKDOWN_SCHEMA = {
  type: "object",
  properties: GDPR_SCORE_AXES.reduce((acc, k) => { acc[k] = GDPR_AXIS_SCHEMA; return acc; }, {}),
  required: GDPR_SCORE_AXES,
  propertyOrdering: GDPR_SCORE_AXES,
};
const GDPR_TRACKER_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    category: { type: "string" },
    concern: { type: "string" },
  },
  required: ["name", "category", "concern"],
  propertyOrdering: ["name", "category", "concern"],
};
const GDPR_SCAN_FIELDS = [
  "compliance_score", "compliance_label", "executive_summary", "score_breakdown",
  "detected_trackers", "what_is_in_place", "key_risks", "recommended_next_steps",
  "final_verdict", "disclaimer",
];
const GDPR_SCAN_SCHEMA = {
  type: "object",
  properties: {
    compliance_score: { type: "integer" },
    compliance_label: { type: "string" },
    executive_summary: { type: "string" },
    score_breakdown: GDPR_BREAKDOWN_SCHEMA,
    detected_trackers: { type: "array", items: GDPR_TRACKER_SCHEMA },
    what_is_in_place: { type: "array", items: { type: "string" } },
    key_risks: { type: "array", items: { type: "string" } },
    recommended_next_steps: { type: "array", items: { type: "string" } },
    final_verdict: { type: "string" },
    disclaimer: { type: "string" },
  },
  required: GDPR_SCAN_FIELDS,
  propertyOrdering: GDPR_SCAN_FIELDS,
};

const GDPR_SCAN_MAX_NOTES = 2000;

async function handleGdprScan(body, env, ctx, corsOrigin) {
  if (!env.GOOGLE_API_KEY) {
    return json({ error: "scan_failed" }, 500, corsOrigin);
  }

  // --- Passphrase gate — SAME codes as the Artifact chat / other scanners ---
  const valid = collectPassphrases(env);
  if (valid.size) {
    const provided = typeof body.passphrase === "string" ? body.passphrase.trim() : "";
    if (!valid.has(provided)) return json({ error: "locked" }, 401, corsOrigin);
  }
  if (body.verify) return json({ ok: true }, 200, corsOrigin);

  const lang = body.lang === "el" ? "el" : "en";

  const clean = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const urlOk = (u) => /^(https?:\/\/)?[^\s.]+\.[^\s]{2,}$/i.test(u);
  const url = clean(body.url, 300);
  if (!url || !urlOk(url)) {
    return json({ error: "url_required" }, 400, corsOrigin);
  }

  const businessType = clean(body.businessType, 80);
  const notes = clean(body.notes, GDPR_SCAN_MAX_NOTES);
  const model = env.SCANNER_MODEL || SCAN_DEFAULT_MODEL;

  // --- Fetch + extract real GDPR signals. Option B: refuse if unreadable. ---
  const fetched = await fetchPageSignals(url, extractGdprSignals);
  if (!fetched.ok) {
    return json({ error: "unreachable", message: websiteFetchRefusal(fetched.reason, lang, { status: fetched.status }) }, 200, corsOrigin);
  }

  const lines = [renderGdprSignalsBlock(fetched.signals)];
  if (businessType) lines.push("", `Business Type: ${businessType}`);
  if (notes) lines.push("", "Owner Notes:", notes);
  const userText = lines.join("\n");

  let result;
  try {
    result = await callGdprScanner({ apiKey: env.GOOGLE_API_KEY, model, userText, lang });
  } catch (err) {
    console.error("gdpr-scan error:", String((err && err.message) || err));
    return json({ error: "scan_failed" }, 502, corsOrigin);
  }
  if (!result) return json({ error: "bad_format" }, 502, corsOrigin);

  result.scanned_url = fetched.signals.final_url || url;
  return json({ result }, 200, corsOrigin);
}

async function callGdprScanner({ apiKey, model, userText, lang }) {
  const apiUrl = `${API_BASE}/${encodeURIComponent(model)}:generateContent`;
  const payload = {
    systemInstruction: { parts: [{ text: buildGdprPrompt(lang) }] },
    contents: [{ role: "user", parts: [{ text: userText }] }],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 3072,
      responseMimeType: "application/json",
      responseSchema: GDPR_SCAN_SCHEMA,
      thinkingConfig: { thinkingBudget: 0 },
    },
  };
  const res = await postJsonWithRetry(apiUrl, apiKey, payload, "gdpr-scan", SCANNER_AI_TIMEOUT_MS, SCANNER_MAX_RETRIES);
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google API ${res.status}: ${errText.slice(0, 300)}`);
  }
  const data = await res.json();
  return parseGdprScanJson(extractReply(data), lang);
}

function parseGdprScanJson(text, lang) {
  if (!text) return null;
  let raw = String(text).trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) raw = fence[1].trim();
  let obj;
  try { obj = JSON.parse(raw); } catch { return null; }
  if (!obj || typeof obj !== "object") return null;

  const str = (v) => (typeof v === "string" ? v.trim() : "");
  const list = (v) => Array.isArray(v)
    ? v.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim()).slice(0, 12)
    : [];
  const clampScore = (v) => {
    let n = Number(v);
    if (!Number.isFinite(n)) n = 0;
    return Math.min(100, Math.max(0, Math.round(n)));
  };

  const score = clampScore(obj.compliance_score);

  const srcBreak = (obj.score_breakdown && typeof obj.score_breakdown === "object") ? obj.score_breakdown : {};
  const breakdown = {};
  for (const axis of GDPR_SCORE_AXES) {
    const a = srcBreak[axis];
    if (a && typeof a === "object") {
      breakdown[axis] = { score: clampScore(a.score), note: str(a.note) };
    }
  }

  const trackers = Array.isArray(obj.detected_trackers)
    ? obj.detected_trackers
        .filter((t) => t && typeof t === "object")
        .map((t) => ({ name: str(t.name), category: str(t.category), concern: str(t.concern) }))
        .filter((t) => t.name)
        .slice(0, 20)
    : [];

  const result = {
    mode: "single",
    language: lang,
    compliance_score: score,
    compliance_label: str(obj.compliance_label) || gdprScoreLabel(score, lang),
    executive_summary: str(obj.executive_summary),
    score_breakdown: breakdown,
    detected_trackers: trackers,
    what_is_in_place: list(obj.what_is_in_place),
    key_risks: list(obj.key_risks),
    recommended_next_steps: list(obj.recommended_next_steps),
    final_verdict: str(obj.final_verdict),
    disclaimer: str(obj.disclaimer),
  };
  if (!result.executive_summary && !result.final_verdict) return null;
  return result;
}

/* ===========================================================================
 * AI Visibility Scanner  —  POST /api/ai-visibility-scan
 * ----------------------------------------------------------------------------
 * A fourth standalone Noustelos AI Lab utility, sibling to the SaaS + Website +
 * GDPR scanners and fully decoupled from The Artifact. Evaluates how easily AI
 * assistants (ChatGPT, Gemini, Claude, Perplexity) can DISCOVER, PARSE and CITE
 * a website. Shares this Worker + GOOGLE_API_KEY.
 *
 * Honest by design: the score is DETERMINISTIC. We fetch the homepage (reusing
 * fetchPageSignals + the full SSRF guards) PLUS three root files (/robots.txt,
 * /sitemap.xml, /llms.txt, in parallel, each re-validated through fetchFollow),
 * then run 15 weighted checks that sum to 100. Every point traces to a real,
 * checkable signal — the model NEVER guesses the number. Gemini only writes a
 * short summary + 3 recommendations from the failed checks (it cannot invent
 * passing/failing checks). Like the other scanners it REFUSES (Option B) if the
 * homepage can't be read. Bilingual (lang:"en"|"el"). User input is NOT logged.
 *
 * HONESTY: this is a STATIC analysis of public, server-rendered HTML. We cannot
 * simulate a real LLM crawl, guarantee citation, or read JS-rendered content.
 * llms.txt is an EMERGING convention (llmstxt.org), not an official standard.
 * The "AI Citation Probability" is an explicit heuristic, NOT a prediction.
 *
 * Access: SAME passphrases as the Artifact chat / other scanners (collectPassphrases).
 * Model: SCANNER_MODEL (live override gemini-2.5-flash-lite), thinkingBudget:0.
 * ==========================================================================*/

// Grade bands: [maxScore, letter, label]. Mirrors the spec's 4 tiers.
const AIVIS_BANDS = {
  en: [
    [49, "D", "Poor AI visibility"],
    [69, "C", "Needs improvement"],
    [89, "B", "Good AI visibility"],
    [100, "A", "Excellent AI visibility"],
  ],
  el: [
    [49, "D", "Χαμηλή ορατότητα σε AI"],
    [69, "C", "Χρειάζεται βελτίωση"],
    [89, "B", "Καλή ορατότητα σε AI"],
    [100, "A", "Εξαιρετική ορατότητα σε AI"],
  ],
};
function aivisGrade(score, lang) {
  const bands = AIVIS_BANDS[lang] || AIVIS_BANDS.en;
  for (const [max, letter, label] of bands) {
    if (score <= max) return { letter, label };
  }
  const last = bands[bands.length - 1];
  return { letter: last[1], label: last[2] };
}

// Localized human names for each check (for the rendered breakdown).
const AIVIS_CHECK_NAMES = {
  en: {
    homepage_reachable: "Homepage reachable",
    robots_txt: "robots.txt present",
    sitemap_xml: "XML sitemap",
    llms_txt: "llms.txt (AI guidance file)",
    org_schema: "Organization schema",
    faq_schema: "FAQ schema",
    localbusiness_schema: "LocalBusiness schema",
    contact_info: "Contact information",
    meta_title: "Title tag",
    meta_description: "Meta description",
    open_graph: "Open Graph tags",
    canonical: "Canonical URL",
    heading_structure: "Heading structure (single H1)",
    content_richness: "Content richness",
    ai_friendly_wording: "AI-friendly content sections",
  },
  el: {
    homepage_reachable: "Προσβάσιμη αρχική",
    robots_txt: "Παρουσία robots.txt",
    sitemap_xml: "XML sitemap",
    llms_txt: "llms.txt (αρχείο οδηγιών για AI)",
    org_schema: "Schema Organization",
    faq_schema: "Schema FAQ",
    localbusiness_schema: "Schema LocalBusiness",
    contact_info: "Στοιχεία επικοινωνίας",
    meta_title: "Ετικέτα τίτλου (title)",
    meta_description: "Meta description",
    open_graph: "Ετικέτες Open Graph",
    canonical: "Canonical URL",
    heading_structure: "Δομή επικεφαλίδων (ένα H1)",
    content_richness: "Πλούτος περιεχομένου",
    ai_friendly_wording: "Ενότητες φιλικές προς AI",
  },
};

// AI-discoverability content sections we look for (link text / headings / body).
const AIVIS_SECTION_WORDS = {
  services: ["services", "what we do", "solutions", "υπηρεσίες", "λύσεις"],
  pricing: ["pricing", "plans", "τιμές", "τιμολόγηση", "πακέτα"],
  faq: ["faq", "frequently asked", "συχνές ερωτήσεις", "ερωτήσεις"],
  about: ["about", "about us", "who we are", "σχετικά", "ποιοι είμαστε"],
  contact: ["contact", "get in touch", "επικοινωνία", "επικοινωνήστε"],
};

const AIVIS_FILE_MAX_BYTES = 300_000;

// Fetch a root text file (robots/sitemap/llms) via fetchFollow so every hop is
// re-validated against the SSRF guard. Returns { found, status?, text?, ... }.
async function fetchRootFile(originUrl, path) {
  let target;
  try { target = new URL(path, originUrl).href; } catch { return { found: false }; }
  const start = parseSafeUrl(target);
  if (!start) return { found: false };
  let hop;
  try { hop = await fetchFollow(start); } catch { return { found: false }; }
  if (!hop || !hop.ok) return { found: false };
  const res = hop.res;
  if (res.status < 200 || res.status >= 300) return { found: false, status: res.status };
  let text;
  try { text = await readCapped(res, AIVIS_FILE_MAX_BYTES); } catch { return { found: false }; }
  return { found: true, status: res.status, text: text || "", url: hop.url };
}

// A 200 that is really an HTML "soft 404" page should NOT count as the file.
function looksLikeHtmlPage(text) {
  return /^\s*<(?:!doctype\s+html|html[\s>]|head[\s>])/i.test(String(text || ""));
}

// Classify the three root files into the booleans the scorer needs.
function classifyRootFiles(robots, sitemap, llms) {
  const r = { found: false, has_user_agent: false, references_sitemap: false };
  if (robots.found && !looksLikeHtmlPage(robots.text) &&
      /user-agent\s*:|disallow\s*:|allow\s*:|sitemap\s*:/i.test(robots.text)) {
    r.found = true;
    r.has_user_agent = /user-agent\s*:/i.test(robots.text);
    r.references_sitemap = /sitemap\s*:/i.test(robots.text);
  }
  const s = { found: false, referenced_in_robots: r.references_sitemap };
  if (sitemap.found && /<urlset|<sitemapindex|<\?xml/i.test(sitemap.text)) s.found = true;
  const l = { found: false, mentions_content: false };
  if (llms.found && !looksLikeHtmlPage(llms.text) && llms.text.trim().length > 0) {
    l.found = true;
    l.mentions_content = /docs|document|product|service|about|api|guide|pricing/i.test(llms.text);
  }
  return { robots: r, sitemap: s, llms: l };
}

// AI-visibility signal extraction. Layers on extractSignals() for the base page
// signals (title, meta description, canonical, OG, schema, word_count, contact).
function extractAiVisibilitySignals(html, baseUrl) {
  const base = extractSignals(html, baseUrl);
  const lc = String(html).toLowerCase();

  const h1Count = (html.match(/<h1\b[^>]*>/gi) || []).length;
  const ogImage = metaContentOf(html, "og:image");

  // Schema types: extractSignals gives @type values; also scan raw HTML so a
  // nested @type (e.g. inside @graph) is not missed.
  const typesLc = (base.schema_types || []).map((t) => String(t).toLowerCase());
  const typeIn = (...names) =>
    names.some((n) => typesLc.some((t) => t.includes(n)) ||
      new RegExp('"@type"\\s*:\\s*"[^"]*' + n + '[^"]*"', "i").test(html));
  const hasOrg = typeIn("organization", "localbusiness", "corporation"); // LocalBusiness extends Organization
  const hasFaq = typeIn("faqpage", "qapage");
  const hasLocalBusiness = typeIn("localbusiness", "restaurant", "store", "lodgingbusiness", "professionalservice");
  const hasPostalAddress = typeIn("postaladdress") || /"streetaddress"\s*:/i.test(html);

  // AI-friendly content sections found anywhere (links/headings/body).
  const sections = [];
  for (const [key, words] of Object.entries(AIVIS_SECTION_WORDS)) {
    if (words.some((w) => lc.includes(w))) sections.push(key);
  }

  const title = base.title || "";
  const metaDesc = base.meta_description || "";
  const ogCount = [base.og_title, base.og_description, ogImage].filter(Boolean).length;

  return {
    final_url: base.final_url,
    title,
    title_length: title.length,
    meta_description: metaDesc,
    meta_description_length: metaDesc.length,
    canonical: base.canonical || "",
    og_title: base.og_title || "",
    og_description: base.og_description || "",
    og_image: ogImage,
    og_count: ogCount,
    h1_count: h1Count,
    word_count: base.word_count,
    has_phone: base.has_phone,
    has_email: base.has_email,
    schema_types: base.schema_types || [],
    has_org_schema: hasOrg,
    has_faq_schema: hasFaq,
    has_localbusiness_schema: hasLocalBusiness,
    has_postal_address: hasPostalAddress,
    ai_sections: sections,
  };
}

// DETERMINISTIC scoring — 15 checks, weights sum to 100. Each check earns
// 0..weight; status is pass / partial / missing. The model never touches this.
function scoreAiVisibility(s, files, lang) {
  const name = (AIVIS_CHECK_NAMES[lang] || AIVIS_CHECK_NAMES.en);
  const checks = [];
  const add = (key, weight, earned, detail) => {
    earned = Math.max(0, Math.min(weight, earned));
    const status = earned >= weight ? "pass" : (earned > 0 ? "partial" : "missing");
    checks.push({ key, name: name[key], weight, points: earned, status, detail });
  };

  // 1. Homepage reachable (5) — we only get here if the fetch succeeded.
  add("homepage_reachable", 5, 5, "HTTP 200 — the homepage was fetched successfully.");
  // 2. robots.txt (5) — full only with a User-agent directive.
  add("robots_txt", 5, files.robots.found ? (files.robots.has_user_agent ? 5 : 3) : 0,
    files.robots.found ? (files.robots.has_user_agent ? "Found, with User-agent directives." : "Found, but no User-agent directive.") : "No robots.txt found at the site root.");
  // 3. XML sitemap (5) — file present OR referenced in robots.txt.
  add("sitemap_xml", 5, (files.sitemap.found || files.sitemap.referenced_in_robots) ? 5 : 0,
    files.sitemap.found ? "XML sitemap found at /sitemap.xml." : (files.sitemap.referenced_in_robots ? "Sitemap referenced in robots.txt." : "No XML sitemap found."));
  // 4. llms.txt (15) — the headline AI-specific signal.
  add("llms_txt", 15, files.llms.found ? (files.llms.mentions_content ? 15 : 10) : 0,
    files.llms.found ? (files.llms.mentions_content ? "Found and references content (docs/products/services)." : "Found, but sparse.") : "No llms.txt — the emerging convention for guiding AI assistants is absent.");
  // 5. Organization schema (10).
  add("org_schema", 10, s.has_org_schema ? 10 : 0,
    s.has_org_schema ? "Organization (or LocalBusiness) structured data present." : "No Organization schema.org markup found.");
  // 6. FAQ schema (10).
  add("faq_schema", 10, s.has_faq_schema ? 10 : 0,
    s.has_faq_schema ? "FAQPage structured data present — directly citable by AI." : "No FAQ structured data found.");
  // 7. LocalBusiness schema (5).
  add("localbusiness_schema", 5, s.has_localbusiness_schema ? 5 : 0,
    s.has_localbusiness_schema ? "LocalBusiness structured data present." : "No LocalBusiness schema (fine if not a local business).");
  // 8. Contact info (5) — partial for one channel, full for two / a postal address.
  {
    const channels = (s.has_phone ? 1 : 0) + (s.has_email ? 1 : 0);
    const earned = channels >= 2 || s.has_postal_address ? 5 : (channels === 1 ? 3 : 0);
    add("contact_info", 5, earned,
      earned === 5 ? "Phone, email and/or a postal address are present." : (earned ? "Only one contact channel found." : "No phone, email or address detected."));
  }
  // 9. Title tag (5) — ideal 30–60 chars.
  {
    const L = s.title_length;
    const earned = !L ? 0 : (L >= 30 && L <= 60 ? 5 : 3);
    add("meta_title", 5, earned,
      !L ? "No <title> tag found." : `Title is ${L} chars (ideal 30–60).`);
  }
  // 10. Meta description (5) — ideal 120–160 chars.
  {
    const L = s.meta_description_length;
    const earned = !L ? 0 : (L >= 120 && L <= 160 ? 5 : 3);
    add("meta_description", 5, earned,
      !L ? "No meta description found." : `Description is ${L} chars (ideal 120–160).`);
  }
  // 11. Open Graph (5) — need og:title, og:description, og:image.
  add("open_graph", 5, s.og_count >= 3 ? 5 : (s.og_count > 0 ? 3 : 0),
    s.og_count >= 3 ? "og:title, og:description and og:image all present." : (s.og_count ? `Only ${s.og_count} of 3 core Open Graph tags present.` : "No Open Graph tags found."));
  // 12. Canonical (5).
  add("canonical", 5, s.canonical ? 5 : 0,
    s.canonical ? "Canonical URL declared." : "No canonical URL declared.");
  // 13. Heading structure (5) — exactly one H1.
  add("heading_structure", 5, s.h1_count === 1 ? 5 : (s.h1_count > 1 ? 3 : 0),
    s.h1_count === 1 ? "Exactly one H1, as expected." : (s.h1_count > 1 ? `${s.h1_count} H1 tags — should be exactly one.` : "No H1 heading found."));
  // 14. Content richness (5) — visible word count.
  {
    const w = s.word_count;
    const earned = w >= 500 ? 5 : (w >= 150 ? 3 : 0);
    add("content_richness", 5, earned, `~${w} visible words (richer content is easier for AI to parse and cite).`);
  }
  // 15. AI-friendly content sections (10) — services/pricing/faq/about/contact.
  {
    const n = s.ai_sections.length;
    const earned = n >= 3 ? 10 : (n >= 1 ? 5 : 0);
    add("ai_friendly_wording", 10, earned,
      n ? `Found content sections: ${s.ai_sections.join(", ")}.` : "No clear services/pricing/FAQ/about/contact sections detected.");
  }

  const score = checks.reduce((sum, c) => sum + c.points, 0);
  const grade = aivisGrade(score, lang);

  // AI Citation Probability — an explicit, NON-scientific heuristic (clearly
  // labelled as such on the front-end). score×0.8 + bonuses for the signals AI
  // assistants weigh most (FAQ, llms.txt, Organization).
  const bonus = (s.has_faq_schema ? 5 : 0) + (files.llms.found ? 8 : 0) + (s.has_org_schema ? 5 : 0);
  const citationValue = Math.max(0, Math.min(100, Math.round(score * 0.8 + bonus)));
  const citeBands = lang === "el"
    ? [[39, "Χαμηλή"], [69, "Μέτρια"], [100, "Υψηλή"]]
    : [[39, "Low"], [69, "Medium"], [100, "High"]];
  let citationLabel = citeBands[citeBands.length - 1][1];
  for (const [max, label] of citeBands) { if (citationValue <= max) { citationLabel = label; break; } }

  return {
    score,
    grade: grade.letter,
    grade_label: grade.label,
    citation_probability: { value: citationValue, label: citationLabel },
    checks,
  };
}

// Plain-text block fed to the model so its summary is grounded in the real
// pass/fail results (it must ONLY mention failed checks — never invent any).
function renderAiVisibilityBlock(scored, s) {
  const lines = [];
  lines.push(`Fetched URL: ${s.final_url}`);
  lines.push(`Deterministic AI-visibility score: ${scored.score}/100 (grade ${scored.grade})`);
  lines.push(`Detected structured-data types: ${s.schema_types.length ? s.schema_types.join(", ") : "none"}`);
  lines.push("");
  lines.push("CHECK RESULTS (deterministic — do not re-score):");
  for (const c of scored.checks) {
    lines.push(`- [${c.status.toUpperCase()}] ${c.name} (${c.points}/${c.weight}): ${c.detail}`);
  }
  return lines.join("\n");
}

function buildAiVisibilityPrompt(lang) {
  const isEl = lang === "el";
  const langName = isEl ? "Greek" : "English";
  return (
    "You are an AI-discoverability consultant. A website was analysed with 15 " +
    "DETERMINISTIC checks for how easily AI assistants (ChatGPT, Gemini, Claude, " +
    "Perplexity) can discover, parse and cite it. You are given the final score and " +
    "the exact PASS/PARTIAL/MISSING result of every check.\n\n" +
    "YOUR JOB: write a concise, professional summary and exactly THREE concrete " +
    "improvements. RULES:\n" +
    "- Do NOT speculate and do NOT re-score. Use ONLY the provided check results.\n" +
    "- In the summary, focus on the FAILED or PARTIAL checks (what is missing/weak). " +
    "If almost everything passes, say so plainly.\n" +
    "- The three recommendations must target the failed/partial checks with the " +
    "highest weight first (llms.txt=15, Organization/FAQ schema=10, AI-friendly " +
    "sections=10 are the heaviest). Be specific and actionable.\n" +
    "- executive_summary: max 60 words. final_verdict: one short sentence.\n" +
    "- HONESTY: this is a STATIC analysis of public HTML. Do not claim to simulate a " +
    "real AI crawl, guarantee citation, or read JavaScript-rendered content. Treat " +
    "llms.txt as an emerging convention, not an official standard.\n\n" +
    `IMPORTANT: Write EVERY string value in ${langName}. Return ONLY structured JSON ` +
    "matching the required schema."
  );
}

const AIVIS_AI_FIELDS = ["executive_summary", "final_verdict", "recommendations"];
const AIVIS_AI_SCHEMA = {
  type: "object",
  properties: {
    executive_summary: { type: "string" },
    final_verdict: { type: "string" },
    recommendations: { type: "array", items: { type: "string" } },
  },
  required: AIVIS_AI_FIELDS,
  propertyOrdering: AIVIS_AI_FIELDS,
};

const AIVIS_DISCLAIMERS = {
  en: "Indicative analysis based on static, public HTML signals — not a live AI crawl, a guarantee of citation, or a substitute for full SEO/GEO work. llms.txt is an emerging convention. The AI Citation Probability is a heuristic, not a prediction.",
  el: "Ενδεικτική ανάλυση βασισμένη σε στατικά, δημόσια σήματα HTML — όχι πραγματικό crawl από AI, ούτε εγγύηση παράθεσης, ούτε υποκατάστατο πλήρους εργασίας SEO/GEO. Το llms.txt είναι αναδυόμενη σύμβαση. Η «Πιθανότητα Παράθεσης από AI» είναι ευρετική, όχι πρόβλεψη.",
};

async function handleAiVisibilityScan(body, env, ctx, corsOrigin) {
  if (!env.GOOGLE_API_KEY) {
    return json({ error: "scan_failed" }, 500, corsOrigin);
  }

  // --- Passphrase gate — SAME codes as the Artifact chat / other scanners ---
  const valid = collectPassphrases(env);
  if (valid.size) {
    const provided = typeof body.passphrase === "string" ? body.passphrase.trim() : "";
    if (!valid.has(provided)) return json({ error: "locked" }, 401, corsOrigin);
  }
  if (body.verify) return json({ ok: true }, 200, corsOrigin);

  const lang = body.lang === "el" ? "el" : "en";
  const clean = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const urlOk = (u) => /^(https?:\/\/)?[^\s.]+\.[^\s]{2,}$/i.test(u);
  const url = clean(body.url, 300);
  if (!url || !urlOk(url)) {
    return json({ error: "url_required" }, 400, corsOrigin);
  }
  const businessType = clean(body.businessType, 80);
  const model = env.SCANNER_MODEL || SCAN_DEFAULT_MODEL;

  // --- Fetch homepage + extract signals. Option B: refuse if unreadable. ---
  const fetched = await fetchPageSignals(url, extractAiVisibilitySignals);
  if (!fetched.ok) {
    return json({ error: "unreachable", message: websiteFetchRefusal(fetched.reason, lang, { status: fetched.status }) }, 200, corsOrigin);
  }
  const signals = fetched.signals;
  const origin = signals.final_url || url;

  // --- Three root files in parallel (each re-validated through fetchFollow). ---
  const [robots, sitemap, llms] = await Promise.all([
    fetchRootFile(origin, "/robots.txt"),
    fetchRootFile(origin, "/sitemap.xml"),
    fetchRootFile(origin, "/llms.txt"),
  ]);
  const files = classifyRootFiles(robots, sitemap, llms);

  // --- Deterministic score (the model never touches this). ---
  const scored = scoreAiVisibility(signals, files, lang);

  // --- Gemini writes the summary + 3 recommendations from the check results. ---
  let userText = renderAiVisibilityBlock(scored, signals);
  if (businessType) userText += `\n\nBusiness Type (context for tailoring recommendations): ${businessType}`;
  let ai;
  try {
    ai = await callAiVisibilityScanner({
      apiKey: env.GOOGLE_API_KEY, model, lang, userText,
    });
  } catch (err) {
    console.error("ai-visibility-scan error:", String((err && err.message) || err));
    ai = null; // fail soft — the deterministic report still stands.
  }

  const result = {
    mode: "single",
    language: lang,
    scanned_url: signals.final_url || url,
    score: scored.score,
    grade: scored.grade,
    grade_label: scored.grade_label,
    citation_probability: scored.citation_probability,
    executive_summary: (ai && ai.executive_summary) || "",
    final_verdict: (ai && ai.final_verdict) || "",
    recommendations: (ai && ai.recommendations) || [],
    checks: scored.checks,
    detected_schema: signals.schema_types,
    files: {
      robots_txt: files.robots.found,
      sitemap_xml: files.sitemap.found || files.sitemap.referenced_in_robots,
      llms_txt: files.llms.found,
    },
    disclaimer: AIVIS_DISCLAIMERS[lang] || AIVIS_DISCLAIMERS.en,
  };
  return json({ result }, 200, corsOrigin);
}

async function callAiVisibilityScanner({ apiKey, model, userText, lang }) {
  const apiUrl = `${API_BASE}/${encodeURIComponent(model)}:generateContent`;
  const payload = {
    systemInstruction: { parts: [{ text: buildAiVisibilityPrompt(lang) }] },
    contents: [{ role: "user", parts: [{ text: userText }] }],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 1024,
      responseMimeType: "application/json",
      responseSchema: AIVIS_AI_SCHEMA,
      thinkingConfig: { thinkingBudget: 0 },
    },
  };
  const res = await postJsonWithRetry(apiUrl, apiKey, payload, "ai-visibility-scan", SCANNER_AI_TIMEOUT_MS, SCANNER_MAX_RETRIES);
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google API ${res.status}: ${errText.slice(0, 300)}`);
  }
  const data = await res.json();
  return parseAiVisibilityJson(extractReply(data));
}

function parseAiVisibilityJson(text) {
  if (!text) return null;
  let raw = String(text).trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) raw = fence[1].trim();
  let obj;
  try { obj = JSON.parse(raw); } catch { return null; }
  if (!obj || typeof obj !== "object") return null;
  const str = (v) => (typeof v === "string" ? v.trim() : "");
  const recs = Array.isArray(obj.recommendations)
    ? obj.recommendations.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim()).slice(0, 3)
    : [];
  return {
    executive_summary: str(obj.executive_summary),
    final_verdict: str(obj.final_verdict),
    recommendations: recs,
  };
}
