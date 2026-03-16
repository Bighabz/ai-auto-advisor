# External Integrations

**Analysis Date:** 2026-03-15

## AI / LLM APIs

**Anthropic Claude:**
- Used for: Telegram conversation routing (tool_use), diagnostic synthesis, MOTOR category navigation in AutoLeap playbook
- SDK: `@anthropic-ai/sdk` (dynamic `require`, not in `package.json`)
- Model: `claude-sonnet-4-5-20250929` (also `claude-haiku` referenced in playbook for MOTOR nav)
- Auth: `ANTHROPIC_API_KEY`
- Call site: `skills/telegram-gateway/scripts/server.js` (messages.create with tools)
- Also used: `skills/ai-diagnostics/scripts/diagnose.js` (direct REST fallback path)

**OpenAI Embeddings:**
- Used for: Diagnostic knowledge base vector search (RAG)
- Client: Direct REST to `https://api.openai.com/v1/embeddings`
- Model: `text-embedding-3-small` (1536 dimensions)
- Auth: `OPENAI_API_KEY`
- Call site: `skills/ai-diagnostics/scripts/embeddings.js`

## Data Storage

**Databases:**
- Supabase (PostgreSQL + pgvector)
  - Project ID: `vtgjljmicmrprnexloeb`, region: `us-west-2`
  - URL: `SUPABASE_URL` env var
  - Auth: `SUPABASE_ANON_KEY` env var
  - Client: `@supabase/supabase-js` v2.95.3 (singleton pattern in each skill)
  - Key tables: `diagnostic_cases` (vector embeddings), `tsb_cache`, `labor_cache`, `repair_plans`, `shops`, `shop_usage`
  - RPC functions: `match_diagnostic_cases` (pgvector similarity search)
  - Used by: `skills/ai-diagnostics/scripts/embeddings.js`, `skills/ai-diagnostics/scripts/tsb-lookup.js`, `skills/ari-labor/scripts/lookup.js`, `skills/shop-management/scripts/config.js`, `skills/shop-management/scripts/usage.js`

**File Storage:**
- Local filesystem only — PDFs written to `/tmp/`, screenshots to `/tmp/alldata-screenshots/`
- OpenClaw screenshot output: `~/.openclaw/media/browser/<uuid>.png` (parsed from `MEDIA:` prefix)

**Caching:**
- In-memory per-chat session store (Map) in gateway servers — last estimate results
- In-memory conversation history per chat (Map, capped at 20 messages)
- Supabase `tsb_cache` table — NHTSA TSB/recall results (30-day TTL)
- Supabase `labor_cache` table — ARI labor times (90-day TTL)
- Disk token cache: `/tmp/autoleap-token.json` — AutoLeap JWT captured via puppeteer CDP

## Repair Data Platforms (Browser Automation)

**AllData Repair:**
- Used for: OEM repair procedures, TSBs, wiring diagrams, torque specs
- Access: Browser automation via OpenClaw shared browser module
- URL: `ALLDATA_URL` (default `https://my.alldata.com`)
- Auth: `ALLDATA_USERNAME`, `ALLDATA_PASSWORD`
- Skill: `skills/alldata-lookup/scripts/search.js`
- Status: 403 errors from VPS/Pi IPs — needs IP whitelist or residential proxy

**Identifix Direct-Hit:**
- Used for: Success-rated community fixes, misdiagnosis warnings
- Access: Browser automation via OpenClaw shared browser module
- URL: `IDENTIFIX_URL` (default `https://www.identifix.com`)
- Auth: `IDENTIFIX_USERNAME`, `IDENTIFIX_PASSWORD`
- Skill: `skills/identifix-search/scripts/search.js`
- Status: Unreachable from Pi network — graceful degradation

**ProDemand (Mitchell 1):**
- Used for: Real Fixes (success-rated), labor times, DTC test plans
- Access: puppeteer-core CDP (port 18800) — NOT OpenClaw (bypasses 20s gateway timeout)
- URL: `PRODEMAND_URL` (default `https://www.prodemand.com`); app is at `https://www2.prodemand.com`
- Auth: `PRODEMAND_USERNAME`, `PRODEMAND_PASSWORD`; auth stored in sessionStorage (per-tab)
- Optional TAPE API: `PRODEMAND_TAPE_TOKEN` — direct partner API access (not currently used)
- Skill: `skills/prodemand-lookup/scripts/search-direct.js` (primary), `skills/prodemand-lookup/scripts/search.js` (OpenClaw fallback)
- Status: Working on Pi (residential IP, 22.8s warm start)

**ARI Free Labor Guide:**
- Used for: Live labor time lookup fallback when not in Supabase labor_cache
- Access: Browser automation via OpenClaw
- URL: `ARI_URL` (default `https://web.ari.app`)
- Auth: None (free tool)
- Skill: `skills/ari-labor/scripts/lookup.js`
- Activation: Only loaded when `ARI_URL` env var is set

## Shop Management Software

**AutoLeap:**
- Used for: Customer/vehicle/estimate CRUD, MOTOR labor lookup, PartsTech embedded ordering, PDF generation, estimate sending
- Access: Two paths:
  1. **Browser playbook** (`skills/autoleap-browser/scripts/playbook.js`) — puppeteer-core driving `https://app.myautoleap.com`, primary path when `AUTOLEAP_EMAIL` set
  2. **REST API** (`skills/autoleap-browser/scripts/autoleap-api.js`) — JWT captured from live Chrome session via CDP, cached to `/tmp/autoleap-token.json`, then direct HTTPS to `api.myautoleap.com/api/v1`
- Auth: `AUTOLEAP_EMAIL`, `AUTOLEAP_PASSWORD`; also `AUTOLEAP_LABOR_RATE` for labor rate override
- Activation: All AutoLeap paths conditional on `AUTOLEAP_EMAIL` env var

## Parts Procurement

**PartsTech:**
- Used for: Live parts pricing, inventory, cart management, vendor comparison
- Two access modes:
  1. **REST API** (`skills/partstech-search/scripts/search.js`) — `https://api.partstech.com/v1/parts/search`; Auth: `PARTSTECH_API_KEY`
  2. **Browser via AutoLeap SSO** (`skills/autoleap-browser/scripts/partstech-search.js`) — opens `https://shop.partstech.com` in new tab via AutoLeap SSO; primary path in playbook; no separate PT credentials needed
  3. **Browser direct** (`skills/partstech-order/scripts/order.js`) — direct login to `shop.partstech.com`; Auth: `PARTSTECH_USERNAME`, `PARTSTECH_PASSWORD`
- GraphQL endpoint also probed: `scripts/probe-partstech-graphql.js`
- Activation: AutoLeap SSO path requires `AUTOLEAP_EMAIL`; direct browser requires `PARTSTECH_USERNAME`

## Government APIs (Free, No Auth)

**NHTSA vPIC API:**
- Used for: VIN decoding
- Endpoint: `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/<VIN>?format=json`
- Auth: None
- Skill: `skills/vin-decoder/scripts/decode.js`

**NHTSA Recalls API:**
- Used for: Active recall lookup by make/model/year
- Endpoint: `https://api.nhtsa.gov/recalls/recallsByVehicle`
- Auth: None
- Skill: `skills/ai-diagnostics/scripts/tsb-lookup.js`

**NHTSA Complaints API:**
- Used for: Complaint lookup by make/model/year
- Endpoint: `https://api.nhtsa.gov/complaints/complaintsByVehicle`
- Auth: None
- Skill: `skills/ai-diagnostics/scripts/tsb-lookup.js`

## Messaging Channels

**Telegram Bot:**
- Used for: Primary technician-facing interface (active demo device on Pi)
- Bot: `@hillsideautobot`
- Polling: Long-polling (`getUpdates`, 30s timeout)
- Auth: `TELEGRAM_BOT_TOKEN`
- API base: `https://api.telegram.org/bot<TOKEN>`
- Entry point: `skills/telegram-gateway/scripts/server.js`
- Sends: text messages, PDFs (`sendDocument`), photos/wiring diagrams (`sendPhoto`)

**WhatsApp (Twilio sandbox / Meta Business API):**
- Used for: Alternative customer-facing interface
- Provider toggle: `WHATSAPP_PROVIDER=twilio|meta` (default `twilio`)
- Twilio: TwiML responses, Auth: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_NUMBER`
- Meta: Graph API v18.0, Auth: `META_WHATSAPP_TOKEN`, `META_PHONE_NUMBER_ID`, `META_VERIFY_TOKEN`
- Entry point: `skills/whatsapp-gateway/scripts/server.js` (HTTP server, port 3000)
- Webhook: `POST /webhook` and `POST /sms`

## Proxy / Network

**Residential Proxy (Decodo/Smartproxy):**
- Used for: Bypassing IP restrictions on AllData/Identifix from VPS datacenter IP
- Host: `us.decodo.com:10001`
- Auth: `PROXY_HOST`, `PROXY_PORT`, `PROXY_USER`, `PROXY_PASS`
- Wrapper: `scripts/proxy-server.js` (uses `proxy-chain` npm package)
- Chrome launch flag: `--proxy-server=socks5://127.0.0.1:40000`

**Cloudflare WARP:**
- Used on VPS as alternative residential IP routing (SOCKS5 on port 40000)
- Configured in `deploy/vps-backup/openclaw-browser.service` systemd unit

## CI/CD & Deployment

**Hosting:**
- DigitalOcean — Droplet `sam-prod`, `s-4vcpu-8gb`, `sfo3`, Ubuntu 22.04 (`137.184.4.157`)
- Raspberry Pi — `192.168.1.232`, active demo device (residential IP)
- No containerization (no Docker)
- Provisioning: `deploy/provision.sh` (requires `doctl` CLI)

**CI Pipeline:**
- None — no GitHub Actions, no CI service configured

**Process Management:**
- systemd services on both VPS and Pi (service files in `deploy/services/` and `deploy/vps-backup/`)
- Service names: `openclaw-gateway`, `openclaw-browser`, `sam-telegram`, `sam-whatsapp` (optional: `sam-proxy`)

**Source Control:**
- GitHub: `https://github.com/Bighabz/ai-auto-advisor` (private)

## Environment Configuration

**Required env vars:**
- `ANTHROPIC_API_KEY` — Claude conversation + diagnostic synthesis
- `SUPABASE_URL` + `SUPABASE_ANON_KEY` — All DB operations
- `TELEGRAM_BOT_TOKEN` — Telegram gateway entry point
- `OPENAI_API_KEY` — Vector embeddings (required for kb_direct/kb_with_claude paths)

**Optional / platform-specific:**
- `AUTOLEAP_EMAIL` + `AUTOLEAP_PASSWORD` — Enables estimate creation, playbook, PartsTech SSO
- `AUTOLEAP_LABOR_RATE` — Labor rate override (default $120/h)
- `ALLDATA_USERNAME` + `ALLDATA_PASSWORD` + `ALLDATA_URL`
- `IDENTIFIX_USERNAME` + `IDENTIFIX_PASSWORD` + `IDENTIFIX_URL`
- `PRODEMAND_USERNAME` + `PRODEMAND_PASSWORD` + `PRODEMAND_URL`
- `PRODEMAND_TAPE_TOKEN` — Optional Mitchell 1 partner API
- `PARTSTECH_API_KEY` — REST parts search
- `PARTSTECH_USERNAME` + `PARTSTECH_PASSWORD` + `PARTSTECH_URL`
- `ARI_URL` — Enables live ARI labor fallback
- `WHATSAPP_PROVIDER`, `TWILIO_*`, `META_*` — WhatsApp gateway
- `PROXY_HOST` + `PROXY_PORT` + `PROXY_USER` + `PROXY_PASS` — Residential proxy
- `OPENCLAW_BROWSER_PROFILE` — Browser profile name (default `openclaw`)
- `SHOP_CONFIG_PATH` — Override shop-config.json location

**Secrets location:**
- `config/.env` — local file, loaded manually at startup; listed in `.gitignore`
- `config/.env.example` — template committed to repo

## Webhooks & Callbacks

**Incoming:**
- `POST /webhook` — WhatsApp messages (Twilio TwiML or Meta Business API)
- `POST /sms` — Alternative WhatsApp endpoint
- `GET /webhook` — Meta webhook verification challenge
- `POST /whatsapp` — Additional WhatsApp alias endpoint

**Outgoing:**
- Telegram Bot API polling (no webhook — long-polling model)
- Meta Graph API v18.0 messages endpoint (outbound messages in Meta mode)

---

*Integration audit: 2026-03-15*
