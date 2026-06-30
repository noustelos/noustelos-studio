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
  // ElevenLabs cloud TTS (read-aloud voice "Elias"). The key is a SECRET
  // (env.ELEVENLABS_API_KEY, never in the front-end); the front-end POSTs text to
  // /api/tts and the Worker proxies it. flash_v2_5 is multilingual (reads EL+EN in
  // the same voice), cheap and low-latency. All env-overridable.
  ELEVENLABS_VOICE_ID: "LjADh1ECU2fAah7OCeE8",   // Elias (male)
  ELEVENLABS_MODEL: "eleven_flash_v2_5",
  TTS_MAX_CHARS: 2000,            // safety cap on a single read-aloud request
  TTS_TIMEOUT_MS: 20000,
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
      return handleWebsiteScan(body, env, ctx, request, corsOrigin, origin, allowedOrigin);
    }

    // --- GDPR Auto-Scanner (third standalone, passphrase-gated AI Lab tool) ---
    // A static GDPR-compliance pre-audit on the SAME Worker, decoupled from the
    // Artifact, SaaS scanner AND website scanner: its own route, its own GDPR
    // extraction (trackers / CMP / policy links / cookie-setting embeds), its own
    // prompt + schema. Like the website scanner it FETCHES the URL (Option B
    // refusal if it can't), reuses fetchPageSignals + SSRF guards, and is bilingual
    // (lang:"en"|"el"). Same passphrases, no user-input logging. See handleGdprScan.
    if (new URL(request.url).pathname === "/api/gdpr-scan") {
      return handleGdprScan(body, env, ctx, request, corsOrigin, origin, allowedOrigin);
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
      return handleAiVisibilityScan(body, env, ctx, request, corsOrigin, origin, allowedOrigin);
    }

    // --- Site Assistant (PUBLIC, ungated public-facing chatbot) ---
    // The friendly noustelos.gr site guide: answers questions about the studio +
    // general concepts (SEO, AI visibility, testimonials, GDPR…) and points to the
    // right page/tool. UNLIKE the Artifact + scanners it has NO passphrase (it's for
    // random visitors), so it's protected technically instead: an Origin allow-list +
    // a per-IP KV rate limit + a cheap model with a tight token cap. Decoupled — its
    // own route, own short system prompt, no persona/memory/Drive/kill-switch.
    if (new URL(request.url).pathname === "/api/site-assistant") {
      return handleSiteAssistant(body, env, ctx, request, corsOrigin, origin, allowedOrigin);
    }

    // --- Text-to-Speech proxy (Artifact read-aloud, ElevenLabs "Elias") ---
    // The Artifact front-end POSTs { passphrase, text } here when a bot bubble's
    // read-aloud (▶) button is tapped; the Worker proxies it to ElevenLabs with the
    // SECRET key and returns audio/mpeg. Passphrase-gated with the SAME codes as the
    // chat (owner + guest), so unlocking the Artifact unlocks the voice. On-demand
    // only (the front-end never auto-reads via cloud), no user-input logging.
    if (new URL(request.url).pathname === "/api/tts") {
      return handleTts(body, env, ctx, corsOrigin);
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
 * Text-to-Speech proxy  —  POST /api/tts   (Artifact read-aloud, ElevenLabs)
 * ----------------------------------------------------------------------------
 * Proxies the read-aloud voice "Elias" through the Worker so the ElevenLabs key
 * stays SECRET (never reaches the front-end). Gated with the SAME passphrases as
 * the chat (owner + guest). Returns audio/mpeg bytes, or JSON on error. Does NOT
 * log the text. On-demand only — the front-end calls this when a ▶ button is
 * tapped; it caches the resulting audio per bubble so a replay never re-charges.
 * ========================================================================== */
async function handleTts(body, env, ctx, corsOrigin) {
  // Passphrase gate — reuse the chat codes (owner + guest). No separate secret.
  const valid = collectPassphrases(env);
  if (valid.size) {
    const provided = typeof body.passphrase === "string" ? body.passphrase.trim() : "";
    if (!valid.has(provided)) return json({ error: "locked" }, 401, corsOrigin);
  }

  if (!env.ELEVENLABS_API_KEY) {
    return json({ error: "tts_unconfigured" }, 500, corsOrigin);
  }

  // Light server-side hygiene: ensure a string, cap length (cost guard). The
  // front-end already strips emojis/markdown, so we don't re-clean here.
  const maxChars = Number(env.TTS_MAX_CHARS || DEFAULTS.TTS_MAX_CHARS);
  const text = String(body.text ?? "").trim().slice(0, maxChars);
  if (!text) return json({ error: "no_text" }, 400, corsOrigin);

  const voiceId = env.ELEVENLABS_VOICE_ID || DEFAULTS.ELEVENLABS_VOICE_ID;
  const modelId = env.ELEVENLABS_MODEL || DEFAULTS.ELEVENLABS_MODEL;
  const timeoutMs = Number(env.TTS_TIMEOUT_MS || DEFAULTS.TTS_TIMEOUT_MS);

  try {
    const resp = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: {
          "xi-api-key": env.ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({ text, model_id: modelId }),
        signal: AbortSignal.timeout(timeoutMs),
      }
    );

    if (!resp.ok) {
      // 401 (bad key) / 422 (bad request) / 429 (quota — credits exhausted) etc.
      // Surface a clean status so the front-end can fall back to browser TTS.
      console.error("tts upstream error:", resp.status);
      const status = resp.status === 401 || resp.status === 429 ? resp.status : 502;
      return json({ error: "tts_failed", status: resp.status }, status, corsOrigin);
    }

    // Stream the MP3 straight back to the browser with CORS + cache headers.
    return new Response(resp.body, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "private, max-age=86400",
        ...cors(corsOrigin),
      },
    });
  } catch (err) {
    console.error("tts error:", err && err.message);
    return json({ error: "tts_failed" }, 502, corsOrigin);
  }
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

async function handleWebsiteScan(body, env, ctx, request, corsOrigin, origin, allowedOrigin) {
  if (!env.GOOGLE_API_KEY) {
    return json({ error: "scan_failed" }, 500, corsOrigin);
  }

  // --- PUBLIC (ungated): Origin allow-list + per-IP + global daily KV caps ---
  const gate = await publicScanGate(env, request, origin, allowedOrigin, body.compare === true ? 2 : 1, body.lang === "el" ? "el" : "en");
  if (!gate.ok) return json(gate.body, gate.status, corsOrigin);

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
const GDPR_DISCLAIMER = {
  en: "Indicative, signals-based pre-audit of public HTML — not a full audit, not verification of runtime consent behaviour or real cookie storage, and not legal advice.",
  el: "Ενδεικτικός προέλεγχος βασισμένος σε σήματα δημόσιου HTML — όχι πλήρης έλεγχος, ούτε επαλήθευση της πραγματικής συμπεριφοράς συναίνεσης ή αποθήκευσης cookies, ούτε νομική συμβουλή.",
};

// A short, deterministic GDPR concern per tracker category (EN/EL).
function gdprTrackerConcern(category, el) {
  const c = String(category || "").toLowerCase();
  if (c.includes("advertis")) return el ? "Tracker διαφήμισης/retargeting· πρέπει να μπλοκάρεται μέχρι ο χρήστης να συναινέσει." : "Advertising/retargeting tracker; must be blocked until the user consents.";
  if (c.includes("tag")) return el ? "Μπορεί να φορτώσει κι άλλα tags/cookies· βεβαιώσου ότι κανένα δεν ενεργοποιείται πριν τη συναίνεση." : "Can load further tags/cookies; ensure none fire before consent.";
  if (c.includes("heatmap") || c.includes("behaviour")) return el ? "Καταγράφει συμπεριφορά χρήστη· χρειάζεται προηγούμενη συναίνεση." : "Records user behaviour; needs prior consent.";
  if (c.includes("chat") || c.includes("marketing")) return el ? "Μπορεί να θέτει cookies / να μεταφέρει δεδομένα· έλεγξε τη συναίνεση." : "May set cookies / transfer data; review consent.";
  return el ? "Θέτει cookies και μεταφέρει δεδομένα· χρειάζεται προηγούμενη συναίνεση στην ΕΕ." : "Sets cookies and transfers data; needs prior consent in the EU.";
}

// DETERMINISTIC GDPR report — rule-based scoring + templated narrative (NO model).
// The detection (trackers/CMP/links/embeds/fonts/forms) is already deterministic in
// extractGdprSignals; this turns those signals into a score, a 5-axis breakdown and
// the lists. ePrivacy logic: trackers WITHOUT a consent banner/CMP is the red flag.
function gdprReport(s, lang) {
  const el = lang === "el";
  const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));
  const trackers = s.trackers || [];
  const embeds = s.third_party_embeds || [];
  const cmps = s.cmps_detected || [];
  const hasTrackers = trackers.length > 0;
  const adTrackers = trackers.filter((t) => /advertis/i.test(t.category || "")).length;
  const cmp = cmps.length > 0;
  const banner = s.consent_banner_detected;
  const collectsPersonal = !!(s.collects_email || s.collects_phone);

  // --- Axis scores (0-100) ---
  let pt = 100;
  if (!s.privacy_policy_found) pt -= 50;
  if (!s.cookie_policy_link_found) pt -= 25;
  if (!s.terms_link_found) pt -= 8;
  if (!s.is_https) pt -= 15;
  pt = clamp(pt);
  const cc = hasTrackers ? (cmp ? 90 : (banner ? 60 : 15)) : ((cmp || banner) ? 100 : 85);
  const tf = clamp(100 - trackers.length * 12 - adTrackers * 8);
  const dc = !collectsPersonal ? 100
    : (s.form_consent_checkbox && s.privacy_policy_found) ? 90
    : (s.form_consent_checkbox || s.privacy_policy_found) ? 65 : 35;
  const tpe = clamp(100 - (s.google_fonts_hotlinked ? 25 : 0) - embeds.length * 15);
  const score = clamp(pt * 0.20 + cc * 0.30 + tf * 0.20 + dc * 0.15 + tpe * 0.15);
  const label = gdprScoreLabel(score, lang);

  const breakdown = {
    privacy_transparency: { score: pt, note: s.privacy_policy_found
      ? (el ? `Σύνδεσμος πολιτικής απορρήτου βρέθηκε${s.cookie_policy_link_found ? " και πολιτική cookies" : ", αλλά όχι ξεχωριστή πολιτική cookies"}.` : `Privacy policy link found${s.cookie_policy_link_found ? " plus a cookie policy" : ", but no dedicated cookie policy"}.`)
      : (el ? "Δεν βρέθηκε σύνδεσμος πολιτικής απορρήτου." : "No privacy policy link was found.") },
    cookie_consent: { score: cc, note: hasTrackers
      ? (cmp ? (el ? `Εντοπίστηκε CMP (${cmps.join(", ")}).` : `Consent Management Platform detected (${cmps.join(", ")}).`)
        : banner ? (el ? "Banner cookies εντοπίστηκε, αλλά όχι γνωστό CMP." : "A cookie banner was detected, but no known CMP.")
        : (el ? "Φορτώνουν trackers χωρίς εντοπισμένο banner/CMP συναίνεσης." : "Trackers load with no detected consent banner/CMP."))
      : (el ? "Δεν εντοπίστηκαν non-essential trackers που να απαιτούν συναίνεση." : "No non-essential trackers requiring consent were detected.") },
    tracking_footprint: { score: tf, note: hasTrackers
      ? (el ? `${trackers.length} scripts παρακολούθησης/μάρκετινγκ${adTrackers ? ` (${adTrackers} διαφημιστικά)` : ""}.` : `${trackers.length} tracking/marketing scripts${adTrackers ? ` (${adTrackers} advertising)` : ""}.`)
      : (el ? "Δεν εντοπίστηκαν scripts τρίτων για παρακολούθηση." : "No third-party tracking scripts were detected.") },
    data_collection: { score: dc, note: !collectsPersonal
      ? (el ? "Δεν εντοπίστηκε φόρμα που να συλλέγει προσωπικά δεδομένα." : "No form collecting personal data was detected.")
      : (el ? `Φόρμα συλλέγει προσωπικά δεδομένα· checkbox συναίνεσης ${s.form_consent_checkbox ? "βρέθηκε" : "δεν εντοπίστηκε"}.` : `A form collects personal data; a consent checkbox was ${s.form_consent_checkbox ? "found" : "not detected"}.`) },
    third_party_exposure: { score: tpe, note: (s.google_fonts_hotlinked || embeds.length)
      ? (el ? `${s.google_fonts_hotlinked ? "Google Fonts από Google. " : ""}${embeds.length ? "Embeds με cookies: " + embeds.join(", ") + "." : ""}`.trim() : `${s.google_fonts_hotlinked ? "Google Fonts hotlinked from Google. " : ""}${embeds.length ? "Cookie-setting embeds: " + embeds.join(", ") + "." : ""}`.trim())
      : (el ? "Δεν εντοπίστηκαν hotlinked fonts ή embeds που θέτουν cookies." : "No hotlinked fonts or cookie-setting embeds detected.") },
  };

  const detected_trackers = trackers.map((t) => ({ name: t.name, category: t.category, concern: gdprTrackerConcern(t.category, el) }));

  const inPlace = [];
  if (s.is_https) inPlace.push(el ? "Εξυπηρετείται μέσω HTTPS." : "Served over HTTPS.");
  if (s.privacy_policy_found) inPlace.push(el ? "Υπάρχει σύνδεσμος πολιτικής απορρήτου." : "A privacy policy link is present.");
  if (s.cookie_policy_link_found) inPlace.push(el ? "Υπάρχει σύνδεσμος πολιτικής/ειδοποίησης cookies." : "A cookie policy / notice link is present.");
  if (cmp) inPlace.push(el ? `Εντοπίστηκε CMP (${cmps.join(", ")}).` : `A Consent Management Platform was detected (${cmps.join(", ")}).`);
  else if (banner) inPlace.push(el ? "Εντοπίστηκε banner συναίνεσης cookies." : "A cookie-consent banner was detected.");
  if (s.form_consent_checkbox) inPlace.push(el ? "Οι φόρμες περιλαμβάνουν checkbox συναίνεσης." : "Forms include a consent checkbox.");
  if (!hasTrackers) inPlace.push(el ? "Δεν εντοπίστηκαν scripts τρίτων για παρακολούθηση." : "No third-party tracking scripts were detected.");
  if (!inPlace.length) inPlace.push(el ? "Δεν εντοπίστηκαν θετικά σήματα συμμόρφωσης." : "No positive compliance signals were detected.");

  const risks = [];
  if (hasTrackers && !banner) risks.push(el ? "Scripts παρακολούθησης/διαφήμισης φορτώνουν χωρίς εντοπισμένο banner/CMP — τα μη απαραίτητα cookies πιθανώς τρέχουν πριν τη συναίνεση." : "Tracking/advertising scripts load with no detected consent banner or CMP — non-essential cookies likely run before consent.");
  if (!s.privacy_policy_found) risks.push(el ? "Δεν βρέθηκε σύνδεσμος πολιτικής απορρήτου." : "No privacy policy link was found.");
  if (hasTrackers && !s.cookie_policy_link_found) risks.push(el ? "Δεν βρέθηκε ξεχωριστή πολιτική/ειδοποίηση cookies." : "No dedicated cookie policy / notice link was found.");
  if (s.google_fonts_hotlinked) risks.push(el ? "Τα Google Fonts φορτώνονται απευθείας από την Google (ζήτημα μεταφοράς δεδομένων στην ΕΕ)." : "Google Fonts are hotlinked from Google (an EU data-transfer concern).");
  if (collectsPersonal && !s.form_consent_checkbox) risks.push(el ? "Φόρμες συλλέγουν προσωπικά δεδομένα χωρίς εντοπισμένο checkbox συναίνεσης ή σύνδεσμο απορρήτου." : "Forms collect personal data with no detected consent checkbox or privacy-link reference.");
  if (embeds.length) risks.push(el ? `Embeds τρίτων που θέτουν cookies: ${embeds.join(", ")}.` : `Cookie-setting third-party embeds are present: ${embeds.join(", ")}.`);
  if (!s.is_https) risks.push(el ? "Ο ιστότοπος δεν εξυπηρετείται μέσω HTTPS." : "The site is not served over HTTPS.");
  if (!risks.length) risks.push(el ? "Δεν εντοπίστηκαν σημαντικά κενά από τα διαθέσιμα σήματα." : "No major gaps were detected from the available signals.");

  const steps = [];
  if (hasTrackers && !cmp) steps.push(el ? "Πρόσθεσε CMP που μπλοκάρει τα μη απαραίτητα scripts μέχρι τη συναίνεση." : "Add a Consent Management Platform that blocks non-essential scripts until consent.");
  if (hasTrackers && !s.cookie_policy_link_found) steps.push(el ? "Πρόσθεσε ξεχωριστή πολιτική cookies και σύνδεσμο ρυθμίσεων cookies." : "Add a dedicated cookie policy and a cookie-settings link.");
  if (collectsPersonal && !s.form_consent_checkbox) steps.push(el ? "Πρόσθεσε checkbox συναίνεσης και αναφορά στην πολιτική απορρήτου σε κάθε φόρμα." : "Add a consent checkbox and a privacy-policy reference to every data-collection form.");
  if (s.google_fonts_hotlinked) steps.push(el ? "Self-host τα Google Fonts αντί για hotlink από την Google." : "Self-host Google Fonts instead of hotlinking from Google.");
  if (embeds.length) steps.push(el ? "Φόρτωσε τα embeds (π.χ. YouTube) σε privacy-enhanced/no-cookie mode." : "Load embeds (e.g. YouTube) in privacy-enhanced / no-cookie mode.");
  if (!s.privacy_policy_found) steps.push(el ? "Δημοσίευσε καθαρή, προσβάσιμη πολιτική απορρήτου." : "Publish a clear, reachable privacy policy.");
  if (!steps.length) steps.push(el ? "Διατήρησε τα τρέχοντα μέτρα και επανέλεγχε μετά από αλλαγές σε scripts/φόρμες." : "Maintain current measures and re-check after changes to scripts or forms.");

  const summary = el
    ? `Με βάση δημόσια σήματα της σελίδας, η στάση GDPR/ePrivacy βαθμολογείται ${score}/100 (${label}). ${hasTrackers ? (banner ? "Εντοπίστηκαν trackers και μηχανισμός συναίνεσης." : "Εντοπίστηκαν trackers χωρίς μηχανισμό συναίνεσης — το βασικό ζήτημα.") : "Δεν εντοπίστηκαν non-essential trackers."}`
    : `Based on public page signals, the GDPR/ePrivacy posture scores ${score}/100 (${label}). ${hasTrackers ? (banner ? "Trackers and a consent mechanism were detected." : "Trackers were detected with no consent mechanism — the core issue.") : "No non-essential trackers were detected."}`;
  const verdict = score >= 80
    ? (el ? "Καλή βασική στάση συμμόρφωσης, με μικρά σημεία προς βελτίωση." : "A good baseline posture, with minor points to tighten.")
    : score >= 60
    ? (el ? "Μερική συμμόρφωση — χρειάζονται διορθώσεις, κυρίως στη συναίνεση cookies." : "Partially aligned — fixes are needed, mainly around cookie consent.")
    : (el ? "Σημαντικά κενά — χρειάζεται μηχανισμός συναίνεσης πριν τρέξουν νόμιμα τα trackers." : "Significant gaps — a working consent mechanism is needed before trackers can run lawfully.");

  return {
    mode: "single",
    language: lang,
    compliance_score: score,
    compliance_label: label,
    executive_summary: summary,
    score_breakdown: breakdown,
    detected_trackers,
    what_is_in_place: inPlace,
    key_risks: risks,
    recommended_next_steps: steps,
    final_verdict: verdict,
    disclaimer: GDPR_DISCLAIMER[lang] || GDPR_DISCLAIMER.en,
  };
}

async function handleGdprScan(body, env, ctx, request, corsOrigin, origin, allowedOrigin) {
  if (!env.GOOGLE_API_KEY) {
    return json({ error: "scan_failed" }, 500, corsOrigin);
  }

  // --- PUBLIC (ungated): Origin allow-list + per-IP + global daily KV caps ---
  const gate = await publicScanGate(env, request, origin, allowedOrigin, body.compare === true ? 2 : 1, body.lang === "el" ? "el" : "en");
  if (!gate.ok) return json(gate.body, gate.status, corsOrigin);

  const lang = body.lang === "el" ? "el" : "en";

  const clean = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const urlOk = (u) => /^(https?:\/\/)?[^\s.]+\.[^\s]{2,}$/i.test(u);
  const url = clean(body.url, 300);
  if (!url || !urlOk(url)) {
    return json({ error: "url_required" }, 400, corsOrigin);
  }

  // --- Fetch + extract real GDPR signals. Option B: refuse if unreadable. ---
  const fetched = await fetchPageSignals(url, extractGdprSignals);
  if (!fetched.ok) {
    return json({ error: "unreachable", message: websiteFetchRefusal(fetched.reason, lang, { status: fetched.status }) }, 200, corsOrigin);
  }

  // DETERMINISTIC report — rule-based scoring + templated narrative (NO model call).
  const result = gdprReport(fetched.signals, lang);
  result.scanned_url = fetched.signals.final_url || url;
  return json({ result }, 200, corsOrigin);
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
const AIVIS_DISCLAIMERS = {
  en: "Indicative analysis based on static, public HTML signals — not a live AI crawl, a guarantee of citation, or a substitute for full SEO/GEO work. llms.txt is an emerging convention. The AI Citation Probability is a heuristic, not a prediction.",
  el: "Ενδεικτική ανάλυση βασισμένη σε στατικά, δημόσια σήματα HTML — όχι πραγματικό crawl από AI, ούτε εγγύηση παράθεσης, ούτε υποκατάστατο πλήρους εργασίας SEO/GEO. Το llms.txt είναι αναδυόμενη σύμβαση. Η «Πιθανότητα Παράθεσης από AI» είναι ευρετική, όχι πρόβλεψη.",
};

// DETERMINISTIC narrative (NO model call). Per-check fix lines + per-grade verdicts.
const AIVIS_FIX = {
  en: {
    robots_txt: "Add a robots.txt at your site root with clear User-agent rules so crawlers (including AI crawlers) know what they can access.",
    sitemap_xml: "Publish an XML sitemap and reference it in robots.txt so crawlers can find all your pages.",
    llms_txt: "Publish an llms.txt at your site root pointing AI assistants to your key pages (services, pricing, about, contact) — it's the heaviest single signal here.",
    org_schema: "Add Organization (JSON-LD) structured data so AI can identify who you are.",
    faq_schema: "Add FAQPage structured data to a real FAQ section so assistants can lift and cite your answers directly.",
    localbusiness_schema: "If you're a local business, add LocalBusiness structured data with your address and contact details.",
    contact_info: "Surface clear contact details (phone, email and/or a postal address) so AI can attribute and recommend you.",
    meta_title: "Set a descriptive <title> tag of about 30–60 characters.",
    meta_description: "Add a meta description of about 120–160 characters summarising the page.",
    open_graph: "Add Open Graph tags (og:title, og:description, og:image) for cleaner sharing and richer machine context.",
    canonical: "Declare a canonical URL to remove duplicate-content ambiguity.",
    heading_structure: "Use exactly one clear H1 that states what the page is about.",
    content_richness: "Add more substantial, readable copy so there is enough citable content for AI to use.",
    ai_friendly_wording: "Add clearly labelled Services, Pricing, About, FAQ and Contact sections — the content AI assistants look for.",
  },
  el: {
    robots_txt: "Πρόσθεσε robots.txt στη ρίζα με καθαρούς κανόνες User-agent ώστε τα crawlers (και των AI) να ξέρουν τι μπορούν να δουν.",
    sitemap_xml: "Δημοσίευσε XML sitemap και ανέφερέ το στο robots.txt ώστε τα crawlers να βρίσκουν όλες τις σελίδες.",
    llms_txt: "Δημοσίευσε llms.txt στη ρίζα που να παραπέμπει τους βοηθούς AI στις βασικές σου σελίδες (υπηρεσίες, τιμές, σχετικά, επικοινωνία) — το βαρύτερο μεμονωμένο σήμα εδώ.",
    org_schema: "Πρόσθεσε δομημένα δεδομένα Organization (JSON-LD) ώστε το AI να αναγνωρίζει ποιος είσαι.",
    faq_schema: "Πρόσθεσε δομημένα δεδομένα FAQPage σε μια πραγματική ενότητα συχνών ερωτήσεων ώστε οι βοηθοί να παραθέτουν απευθείας τις απαντήσεις σου.",
    localbusiness_schema: "Αν είσαι τοπική επιχείρηση, πρόσθεσε δομημένα δεδομένα LocalBusiness με διεύθυνση και στοιχεία επικοινωνίας.",
    contact_info: "Ανέδειξε καθαρά στοιχεία επικοινωνίας (τηλέφωνο, email ή/και διεύθυνση) ώστε το AI να σε αποδίδει και να σε προτείνει.",
    meta_title: "Όρισε περιγραφικό <title> περίπου 30–60 χαρακτήρων.",
    meta_description: "Πρόσθεσε meta description περίπου 120–160 χαρακτήρων που να συνοψίζει τη σελίδα.",
    open_graph: "Πρόσθεσε ετικέτες Open Graph (og:title, og:description, og:image) για καθαρότερο share και πλουσιότερο context.",
    canonical: "Δήλωσε canonical URL για να φύγει η ασάφεια διπλότυπου περιεχομένου.",
    heading_structure: "Χρησιμοποίησε ακριβώς ένα καθαρό H1 που να λέει για τι είναι η σελίδα.",
    content_richness: "Πρόσθεσε πιο ουσιαστικό, ευανάγνωστο κείμενο ώστε να υπάρχει αρκετό παραθέσιμο περιεχόμενο για το AI.",
    ai_friendly_wording: "Πρόσθεσε καθαρές ενότητες Υπηρεσιών, Τιμών, Σχετικά, FAQ και Επικοινωνίας — το περιεχόμενο που ψάχνουν οι βοηθοί AI.",
  },
};
const AIVIS_VERDICTS = {
  en: {
    A: "Your site is technically very easy for AI assistants to discover, parse and cite.",
    B: "A solid AI-visibility foundation, with a few signals left to add.",
    C: "The basics are reasonable, but several AI-visibility signals are missing.",
    D: "Most AI-visibility signals are missing — there's a lot of low-effort upside here.",
  },
  el: {
    A: "Ο ιστότοπός σου είναι τεχνικά πολύ εύκολο να τον εντοπίζουν, να τον διαβάζουν και να τον παραθέτουν οι βοηθοί AI.",
    B: "Γερά θεμέλια ορατότητας σε AI, με λίγα σήματα ακόμη να προστεθούν.",
    C: "Τα βασικά είναι λογικά, αλλά αρκετά σήματα ορατότητας σε AI λείπουν.",
    D: "Τα περισσότερα σήματα ορατότητας σε AI λείπουν — υπάρχει μεγάλο περιθώριο με μικρή προσπάθεια.",
  },
};

// Order gaps: missing before partial, then by weight desc.
function aivisGaps(checks) {
  return checks
    .filter((c) => c.status !== "pass")
    .sort((a, b) => (a.status === b.status ? b.weight - a.weight : (a.status === "missing" ? -1 : 1)));
}

function aivisNarrative(scored, lang) {
  const el = lang === "el";
  const passCount = scored.checks.filter((c) => c.status === "pass").length;
  const gaps = aivisGaps(scored.checks);
  const fixMap = AIVIS_FIX[lang] || AIVIS_FIX.en;
  const recommendations = gaps.slice(0, 3).map((c) => fixMap[c.key]).filter(Boolean);
  const topGapNames = gaps.slice(0, 3).map((c) => c.name);
  const verdict = (AIVIS_VERDICTS[lang] || AIVIS_VERDICTS.en)[scored.grade] || "";
  const summary = el
    ? `Με βάση πραγματικά δημόσια σήματα της σελίδας, ο ιστότοπος σκοράρει ${scored.score}/100 (βαθμός ${scored.grade}, ${scored.grade_label}) και περνά ${passCount} από 15 ελέγχους ορατότητας σε AI. `
        + (topGapNames.length ? `Τα σημαντικότερα κενά: ${topGapNames.join(", ")}.` : "Όλοι οι έλεγχοι περνούν.")
    : `Based on real public page signals, the site scores ${scored.score}/100 (grade ${scored.grade}, ${scored.grade_label}) and passes ${passCount} of 15 AI-visibility checks. `
        + (topGapNames.length ? `The biggest gaps: ${topGapNames.join(", ")}.` : "All checks pass.");
  return { executive_summary: summary, final_verdict: verdict, recommendations };
}

function aivisCompareNarrative(a, b, lang) {
  const el = lang === "el";
  const A = a.scored, B = b.scored;
  const labelA = hostLabel(a.signals.final_url), labelB = hostLabel(b.signals.final_url);
  const fixMap = AIVIS_FIX[lang] || AIVIS_FIX.en;
  const strengths = (s) => s.checks.filter((c) => c.status === "pass").sort((x, y) => y.weight - x.weight).slice(0, 3).map((c) => c.name);
  const topGapFix = (s) => { const g = aivisGaps(s.checks)[0]; return g ? fixMap[g.key] : null; };
  const edges = [];
  for (let i = 0; i < A.checks.length; i++) {
    const ca = A.checks[i], cb = B.checks[i];
    if (ca.points !== cb.points) edges.push({ name: ca.name, w: ca.weight, side: ca.points > cb.points ? "a" : "b" });
  }
  const tie = A.score === B.score;
  const winA = A.score >= B.score;
  const wLabel = winA ? labelA : labelB, lLabel = winA ? labelB : labelA;
  const wScore = winA ? A.score : B.score, lScore = winA ? B.score : A.score;
  const loser = winA ? B : A;
  const edgeNames = edges.filter((e) => e.side === (winA ? "a" : "b")).sort((x, y) => y.w - x.w).slice(0, 3).map((e) => e.name);
  const recFix = topGapFix(loser);
  return {
    executive_summary: el
      ? (tie ? `${labelA} και ${labelB} ισοβαθμούν στο ${A.score}/100 για ορατότητα σε AI.`
             : `${wLabel} σκοράρει ${wScore}/100 έναντι ${lScore}/100 του ${lLabel}, με ισχυρότερα σήματα ορατότητας σε AI${edgeNames.length ? " — κυρίως: " + edgeNames.join(", ") + "." : "."}`)
      : (tie ? `${labelA} and ${labelB} tie at ${A.score}/100 for AI visibility.`
             : `${wLabel} scores ${wScore}/100 vs ${lLabel}'s ${lScore}/100, with stronger AI-visibility signals${edgeNames.length ? " — mainly: " + edgeNames.join(", ") + "." : "."}`),
    site_a_strengths: strengths(A),
    site_b_strengths: strengths(B),
    recommendation: el
      ? (recFix ? `Η κύρια ευκαιρία για ${lLabel}: ${recFix}` : `${lLabel} καλύπτει ήδη τα βασικά σήματα ορατότητας σε AI.`)
      : (recFix ? `The main opportunity for ${lLabel}: ${recFix}` : `${lLabel} already covers the core AI-visibility signals.`),
    final_verdict: el
      ? (tie ? "Οι δύο ιστότοποι είναι εξίσου εύκολο να παρατεθούν από AI αυτή τη στιγμή." : `${wLabel} είναι αυτή τη στιγμή ευκολότερο να τον εντοπίζουν και να τον παραθέτουν οι βοηθοί AI.`)
      : (tie ? "Both sites are currently equally easy for AI assistants to cite." : `${wLabel} is currently easier for AI assistants to discover and cite.`),
  };
}

async function handleAiVisibilityScan(body, env, ctx, request, corsOrigin, origin, allowedOrigin) {
  if (!env.GOOGLE_API_KEY) {
    return json({ error: "scan_failed" }, 500, corsOrigin);
  }

  // --- PUBLIC (ungated): Origin allow-list + per-IP + global daily KV caps ---
  const gate = await publicScanGate(env, request, origin, allowedOrigin, body.compare === true ? 2 : 1, body.lang === "el" ? "el" : "en");
  if (!gate.ok) return json(gate.body, gate.status, corsOrigin);

  const lang = body.lang === "el" ? "el" : "en";
  const clean = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const urlOk = (u) => /^(https?:\/\/)?[^\s.]+\.[^\s]{2,}$/i.test(u);
  const url = clean(body.url, 300);
  if (!url || !urlOk(url)) {
    return json({ error: "url_required" }, 400, corsOrigin);
  }
  // === Compare mode: BOTH sites scored + narrated deterministically (no model). ===
  // If EITHER site can't be read, there's no comparison (the message names which).
  if (body.compare === true) {
    const urlB = clean(body.urlB, 300);
    if (!urlB || !urlOk(urlB)) return json({ error: "url_required" }, 400, corsOrigin);
    const [a, b] = await Promise.all([
      gatherAiVisibility(url, lang),
      gatherAiVisibility(urlB, lang),
    ]);
    if (!a.ok) return json({ error: "unreachable", message: websiteFetchRefusal(a.reason, lang, { status: a.status, siteLabel: hostLabel(url) }) }, 200, corsOrigin);
    if (!b.ok) return json({ error: "unreachable", message: websiteFetchRefusal(b.reason, lang, { status: b.status, siteLabel: hostLabel(urlB) }) }, 200, corsOrigin);
    return json({ result: buildAiVisibilityCompare(a, b, lang) }, 200, corsOrigin);
  }

  // === Single mode ===
  const one = await gatherAiVisibility(url, lang);
  if (!one.ok) {
    return json({ error: "unreachable", message: websiteFetchRefusal(one.reason, lang, { status: one.status }) }, 200, corsOrigin);
  }
  const { signals, files, scored } = one;

  // DETERMINISTIC narrative — templated from the check results (NO model call).
  const nar = aivisNarrative(scored, lang);

  const result = {
    mode: "single",
    language: lang,
    scanned_url: signals.final_url || url,
    score: scored.score,
    grade: scored.grade,
    grade_label: scored.grade_label,
    citation_probability: scored.citation_probability,
    executive_summary: nar.executive_summary,
    final_verdict: nar.final_verdict,
    recommendations: nar.recommendations,
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

// Short, human label for a site (hostname, no www) — used in the compare table.
function hostLabel(u) {
  try { return new URL(/^https?:\/\//i.test(u) ? u : "https://" + u).hostname.replace(/^www\./i, ""); }
  catch { return String(u).replace(/^https?:\/\//i, "").split("/")[0]; }
}

// Fetch + 3 root files + deterministic score for ONE site. Shared by single +
// compare. Returns { ok:true, signals, files, scored } or { ok:false, reason, status }.
async function gatherAiVisibility(url, lang) {
  const fetched = await fetchPageSignals(url, extractAiVisibilitySignals);
  if (!fetched.ok) return { ok: false, reason: fetched.reason, status: fetched.status };
  const signals = fetched.signals;
  const origin = signals.final_url || url;
  const [robots, sitemap, llms] = await Promise.all([
    fetchRootFile(origin, "/robots.txt"),
    fetchRootFile(origin, "/sitemap.xml"),
    fetchRootFile(origin, "/llms.txt"),
  ]);
  const files = classifyRootFiles(robots, sitemap, llms);
  const scored = scoreAiVisibility(signals, files, lang);
  return { ok: true, signals, files, scored };
}

// DETERMINISTIC comparison table (Overall + the 15 checks). The model never
// scores — it only adds the narrative fields afterwards.
function buildAiVisibilityCompare(a, b, lang) {
  const A = a.scored, B = b.scored;
  const win = (x, y) => (x > y ? "a" : (y > x ? "b" : "tie"));
  const comparison = [{
    criterion: lang === "el" ? "Συνολική ορατότητα σε AI" : "Overall AI visibility",
    weight: 100, site_a_score: A.score, site_b_score: B.score, winner: win(A.score, B.score),
  }];
  for (let i = 0; i < A.checks.length; i++) {
    const ca = A.checks[i], cb = B.checks[i];
    comparison.push({
      criterion: ca.name, weight: ca.weight,
      site_a_score: ca.points, site_b_score: cb.points, winner: win(ca.points, cb.points),
    });
  }
  return {
    mode: "compare",
    language: lang,
    site_a_label: hostLabel(a.signals.final_url),
    site_b_label: hostLabel(b.signals.final_url),
    site_a_url: a.signals.final_url,
    site_b_url: b.signals.final_url,
    site_a_overall: A.score, site_b_overall: B.score,
    site_a_grade: A.grade, site_a_grade_label: A.grade_label, site_a_citation: A.citation_probability,
    site_b_grade: B.grade, site_b_grade_label: B.grade_label, site_b_citation: B.citation_probability,
    comparison,
    ...aivisCompareNarrative(a, b, lang),
    disclaimer: AIVIS_DISCLAIMERS[lang] || AIVIS_DISCLAIMERS.en,
  };
}

// Plain-text block of BOTH sites' per-check points, fed to the narrative model.
/* ===========================================================================
 * Site Assistant  —  POST /api/site-assistant   (PUBLIC, no passphrase)
 * ----------------------------------------------------------------------------
 * The public-facing noustelos.gr chatbot: answers questions about the studio and
 * general web/AI concepts (SEO, AI visibility, testimonials, GDPR…), pointing to
 * the right page/tool. Replaces a separate Hugging Face Space so the system prompt
 * + key live here. Decoupled from the Artifact: own route, own SHORT prompt, no
 * persona/memory/Drive/kill-switch. Because it's ungated it's protected by an
 * Origin allow-list (isAllowed) + a per-IP KV rate limit (saRateLimited) + a cheap
 * model with a tight token cap. Env overrides: SA_SYSTEM_PROMPT, SA_MODEL,
 * SA_MAX_OUTPUT_TOKENS, SA_TEMPERATURE, SA_HISTORY_CAP, SA_RATE_LIMIT, SA_RATE_WINDOW_S.
 * ==========================================================================*/

const SA_DEFAULTS = {
  RATE_LIMIT: 20,        // messages per window, per IP
  RATE_WINDOW_S: 600,    // 10 minutes
  MAX_OUTPUT_TOKENS: 600,
  HISTORY_CAP: 12,
  TEMPERATURE: 0.6,
};

const SITE_ASSISTANT_PROMPT = [
  "You are the Noustelos Studio site assistant — a friendly, professional guide on noustelos.gr. You help visitors understand the studio and answer practical questions a prospective client might have.",
  "",
  "ABOUT THE STUDIO (facts — do not contradict or invent beyond these):",
  "- Noustelos Studio is a web design and development practice based in Santorini, Greece, led by Nick Karadimas.",
  "- It builds custom websites, landing pages and creative web projects, plus agentic AI platforms delivered as SaaS. Focus is tourism and hospitality, but it is open to other fields.",
  "- Flagship live product: AskSantorini.ai — a free AI guide/concierge for Santorini visitors. A sister project, AskSingapore.ai, is in early preview.",
  "- The studio runs an 'AI Lab' with free, AI-powered tools: an AI Visibility Scanner (how easily AI assistants can find and cite a site), a Website Quality Scanner, a SaaS Readiness Scanner, and a GDPR Auto-Scanner. They are passphrase-gated; a visitor can request an access code by email through the contact form.",
  "- There is also 'The Artifact', an experimental AI chat playground.",
  "- To start a project or get a quote, visitors use the contact form on the site; Nick replies by email. There are no fixed public prices — quotes are tailored to each project.",
  "",
  "WHAT YOU CAN EXPLAIN, in plain language for non-experts: SEO; AI visibility / Generative Engine Optimization (GEO); llms.txt; structured data (schema.org); testimonials and social proof and why they matter; landing pages and conversion; GDPR and cookie basics. When a topic maps to one of the Lab tools or a FAQ page, mention it helpfully (e.g. 'you can check this with our free AI Visibility Scanner').",
  "",
  "STYLE:",
  "- Be concise: usually 2-5 short sentences. No walls of text; minimal or no emoji.",
  "- Reply in the user's language — Greek or English — detected from their message.",
  "- Warm, clear and helpful; never pushy.",
  "",
  "HONESTY (important):",
  "- Never invent facts, prices, features, clients or results. If you don't know, say so and suggest contacting Nick through the contact form.",
  "- Do NOT refer visitors to specific site pages or sections unless they are named in the facts above (the four AI Lab tools, AskSantorini.ai, The Artifact, the contact form). Never claim a section exists (e.g. a testimonials page) unless listed. When unsure where to point someone, point to the contact form.",
  "- You are an AI assistant, not a human — own it if asked.",
  "- For legal or compliance questions (e.g. GDPR), give general information only and say it is not legal advice.",
  "- Do not overpromise outcomes (rankings, guaranteed AI citations, traffic). Describe honestly what helps.",
  "- Gently steer clearly off-topic requests back to the studio, its work, or web/AI topics.",
].join("\n");

// Per-IP fixed-window rate limit via KV. Fails OPEN if KV is unbound. Read-modify-
// write isn't atomic (KV has no increment), which is fine for soft abuse control.
async function saRateLimited(env, ip) {
  if (!env.ARTIFACT_KV) return false;
  const limit = Number(env.SA_RATE_LIMIT || SA_DEFAULTS.RATE_LIMIT);
  const windowS = Number(env.SA_RATE_WINDOW_S || SA_DEFAULTS.RATE_WINDOW_S);
  const bucket = Math.floor(Date.now() / (windowS * 1000));
  const key = `rl:sa:${ip}:${bucket}`;
  let count = 0;
  try { count = parseInt((await env.ARTIFACT_KV.get(key)) || "0", 10) || 0; } catch { return false; }
  if (count >= limit) return true;
  try { await env.ARTIFACT_KV.put(key, String(count + 1), { expirationTtl: windowS + 60 }); } catch { /* best effort */ }
  return false;
}

async function handleSiteAssistant(body, env, ctx, request, corsOrigin, origin, allowedOrigin) {
  if (!env.GOOGLE_API_KEY) return json({ error: "unavailable" }, 500, corsOrigin);

  // Origin allow-list — blocks naive off-site abuse (not a hard boundary; spoofable).
  if (!isAllowed(origin, allowedOrigin)) {
    return json({ error: "forbidden" }, 403, corsOrigin);
  }

  // Per-IP rate limit (KV). The front-end shows the friendly `reply` calmly.
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (await saRateLimited(env, ip)) {
    return json({
      error: "rate_limited",
      reply: "I'm getting a lot of questions right now — give me a minute and try again. For anything urgent, use the contact form and Nick will reply by email.",
    }, 429, corsOrigin);
  }

  const messages = normalizeMessages(body);
  if (!messages.length) return json({ error: "no_message" }, 400, corsOrigin);

  const model = env.SA_MODEL || env.SCANNER_MODEL || SCAN_DEFAULT_MODEL;
  const cap = Number(env.SA_HISTORY_CAP || SA_DEFAULTS.HISTORY_CAP);
  const contents = messages.slice(-cap).map((m) => ({
    role: (m.role === "model" || m.role === "assistant" || m.role === "bot") ? "model" : "user",
    parts: [{ text: String(m.text ?? m.content ?? "").slice(0, 2000) }],
  }));

  const payload = {
    systemInstruction: { parts: [{ text: env.SA_SYSTEM_PROMPT || SITE_ASSISTANT_PROMPT }] },
    contents,
    generationConfig: {
      temperature: Number(env.SA_TEMPERATURE || SA_DEFAULTS.TEMPERATURE),
      maxOutputTokens: Number(env.SA_MAX_OUTPUT_TOKENS || SA_DEFAULTS.MAX_OUTPUT_TOKENS),
      thinkingConfig: { thinkingBudget: 0 },
    },
  };

  let reply;
  try {
    const apiUrl = `${API_BASE}/${encodeURIComponent(model)}:generateContent`;
    const res = await postJsonWithRetry(apiUrl, env.GOOGLE_API_KEY, payload, "site-assistant", SCANNER_AI_TIMEOUT_MS, SCANNER_MAX_RETRIES);
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Google API ${res.status}: ${t.slice(0, 200)}`);
    }
    const data = await res.json();
    reply = extractReply(data);
  } catch (err) {
    console.error("site-assistant error:", String((err && err.message) || err));
    return json({ error: "assistant_failed" }, 502, corsOrigin);
  }
  if (!reply) return json({ error: "assistant_failed" }, 502, corsOrigin);
  return json({ reply }, 200, corsOrigin);
}

/* ===========================================================================
 * Public scanner gate (ungated AI Visibility / Website / GDPR scanners)
 * ----------------------------------------------------------------------------
 * These three scanners are now PUBLIC (no passphrase) so anyone can try them.
 * Each request FETCHES a URL + calls the model, so it's heavier than a chat turn
 * → protected technically: an Origin allow-list + a per-IP KV rate limit (tighter
 * than the chat) + a GLOBAL daily circuit-breaker (catches distributed/IP-rotating
 * abuse the per-IP limit can't). A compare scan counts as weight 2. The SSRF guards
 * (parseSafeUrl/fetchFollow) already bound what URLs the Worker will fetch. The SaaS
 * scanner stays passphrase-gated (it's a model-only tool, kept opt-in). Env overrides:
 * SCAN_RATE_LIMIT, SCAN_RATE_WINDOW_S, SCAN_DAILY_CAP. ==========================*/

// Per-IP: 20 scans/day (fixed window). Global circuit-breaker: 600/day across all
// users. Both env-overridable (e.g. SCAN_RATE_LIMIT=3 + SCAN_RATE_WINDOW_S=3600 for
// "3/hour"). A compare scan counts as weight 2.
const SCAN_GATE_DEFAULTS = { RATE_LIMIT: 20, RATE_WINDOW_S: 86400, DAILY_CAP: 300 };

// Localized limit messages (shown to the user as `message`).
function scanLimitMsg(lang, kind) {
  const el = lang === "el";
  if (kind === "global") {
    return el
      ? "Ο scanner δέχεται πολλή κίνηση σήμερα — το δωρεάν ημερήσιο όριο εξαντλήθηκε. Δοκίμασε ξανά αύριο ή επικοινώνησε μαζί μας."
      : "The scanner is seeing heavy traffic today — the free daily limit has been reached. Please try again tomorrow, or get in touch.";
  }
  return el
    ? "Έφτασες το ημερήσιο όριο σαρώσεων για αυτή τη σύνδεση. Δοκίμασε ξανά αύριο ή επικοινώνησε μαζί μας."
    : "You've reached the daily scan limit for this connection. Please try again tomorrow, or get in touch.";
}

// Fixed-window KV counter. Returns true if ALREADY at/over the limit (block),
// otherwise bumps by `weight` and returns false. Fails OPEN if KV is unbound.
// Read-modify-write isn't atomic (KV has no increment) — fine for soft limits.
async function kvBump(env, key, limit, windowS, weight) {
  if (!env.ARTIFACT_KV) return false;
  let count = 0;
  try { count = parseInt((await env.ARTIFACT_KV.get(key)) || "0", 10) || 0; } catch { return false; }
  if (count >= limit) return true;
  try { await env.ARTIFACT_KV.put(key, String(count + (weight || 1)), { expirationTtl: windowS + 60 }); } catch { /* best effort */ }
  return false;
}

async function publicScanGate(env, request, origin, allowedOrigin, weight, lang) {
  // 1) Origin allow-list — blocks naive off-site abuse (spoofable, not a hard wall).
  if (!isAllowed(origin, allowedOrigin)) return { ok: false, status: 403, body: { error: "forbidden" } };
  const w = weight || 1;
  const ip = (request && request.headers.get("CF-Connecting-IP")) || "unknown";

  // 2) Per-IP fixed-window limit.
  const windowS = Number(env.SCAN_RATE_WINDOW_S || SCAN_GATE_DEFAULTS.RATE_WINDOW_S);
  const perIp = Number(env.SCAN_RATE_LIMIT || SCAN_GATE_DEFAULTS.RATE_LIMIT);
  const ipKey = `rl:scan:${ip}:${Math.floor(Date.now() / (windowS * 1000))}`;
  if (await kvBump(env, ipKey, perIp, windowS, w)) {
    return { ok: false, status: 429, body: { error: "rate_limited", message: scanLimitMsg(lang, "ip") } };
  }

  // 3) Global daily circuit-breaker.
  const dailyCap = Number(env.SCAN_DAILY_CAP || SCAN_GATE_DEFAULTS.DAILY_CAP);
  const dayKey = `rl:scan:global:${Math.floor(Date.now() / 86400000)}`;
  if (await kvBump(env, dayKey, dailyCap, 86400, w)) {
    return { ok: false, status: 429, body: { error: "busy", message: scanLimitMsg(lang, "global") } };
  }
  return { ok: true };
}
