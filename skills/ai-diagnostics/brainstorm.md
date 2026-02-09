# AI Diagnostics Skill — Brainstorm & Status

## What This Skill Does
AI-powered diagnostic engine that takes a vehicle + DTC codes + symptoms and returns ranked causes with confidence scores, TSB/recall awareness, and recommended diagnostic steps. Backed by Supabase pgvector (RAG) and Claude API for reasoning.

## Supabase Project
- **Project:** SAM (ID: vtgjljmicmrprnexloeb)
- **Region:** us-west-2
- **Status:** Active

## Where We Left Off
**Last completed:** Phase 6 of v2 — Commercialization (all phases complete)
**Next up:** Step 9 — Testing (20 cases, 75%+ accuracy target)
**Design doc:** `docs/plans/2026-02-06-diagnostics-engine-v2-design.md`
**OpenClaw ref:** `docs/openclaw.md`

## Implementation Checklist
- [x] **Step 1:** Supabase schema setup (7 migrations applied)
  - pgvector extension enabled
  - 5 tables: diagnostic_knowledge, dtc_codes, diagnosis_log, diagnosis_outcomes, tsb_cache
  - 1 RPC function: match_diagnostic_cases()
  - Indexes: vector (ivfflat), dtc_code, vehicle make/model, tsb_cache vehicle
- [x] **Step 2:** `embeddings.js` — Vector operations
  - generateEmbedding / generateEmbeddingBatch (OpenAI text-embedding-3-small)
  - searchSimilarCases (Supabase pgvector RPC)
  - insertCase / insertBatch (with auto-embedding)
  - buildEmbeddingText (constructs searchable text from case fields)
  - Singleton Supabase client via getSupabase()
- [x] **Step 3:** `seed-data.js` — Knowledge base seeder
  - 170 DTC codes (Tier 1)
  - 186 DTC-to-cause mappings (Tier 2)
  - 72 vehicle-specific patterns (Tier 3) for 20 vehicles
  - Split across 6 files for manageability
- [x] **Step 4:** `tsb-lookup.js` — NHTSA TSB/recall API + caching
  - checkRecalls, checkComplaints, lookupTSBs (main)
  - Promise.allSettled for parallel fetching
  - Supabase cache with 30-day TTL
- [x] **Step 5:** `diagnose.js` — Main engine (RAG + Claude synthesis)
  - Full pipeline: embed → search → TSB → Claude → log → return
  - Confidence scoring algorithm (5-factor weighted formula)
  - Claude API via node-fetch (claude-sonnet-4-5-20250929)
  - Non-fatal logging to diagnosis_log table
- [x] **Step 6:** `feedback.js` — Outcome tracking + learning loop
  - recordOutcome, getAccuracyStats, learnFromOutcome
  - Learning inserts new knowledge entries with source: "outcome_learning"
- [x] **Step 7:** `SKILL.md` — Skill definition with full usage docs
- [x] **Step 8:** Orchestrator integration
  - Added Step 2.5 (AI diagnosis before parallel research)
  - extractPartsNeeded() uses AI parts when available (falls back to keyword)
  - formatServiceAdvisorResponse() shows confidence bars + diagnostic steps
  - formatDiagnosisSummary() helper added
  - .env.example updated with Supabase + OpenAI vars
  - Bug fix: spread operator preserves AI diagnosis through Step 3
- [ ] **Step 9:** Testing (20 cases, 75%+ accuracy target)

### v2 Phase 1 Checklist
- [x] Add `repair_plan` jsonb column to `diagnostic_knowledge` (migration applied)
- [x] Add `labor_cache` table to Supabase (migration applied)
- [x] Enrich top 40 DTC+vehicle combos with full repair plans (`seed-repair-plans.js`)
- [x] Seed ARI labor times for top 50 procedures x 20 vehicles (`seed-labor-times.js`, 933 entries)
- [x] Update `diagnose.js` for repair plan output (3-path system: kb_direct, kb_with_claude, claude_only)
- [x] Update orchestrator to consume repair plans (parts from search_terms, labor from repair_plan, tools/torque/verification in response)

### v2 Phase 2 Checklist
- [x] Create `ari-labor` skill (SKILL.md + scripts/lookup.js)
  - Browser automation via OpenClaw CDP
  - Snapshot-based navigation (parseSnapshot, findRef helpers)
  - Cache results in labor_cache table (90-day TTL)
  - Graceful degradation on failure
- [x] Integrate ari-labor into diagnose.js as live labor fallback
  - Conditional import: only loaded when ARI_URL env var is set
  - Called after lookupLaborCache() cache miss
  - Non-fatal: errors logged but don't break pipeline
- [x] Update .env.example with ARI_URL
- [x] Create `docs/openclaw.md` — OpenClaw reference for SAM project

### v2 Phase 3 Checklist
- [x] Create `partstech-order` skill (SKILL.md + scripts/order.js)
  - Browser automation via OpenClaw CDP for PartsTech ordering
  - Login management with session persistence
  - Vehicle selection (VIN or Y/M/M)
  - Part search, match by partNumber/brand/supplier, add to cart
  - Cart summary, clear cart, place order
  - Graceful degradation on failure
- [x] Integrate partstech-order into orchestrator
  - Conditional import: only loaded when PARTSTECH_URL env var is set
  - Step 5.5: Pre-stage non-conditional parts into cart after API search
  - `handleOrderRequest()`: SA says "order those parts" -> places order
  - Response shows cart status and ordering availability
- [x] Update .env.example with PARTSTECH_URL and PARTSTECH_PASSWORD

### v2 Phase 4 Checklist
- [x] Create `skills/shared/browser.js` — shared browser automation module
  - Extracted from ari-labor/partstech-order into reusable helpers
  - execFileSync with argument arrays (no shell injection)
  - Login, vehicle selection, search, screenshot, snapshot parsing
- [x] Complete `alldata-lookup` skill (scripts/search.js)
  - Browser automation via shared/browser.js
  - Query classification → section navigation (procedures, TSB, wiring, specs, DTC, maintenance)
  - Extracts: procedures, torque specs, special tools, notes, related TSBs, labor time
  - Screenshot capture (view + full-page)
- [x] Complete `identifix-search` skill (scripts/search.js)
  - Browser automation via shared/browser.js
  - Direct-Hit search with known fix extraction
  - Success rates, parts replaced, labor hours, confirmed counts
  - Misdiagnosis warning detection
  - Top fix ranking by success rate
- [x] Complete `prodemand-lookup` skill (scripts/search.js)
  - Preserved TAPE API path (partner access)
  - Added full browser automation fallback via shared/browser.js
  - Real Fixes extraction (symptom → cause → repair → confidence)
  - Labor times and OEM part number extraction
  - Dual-mode router: TAPE API first, browser fallback
- [x] Update orchestrator for Phase 4 results
  - Identifix corroboration boosts AI diagnosis confidence
  - ProDemand labor times as fallback labor source
  - AllData torque specs/tools merged into mechanic specs
  - New PLATFORM RESEARCH section in formatted response
  - Research screenshots collected from AllData

### v2 Phase 5 Checklist
- [x] Create `repair_history` and `canned_jobs` Supabase tables (migration applied)
  - repair_history: cached completed ROs from AutoLeap, indexed by VIN/YMME/DTC/description
  - canned_jobs: pre-built service packages from history patterns, indexed by make/name/category
  - RLS enabled on both tables
- [x] Build `history.js` — AutoLeap history retrieval module
  - `getVehicleHistory(vin/YMME)` — cache-first with 24h TTL, stale fallback
  - `getShopRepairStats({make, model, cause})` — shop-wide analytics with success rates
  - `findRelatedPriorRepairs(vehicle, diagnosis)` — escalation patterns, DTC overlap, comeback detection
  - `syncRepairHistory()` — bulk sync with pagination (20 page safety limit)
  - `normalizeRepairOrder()` — shared RO normalization (DRY extracted)
  - PII protection: customer_name not cached
- [x] Build `canned-jobs.js` — service package builder
  - 20 service patterns (oil change, brakes, spark plugs, alternator, etc.)
  - `buildCannedJobsFromHistory()` — groups repairs by pattern+make/model, computes avg labor/parts/cost
  - `getCannedJobs({make, model, year})` — filtered by vehicle
  - `searchCannedJobs(text)` — full-text search on canned job names
- [x] Integrate history into orchestrator
  - Step 2.7: Vehicle history check (prior repairs, escalation patterns, comebacks)
  - Confidence adjustment from history (+10% escalation, +8% same DTC, -5% comeback)
  - Shop-wide repair stats (success rate, avg labor/cost, comebacks)
  - Canned job suggestions for maintenance requests
  - formatServiceAdvisorResponse: VEHICLE HISTORY, SHOP EXPERIENCE, CANNED JOBS sections
  - History marker (★) in confidence bar display

### v2 Phase 6 Checklist
- [x] Create `shops` and `shop_usage` Supabase tables (migration applied)
  - shops: id, name, slug, owner_email, settings (jsonb), platforms_enabled (text[]), active
  - shop_usage: id, shop_id (FK), event_type, metadata (jsonb), created_at
  - Added shop_id column to repair_history, canned_jobs, diagnosis_log, diagnosis_outcomes
  - RLS enabled on both tables
- [x] Build `shop-management/scripts/config.js` — multi-shop config
  - `getShopConfig(shopId?)` — Supabase-backed with local JSON fallback
  - `getShopById(idOrSlug)` — UUID or slug lookup
  - `listActiveShops()`, `updateShopSettings(shopId, update)`
  - `getShopPlatforms(shopId)` — platform status with env var check
  - DEFAULT_SETTINGS with all shop defaults
- [x] Build `shop-management/scripts/onboard.js` — shop onboarding
  - `onboardShop({name, slug, ownerEmail, settings, platforms})` — create shop + env template
  - `validatePlatformAccess(platformKeys?)` — check env var presence
  - `generateEnvTemplate(shopId, platformKeys)` — .env file generator
  - `deactivateShop(shopId)` — soft delete
  - 7 platform definitions with env var requirements
- [x] Build `shop-management/scripts/usage.js` — event tracking & analytics
  - `trackEvent(shopId, eventType, metadata)` — non-fatal event logging
  - `getShopDashboard(shopId)` — this month + 90-day stats, top repairs, platform usage
  - `getShopMonthlyReport(shopId, yearMonth)` — daily breakdown, revenue, top vehicles
- [x] Create `shop-management/SKILL.md` — full skill documentation
- [x] Update orchestrator for multi-shop support
  - Imports getShopConfig and trackEvent from shop-management
  - Removed local JSON file loading (loadShopConfig, fs import)
  - `buildEstimate()` accepts shopId param (falls back to SHOP_ID env var)
  - Usage tracking: diagnosis_run, parts_searched, estimate_created, order_placed events
  - shopId stored in results for handleOrderRequest() context
  - Backward compatible: no shopId → local JSON config

## Files Created
| File | Status |
|------|--------|
| `skills/ai-diagnostics/scripts/embeddings.js` | Done |
| `skills/ai-diagnostics/scripts/seed-data.js` | Done |
| `skills/ai-diagnostics/scripts/seed-dtc-codes.js` | Done |
| `skills/ai-diagnostics/scripts/seed-cause-mappings.js` | Done |
| `skills/ai-diagnostics/scripts/seed-causes-a.js` | Done |
| `skills/ai-diagnostics/scripts/seed-causes-b.js` | Done |
| `skills/ai-diagnostics/scripts/seed-vehicle-patterns.js` | Done |
| `skills/ai-diagnostics/scripts/tsb-lookup.js` | Done |
| `skills/ai-diagnostics/scripts/diagnose.js` | Done (v2 updated) |
| `skills/ai-diagnostics/scripts/feedback.js` | Done |
| `skills/ai-diagnostics/scripts/seed-repair-plans.js` | Done (v2) |
| `skills/ai-diagnostics/scripts/seed-labor-times.js` | Done (v2) |
| `skills/ai-diagnostics/SKILL.md` | Done |
| `skills/ari-labor/SKILL.md` | Done (v2 Phase 2) |
| `skills/ari-labor/scripts/lookup.js` | Done (v2 Phase 2) |
| `docs/openclaw.md` | Done (v2 Phase 2) |
| `skills/partstech-order/SKILL.md` | Done (v2 Phase 3) |
| `skills/partstech-order/scripts/order.js` | Done (v2 Phase 3) |
| `skills/shared/browser.js` | Done (v2 Phase 4) |
| `skills/alldata-lookup/scripts/search.js` | Done (v2 Phase 4, rewritten) |
| `skills/identifix-search/scripts/search.js` | Done (v2 Phase 4, rewritten) |
| `skills/prodemand-lookup/scripts/search.js` | Done (v2 Phase 4, rewritten) |
| `skills/autoleap-estimate/scripts/history.js` | Done (v2 Phase 5) |
| `skills/autoleap-estimate/scripts/canned-jobs.js` | Done (v2 Phase 5) |
| `skills/shop-management/scripts/config.js` | Done (v2 Phase 6) |
| `skills/shop-management/scripts/onboard.js` | Done (v2 Phase 6) |
| `skills/shop-management/scripts/usage.js` | Done (v2 Phase 6) |
| `skills/shop-management/SKILL.md` | Done (v2 Phase 6) |

## Files Modified
| File | Changes |
|------|---------|
| `skills/estimate-builder/scripts/orchestrator.js` | v1: import, Step 2.5, AI parts, confidence display. v2: repair plan parts extraction, labor from repair plan, tools/torque/verification display. v2 Phase 3: conditional partstech-order import, Step 5.5 cart pre-staging, handleOrderRequest(), cart status in response. v2 Phase 4: Identifix corroboration, ProDemand labor fallback, AllData torque/tools merge, PLATFORM RESEARCH display section. v2 Phase 5: history imports, Step 2.7 vehicle history check, shop stats, canned jobs, confidence adjustment from history, VEHICLE HISTORY/SHOP EXPERIENCE/CANNED JOBS display sections. v2 Phase 6: getShopConfig/trackEvent imports, removed loadShopConfig/fs, shopId param + SHOP_ID env fallback, usage event tracking (diagnosis_run, parts_searched, estimate_created, order_placed) |
| `config/.env.example` | Added SUPABASE_URL, SUPABASE_ANON_KEY, OPENAI_API_KEY, ARI_URL, PARTSTECH_URL, PARTSTECH_PASSWORD |

## Key Decisions Made
- OpenAI `text-embedding-3-small` for embeddings (1536 dims)
- Supabase pgvector with ivfflat index (lists=100)
- CommonJS modules (matching existing codebase)
- node-fetch via dynamic import (matching existing pattern)
- Confidence cap at 0.95, minimum display 0.05
- TSB cache TTL: 30 days
- Batch embedding size: 20 per API call
- Seed data: 428 entries total (170 + 186 + 72) — feedback loop grows it organically
- Claude model: claude-sonnet-4-5-20250929 for synthesis

## Before You Can Run
1. Install dependencies:
   ```bash
   cd skills/ai-diagnostics
   npm init -y
   npm install @supabase/supabase-js
   ```
2. Set env vars:
   ```
   SUPABASE_URL=https://vtgjljmicmrprnexloeb.supabase.co
   SUPABASE_ANON_KEY=<get from Supabase dashboard>
   OPENAI_API_KEY=<your key>
   ANTHROPIC_API_KEY=<your key>
   ```
3. Run seed script: `node skills/ai-diagnostics/scripts/seed-data.js`
4. Rebuild IVFFlat index after seeding for optimal vector search performance

## Notes
- IVFFlat index should be rebuilt after seed data is loaded for optimal performance
- The existing AllData/Identifix/ProDemand skills are skeletons — this skill fills the diagnostic gap
- AI diagnosis runs BEFORE parallel research in the orchestrator (Step 2.5)
- Spec reviews caught and fixed: diagnosis overwrite bug in orchestrator (Step 3 was losing AI data)
