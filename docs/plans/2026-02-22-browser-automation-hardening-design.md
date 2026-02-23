# Browser Automation Hardening Design

**Date:** 2026-02-22
**Status:** Approved
**Target:** Pi only (sam-telegram service)
**Scope:** Full 14-section implementation from upgrade.md

## Approach: Adapter Layer

Create shared infrastructure modules in `skills/shared/` that each skill imports. Matches existing `skills/shared/browser.js` pattern.

### New Shared Modules

| Module | Purpose |
|--------|---------|
| `skills/shared/logger.js` | Structured JSON logging with runId correlation |
| `skills/shared/session-manager.js` | Per-platform auth check + auto-heal |
| `skills/shared/tab-manager.js` | Tab ownership, stale detection, cleanup |
| `skills/shared/retry.js` | Bounded retries with jitter + circuit breaker |
| `skills/shared/contracts.js` | Validation/normalization for LaborResult, PartQuote, EstimateLine |
| `skills/shared/health.js` | CDP health check, Chrome alive, disk space |

---

## Section 1: Structured Logging & Observability

**Module:** `skills/shared/logger.js`

```js
createLogger(skillName) → { info, warn, error, step, metric }
```

- JSON output: `{ ts, runId, skill, step, duration_ms, outcome, reason_code, ...extra }`
- `runId` generated per estimate request, flows through entire pipeline
- `step()` auto-times operations: `const end = log.step("search_parts"); ... end({ outcome: "ok" })`
- `metric()` emits pipeline stats: `parts_priced_rate`, `labor_real_rate`, `total_runtime_ms`
- Log to stdout (systemd journal captures it)
- Feature flag: `SAM_STRUCTURED_LOGGING=true` (falls back to console.log when off)

**RunContext:**
```js
{ runId, vehicle, symptom, shopId, startTime, steps: [] }
```
Created in orchestrator at pipeline start, passed to every skill.

**Failure artifacts:** On error, dump screenshot path + last 5 log entries + active tab URL to `/tmp/sam-artifacts/<runId>/`.

---

## Section 2: Session & Authentication Manager

**Module:** `skills/shared/session-manager.js`

```js
checkAuth(platform) → { authenticated: bool, reason_code }
healAuth(platform) → { success: bool, reason_code }
```

| Platform | Check | Heal | Token cache |
|----------|-------|------|-------------|
| AutoLeap | JWT not expired, API 200 | Puppeteer login, capture JWT | `/tmp/autoleap-token.json` with TTL + 5min skew |
| PartsTech | Tab URL not login, search input visible | Close + reopen SSO tab | Chrome sessionStorage |
| ProDemand | www2.prodemand.com tab exists, sessionStorage valid | Navigate to login, fill creds | Chrome sessionStorage |

**Preflight sequence (before every estimate):**
1. CDP health check — Chrome alive on port 18800?
2. Per enabled platform: checkAuth() → healAuth() if needed → mark unavailable if both fail
3. Log all platform auth status in one structured entry

**Security:** Credentials from env vars only. Never log token values — only `token_source: "cache"|"fresh"`.

---

## Section 3: Tab & Context Management

**Module:** `skills/shared/tab-manager.js`

```js
acquireTab(platform, runId) → { page, tabId }
releaseTab(tabId) → void
validateTab(tabId) → { valid: bool, reason_code }
cleanupStaleTabs() → { closed: number }
```

- Tabs tagged with runId ownership
- Pre-validate domain + no error/login page before interaction
- Stale threshold: 60s without validation → eligible for cleanup
- Post-run: close transient tabs (PartsTech SSO), keep persistent (ProDemand)
- PartsTech: fresh tab every run. ProDemand: reuse if valid. AutoLeap: reuse for capture, disconnect after.

---

## Section 4: Retry & Circuit Breaker

**Module:** `skills/shared/retry.js`

```js
withRetry(fn, opts) → result
circuitBreaker(name, fn, opts) → result
```

**Retry policy:**
- Max 2 retries for idempotent operations
- Backoff: 1s, 3s (with 20% jitter)
- Only retry retryable failures (timeout, network, stale tab)

**Circuit breaker:**
- Per-platform: 3 consecutive failures in 5min → short-circuit 2min
- Half-open: after cooldown, allow one probe
- State in memory (resets on restart)

**Failure classification:**

| Category | Retryable | Examples |
|----------|-----------|---------|
| TIMEOUT | Yes | Page load, API timeout |
| STALE_TAB | Yes | Wrong page, login redirect |
| NETWORK | Yes | Connection refused, DNS |
| AUTH_FAILED | No | Bad creds, expired after heal |
| PLATFORM_DOWN | No | 503, maintenance |
| NOT_FOUND | No | No results |
| PARSE_ERROR | No | Unexpected page structure |

---

## Section 5: Data Contracts & Pipeline Integrity

**Module:** `skills/shared/contracts.js`

```js
validateLaborResult(raw) → { hours, operation, source, confidence, reason_code }
validatePartQuote(raw) → { brand, part_number, supplier, unit_price, availability, source, reason_code }
validateEstimateLine(raw) → { type, description, qty, unit_price, total, source }
normalizePrice(raw) → number | null
mergeResults(base, overlay, precedence) → merged  // immutable merge
```

**Source precedence:**
- Labor: MOTOR (ProDemand) > shop_default > AI_fallback > default(1.5h)
- Parts: priced_item > non_priced_with_supplier > TBD

No hidden mutation. Original results preserved in RunContext. Never drop user intent — failed parts become TBD.

---

## Section 6: Platform-Specific Adapter Changes

**PartsTech (`partstech-search.js`):**
- Import shared modules
- Fresh tab via tabManager.acquireTab()
- GetProducts network intercept validation with reason code
- Filter: no `Call for availability`, zero-price, out-of-network
- Price normalization via contracts.normalizePrice()
- Reason codes: PT_NO_TAB, PT_LOGIN_REDIRECT, PT_NO_SEARCH_INPUT, PT_NO_PRODUCTS, PT_NO_PRICEABLE_ITEMS
- Selector fallback chains (2-3 per critical element)

**ProDemand (`search-direct.js`):**
- Import shared modules
- Engine scoring: add confidence field
- Operation synonym fallback: primary → synonym1 → synonym2
- Labor: return { hours, operation, source: "MOTOR", confidence, reason_code }
- Centralize selectors at top of file

**AutoLeap (`autoleap-api.js`):**
- Import shared modules
- Token logging: token_source, token_expires_in_min
- API retry via withRetry() for transient failures
- Validate buildServices() output before POST
- Check for duplicate estimate before creating

---

## Section 7: Telegram UX & Messaging

**server.js changes:**
- Progress milestones via Telegram editMessageText (not new messages):
  1. "On it! Looking up your vehicle..."
  2. "Got vehicle specs. Checking repair data..."
  3. "Building your estimate..."
- Gated by TELEGRAM_PROGRESS_UPDATES=true (off by default)
- Markdown escape for sensitive chars before parse_mode: Markdown
- User-friendly error messages mapped from reason_codes

**formatter.js changes:**
- Source labels: (MOTOR), (AI est.), (TBD)
- Degraded-mode notice if warnings present
- Split at 4000 chars (Telegram limit 4096)

---

## Section 8: Service Runtime Hardening

**systemd changes (sam-telegram.service):**
- EnvironmentFile=/home/sam/.env
- Startup env var validation (exit 1 if missing required vars)
- Restart=on-failure, RestartSec=5s, StartLimitBurst=5

**Health check (`skills/shared/health.js`):**
```js
checkHealth() → { chrome, cdp, telegram, disk_free_mb, uptime_s }
```
- Available via /health Telegram command
- Disk warning < 500MB

**Artifact cleanup:**
- /tmp/sam-artifacts/ → delete > 24h old
- Screenshots → keep last 50
- Run at startup + every 6h (setTimeout)

---

## Section 9: Testing

**Unit tests (`tests/unit/`):**
- test-logger.js, test-retry.js, test-contracts.js, test-engine-scoring.js, test-session-manager.js
- Simple runner: `node tests/unit/run.js`

**Enhanced E2E (`tests/e2e-test.js`):**
- Golden cases: RAV4 cat, Prius brakes, F150 misfire, Bolt battery, Accord water pump
- Degraded cases: PartsTech unavailable, ProDemand unavailable, AutoLeap unavailable
- Mocked orchestrator for CI, live on Pi for smoke testing

---

## Section 10: Change Management & Rollout

**Feature flags (env vars, all default false):**
- SAM_STRUCTURED_LOGGING
- SAM_SESSION_PREFLIGHT
- SAM_RETRY_ENABLED
- TELEGRAM_PROGRESS_UPDATES

**Rollout on Pi:**
1. Deploy with all flags off → E2E passes
2. Enable logging → 5 test prompts
3. Enable session preflight → 5 prompts
4. Enable retry → test with artificial failures
5. Enable progress updates → verify edits
6. All on → full golden suite

**Rollback:** flip flag false + restart service.

---

## Open Questions (Resolved)

- Hybrid engines: allow only if symptom is engine-agnostic (conservative)
- Multiple labor ops: use first matching by confidence
- Tab recycling: every run (fresh start)
