# Codebase Concerns

**Analysis Date:** 2026-03-15

---

## Tech Debt

**Dual AutoLeap API systems (REST + Browser) coexist with no consolidation plan:**
- Issue: `skills/autoleap-estimate/scripts/estimate.js` uses the Partner API (`AUTOLEAP_PARTNER_ID` / `AUTOLEAP_AUTH_KEY`), while `skills/autoleap-browser/scripts/autoleap-api.js` uses CDP token capture from a live Chrome session. Both paths exist in the codebase and the Partner API path is effectively dead code in production (browser path always wins when `AUTOLEAP_EMAIL` is set).
- Files: `skills/autoleap-estimate/scripts/estimate.js`, `skills/autoleap-browser/scripts/autoleap-api.js`, `skills/autoleap-estimate/scripts/history.js`
- Impact: `history.js` still calls `authenticate()` from the Partner API path. If credentials differ between environments, history sync silently fails with no warning to the user.
- Fix approach: Decide on one auth path. If browser-CDP is canonical, update `history.js` to use `getToken()` from `autoleap-api.js`. Retire the Partner API code path.

**`handleApprovalAndOrder` / `handleOrderRequest` mutual recursion:**
- Issue: `handleApprovalAndOrder()` in `skills/estimate-builder/scripts/orchestrator.js` (line 653-655) immediately calls `handleOrderRequest()`. Inside `handleOrderRequest()` (line 669), if `estimateSource === "browser"` AND `autoLeapBrowser` is set, it calls `handleApprovalAndOrder()` again. `autoLeapBrowser` is hardcoded `null` (line 88), so no infinite loop occurs today, but the logic is a dead circular reference that will break if the null guard is ever removed.
- Files: `skills/estimate-builder/scripts/orchestrator.js` lines 653-670
- Impact: Confusing dead code path. If `autoLeapBrowser` is ever populated, both functions call each other infinitely.
- Fix approach: Eliminate `handleApprovalAndOrder` or make it clearly a thin wrapper with a comment. Remove the `autoLeapBrowser` null reference.

**`SessionManager` heal methods are all stubs:**
- Issue: `skills/shared/session-manager.js` — `_healAutoLeap()`, `_healPartsTech()`, `_healProDemand()` all return `{ success: false, reason_code: "HEAL_NOT_WIRED" }`. The preflight feature (`SAM_SESSION_PREFLIGHT=true`) detects auth failures and calls these, then logs a healed/not-healed status that is entirely fictional.
- Files: `skills/shared/session-manager.js` lines 127-137
- Impact: Preflight is advertised as a capability but heal is completely unimplemented. Enabling `SAM_SESSION_PREFLIGHT` gives false confidence.
- Fix approach: Either wire up the heal logic (re-login via `getToken()`) or remove the heal step and make preflight read-only diagnostics.

**`CLAUDE_MODEL` constant hardcoded to a specific model version string:**
- Issue: Model IDs are hardcoded in three places: `"claude-sonnet-4-5-20250929"` in `skills/ai-diagnostics/scripts/diagnose.js` (line 34), `"claude-sonnet-4-5-20250929"` in `skills/telegram-gateway/scripts/server.js` (line 219), `"claude-haiku-4-5-20251001"` in `skills/autoleap-browser/scripts/helpers/motor-nav.js` (line 1288). No env var override.
- Files: `skills/ai-diagnostics/scripts/diagnose.js`, `skills/telegram-gateway/scripts/server.js`, `skills/autoleap-browser/scripts/helpers/motor-nav.js`
- Impact: Updating to a new Claude release requires editing three source files.
- Fix approach: Pull from `process.env.CLAUDE_SONNET_MODEL` / `process.env.CLAUDE_HAIKU_MODEL` with a hardcoded default as fallback.

**`puppeteer-core` / `@anthropic-ai/sdk` are runtime dependencies not in `package.json`:**
- Issue: `package.json` only lists `@supabase/supabase-js`, `form-data`, `node-fetch`, `pdfkit`, and `proxy-chain`. `puppeteer-core` and `@anthropic-ai/sdk` are required at runtime in several files but not declared, meaning `npm install` on a fresh checkout produces a broken runtime.
- Files: `package.json`, `skills/autoleap-browser/scripts/autoleap-api.js`, `skills/telegram-gateway/scripts/server.js`
- Impact: Any CI/CD step or new deployment that runs `npm install` and then `node` will fail at first browser or Claude invocation.
- Fix approach: Add `puppeteer-core` and `@anthropic-ai/sdk` to `package.json` dependencies with pinned versions matching what's installed on the Pi and VPS.

**`/tmp/` debug screenshot paths hardcoded throughout playbook helpers:**
- Issue: `motor-nav.js` and `pt-tab.js` write debug screenshots to absolute paths like `/tmp/debug-motor-start.png`, `/tmp/debug-pt-search-results.png`, etc. (20+ unique paths). These overwrite each other across concurrent runs and accumulate without cleanup.
- Files: `skills/autoleap-browser/scripts/helpers/motor-nav.js`, `skills/autoleap-browser/scripts/helpers/pt-tab.js`, `skills/autoleap-browser/scripts/playbook.js`
- Impact: Production debugging is difficult because screenshots from different estimates overwrite each other. Disk fills over time.
- Fix approach: Route debug screenshots through a timestamped subdirectory under `os.tmpdir()` per run, and include them in `cleanupArtifacts()` sweep.

---

## Known Bugs

**`CHROME_CDP_URL` is hardcoded in two files instead of using the env var:**
- Symptoms: Connecting to a Chrome instance on a different port or host silently uses `http://127.0.0.1:18800` instead of the configured value.
- Files: `skills/autoleap-browser/scripts/autoleap-api.js` line 28, `skills/autoleap-browser/scripts/playbook.js` line 25
- Trigger: Set `CHROME_DEBUG_PORT` to anything other than `18800` — `search-direct.js` reads it correctly, but `autoleap-api.js` and `playbook.js` ignore the env var entirely.
- Workaround: Keep port 18800. Note that `skills/shared/health.js` and `skills/shared/session-manager.js` correctly read `CHROME_DEBUG_PORT` — the discrepancy is a latent bug.

**WhatsApp PDF delivery not implemented (TODO left in code):**
- Symptoms: When a PDF is generated and WhatsApp is the delivery channel, it is silently dropped.
- Files: `skills/whatsapp-gateway/scripts/server.js` line 117
- Trigger: Any estimate with a PDF sent via the WhatsApp gateway (not Telegram).
- Workaround: PDF path is returned in the result object but never sent. Telegram path does send it via `sendDocument`.

**`isReachable()` in orchestrator uses `resp.ok` (200-299 only) for AllData and Identifix:**
- Symptoms: Both AllData (`my.alldata.com`) and Identifix (`www.identifix.com`) may return 3xx redirects on HEAD requests. `isReachable` returns `false` for a 301 redirect, causing the orchestrator to log the platform as "blocked" and skip it even when it is reachable.
- Files: `skills/estimate-builder/scripts/orchestrator.js` line 966
- Trigger: Any network where the sites redirect on HEAD (common with CDNs and auth portals).
- Workaround: Change `return resp.ok` to `return resp.status < 500` to treat redirects as reachable.

**Telegram `conversations` map grows unbounded across long-running sessions:**
- Symptoms: Memory grows slowly over time; old chat history from months ago is retained in-process.
- Files: `skills/telegram-gateway/scripts/server.js` lines 66-69
- Trigger: Each unique `chatId` creates a permanent entry. The `MAX_HISTORY=20` limit trims per-chat messages but never evicts old chat entries from the map.
- Workaround: Currently mitigated by occasional service restarts. Real fix: LRU eviction by chatId after N days of inactivity.

---

## Security Considerations

**Credentials visible in process argument lists (OpenClaw browser automation):**
- Risk: `skills/shared/browser.js` `performLogin()` passes username and password as CLI arguments to `execFileSync("openclaw", [..., username, password])`. On Linux/macOS, process argument lists are visible to any user who can read `/proc/<pid>/cmdline` or run `ps`.
- Files: `skills/shared/browser.js` lines 386-405
- Current mitigation: The shared browser module's comment (line 362-365) notes this as a "known limitation." `execFileSync` is used (not shell interpolation), which prevents injection but not process-list exposure.
- Recommendations: Pipe credentials via stdin, or use a temp file with restricted permissions. Apply on AllData, Identifix, and ARI login flows.

**JWT token cached to world-readable `/tmp/autoleap-token.json`:**
- Risk: The AutoLeap JWT is written to `os.tmpdir()` which on Linux is `/tmp` — readable by all users on the system.
- Files: `skills/autoleap-browser/scripts/autoleap-api.js` lines 104-108
- Current mitigation: Single-user VPS/Pi deployment reduces exposure. Token expires in ~2 hours.
- Recommendations: Write token to a file owned/readable only by the `sam` user. Use `fs.writeFileSync(path, data, { mode: 0o600 })`.

**WhatsApp webhook has no signature validation:**
- Risk: The Twilio webhook endpoint at `skills/whatsapp-gateway/scripts/server.js` accepts POST requests without verifying the `X-Twilio-Signature` header. Any party that discovers the URL can inject arbitrary messages into the SAM pipeline.
- Files: `skills/whatsapp-gateway/scripts/server.js`
- Current mitigation: URL is not publicly advertised. Basic IP obscurity.
- Recommendations: Add Twilio signature validation using `TWILIO_AUTH_TOKEN` + request URL + body HMAC. Twilio documents the validation algorithm.

**`.env` file is loaded with a custom parser (no `dotenv` library):**
- Risk: The hand-rolled env parser in `server.js` (Telegram and WhatsApp) does not handle multi-line values, quoted values, or `export KEY=VALUE` syntax. A malformed `.env` line could silently set an incorrect env var.
- Files: `skills/telegram-gateway/scripts/server.js` lines 19-31, `skills/whatsapp-gateway/scripts/server.js` lines 33-44
- Current mitigation: The config format in use is simple `KEY=VALUE` with no special cases, so it works in practice.
- Recommendations: Replace with `dotenv` package (already a de facto standard). Reduces parser surface area.

---

## Performance Bottlenecks

**Playbook `sleep()` calls accumulate to 60+ seconds of fixed wait time:**
- Problem: `skills/autoleap-browser/scripts/playbook.js` uses approximately 68 `sleep()` / `setTimeout` calls throughout the 14-step process. Many are fixed waits (2s, 3s, 5s) that run regardless of whether the UI has actually settled.
- Files: `skills/autoleap-browser/scripts/playbook.js`, `skills/autoleap-browser/scripts/helpers/motor-nav.js`, `skills/autoleap-browser/scripts/helpers/pt-tab.js`
- Cause: Angular SPA with slow renders requires settling time, but fixed sleeps add cumulative delay.
- Improvement path: Replace fixed sleeps with `page.waitForSelector()` or `page.waitForFunction()` with a reasonable timeout. Priority: Phase 3 (PartsTech tab opening) and Phase 4 (MOTOR catalog navigation) where delays stack hardest.

**`findMatchingVehicle()` fetches ALL recent estimates individually to find vehicle:**
- Problem: `skills/autoleap-browser/scripts/partstech-search.js` `findMatchingVehicle()` (line 88-119) fetches up to 50 estimates list, then makes a separate API call for each record to get the vehicle data. On a busy shop with 50+ estimates, this is 51 sequential HTTPS requests.
- Files: `skills/autoleap-browser/scripts/partstech-search.js` lines 88-119
- Cause: AutoLeap's list endpoint doesn't return vehicle info inline; full fetch is required per record.
- Improvement path: Cache the last-used vehicleId by vehicle YMME string in a local JSON file (same pattern as `autoleap-token.json`). Invalidate on new estimate creation.

**ProDemand vehicle breadcrumb selection runs full page navigation flow every cold start:**
- Problem: `skills/prodemand-lookup/scripts/search-direct.js` navigates ProDemand's URL-hash vehicle selection, which involves waiting for Angular to render vehicle qualifier dropdowns, selecting Year/Make/Model/Engine options, and potentially waiting for AJAX refreshes between each. Cold start is 22-25s.
- Files: `skills/prodemand-lookup/scripts/search-direct.js`
- Cause: ProDemand uses sessionStorage auth — the page can't be cached between processes.
- Improvement path: The breadcrumb skip already implemented (check `#vehicleDetails` text before re-selecting) is the primary optimization. Consider persisting the vehicle URL hash to skip vehicle selection entirely on repeat lookups for the same vehicle.

---

## Fragile Areas

**AutoLeap Angular UI automation relies on undocumented CSS selectors and DOM structure:**
- Files: `skills/autoleap-browser/scripts/helpers/selectors.js`, `skills/autoleap-browser/scripts/helpers/motor-nav.js`, `skills/autoleap-browser/scripts/helpers/pt-tab.js`, `skills/autoleap-browser/scripts/playbook.js`
- Why fragile: The entire playbook depends on selectors like `#estimate-customer`, `.p-autocomplete-panel li`, `div.add-est-btn`, `.dropdown-list-item`. AutoLeap ships frequent UI updates and their Angular app structure can change without notice. Even a className change breaks estimate creation silently.
- Safe modification: Always run `scripts/test-new-vehicle.js` and `scripts/test-playbook.js` after any AutoLeap UI change. Keep `scripts/debug-*.js` debug scripts as quick regression tools.
- Test coverage: No automated assertions on selector validity. Debug screenshots to `/tmp/` are the only diagnostic trail.

**OpenClaw `snapshot → parseSnapshot → findRef → act` pattern assumes deterministic element ordering:**
- Files: `skills/shared/browser.js`, `skills/alldata-lookup/scripts/search.js`, `skills/identifix-search/scripts/search.js`, `skills/ari-labor/scripts/lookup.js`
- Why fragile: `parseSnapshot` returns elements in document order. `findRef(elements, "search")` returns the first element whose text includes "search" (case-insensitive). On pages with multiple search-like inputs, this picks the wrong one silently.
- Safe modification: Use `findRefByType(elements, "input", "search")` and supply specific type constraints. Add snapshot logging when `searchRef` is `null` before failing.
- Test coverage: Unit tests in `tests/unit/` test the parser logic but not against real page snapshots.

**PartsTech product extraction uses heuristic text-proximity parsing, not a DOM/API contract:**
- Files: `skills/autoleap-browser/scripts/partstech-search.js` lines 144-217
- Why fragile: `parseProducts()` finds price patterns (`$N.NN`) in snapshot text, then looks at nearby elements ±10 positions to infer brand, description, and part number. Any PartsTech UI layout change that reorders elements (e.g. price before description instead of after) silently produces wrong brand/description associations. Price extraction itself is correct; metadata attribution is a heuristic.
- Safe modification: After PartsTech UI changes, run `scripts/debug-pt-open-and-click.js` and inspect snapshot element ordering before deploying.
- Test coverage: None for the product extraction logic.

**Vehicle specification data in `vehicle-specs/scripts/specs.js` is hardcoded static data:**
- Files: `skills/vehicle-specs/scripts/specs.js` line 287 (`TODO: Enhance with live extraction from AllData/ProDemand`)
- Why fragile: All torque specs, fluid capacities, O2 sensor locations, and special tools are pre-programmed lookups. For vehicles not matching the static lookup tables, the spec object returns placeholder values (`"?"`) that flow through to the PDF estimate and mechanic reference.
- Safe modification: The static data is not wrong — it's approximate. Real production impact is mechanic reference quality. AllData and ProDemand integration was designed to override these values when reachable.
- Test coverage: No tests for spec lookup edge cases or missing vehicle coverage.

**Circuit breakers are in-process and reset on service restart:**
- Files: `skills/estimate-builder/scripts/orchestrator.js` lines 104-110, `skills/shared/retry.js` lines 57-100
- Why fragile: `circuitBreaker()` state is stored in closure variables (JavaScript heap). If the process restarts due to an error or deployment, the breaker resets to closed regardless of the upstream platform's health. A restart loop can hammer a broken platform 3 times per startup indefinitely.
- Safe modification: The 2-minute cooldown (`cooldownMs: 120000`) limits damage within a single process lifetime. Use `FEAT_RETRY_ENABLED=true` to activate — it defaults to off.
- Test coverage: `tests/unit/test-retry.js` covers the retry/breaker logic in isolation.

---

## Scaling Limits

**Single shared Chrome instance for all browser automation:**
- Current capacity: One Chrome process on port 18800, shared by ProDemand (puppeteer-core), AutoLeap playbook (puppeteer-core), PartsTech (puppeteer-core), and OpenClaw (AllData, Identifix, ARI).
- Limit: Concurrent estimate requests will contend for the same browser. A second Telegram message received while a 60s playbook is running will either queue behind it or interfere with the active playbook's tabs.
- Scaling path: Multi-shop deployment (Phase 6) has no browser isolation. Each shop would need its own Chrome instance. The `CHROME_DEBUG_PORT` env var provides the hook; the orchestrator needs pool/locking logic.

**In-memory Telegram session and conversation stores:**
- Current capacity: `sessions` and `conversations` Maps in `skills/telegram-gateway/scripts/server.js` hold the last estimate result and full Claude history per chat ID, persisted only for process lifetime.
- Limit: Service restart clears all context. Multi-instance deployment (load balancing) is impossible — session state is not shared.
- Scaling path: Persist `sessions` to Supabase. The `sessions` key is `chatId`; a simple `telegram_sessions` table with `chat_id` + `last_estimate_json` + `history_json` would survive restarts.

---

## Dependencies at Risk

**`@anthropic-ai/sdk` loaded with `require()` at call time, not declared in `package.json`:**
- Risk: The SDK is required dynamically inside `processMessage()` in `server.js` (line 215). If `npm install` is run (e.g. after a fresh clone or deployment), the package won't be present.
- Impact: Telegram bot silently falls back to `"My AI brain isn't connected"` error message. No startup crash — failure is delayed until first user message.
- Migration plan: Add `@anthropic-ai/sdk` to `package.json` dependencies.

**`node-fetch` v3 (ESM-only) used via dynamic `import()` throughout codebase:**
- Risk: `node-fetch` v3 is ESM-only but the codebase is CommonJS. The workaround `(await import("node-fetch")).default` is used in 10+ places. This pattern works but is unusual — a future Node.js version change or tooling update could break the mixed-module pattern.
- Impact: All outbound HTTP calls (Telegram API, Anthropic API, WhatsApp/Meta API, AutoLeap API, NHTSA API) use this pattern.
- Migration plan: Either downgrade to `node-fetch` v2 (CommonJS-compatible) or migrate the entire project to ESM (`"type": "module"` in `package.json`).

---

## Missing Critical Features

**No rate limiting or concurrency guard on the estimate pipeline:**
- Problem: The Telegram and WhatsApp gateways have no mechanism to reject or queue overlapping pipeline invocations. Two messages sent within seconds of each other will both start `buildEstimate()` simultaneously, contending for the shared Chrome instance.
- Blocks: Reliable multi-user or multi-message operation.

**No persistent error logging or alerting:**
- Problem: All errors are `console.error()` to stdout. There is no structured error log, no alerting (Slack/email), and no error aggregation. Failures on the VPS are visible only via `journalctl -u sam-whatsapp` or SSH.
- Blocks: Proactive ops monitoring. Issues are discovered when users complain, not when they occur.

---

## Test Coverage Gaps

**Zero test coverage for the orchestrator pipeline:**
- What's not tested: The core `buildEstimate()` function in `skills/estimate-builder/scripts/orchestrator.js` (1533 lines) has no unit tests. The E2E test (`scripts/test-e2e.js`) exercises the full pipeline but requires live credentials and a running Chrome instance — it is not runnable in CI.
- Files: `skills/estimate-builder/scripts/orchestrator.js`
- Risk: Any refactor to orchestrator step logic (Steps 1-7) can silently break the pipeline.
- Priority: High

**Zero test coverage for browser playbook and helpers:**
- What's not tested: `skills/autoleap-browser/scripts/playbook.js`, `helpers/motor-nav.js`, `helpers/pt-tab.js`. All 14 playbook steps, the MOTOR navigation logic, and PartsTech cart flow are tested only via `scripts/test-playbook.js` which requires a live AutoLeap session.
- Files: `skills/autoleap-browser/scripts/playbook.js`, `skills/autoleap-browser/scripts/helpers/`
- Risk: Angular UI changes at AutoLeap break estimate creation with no automated detection.
- Priority: High

**`diagnose.js` AI path only tested via E2E:**
- What's not tested: The `kb_with_claude` and `claude_only` diagnostic paths in `skills/ai-diagnostics/scripts/diagnose.js`. Only `kb_direct` runs in the E2E test (because it hits the KB threshold without needing live Claude).
- Files: `skills/ai-diagnostics/scripts/diagnose.js`
- Risk: Claude synthesis path could regress (JSON parse failure, schema mismatch) without detection.
- Priority: Medium

**Unit tests cover only shared infrastructure, not business logic:**
- What's not tested: `tests/unit/` contains tests for `logger`, `retry`, `session-manager`, `tab-manager`, `health`, and `contracts` — all shared infrastructure modules. No business logic in `diagnose.js`, `orchestrator.js`, `playbook.js`, `partstech-search.js`, or gateway servers is unit-tested.
- Files: `tests/unit/`
- Risk: Regressions in business logic go undetected until live testing.
- Priority: Medium

---

*Concerns audit: 2026-03-15*
