# Architecture

**Analysis Date:** 2026-03-15

## Pattern Overview

**Overall:** Skill-based pipeline with a central orchestrator

**Key Characteristics:**
- Every capability is a self-contained "skill" — an isolated directory under `skills/` with its own scripts and a `SKILL.md` reference doc
- A single master orchestrator (`skills/estimate-builder/scripts/orchestrator.js`) imports and sequences all skills into one end-to-end pipeline
- Messaging gateways (Telegram, WhatsApp) are themselves skills — they own the HTTP/polling server and call the orchestrator
- All optional capabilities (browser automation, parts ordering, estimate creation) are guarded by env-var feature flags at load time using try/catch; missing env var or uninstalled dependency silently disables the skill
- No framework dependency injection — skill resolution is done manually with `let skill = null; if (process.env.X) { try { skill = require("...") } catch {} }`

## Layers

**Messaging Layer:**
- Purpose: Accept inbound messages from shop technicians and route to the pipeline
- Location: `skills/telegram-gateway/scripts/server.js`, `skills/whatsapp-gateway/scripts/server.js`
- Contains: Long-polling / HTTP webhook server, Claude `tool_use` conversation engine, in-memory session store (Map per chat/phone), message formatting
- Depends on: `estimate-builder` (orchestrator), `whatsapp-gateway` formatter (shared between both gateways), `shared` utilities
- Used by: End-users (shop staff) via Telegram `@hillsideautobot` or WhatsApp

**Orchestration Layer:**
- Purpose: Sequence all skills into the 8-step estimate pipeline; manage feature flags, timeouts, circuit breakers
- Location: `skills/estimate-builder/scripts/orchestrator.js`
- Contains: `buildEstimate()`, `handleOrderRequest()`, `handleApprovalAndOrder()`, response formatter, parts extraction logic, pricing gate
- Depends on: All research skills, all estimate skills, all shared utilities
- Used by: Telegram gateway, WhatsApp gateway

**Research Skills:**
- Purpose: Pull repair data from third-party platforms
- Location:
  - `skills/ai-diagnostics/scripts/diagnose.js` — RAG vector search + Claude synthesis
  - `skills/alldata-lookup/scripts/search.js` — AllData browser automation (OpenClaw)
  - `skills/identifix-search/scripts/search.js` — Identifix Direct-Hit browser automation
  - `skills/prodemand-lookup/scripts/search-direct.js` — ProDemand Puppeteer automation (primary)
  - `skills/prodemand-lookup/scripts/search.js` — ProDemand OpenClaw fallback
  - `skills/vehicle-specs/scripts/specs.js` — Vehicle mechanic specs (fluids, torque, sensors)
  - `skills/vin-decoder/scripts/decode.js` — NHTSA VIN decode API
- Depends on: `shared/browser.js` (OpenClaw skills), Supabase (ai-diagnostics), external platform URLs
- Used by: `estimate-builder` orchestrator

**Parts & Estimate Skills:**
- Purpose: Source parts pricing and create customer-facing estimate in AutoLeap
- Location:
  - `skills/partstech-search/scripts/search.js` — PartsTech REST API parts pricing
  - `skills/autoleap-browser/scripts/partstech-search.js` — PartsTech via AutoLeap SSO (primary browser path)
  - `skills/partstech-order/scripts/order.js` — PartsTech browser cart + ordering
  - `skills/autoleap-browser/scripts/playbook.js` — 14-step browser playbook (MOTOR + PartsTech + markup matrix)
  - `skills/autoleap-browser/scripts/autoleap-api.js` — AutoLeap REST client (JWT via CDP)
  - `skills/autoleap-estimate/scripts/estimate.js` — AutoLeap REST customer/vehicle/estimate creation
  - `skills/autoleap-estimate/scripts/history.js` — AutoLeap repair history via Supabase
  - `skills/autoleap-estimate/scripts/canned-jobs.js` — Pre-built maintenance job templates
  - `skills/estimate-pdf/scripts/generate.js` — PDF generation via pdfkit
  - `skills/ari-labor/scripts/lookup.js` — ARI Free labor guide (browser, optional fallback)
- Depends on: `shared/browser.js`, `shared/contracts.js`, Supabase, AutoLeap credentials
- Used by: `estimate-builder` orchestrator

**Shared Infrastructure:**
- Purpose: Cross-cutting utilities consumed by all skills
- Location: `skills/shared/`
  - `browser.js` — OpenClaw CLI wrapper (all OpenClaw-based skills import from here)
  - `contracts.js` — Data validation and normalization (`validateLaborResult`, `validatePartQuote`, `normalizePrice`, `mergeResults`)
  - `logger.js` — Structured/unstructured logger with `[skill-name]` prefix, run ID support
  - `retry.js` — `withRetry()` exponential backoff + `circuitBreaker()` per-platform
  - `session-manager.js` — Platform auth status checks (AutoLeap, PartsTech, ProDemand)
  - `health.js` — Port probing (Chrome CDP on 18800), disk space, artifact cleanup
  - `tab-manager.js` — OpenClaw tab lifecycle utilities

**Shop Management:**
- Purpose: Multi-shop configuration, onboarding, usage tracking
- Location: `skills/shop-management/scripts/`
  - `config.js` — `getShopConfig()`: Supabase-backed with local JSON fallback
  - `onboard.js` — Shop onboarding helpers
  - `usage.js` — `trackEvent()` for analytics (diagnosis_run, parts_searched, estimate_created, order_placed)
- Depends on: Supabase, `config/shop-config.json` (fallback)
- Used by: `estimate-builder` orchestrator

## Data Flow

**Estimate Request (Telegram):**
1. Shop technician texts `@hillsideautobot` with vehicle + symptom
2. `telegram-gateway/scripts/server.js` sends message to Claude (Anthropic API) with `tool_use` conversation
3. Claude detects `run_estimate` tool call, gateway calls `buildEstimate(params)` in orchestrator
4. Orchestrator runs 8-step pipeline:
   - Step 1: VIN decode or build vehicle object from make/model/year
   - Step 2: Classify request (diagnostic / maintenance / general)
   - Step 2.5: AI diagnosis — vector embedding → Supabase pgvector RAG → Claude synthesis
   - Step 2.7: Vehicle history + shop stats from Supabase via AutoLeap history tables
   - Step 3: Parallel platform research — AllData, Identifix (sequential via OpenClaw), ProDemand (parallel Puppeteer)
   - Step 4: Vehicle mechanic specs (fluid types, torque specs, sensor locations)
   - Step 5: Parts search — PartsTech via AutoLeap SSO (primary) → PartsTech browser (fallback) → REST API (fallback)
   - Step 5.5: Pre-stage PartsTech cart (if PARTSTECH_USERNAME set)
   - Step 6: Create estimate — browser playbook (primary, MOTOR + PartsTech + markup matrix) or AutoLeap REST API (fallback)
   - Step 7: Download AutoLeap PDF
   - Step 8: Capture AllData procedure screenshots
5. Orchestrator formats response text and returns `results` object
6. Gateway sends 4 formatted Telegram messages + PDF attachment to technician

**Parts Order Request:**
1. Technician texts "order those parts" or "approved"
2. Claude detects `order_parts` or `customer_approved` tool
3. Gateway calls `handleOrderRequest(lastEstimateResults)` with in-memory session
4. Routes to PartsTech browser cart + `placeOrder()` or AutoLeap playbook order path

**State Management:**
- Conversation history: in-memory `Map<chatId, messages[]>`, max 20 messages, per gateway instance
- Last estimate result: in-memory `Map<chatId|phone, results>` per gateway instance
- No persistent session state — each process restart clears sessions
- Shop config and usage analytics: Supabase `shops` + `shop_usage` tables

## Key Abstractions

**Skill:**
- Purpose: Single-responsibility module for one external platform or capability
- Examples: `skills/ai-diagnostics/`, `skills/prodemand-lookup/`, `skills/autoleap-browser/`
- Pattern: Each skill exports named functions from `scripts/*.js`. Skills never call each other directly — all cross-skill calls go through the orchestrator.

**Conditional Skill Loading:**
- Purpose: Optional skills that require credentials or external tools
- Pattern:
  ```javascript
  let skill = null;
  if (process.env.SKILL_CREDENTIAL) {
    try { skill = require("../../skill-name/scripts/file"); } catch { /* silent */ }
  }
  // Usage: if (skill) { result = await skill.doThing(); }
  ```
- Skills using this: `ari-labor`, `partstech-order`, `autoleap-browser` (3 modules), ProDemand direct vs OpenClaw

**Circuit Breaker:**
- Purpose: Stop hammering a failed browser platform mid-pipeline
- Location: `skills/shared/retry.js` — `circuitBreaker(name, { failThreshold: 3, cooldownMs: 120000 })`
- One breaker per platform: `partstech`, `prodemand`, `autoleap`, `alldata`, `identifix`
- Feature-flagged behind `SAM_RETRY_ENABLED=true`

**Contracts:**
- Purpose: Normalize and validate data crossing skill boundaries
- Location: `skills/shared/contracts.js`
- Key functions: `validateLaborResult()`, `validatePartQuote()`, `normalizePrice()`, `mergeResults()`, `LABOR_PRECEDENCE` (MOTOR > shop_default > AI_fallback > default)

**Browser Abstraction:**
- Purpose: Unified OpenClaw CLI wrapper for all OpenClaw-based browser skills
- Location: `skills/shared/browser.js`
- Pattern: `execFileSync("openclaw", ["browser", "--browser-profile", profile, ...args])` — no shell interpolation
- Used by: AllData, Identifix, ARI Labor, PartsTech Order
- NOT used by: ProDemand (uses `puppeteer-core` direct CDP), AutoLeap browser (uses `puppeteer-core` direct CDP)

## Entry Points

**Telegram Bot (primary demo entry):**
- Location: `skills/telegram-gateway/scripts/server.js`
- Triggers: `node skills/telegram-gateway/scripts/server.js` or `sam-telegram.service` systemd unit
- Responsibilities: Long-polling Telegram API, Claude `tool_use` conversation, env loading from `config/.env`, pipeline invocation

**WhatsApp Webhook:**
- Location: `skills/whatsapp-gateway/scripts/server.js`
- Triggers: HTTP POST to port 3000 from Twilio or Meta WhatsApp API, or `sam-whatsapp.service`
- Responsibilities: Webhook parsing (Twilio form-body or Meta JSON), pipeline invocation, multi-message response formatting

**Direct Orchestrator (testing/scripting):**
- Location: `skills/estimate-builder/scripts/orchestrator.js`
- Triggers: `require("...").buildEstimate(params)` from any caller
- Responsibilities: Full 8-step pipeline execution

## Error Handling

**Strategy:** Graceful degradation — every external call wrapped in try/catch that returns `{ error: msg }`. Missing platform results are logged and omitted from the final response rather than throwing.

**Patterns:**
- Browser platform failures: `{ error: "AllData unreachable" }` or `{ error: "timeout after 25s" }` — pipeline continues
- Skill load failures: silent `catch {}` during `require()` — skill remains null, orchestrator skips that path
- Hard failures (missing required env): `validateEnv()` in gateway servers → `process.exit(1)`
- Circuit breaker: after 3 failures, platform skipped for 120s cooldown
- Warning surface: `results.warnings[]` collects non-fatal quality issues (NO_MOTOR_LABOR, NO_PARTS_PRICING) that appear as `⚠` lines in the Telegram output

## Cross-Cutting Concerns

**Logging:** `skills/shared/logger.js` — `createLogger("skill-name", runId)` outputs `[skill-name] message` (plain) or JSON (when `SAM_STRUCTURED_LOGGING=true`). Run ID ties all log lines for one pipeline execution together.

**Validation:** `skills/shared/contracts.js` — data from external skills normalized before use in orchestrator (labor hours, part prices)

**Authentication:** Environment variables only. Each skill reads its own credentials from `process.env`. The `SessionManager` (`skills/shared/session-manager.js`) can do pre-flight auth checks when `SAM_SESSION_PREFLIGHT=true`.

**Configuration:** `config/.env` loaded manually by gateway server entry points (no dotenv package). `config/shop-config.json` provides local fallback for shop settings when Supabase `shops` table not populated.

---

*Architecture analysis: 2026-03-15*
