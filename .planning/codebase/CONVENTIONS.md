# Coding Conventions

**Analysis Date:** 2026-03-15

## Naming Patterns

**Files:**
- `kebab-case.js` throughout: `search-direct.js`, `motor-nav.js`, `partstech-search.js`, `session-manager.js`
- Test files prefixed with `test-`: `test-contracts.js`, `test-retry.js`, `test-logger.js`
- Helper files live in `helpers/` subdirectory within a skill's `scripts/` folder

**Functions:**
- `camelCase` for all functions: `buildQueryText`, `normalizePrice`, `validateLaborResult`, `runPlaybook`
- Async functions declared with `async function name()` for top-level exports
- Inner closures and inline helpers use arrow functions: `const doProDemandSearch = async () => { ... }`
- Class methods use standard method shorthand

**Variables:**
- `camelCase` for regular variables and constants: `passCount`, `testParams`, `shopConfig`
- `SCREAMING_SNAKE_CASE` for module-level config constants:
  ```js
  const AUTOLEAP_API_URL = process.env.AUTOLEAP_API_URL || "https://...";
  const LOG = "[skill-name]";
  const CHROME_CDP_URL = "http://127.0.0.1:18800";
  ```

**Types / Classes:**
- `PascalCase` for classes: `SessionManager`, `TabManager`
- Constants that are object maps use `SCREAMING_SNAKE_CASE`: `LABOR_PRECEDENCE`, `PRICING_GATE`, `SELECTORS`

**Log Prefix Convention:**
Every skill file that logs defines a module-level `LOG` constant:
```js
const LOG = "[skill-name]";          // e.g. "[playbook]", "[prodemand-direct]"
```
Used as: `console.log(`${LOG} message`)`

## Code Style

**Formatting:**
- No Prettier or ESLint config files detected — style is maintained manually
- 2-space indentation throughout
- Single quotes for string literals in most files; template literals (`backtick`) for interpolation
- Trailing commas in multi-line arrays and objects
- Semicolons used consistently

**Module System:**
- CommonJS exclusively: `require()` / `module.exports`
- No ES module `import`/`export` syntax in any skill file
- `"use strict"` directive present in shared infrastructure files (`contracts.js`, `retry.js`, `logger.js`, `run.js`) but absent in most skill scripts

## Import Organization

**Order (observed pattern):**
1. Node built-ins: `const fs = require("fs")`, `const path = require("path")`
2. Third-party packages: `require("puppeteer-core")`, `require("@supabase/supabase-js")`
3. Internal skill scripts: `require("../../shared/logger")`, `require("./helpers/selectors")`

**Dynamic Imports:**
`node-fetch` (ESM-only package) is imported dynamically inside each function that uses it:
```js
const fetch = (await import("node-fetch")).default;
```
This pattern repeats in every file making HTTP calls: `diagnose.js`, `embeddings.js`, `tsb-lookup.js`, `estimate.js`, `history.js`, `partstech-search/scripts/search.js`, `orchestrator.js`

**Conditional Skill Loading:**
Optional skills are loaded at module top-level with env-var guard + silent catch:
```js
let autoLeapPlaybook = null;
if (process.env.AUTOLEAP_EMAIL) {
  try {
    autoLeapPlaybook = require("../../autoleap-browser/scripts/playbook");
  } catch {
    // playbook not available — falls back to REST API estimate
  }
}
```
Used in `orchestrator.js` for: `autoLeapPartstech`, `partstechOrder`, `autoLeapApi`, `autoLeapPlaybook`

**Path Aliases:**
None. All imports use relative paths with `../../` traversal from `skills/<skill>/scripts/` up to `skills/`:
```js
require("../../shared/logger")          // skill's scripts/ → skills/shared/
require("../../ai-diagnostics/scripts/diagnose")
```

## Error Handling

**Primary Pattern — Return `{ error }` Objects:**
Functions return a plain error object instead of throwing, enabling graceful degradation:
```js
if (!ALLDATA_USERNAME) {
  return { error: "AllData not configured — set ALLDATA_USERNAME and ALLDATA_PASSWORD" };
}
// ... on failure:
} catch (err) {
  return { error: `AllData search failed: ${err.message}` };
}
```
Callers check `result.error` rather than catching exceptions.

**Secondary Pattern — Try/Catch + Log + Return:**
```js
try {
  const response = await fetch(...);
  if (!response.ok) {
    throw new Error(`PartsTech API error: ${response.status} ${response.statusText}`);
  }
  return data;
} catch (error) {
  console.error(`[partstech] Search failed: ${error.message}`);
  return { error: error.message, results: [] };
}
```

**Shared Infrastructure for Retries:**
`skills/shared/retry.js` provides `withRetry(fn, opts)` and `circuitBreaker(name, opts)`.
`skills/shared/contracts.js` classifies errors via `FailureClass.classify(err)`.
Feature-flagged in `orchestrator.js` via `SAM_RETRY_ENABLED=true`.

**Error Classification:**
Errors are classified into `reason_code` strings: `"TIMEOUT"`, `"AUTH_FAILED"`, `"PLATFORM_DOWN"`, `"NOT_FOUND"`, `"CIRCUIT_OPEN"`. These propagate as `err.reason_code` on thrown Error objects.

## Logging

**Framework:** Built-in `createLogger` from `skills/shared/logger.js`

**Usage:**
```js
const { createLogger, generateRunId } = require("../../shared/logger");
const log = createLogger("telegram-gateway");   // or with runId
log.info("session started", { chatId });
log.warn("AutoLeap token missing");
log.error("Pipeline crashed", { runId, err: err.message });
const end = log.step("search_parts");
end({ outcome: "ok", parts: 3 });               // logs duration_ms automatically
log.metric({ parts_priced_rate: 0.8, total_runtime_ms: 45000 });
```

**Two output modes:**
- `SAM_STRUCTURED_LOGGING=true` → JSON to stdout/stderr with fields: `ts`, `level`, `skill`, `runId`, `msg`
- Default → `[skill-name] message` prefix to console

**Older skills** use `console.log(`${LOG} message`)` directly rather than `createLogger`. Both patterns coexist. New code should use `createLogger`.

## Comments

**Module Headers:**
Every script file begins with a JSDoc block comment describing the module, its pipeline, and main exports:
```js
/**
 * Diagnose — Main Diagnostic Engine for AI Diagnostics Skill
 *
 * Orchestrates the full diagnostic pipeline:
 *   1. Build query text...
 *   2. Generate embedding...
 *
 * Main export: diagnose({ vin, year, make, model, engine, ... })
 */
```

**JSDoc on Exported Functions:**
All exported functions have `@param` / `@returns` JSDoc. There are 534+ JSDoc annotations across skills.
```js
/**
 * Search for parts by vehicle + part type with vendor comparison
 * @param {object} params
 * @param {string} params.vin - Vehicle VIN
 * @param {string} params.partType - Part name or category
 * @returns {object} Parts with vendor comparison and best-value picks
 */
async function searchParts({ vin, partType, ... }) {
```

**Inline Comments:**
Section dividers use ASCII art for major pipeline phases:
```js
// ═══════════════════════════════════════════════════
// PHASE 1: Authentication (Step 1)
// ═══════════════════════════════════════════════════
```
`// ── Description ──` style used for subsections.

**TODOs:**
Minimal — only 2 found: `skills/vehicle-specs/scripts/specs.js:287` and `skills/whatsapp-gateway/scripts/server.js:117`.

## Function Design

**Size:**
Orchestrator functions are large (100+ lines) due to multi-step pipeline flow. Shared utilities (`contracts.js`, `retry.js`, `logger.js`) are small and focused. Browser automation helpers (`motor-nav.js`, `pt-tab.js`) are large due to step-by-step DOM interaction.

**Parameters:**
Exported functions take a single destructured object parameter:
```js
async function runPlaybook({ customer, vehicle, diagnosis, query, parts, progressCallback }) {
async function searchParts({ vin, partType, partNumber, position, includeOEM, includeAftermarket }) {
```
Internal helpers may use positional params.

**Default Parameters:**
```js
async function withRetry(fn, opts = {}) {
  const maxRetries = opts.maxRetries ?? 2;
  const baseDelay = opts.baseDelay ?? 1000;
```

**Return Values:**
- Skill functions return plain objects: `{ success, data, error }`
- Never throw for expected failures — always return `{ error: "message" }`
- Orchestrator returns a rich result object with nested keys: `results.diagnosis.ai`, `results.parts.bestValueBundle`, `results.estimate`, `results.pdfPath`

## Module Design

**Exports:**
Named exports at the bottom of each file:
```js
module.exports = {
  normalizePrice,
  validateLaborResult,
  validatePartQuote,
  validateEstimateLine,
  mergeResults,
  LABOR_PRECEDENCE,
  PRICING_GATE,
  PRICING_SOURCE,
};
```

**Barrel Files:**
None. Each module exports directly; no index.js re-export files.

**Singleton Pattern:**
Supabase client uses lazy singleton:
```js
let supabaseClient = null;
async function getSupabase() {
  if (supabaseClient) return supabaseClient;
  const { createClient } = require("@supabase/supabase-js");
  supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return supabaseClient;
}
```
Used in `embeddings.js`, `history.js`, and `feedback.js`.

## Environment Variables

**Access Pattern:**
Read directly from `process.env` at module top level, with defaults where applicable:
```js
const AUTOLEAP_API_URL = process.env.AUTOLEAP_API_URL || "https://partnerapi.myautoleap.com/v2";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;  // undefined if not set
```

**Loading from File:**
Gateway servers (`telegram-gateway/scripts/server.js`, `whatsapp-gateway/scripts/server.js`) and test scripts manually parse `config/.env` at startup using a hand-rolled parser (no dotenv library). Guard: `if (!process.env[key]) process.env[key] = val` prevents override of already-set env vars.

**Feature Flags:**
Boolean env flags checked as string comparisons:
```js
const FEAT_SESSION_PREFLIGHT = process.env.SAM_SESSION_PREFLIGHT === "true";
const FEAT_RETRY_ENABLED = process.env.SAM_RETRY_ENABLED === "true";
```

---

*Convention analysis: 2026-03-15*
