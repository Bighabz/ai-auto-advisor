# Technology Stack

**Analysis Date:** 2026-03-15

## Languages

**Primary:**
- JavaScript (Node.js) — All application code across every skill, gateway, and orchestrator

**Secondary:**
- Bash — Deployment and provisioning scripts (`deploy/provision.sh`, `deploy/setup-pi.sh`, `deploy/setup-vps.sh`)

## Runtime

**Environment:**
- Node.js 22 (required >= 20.0.0 per lockfile; `v22.16.0` confirmed on dev machine and VPS)

**Package Manager:**
- npm (no version pinned)
- Lockfile: `package-lock.json` present and committed

## Module System

**Format:** CommonJS (`require` / `module.exports`) throughout — no ESM
- `node-fetch` is ESM-only and must be dynamic-imported: `const fetch = (await import("node-fetch")).default;`
- `form-data` is similarly dynamic-imported in some files: `const FormData = (await import("form-data")).default;`

## Frameworks

**Core:**
- No web framework — HTTP server in `skills/whatsapp-gateway/scripts/server.js` uses Node's built-in `http` module directly

**Messaging:**
- Telegram Bot API — long-polling via `https://api.telegram.org/bot<TOKEN>` (no third-party Telegram SDK)
- WhatsApp — HTTP webhook server using Twilio TwiML or Meta Graph API responses

**Browser Automation (primary path):**
- OpenClaw — proprietary CLI framework installed as a global npm package (`npm install -g openclaw`). Wraps Chrome DevTools Protocol. Used by `skills/shared/browser.js`, `skills/alldata-lookup`, `skills/identifix-search`, `skills/ari-labor`, `skills/partstech-order`
- puppeteer-core (runtime peer dep, not in `package.json`) — loaded with `require("puppeteer-core")` in try/catch; used by `skills/prodemand-lookup/scripts/search-direct.js`, `skills/autoleap-browser/scripts/autoleap-api.js`, `skills/autoleap-browser/scripts/playbook.js`; connects to Chrome CDP on port 18800

**AI/LLM:**
- Anthropic Claude (`@anthropic-ai/sdk`) — loaded dynamically via `require("@anthropic-ai/sdk")` inside `skills/telegram-gateway/scripts/server.js`; **not** listed in `package.json`
- Model used: `claude-sonnet-4-5-20250929`
- OpenAI embeddings via direct REST (`https://api.openai.com/v1/embeddings`), model `text-embedding-3-small`; no OpenAI SDK installed

**Build/Dev:**
- No build step, no TypeScript, no transpilation
- No linter or formatter config detected

## Key Dependencies (from `package.json`)

**Critical:**
- `@supabase/supabase-js` `^2.95.3` — Vector DB, diagnostic knowledge base, labor cache, shop config, usage tracking
- `node-fetch` `^3.3.2` — HTTP client used throughout (ESM, dynamic import required)
- `pdfkit` `^0.17.2` — PDF estimate generation in `skills/estimate-pdf/scripts/generate.js`

**Infrastructure:**
- `form-data` `^4.0.5` — Multipart file upload (Telegram `sendDocument`/`sendPhoto`)
- `proxy-chain` `^2.5.6` — Local SOCKS5 proxy auth wrapper for residential proxy (`scripts/proxy-server.js`)

**Runtime peer deps (not in `package.json`, must be installed manually on server):**
- `puppeteer-core` — CDP browser control; installed on Pi/VPS outside package.json
- `@anthropic-ai/sdk` — Claude API; installed on Pi/VPS outside package.json

## Configuration

**Environment:**
- Env vars loaded from `config/.env` at startup in each entry point (manual line-by-line parser)
- No `dotenv` package used — custom parsing in server files
- Template: `config/.env.example`

**Feature Flags (env vars):**
- `SAM_STRUCTURED_LOGGING=true` — JSON structured logs (default: legacy console.log)
- `SAM_SESSION_PREFLIGHT=true` — Auth preflight before each estimate
- `SAM_RETRY_ENABLED=true` — Retry + circuit breaker for browser/API calls
- `TELEGRAM_PROGRESS_UPDATES=true` — Progress message editing in Telegram

**Shop Config:**
- `config/shop-config.json` — Local JSON fallback for single-shop mode (labor rate, markup %, tax rate)
- Supabase `shops` table used for multi-shop mode

**Build:**
- No build config. Scripts run directly with `node <path>`

## Platform Requirements

**Development:**
- Node.js >= 20 (22 preferred)
- OpenClaw installed globally: `npm install -g openclaw`
- Google Chrome (deb) or Chromium for browser automation
- Optional: `puppeteer-core`, `@anthropic-ai/sdk` installed outside package.json

**Production:**
- DigitalOcean droplet `sam-prod` — `s-4vcpu-8gb`, region `sfo3`, Ubuntu 22.04 (`137.184.4.157`)
- Raspberry Pi (residential IP) — Ubuntu/Raspberry Pi OS (`192.168.1.232`), active demo device
- Services managed by systemd: `openclaw-gateway.service`, `openclaw-browser.service`, `sam-telegram.service`, `sam-whatsapp.service` (optional: `sam-proxy.service`)
- Chrome runs headless on port 18800 (`--remote-debugging-port=18800`)
- VPS uses Cloudflare WARP proxy (SOCKS5 on port 40000) for residential IP routing of AllData/Identifix

---

*Stack analysis: 2026-03-15*
