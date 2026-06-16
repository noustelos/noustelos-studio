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
  "params": { "temperature": 0-2, "sarcasm": 0-100, "seriousness": 0-100 } }
```
The engine returns `{ "reply": "…" }`, or `401 {"error":"locked"}` if the
passphrase is missing/wrong. A `{ "verify": true, "passphrase": "…" }` call just
validates the passphrase without spending a model call.

### Features built on the Artifact (all front-end unless noted)
- **Persona Tuner** — "Tuning Console" toggled by the header `#tune`
  sliders/hamburger icon. Sliders: temperature (cyan), sarcasm (magenta),
  seriousness (violet). Values persist in `localStorage` (`artifact.params.v1`)
  and ride along in `params`. The panel is a **floating dropdown OVERLAY**
  (`position:absolute`, anchored under the header via a JS-measured `--header-h`)
  — it floats over the chat and does NOT reflow it; auto-closes on send and on
  outside tap. (Was an in-flow `max-height` block; that shoved the conversation
  around on iPhone — don't go back to that.) **Engine side:** `worker.js`
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

## Gotchas
- **Gemma 4 is a thinking model** (`gemma-4-31b-it`): thinking can't be disabled;
  reasoning returns as parts flagged `thought:true` — `worker.js` `extractReply`
  filters them out. Google API occasionally returns transient 500s (no retry yet).
- **Sheets logging** needs `ctx.waitUntil` in the Worker (an unawaited fetch gets
  cancelled by the Workers runtime). The Sheet has 5 columns:
  `Timestamp | User message | Bot reply | Model | Who`. The Apps Script logger
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
