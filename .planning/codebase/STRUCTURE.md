# Codebase Structure

**Analysis Date:** 2026-03-15

## Directory Layout

```
ai-auto-advisor/
├── config/                     # Environment + shop config
│   ├── .env                    # Active secrets (gitignored)
│   ├── .env.example            # Template for all env vars
│   └── shop-config.json        # Local shop settings fallback
├── deploy/                     # Deployment scripts and systemd units
│   ├── provision.sh            # DigitalOcean VPS provisioning
│   ├── setup-vps.sh            # VPS post-provision setup
│   ├── setup-pi.sh             # Raspberry Pi setup
│   ├── services/               # Systemd unit files
│   │   ├── openclaw-browser.service
│   │   ├── openclaw-gateway.service
│   │   ├── sam-proxy.service
│   │   └── sam-telegram.service
│   └── vps-backup/             # Production env snapshot (gitignored values)
├── docs/
│   └── plans/                  # Design documents and implementation plans
├── scripts/                    # One-off dev/debug/test scripts
│   ├── test-e2e.js             # End-to-end pipeline test (20+ assertions)
│   ├── test-local.js           # Local pipeline smoke test
│   ├── seed-all-via-supabase.js # DB seeding runner
│   ├── debug-*.js              # Browser automation debug scripts
│   └── test-*.js               # Feature-specific test scripts
├── skills/                     # All skill modules (core codebase)
│   ├── ai-diagnostics/         # RAG diagnostic engine
│   ├── alldata-lookup/         # AllData browser automation
│   ├── ari-labor/              # ARI Free labor guide browser automation
│   ├── autoleap-browser/       # AutoLeap + PartsTech browser playbook
│   ├── autoleap-estimate/      # AutoLeap REST API + repair history
│   ├── estimate-builder/       # Master orchestrator (pipeline)
│   ├── estimate-pdf/           # PDF generation
│   ├── estimate-reliability/   # (Reference docs only, no scripts)
│   ├── identifix-search/       # Identifix Direct-Hit browser automation
│   ├── partstech-order/        # PartsTech browser cart + ordering
│   ├── partstech-search/       # PartsTech REST API parts search
│   ├── prodemand-lookup/       # ProDemand Puppeteer automation
│   ├── shared/                 # Cross-skill utilities
│   ├── shop-management/        # Multi-shop config and usage tracking
│   ├── telegram-gateway/       # Telegram bot entry point
│   ├── vehicle-specs/          # Vehicle mechanic specs
│   ├── vin-decoder/            # NHTSA VIN decode
│   └── whatsapp-gateway/       # WhatsApp webhook entry point
├── tests/
│   └── unit/                   # Unit tests for shared utilities
├── .planning/
│   └── codebase/               # Architecture analysis docs
├── package.json
└── CLAUDE.md                   # AI assistant instructions
```

## Directory Purposes

**`skills/`:**
- Purpose: All application logic lives here, organized as independent skill modules
- Contains: One directory per skill. Each skill has a `scripts/` subdirectory with JS files and a `SKILL.md` reference doc at the skill root.
- Key files: `skills/estimate-builder/scripts/orchestrator.js` is the central hub that imports from all other skills

**`skills/shared/`:**
- Purpose: Utilities used by multiple skills — must not depend on any specific skill
- Contains:
  - `browser.js` — OpenClaw CLI wrapper for browser automation
  - `contracts.js` — Data shape validators and normalizers
  - `logger.js` — Structured logger factory
  - `retry.js` — `withRetry()` and `circuitBreaker()` implementations
  - `session-manager.js` — Platform auth status checker
  - `health.js` — Port probing, disk check, artifact cleanup
  - `tab-manager.js` — OpenClaw tab lifecycle helpers

**`skills/autoleap-browser/scripts/`:**
- Purpose: Full browser-driven AutoLeap estimate creation (primary estimate path)
- Contains:
  - `playbook.js` — 14-step Puppeteer playbook (main export: `runPlaybook()`)
  - `autoleap-api.js` — AutoLeap REST API client (JWT captured from Chrome CDP)
  - `partstech-search.js` — PartsTech parts pricing via AutoLeap SSO session
  - `login.js` — AutoLeap browser login helper
  - `send.js` — Estimate send-to-customer automation
  - `order.js` — Parts order automation
  - `helpers/motor-nav.js` — MOTOR labor guide tree navigation (Claude Haiku picks categories)
  - `helpers/pt-tab.js` — PartsTech tab management within AutoLeap
  - `helpers/selectors.js` — DOM selector constants

**`skills/ai-diagnostics/scripts/`:**
- Purpose: AI-powered diagnostic engine with RAG knowledge base
- Contains:
  - `diagnose.js` — Main export: `diagnose()` — embedding → vector search → Claude synthesis
  - `embeddings.js` — OpenAI embedding generation + Supabase pgvector search
  - `tsb-lookup.js` — NHTSA TSB/recall lookup
  - `seed-*.js` — Database seeding scripts (428 cases, 933 labor times, 40 repair plans, DTC codes, vehicle patterns)
  - `feedback.js` — Diagnostic feedback recording

**`skills/estimate-builder/scripts/`:**
- Purpose: Master pipeline orchestrator — imports all skills, sequences them, formats output
- Contains: `orchestrator.js` only (~1500 lines)

**`skills/telegram-gateway/scripts/`:**
- Purpose: Long-running Telegram bot server — the primary end-user entry point
- Contains: `server.js` only — env loading, Claude conversation engine, tool routing, Telegram API calls

**`skills/whatsapp-gateway/scripts/`:**
- Purpose: WhatsApp HTTP webhook server (supports Twilio and Meta APIs)
- Contains:
  - `server.js` — Webhook HTTP server
  - `parser.js` — WhatsApp message parsing for Twilio and Meta formats
  - `formatter.js` — `formatForWhatsApp()` — splits orchestrator output into 2-4 mobile messages

**`config/`:**
- Purpose: Runtime configuration for all skills
- Contains:
  - `.env` — Active secrets and credentials (never commit)
  - `.env.example` — Documents all required env vars with descriptions
  - `shop-config.json` — Local fallback for shop settings (labor rate, markup, preferences)

**`deploy/`:**
- Purpose: Infrastructure provisioning and deployment automation
- Contains: Shell scripts for VPS (DigitalOcean) and Pi setup, systemd unit files for 4 services
- Key services: `sam-telegram.service` (Telegram bot), `openclaw-gateway.service` (OpenClaw HTTP gateway), `openclaw-browser.service` (headless Chrome)

**`scripts/`:**
- Purpose: Developer tools — testing, debugging, and database seeding. Not part of the running application.
- Contains: `test-e2e.js` (canonical E2E test), `seed-all-via-supabase.js`, browser automation debug scripts

**`tests/unit/`:**
- Purpose: Unit tests for shared infrastructure modules
- Contains: Tests for contracts, logger, retry, session-manager, tab-manager, health (`test-*.js` naming, run via `tests/unit/run.js`)

## Key File Locations

**Entry Points:**
- `skills/telegram-gateway/scripts/server.js` — Telegram bot (primary live entry point)
- `skills/whatsapp-gateway/scripts/server.js` — WhatsApp webhook server

**Pipeline Core:**
- `skills/estimate-builder/scripts/orchestrator.js` — All 8 pipeline steps, `buildEstimate()` export

**AI Diagnostic Engine:**
- `skills/ai-diagnostics/scripts/diagnose.js` — `diagnose()` — RAG + Claude
- `skills/ai-diagnostics/scripts/embeddings.js` — OpenAI embeddings + Supabase vector search

**Browser Automation:**
- `skills/shared/browser.js` — OpenClaw wrapper (used by AllData, Identifix, ARI, PartsTech Order)
- `skills/autoleap-browser/scripts/playbook.js` — Puppeteer 14-step AutoLeap playbook
- `skills/prodemand-lookup/scripts/search-direct.js` — Puppeteer ProDemand search

**Configuration:**
- `config/.env` — All credentials and feature flags
- `config/.env.example` — Canonical reference for all env vars
- `config/shop-config.json` — Default shop settings
- `skills/shop-management/scripts/config.js` — `getShopConfig()` with Supabase + JSON fallback

**Data Contracts:**
- `skills/shared/contracts.js` — `validateLaborResult()`, `validatePartQuote()`, `normalizePrice()`, `LABOR_PRECEDENCE`

**Testing:**
- `scripts/test-e2e.js` — Primary E2E test (20 assertions, ~14s on Pi)
- `tests/unit/run.js` — Unit test runner for shared utilities

**Systemd Services:**
- `deploy/services/sam-telegram.service` — Telegram bot daemon
- `deploy/services/openclaw-browser.service` — Headless Chrome daemon
- `deploy/services/openclaw-gateway.service` — OpenClaw HTTP gateway daemon

## Naming Conventions

**Files:**
- Skill script files: `kebab-case.js` (e.g., `search-direct.js`, `autoleap-api.js`, `partstech-search.js`)
- Seed scripts: `seed-<data-type>.js` (e.g., `seed-repair-plans.js`, `seed-dtc-codes.js`)
- Test scripts: `test-<feature>.js` (e.g., `test-e2e.js`, `test-playbook.js`)
- Debug scripts: `debug-<feature>.js` (e.g., `debug-motor-scroll.js`)
- Helper files: `kebab-case.js` in `helpers/` subdirectory

**Directories:**
- Skills: `kebab-case` matching the skill's function (e.g., `ai-diagnostics`, `autoleap-browser`, `prodemand-lookup`)
- No abbreviations in directory names except well-known: `vin-decoder`, `ari-labor`

**Functions:**
- Export names are descriptive verbs: `buildEstimate`, `runPlaybook`, `searchParts`, `diagnose`, `getShopConfig`, `trackEvent`
- Log prefix constant: `const LOG = "[skill-name]"` at top of each file

**Exports:**
- Named exports via `module.exports = { fn1, fn2 }` throughout
- No default exports (CommonJS only)

## Where to Add New Code

**New research skill (browser-based, OpenClaw):**
- Create: `skills/<skill-name>/scripts/search.js` — import from `../shared/browser.js`
- Register: Add conditional require in `skills/estimate-builder/scripts/orchestrator.js` with env-var guard
- Add SKILL.md at: `skills/<skill-name>/SKILL.md`

**New research skill (Puppeteer direct CDP):**
- Create: `skills/<skill-name>/scripts/search-direct.js` — use `puppeteer-core` connecting to `http://127.0.0.1:18800`
- Follow pattern from: `skills/prodemand-lookup/scripts/search-direct.js`

**New estimate/workflow step:**
- Add to: `skills/estimate-builder/scripts/orchestrator.js` in `buildEstimate()` as a numbered step
- Use `log.info("Step N: ...")` pattern for consistency

**New gateway / messaging channel:**
- Create: `skills/<channel>-gateway/scripts/server.js`
- Import orchestrator: `require("../../estimate-builder/scripts/orchestrator")`
- Import formatter: `require("../../whatsapp-gateway/scripts/formatter")` (shared formatter) or create channel-specific one
- Load env from: `config/.env` using the manual parse pattern from existing gateways

**New shared utility:**
- Add to: `skills/shared/<utility-name>.js`
- Add unit test at: `tests/unit/test-<utility-name>.js`

**New database seeding:**
- Add seed script at: `skills/ai-diagnostics/scripts/seed-<type>.js`
- Run via: `scripts/seed-all-via-supabase.js`

**New configuration key:**
- Add to: `config/shop-config.json` with a default value
- Document in: `config/.env.example` if it requires an env var
- Add default to: `DEFAULT_SETTINGS` in `skills/shop-management/scripts/config.js`

**New debug/test script:**
- Add to: `scripts/` — not inside `skills/`
- Follow naming: `test-<feature>.js` or `debug-<feature>.js`

## Special Directories

**`skills/shared/`:**
- Purpose: Cross-skill shared utilities
- Generated: No
- Committed: Yes

**`skills/estimate-reliability/`:**
- Purpose: Documentation-only skill (SKILL.md + reference.md, no runnable scripts)
- Generated: No
- Committed: Yes

**`.planning/codebase/`:**
- Purpose: Architecture analysis documents for AI assistant context
- Generated: Yes (by map-codebase agent)
- Committed: Yes

**`deploy/vps-backup/`:**
- Purpose: Production environment snapshot for recovery reference
- Generated: No
- Committed: Partial (values are non-secret text files, actual .env not committed)

**`node_modules/`:**
- Generated: Yes
- Committed: No

---

*Structure analysis: 2026-03-15*
