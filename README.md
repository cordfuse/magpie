# Quill

**Agent-agnostic AI chatbot framework.** Next.js app with a self-hosted relay, 9-provider abstraction via [`token.js`](https://www.npmjs.com/package/token.js), JWT device-auth, and a polished chat UI inherited from [mighty-ai-qr-web](https://github.com/cordfuse/mighty-ai-qr-web).

Not a hosted product. Clone, configure, run.

## Repo layout

```
quill/
├── nodejs/        # the app — Next.js, run bare metal via npm run dev / build / start
└── docker/        # Dockerfile + compose + Caddyfile for the containerized deploy variant
```

Each subfolder is self-contained. Pick the path you want:

- **Bare-metal Node.js** — `cd nodejs/` and follow the Quick start below
- **Docker** — `cd docker/` and `docker compose up` (compose file references `../nodejs/` for the build context)

## Stack

- **Next.js 15** + React 19 + Tailwind (single-page app, PWA-capable)
- **token.js** — one TypeScript SDK across 9 providers (Anthropic, OpenAI, Google Gemini, Groq, Mistral, Cohere, Perplexity, AWS Bedrock, AI21). Switching providers = one env var change.
- **JWT device-auth** — anonymous guest sessions; no signup, no email, no third-party auth provider
- No database (yet); conversations persist in browser `localStorage`

## Quick start (bare-metal)

```bash
cd nodejs/
npm install
cp .env.example .env.local
# edit .env.local — at minimum set ANTHROPIC_API_KEY + JWT_SECRET
npm run dev
# → http://localhost:3000
```

## Quick start (Docker)

```bash
cd docker/
# create .env in this folder with at minimum: JWT_SECRET, ANTHROPIC_API_KEY
docker compose up --build
# → http://localhost:3008  (host port; container internal is 3000)
```

Production compose (`docker-compose.prod.yml`) adds a Caddy reverse-proxy in front of the app — edit `docker/Caddyfile` to set your domain before bringing it up.

## Configuration (env vars)

| Var | Purpose | Default |
|---|---|---|
| `QUILL_PROVIDER` | `anthropic` / `openai` / `gemini` / `groq` / `mistral` / `cohere` / `perplexity` / `bedrock` / `ai21` | `anthropic` |
| `QUILL_MODEL` | Provider-specific model ID | `claude-sonnet-4-6` |
| `QUILL_SYSTEM_PROMPT` | Baseline system prompt the model sees | `"You are a helpful AI assistant."` |
| `JWT_SECRET` | Secret for signing device tokens (any random ≥32-char string) | `dev-secret-change-in-prod` (NOT for production) |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / etc. | Provider API key; only the selected provider's key needs to be set | — |

Generate a `JWT_SECRET`: `openssl rand -base64 32`

## Switching providers

Set `QUILL_PROVIDER` + `QUILL_MODEL` + the provider's API key env. No code change.

```bash
# Anthropic (default)
QUILL_PROVIDER=anthropic QUILL_MODEL=claude-sonnet-4-6 ANTHROPIC_API_KEY=sk-ant-... npm run dev

# OpenAI
QUILL_PROVIDER=openai QUILL_MODEL=gpt-4o OPENAI_API_KEY=sk-... npm run dev

# Google Gemini
QUILL_PROVIDER=gemini QUILL_MODEL=gemini-2.0-flash-001 GEMINI_API_KEY=... npm run dev
```

token.js's built-in Anthropic model list tops out at Claude 3.7; Quill registers the Claude 4.x family (Opus 4.7, Sonnet 4.6, Haiku 4.5) explicitly. To use other models token.js doesn't know about yet, see `extendModelList` calls in `lib/server/ai-tools.ts`.

## What's NOT included

Intentional out-of-scope (re-add when you need them):

- **Server-side conversation persistence** — currently `localStorage` only; no shared history, no cross-device sync. Add a database (e.g. `better-sqlite3` for single-host) when you need it.
- **Native web search** — Anthropic's `web_search_20250305` was provider-specific and dropped in the multi-provider swap. Re-add as a cross-provider tool call.
- **Streaming responses** — currently single-shot (full response at end). token.js supports streaming; add when needed.
- **File / image uploads** — `next-pwa` is in deps but no upload UI is wired.
- **Anthropic prompt cache** (`cache_control: ephemeral`) — provider-specific; modest cost regression on repeat turns until token.js exposes a cache primitive or we DIY one.

## Theme

15 popular developer themes, picked via the in-app settings dialog. Default = Dracula.

**Dark:** Dracula · One Dark · Tokyo Night · Nord · Solarized Dark · Gruvbox Dark · Monokai · Catppuccin Mocha · Night Owl · Synthwave '84 · GitHub Dark · Palenight

**Light:** Solarized Light · GitHub Light · Catppuccin Latte

CSS variables live in `app/globals.css` under `[data-theme="<id>"]` blocks. Add a theme by extending the `Theme` union in `lib/storage.ts`, adding the CSS block, and adding a `{ id, label }` entry to `THEMES` in `app/page.tsx`.

## Origin

Forked from `cordfuse/mighty-ai-qr-web` on 2026-06-23 because its chatbot UX was already polished beyond what any minimal-fork OSS starter (vercel/chatbot, lobe-chat, etc.) ships. Stripped to a generic foundation in three PRs (#1: QR/product surface, #2: dead SQLite layer + experimental flag, #3: `@anthropic-ai/sdk` direct → `token.js` multi-provider abstraction).

## License

MIT. See [LICENSE](LICENSE).
