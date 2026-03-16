# Testing Patterns

**Analysis Date:** 2026-03-15

## Test Framework

**Runner:**
- Custom hand-rolled runner — no Jest, Vitest, Mocha, or other framework installed
- `package.json` has no test framework dependency and `"test": "echo \"Error: no test specified\" && exit 1"`
- Suite runner: `tests/unit/run.js` — uses `execSync` to run each `test-*.js` file as a child process
- No config file

**Assertion Library:**
- Hand-rolled `assert(condition, message)` function defined locally in every test file:
  ```js
  function assert(cond, msg) {
    if (!cond) throw new Error("FAIL: " + msg);
  }
  ```

**Run Commands:**
```bash
node tests/unit/run.js          # Run all unit tests
node tests/unit/test-retry.js   # Run single unit test suite
node scripts/test-e2e.js        # Run full E2E pipeline test
node scripts/test-e2e.js --customer  # E2E with AutoLeap estimate creation
node scripts/test-playbook.js   # Standalone AutoLeap browser playbook test
node scripts/test-new-vehicle.js    # New vehicle creation test
node scripts/test-telegram-flow.js  # Telegram bot message flow test
```

## Test File Organization

**Location:**
- Unit tests: `tests/unit/test-*.js` — separate from source
- E2E and integration scripts: `scripts/test-*.js` — alongside other utility scripts
- No co-located `*.test.js` or `*.spec.js` files next to source

**Naming:**
- Unit test files: `test-<module-name>.js` (maps to `skills/shared/<module-name>.js`)
- Suite runner: `tests/unit/run.js`

**Structure:**
```
tests/
└── unit/
    ├── run.js                   # Suite runner — discovers and executes test-*.js files
    ├── test-contracts.js        # Tests for skills/shared/contracts.js
    ├── test-health.js           # Tests for skills/shared/health.js
    ├── test-logger.js           # Tests for skills/shared/logger.js
    ├── test-retry.js            # Tests for skills/shared/retry.js
    ├── test-session-manager.js  # Tests for skills/shared/session-manager.js
    └── test-tab-manager.js      # Tests for skills/shared/tab-manager.js

scripts/
    ├── test-e2e.js              # Full pipeline E2E (2019 Honda Civic P0420 + golden cases)
    ├── test-playbook.js         # AutoLeap browser 14-step playbook
    ├── test-new-vehicle.js      # New vehicle creation path
    ├── test-playbook-query.js   # Playbook with query input
    └── test-telegram-flow.js    # Telegram bot simulated conversation
```

## Test Structure

**Suite Organization:**
All unit test files follow the same pattern — `tests` array populated via `test()` helper, then executed serially:
```js
async function runTests() {
  const tests = [];
  let pass = 0, fail = 0;

  function test(name, fn) { tests.push({ name, fn }); }

  test("normalizePrice parses dollar string", () => {
    assert(normalizePrice("$123.45") === 123.45, "$123.45");
  });

  test("withRetry retries on retryable error", async () => {
    let calls = 0;
    silence();
    const result = await withRetry(async () => {
      calls++;
      if (calls < 3) { const err = new Error("timeout"); err.retryable = true; throw err; }
      return "recovered";
    }, { maxRetries: 2, baseDelay: 10 });
    restore();
    assert(result === "recovered", "returns result after retries");
    assert(calls === 3, "called 3 times");
  });

  for (const t of tests) {
    try {
      await t.fn();
      pass++;
      origLog(`  ✓ ${t.name}`);
    } catch (e) {
      fail++;
      origErr(`  ✗ ${t.name}: ${e.message}`);
    }
  }
  console.log(`\nRetry tests: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

runTests();
```

**Suite Runner Pattern (`tests/unit/run.js`):**
```js
const testFiles = fs.readdirSync(testDir)
  .filter((f) => f.startsWith("test-") && f.endsWith(".js"))
  .sort();

for (const file of testFiles) {
  execSync(`node "${filePath}"`, { stdio: "inherit", timeout: 30000, cwd: ... });
}
```

**E2E Test Pattern (`scripts/test-e2e.js`):**
Uses separate `pass(label)`, `fail(label, err)`, `warn(label)` helpers:
```js
let passCount = 0, failCount = 0, warnCount = 0;
function pass(label) { passCount++; console.log(`  ✓ ${label}`); }
function fail(label, err) { failCount++; console.log(`  ✗ ${label}: ${err}`); }
function warn(label) { warnCount++; console.log(`  ⚠ ${label}`); }
```
Calls `process.exit(1)` on any failure; `warn` is non-blocking (for unconfigured optional services).

## Mocking

**Framework:** No mocking library. Console capture and env-var manipulation are done manually.

**Console Silencing (for noisy functions under test):**
```js
const origLog = console.log;
const origErr = console.error;
function silence() { console.log = () => {}; console.error = () => {}; }
function restore() { console.log = origLog; console.error = origErr; }

test("withRetry retries on retryable error", async () => {
  silence();
  // ... code that logs retry attempts ...
  restore();
  assert(result === "recovered", "recovers");
});
```
Used in `test-retry.js` and `test-logger.js`.

**Console Capture (for asserting log output):**
```js
let captured = [];
function capture() {
  captured = [];
  console.log = (...args) => captured.push({ level: "info", args });
  console.error = (...args) => captured.push({ level: "error", args });
}

test("info outputs JSON with correct fields when structured logging enabled", () => {
  process.env.SAM_STRUCTURED_LOGGING = "true";
  const log = createLogger("test-skill", "run-123");
  capture();
  log.info("hello world", { extra: 42 });
  restore();
  const parsed = JSON.parse(captured[0].args[0]);
  assert(parsed.skill === "test-skill", "skill field");
});
```
Used in `test-logger.js`.

**Env Var Manipulation:**
Set and restore env vars around tests that are sensitive to configuration:
```js
test("preflight returns status for all enabled platforms", async () => {
  const origAL = process.env.AUTOLEAP_EMAIL;
  delete process.env.AUTOLEAP_EMAIL;
  // ... test with platform disabled ...
  if (origAL) process.env.AUTOLEAP_EMAIL = origAL;
});
```
Used in `test-session-manager.js`.

**Time-based Testing:**
Circuit breaker cooldown tests use real `setTimeout` with short delays (80-100ms):
```js
test("circuitBreaker resets after cooldown", async () => {
  const breaker = circuitBreaker("cooldown-platform", { failThreshold: 2, cooldownMs: 80 });
  // ... trip the breaker ...
  await new Promise(r => setTimeout(r, 100));   // wait for cooldown
  const result = await breaker.call(async () => "recovered");
  assert(result === "recovered", "recovered after cooldown");
});
```

**What to Mock:**
- Console output when testing code that logs internally (silence/capture pattern)
- Env vars for platform enable/disable testing
- No HTTP mocking — E2E tests hit real services or degrade gracefully when unconfigured

**What NOT to Mock:**
- Real module behavior under test — tests call actual `withRetry`, `normalizePrice`, etc.
- Filesystem reads in E2E tests — real PDF path checked with `fs.existsSync`
- Supabase calls — E2E requires real `SUPABASE_URL` + `SUPABASE_ANON_KEY`

## Fixtures and Factories

**Test Data:**
Inline objects defined directly in test cases. No shared fixture files.

**E2E Scenarios (defined in `scripts/test-e2e.js`):**
```js
const testParams = {
  year: 2019, make: "Honda", model: "Civic", engine: "2.0L",
  cylinders: 4, fuelType: "gas", transmission: "CVT", driveType: "FWD",
  mileage: 87000,
  query: "P0420 catalyst system efficiency below threshold bank 1",
};

const goldenCases = [
  { name: "RAV4 Catalytic Converter",
    params: { year: 2019, make: "Toyota", model: "RAV4", ... },
    expect: { laborMin: 1.0, laborMax: 5.0, hasParts: true } },
  { name: "Prius Brake Pads", ... },
  { name: "F-150 Misfire", ... },
  { name: "Bolt EV Battery", ..., expect: { evExcluded: true } },
  { name: "Accord Water Pump", ... },
];
```

**Location:**
All fixtures are inline in test files. No `fixtures/` or `__fixtures__/` directory.

## Coverage

**Requirements:** None enforced — no coverage tooling configured.

**View Coverage:**
```bash
# No coverage command available — not configured
```

## Test Types

**Unit Tests (`tests/unit/`):**
- Scope: `skills/shared/` modules only — `contracts.js`, `retry.js`, `logger.js`, `health.js`, `session-manager.js`, and `tab-manager.js`
- Pure logic tests: no I/O, no network, no filesystem (except `health.js` which checks CDP socket + disk)
- Run in ~1s total
- Skill-level business logic (diagnose, estimate building, browser automation) has no unit tests

**Integration/E2E Tests (`scripts/test-*.js`):**
- `test-e2e.js`: Full pipeline test requiring live Supabase. Validates: orchestrator load, pipeline completion, diagnosis shape, graceful degradation for all optional platforms, 5 golden case scenarios, degraded mode
- `test-playbook.js`: Live browser automation test requiring Chrome CDP on port 18800 and AutoLeap login
- `test-telegram-flow.js`: Simulated Telegram webhook message flow
- All E2E scripts manually parse `config/.env`

## Common Patterns

**Async Testing:**
All test functions are `async` even when not needed — the runner `await t.fn()` handles both:
```js
test("TabManager tracks tab ownership", () => {   // sync fn, awaited by runner
  const tm = new TabManager();
  tm.register("tab-1", "partstech", "run-abc");
  assert(tm.getInfo("tab-1").platform === "partstech", "platform");
});

test("withRetry succeeds on first attempt", async () => {  // async fn
  const result = await withRetry(async () => "ok", { maxRetries: 2 });
  assert(result === "ok", "returns result");
});
```

**Error Testing:**
Use try/catch within the test function body:
```js
test("withRetry does not retry terminal errors", async () => {
  let calls = 0;
  silence();
  try {
    await withRetry(async () => {
      calls++;
      const err = new Error("auth failed");
      err.retryable = false;
      throw err;
    }, { maxRetries: 2, baseDelay: 10 });
    assert(false, "should have thrown");
  } catch (e) {
    restore();
    assert(e.message === "auth failed", "original error");
    assert(calls === 1, "no retry");
  }
});
```

**Graceful Degradation Assertions (E2E):**
The E2E runner treats unconfigured optional services as warnings (not failures):
```js
if (results.diagnosis.alldata) {
  if (results.diagnosis.alldata.error) {
    pass(`AllData: gracefully degraded — ${results.diagnosis.alldata.error}`);
  } else {
    pass(`AllData: ${results.diagnosis.alldata.procedures?.length || 0} procedures`);
  }
}
```
This means the E2E test suite passes with 0 optional services configured.

## Coverage Gaps

The following are not tested at unit level:
- `skills/ai-diagnostics/scripts/diagnose.js` — core diagnostic engine
- `skills/estimate-builder/scripts/orchestrator.js` — master pipeline
- `skills/autoleap-browser/scripts/playbook.js` — 14-step browser playbook
- `skills/partstech-search/scripts/search.js` — PartsTech REST integration
- All gateway servers (`telegram-gateway`, `whatsapp-gateway`)
- All seed scripts
- All browser skills (`alldata-lookup`, `identifix-search`, `prodemand-lookup`, `ari-labor`)

---

*Testing analysis: 2026-03-15*
