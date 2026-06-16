# THE ARTIFACT // ENGINE

Backend **engine** (Cloudflare Worker) for the hidden **brains** page at
`https://noustelos.gr/secret-artifact/`.

```
browser (brains)  --POST {messages:[...]}-->  ENGINE (Worker)  --->  Gemma 4 (gemma-4-31b-it)
                  <--{reply}---------------                  <---
ENGINE  --fire-and-forget-->  Apps Script  -->  Google Sheet (archive)
```

The Google AI Studio API key lives **only** in the Worker as a secret. It is
never exposed to the browser.

## 1. Get a Google AI Studio API key
- Go to https://aistudio.google.com → **Get API key**.
- The Gemma models (incl. `gemma-4-31b-it`) are served from the same
  Generative Language API.

## 2. Deploy the engine
```bash
cd engine
npx wrangler login
npx wrangler secret put GOOGLE_API_KEY        # paste the AI Studio key
npx wrangler secret put SHEETS_WEBHOOK_URL    # optional, see step 3
npx wrangler deploy
```
Wrangler prints the live URL, e.g. `https://artifact-engine.<subdomain>.workers.dev`.

## 3. Wire up Google Sheets logging (optional)
1. Create a Google Sheet.
2. **Extensions → Apps Script**, paste [`apps-script.gs`](apps-script.gs), Save.
3. **Deploy → New deployment → Web app** — *Execute as: Me*, *Who has access: Anyone*.
4. Copy the `/exec` URL → `npx wrangler secret put SHEETS_WEBHOOK_URL`.

## 4. Point the brains at the engine
In [`../secret-artifact/index.html`](../secret-artifact/index.html), set:
```js
const API_URL = "https://artifact-engine.<subdomain>.workers.dev/api/chat";
```
Commit + push to `main` to publish (GitHub Pages, push-to-main = live).

## Config (in `wrangler.toml` `[vars]`)
| var | default | notes |
|-----|---------|-------|
| `MODEL` | `gemma-4-31b-it` | any Gemma model id from AI Studio |
| `TEMPERATURE` | `1.0` | header reads `TEMP: 2.0`; set `"2.0"` for max creativity |
| `ALLOWED_ORIGIN` | `https://noustelos.gr` | CORS origin (localhost allowed for dev) |
| `SYSTEM_PROMPT` | persona | the engine's system instruction |

## Notes
- **Memory**: the brains keep the transcript in `localStorage` and send the full
  history each turn (capped to the last 40 turns server-side). Memory is
  per-device — it does not sync across your devices. The Sheet is the shared record.
- The engine is **not** deployed by the GitHub Pages push; it deploys separately
  via `wrangler`. These source files live in the repo for convenience and contain
  no secrets.
