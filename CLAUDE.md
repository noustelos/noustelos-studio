# CLAUDE.md — noustelos.gr portfolio + The Artifact

Static portfolio site for **noustelos.gr** (Noustelos Studio), plus a hidden AI
chat playground called **The Artifact**. Two deploy paths that are **not
coupled** — know which one a change needs.

## Deploy models (important)

| What | Lives in | Goes live via |
|------|----------|---------------|
| Portfolio site + the Artifact **front-end** | repo root, `secret-artifact/` | **GitHub Pages**, push to `main` = live (no build step) |
| The Artifact **engine** (Cloudflare Worker) | `engine/` | **`cd engine && npx wrangler deploy`** (separate Cloudflare auth) |

- Pushing to `main` updates the *front-end* only. The Worker keeps running its
  last `wrangler deploy` until you redeploy it — editing `engine/worker.js` and
  pushing does **nothing** to the live engine.
- `CNAME` → `noustelos.gr`. Repo: `github.com/noustelos/noustelos-studio`.
- CSS/JS are hand-minified: edit `styles.css` / `script.js`, then regenerate the
  `.min` files (CSS via `tools/minify-css.js`). Both source and min are committed.

## The Artifact — architecture

Confusingly named, so pin it down:

- **"brains" = the front-end** → [`secret-artifact/index.html`](secret-artifact/index.html)
  Self-contained HTML/CSS/JS (no build). It's only the UI: chat window, the
  Persona Tuner sliders, localStorage transcript memory, voice (STT/TTS), boot
  splash. It holds **no secrets** and **no AI logic** — it just POSTs to the engine.
  Live at https://noustelos.gr/secret-artifact/ (noindex/nofollow, kept hidden).
- **"engine" = the Worker** → [`engine/worker.js`](engine/worker.js)
  Where the *real* AI brains live: Google API key (secret), system prompt /
  persona, temperature, the Gemma call, Sheets logging, passphrase gate.
  Live at `https://artifact-engine.avatar68.workers.dev` (POST `/api/chat`).
  Config in [`engine/wrangler.toml`](engine/wrangler.toml); full deploy notes in
  [`engine/README.md`](engine/README.md). Apps Script logger: `engine/apps-script.gs`.

**Request shape** (browser → engine):
```json
{ "messages": [{"role":"user|model","text":"..."}],
  "passphrase": "…",
  "persona": "gemma|dion",
  "stream": true,
  "memory": ["pinned fact", "…"],
  "params": { "temperature": 0-2, "sarcasm": 0-100, "seriousness": 0-100 } }
```
The engine returns `{ "reply": "…" }`, or `401 {"error":"locked"}` if the
passphrase is missing/wrong. A `{ "verify": true, "passphrase": "…" }` call just
validates the passphrase without spending a model call.

**Streaming:** with `"stream": true` the engine instead returns a
`text/event-stream` — `data: {"delta":"…"}` per token, then `data: {"done":true}`
(or `data: {"error":"…"}`). It proxies Google's `:streamGenerateContent?alt=sse`,
strips the `thought:true` reasoning parts, and logs the assembled reply to the
Sheet on completion (`worker.js` `streamReply`/`extractDelta`). The front-end
(`secret-artifact/index.html` `streamInvoke`) reads the SSE and fills the bot
bubble token-by-token; the bubble's read-aloud button speaks the span's CURRENT
text so a streamed answer still plays in full. Thinking still happens BEFORE the
answer, so the typing dots stay during reasoning, then tokens stream in.
**Heartbeats (don't remove):** during the thinking phase Gemma emits many chunks
with ZERO answer tokens, so the Worker→browser SSE would sit idle for seconds and
the connection gets cut → "SIGNAL LOST" mid-thought (reproduced on both WiFi and
5G, so not a proxy issue). `streamReply` therefore writes an SSE comment `: open`
immediately and `: hb` on every answer-less chunk (comment lines start with `:`,
which the client ignores) to keep the pipe warm. It also `console.log`s
`artifact stream upstream <status>` and `artifact stream done chars:N heartbeats:N`
(and `console.error`s `artifact stream error:`) — watch them with
`cd engine && npx wrangler tail`. A healthy turn logs e.g. `chars:497 heartbeats:44`.

### Features built on the Artifact (all front-end unless noted)
- **Web search (Gemma only, opt-in grounding — ENGINE-side)** — the user grounds
  a SINGLE answer in live Google Search two ways. Off by default and never for
  DION. Handled entirely in `worker.js` (no front-end change) by `detectSearch`,
  which checks the last user turn (anchored with a separator lookahead, not `\b`
  — Greek isn't ASCII `\w`, same caveat as the memory commands):
  **(A) a LEADING verb** — `ψάξε`/`ψάξτε`/`γκουγκλάρισε`/`γκούγκλαρε`/`search`/
  `/search` at the start → the verb is STRIPPED from the prompt so the query
  reads clean (if nothing follows the verb, the original is kept);
  **(B) a web/internet PHRASE anywhere** — `στο ίντερνετ/διαδίκτυο/δίκτυο/google`,
  `από το ίντερνετ`, `search the web/internet/online`, `on the web/internet`,
  `google it/that/this`, `look it up` → search WITHOUT stripping (natural
  language, leave the sentence intact). `για το ίντερνετ` does NOT match (needs
  `στο/από το`), so it won't fire on normal talk. On a hit the handler attaches
  `tools:[{ googleSearch: {} }]` to the Google request (folded into BOTH
  `streamReply` and `callGemma`, incl. their systemInstruction-400 fallbacks).
  Field is `googleSearch` (the Gemini-2+ name) — NOT the deprecated 1.5
  `googleSearchRetrieval`. `gemma-4-31b-it` supports grounding via the Gemini
  API; the AI Studio toggle does NOT carry into our API calls (every request is
  stateless), so the tool MUST be sent per-request. The model decides whether to
  actually search; we only make the tool available when the trigger is present.
  Grounding metadata (citations) is NOT surfaced — only the answer text streams.
  **Needs `cd engine && npx wrangler deploy`** (engine change, not front-end).
- **Long-term memory (Gemma only, RAG-lite)** — a small curated set of pinned
  facts, SEPARATE from the transcript. The user adds one by typing `θυμήσου …` /
  `να θυμάσαι …` / `remember …` / `/remember …`; `/memory` (`μνήμη`) lists them
  numbered, `/forget N` drops just #N (`σβήσε 2`, `ξέχασε 2`), `/forget`
  (`ξέχασέ τα`, `σβήσε τη μνήμη`, `/forget all`) clears all (numbering renumbers
  after a delete). Commands are parsed + handled
  **locally** (no model call) in `parseMemoryCommand`/`runMemoryCommand`, gated
  to `persona==='gemma'`. Stored in `localStorage` (`artifact.memory.gemma.v1`,
  per-device), capped 100 facts × 500 chars, and ride along as `memory:[…]` on
  every Gemma request — NOT for DION. **Engine side:** `worker.js`
  `renderMemoryBlock` folds them into a `// PERSISTENT MEMORY` block appended to
  the system prompt (so they survive the 40-turn trim AND a "Memory wiped" reset;
  `/forget` is the only thing that clears them). Greek `\b` caveat: the command
  regex uses a separator lookahead, not `\b` (Greek isn't ASCII `\w`).
- **Persona switch (DION concierge)** — a SECOND voice shares the same chat UI.
  While unlocked, typing the bare word `DION` or `GEMMA` (case-insensitive) flips
  voices with NO model call — it's a control command, not a message. Active
  persona persists in `localStorage` (`artifact.persona.v1`) and rides along as
  `persona` in every request. **Separate transcripts:** each persona keeps its
  own history key (`gemma` → `artifact.history.v1` (unchanged, keeps old memory);
  `dion` → `artifact.history.dion.v1`); switching repaints the stream from the
  active persona's history — the conversations never mix. **Engine side:**
  `worker.js` reads `body.persona`; `"dion"` selects `DEFAULTS.DION_SYSTEM_PROMPT`
  (the Mykonos concierge persona, kept INLINE — it's a creative voice, not a
  secret; `env.DION_SYSTEM_PROMPT` overrides), anything else = the default Gemma
  `SYSTEM_PROMPT`. The persona dials still fold in on top of either. **Logging:**
  `persona` is sent to the Sheet and routes the row to a per-persona tab (see
  Gotchas). Add a persona = add a `DEFAULTS.*_SYSTEM_PROMPT`, a front-end keyword,
  and a `PERSONA_TABS` entry in `apps-script.gs`.
- **Persona Tuner** — "Tuning Console" toggled by the header `#tune`
  sliders/hamburger icon. Sliders: temperature (cyan), sarcasm (magenta),
  seriousness (violet). Values persist in `localStorage` (`artifact.params.v1`)
  and ride along in `params`. The panel is a **floating dropdown OVERLAY**
  (`position:absolute`, anchored under the header via a JS-measured `--header-h`)
  — it floats over the chat and does NOT reflow it; auto-closes on send and on
  outside tap. (Was an in-flow `max-height` block; that shoved the conversation
  around on iPhone — don't go back to that.) **Quick presets:** three one-tap
  buttons at the top of the panel (`.tuner-preset`, `PRESETS` map in JS) set all
  three sliders at once, each tinted by the matching slider accent —
  *Brainstorming* (cyan: temp 1.9 / sarcasm 27 / seriousness 18), *The Mirror*
  (magenta: 0.9 / 72 / 54), *The Architect* (violet: 0.3 / 0 / 90). Applying one
  persists to `artifact.params.v1` like a manual drag; the active button lights
  up only while the live values still match it (`updateActivePreset`, cleared on
  any slider input). **Engine side:** `worker.js`
  `resolveTemperature` (clamp 0–2, falls back to `env.TEMPERATURE`) +
  `buildSystemPrompt` (folds the dials into the systemInstruction).
- **Voice** — dictation via `webkitSpeechRecognition` (hard-set `el-GR`, mic
  hidden where unsupported, auto-sends transcript); read-aloud via
  `speechSynthesis` (lang auto-detected Greek/English) with a per-bubble ▶/■
  play/stop toggle and auto-read of fresh replies. TTS unlocked on a send/mic tap
  for iOS. **Voice gender:** `pickVoice` prefers a male-named voice (`MALE_VOICE`
  regex — API exposes no gender); when only a female voice exists (Greek
  "Melina" on iOS has no native male), pitch drops to 0.7 to masculinise. A true
  male Greek voice would need cloud TTS via the Worker.
- **Boot splash** — 5s neon "ARTIFACT" intro that fades into the chat.
- **iOS viewport fit** — chat pinned to `visualViewport` height, anchored
  top-only (NOT `inset:0`), so the input stays above the keyboard.
- **iOS focus discipline** — on touch devices the page NEVER programmatically
  focuses the input (`isTouch` + `focusInput()` no-op; all convenience focus
  calls route through it). Auto-focus on touch was popping the keyboard at random
  during voice turns — keep focus user-initiated on touch.
- **Passphrase gate** — server-side in the Worker. Accepts MULTIPLE codes:
  `PASSPHRASE` (→ logged as "owner"), `GUEST_PASSPHRASE` (→ "guest"), and/or a
  comma-separated `PASSPHRASES`. `collectPassphrases()` maps each code→role; the
  matched role is logged to the Sheet "Who" column. Revoke a guest with
  `wrangler secret delete GUEST_PASSPHRASE` (instant, runtime — no redeploy).
  Conversations never mix (memory is per-device localStorage; Worker stateless).
  UI: input is a PLAIN text field — NO `type=password`, NO `-webkit-text-security`
  (both made iOS treat it as a credential → AutoFill bar raised the keyboard and
  a saved password haunted the chat input). Locked state shown by magenta border +
  UNLOCK button (passphrase is visible while typing, by design). LOCK re-locks.

## Kill switch (chat only, owner-only)
Engine-wide OFF for everyone, triggered ONLY from the chat — **no terminal kill**.
Two secret PHRASES: `KILL_SWITCH` (owner types it → offline) and `ANTIDOTE` (owner
types it → online). `worker.js` flow: passphrase gate → `verify` short-circuit
(exempt, so the owner can unlock while killed) → `matchControlPhrase(lastUserText)`
gated to `who==="owner"` → `setKill()` toggles KV → only THEN the offline gate.
`isKilled()` reads the KV flag ONLY (`ARTIFACT_KV` key `kill`=on/off); no secret
boolean. While killed every chat returns `503 {"error":"offline","reply":KILL_MESSAGE}`;
the brains catch 503 and show the offline text calmly (not "SIGNAL LOST"). A guest
code never triggers it; guessing the phrase is useless without the owner passphrase.
**KV is REQUIRED** (Worker is stateless): `wrangler kv namespace create ARTIFACT_KV`
→ paste id into `wrangler.toml`, uncomment the `[[kv_namespaces]]` block, set the
`KILL_SWITCH`/`ANTIDOTE` secrets, deploy. Without the binding `setKill` returns
`kv-missing` (engine stays online). Front-end: the phrase goes through the normal
send path; on a `{control,...}` JSON response `streamInvoke` returns a
`{__control}` marker and `handleSubmit` SCRUBS the just-added user bubble + history
entry (so the secret phrase isn't persisted) and shows the result.

## Gotchas
- **Gemma 4 is a thinking model** (`gemma-4-31b-it`): thinking can't be disabled;
  reasoning returns as parts flagged `thought:true` — `worker.js` `extractReply`
  filters them out. Google API occasionally returns transient 500s (no retry yet).
- **Sheets logging** needs `ctx.waitUntil` in the Worker (an unawaited fetch gets
  cancelled by the Workers runtime). The Sheet has 5 columns:
  `Timestamp | User message | Bot reply | Model | Who`. **Per-persona tabs:** the
  Worker sends `persona` in the log payload; `apps-script.gs` `sheetForPersona()`
  routes `dion` rows to a `DION` tab (auto-created with the same headers on first
  use, via the `PERSONA_TABS` map), everything else to the default active sheet.
  The Apps Script logger
  (`engine/apps-script.gs`) has NO auth — a direct `POST {…, who}` to the `/exec`
  URL writes a row (handy for diagnostics, bypassing the chat/passphrase). It
  auto-backfills the "Who" header on an older 4-col sheet.
- **Apps Script web-app deployment trap**: editing + Save does NOT update the live
  `/exec` — it stays pinned to a version. Update via Deploy > Manage deployments >
  ✏️ > Version: "New version" > Deploy (SAME `/exec` URL). DON'T use "New
  deployment" — that mints a NEW URL while the Worker's `SHEETS_WEBHOOK_URL` still
  points at the old code. If the "Who" header never appears, the old version is
  still live. `SHEETS_WEBHOOK_URL` is set via `wrangler secret put` from engine/.
- The Worker uses `wrangler`, **not** a git-connected Cloudflare Pages build (a
  repo-root build scans `node_modules` >25MB and fails).
- Memory is per-device (localStorage), not synced across devices.

## Parked / NOT live — public Artifact (do not resurrect without asking)
A "show the Artifact publicly in the AI Lab" feature was started then cancelled.
It is **reverted off `main`** and parked on branch **`artifact-public-wip`**.
- That branch has Stage 1 only: Worker guest-guardrails (Cloudflare Turnstile +
  HMAC session tokens + KV per-IP/global rate limit) in `engine/worker.js` +
  `wrangler.toml`. It was NEVER deployed. The planned public page
  (`ai-artifact.html` with visible guest code 2026 + info panel) was NOT built.
- **Guests currently cannot reach the Artifact**: no public page, no nav link.
  Only the hidden owner page (`secret-artifact/`, noindex, unlinked) exists.
- `GUEST_PASSPHRASE` (`2026`) is still set on the live Worker but is harmless
  while nothing public talks to it. To fully retire guests:
  `wrangler secret delete GUEST_PASSPHRASE`.
- To revive: `git cherry-pick`/merge from `artifact-public-wip`, then do the
  Turnstile/KV/secrets setup documented in that branch's `wrangler.toml`.

## Other repo areas (not the Artifact)
- `index.html`, `ai-lab.html`, `ai-lab-faq.html`, `ai-chat.html`,
  `privacy-policy*.html` — portfolio/marketing pages.
- `script.js` / `styles.css` (+ `.min`), `chat-hero-mark.js` — site behavior/style.
- `lab/`, `universe/`, `assets/` — page assets/experiments.
- `tests/` — `npm test` runs `node --test tests/*.test.js`.
