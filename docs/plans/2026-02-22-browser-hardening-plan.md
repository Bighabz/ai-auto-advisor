# Browser Automation Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the SAM estimate pipeline production-reliable with structured logging, session healing, retry/circuit-breaker, data contracts, progress UX, and runtime hardening — all behind feature flags.

**Architecture:** New shared modules in `skills/shared/` (logger, retry, contracts, session-manager, tab-manager, health) that each skill imports. Orchestrator gets a RunContext with correlation ID. Feature flags gate new behavior so existing pipeline is unchanged until explicitly enabled.

**Tech Stack:** Node.js CommonJS, puppeteer-core (CDP port 18800), OpenClaw CLI, Telegram Bot API, systemd on Pi.

---

## Phase 1: Shared Infrastructure Modules

### Task 1: Create structured logger module

**Files:**
- Create: `skills/shared/logger.js`
- Create: `tests/unit/test-logger.js`

**Step 1: Write the failing test**

```javascript
// tests/unit/test-logger.js
const { createLogger } = require("../../skills/shared/logger");

let captured = [];
const origLog = console.log;
const origErr = console.error;

function capture() {
  captured = [];
  console.log = (...args) => captured.push({ level: "info", args });
  console.error = (...args) => captured.push({ level: "error", args });
}
function restore() {
  console.log = origLog;
  console.error = origErr;
}

function assert(cond, msg) {
  if (!cond) { restore(); throw new Error("FAIL: " + msg); }
}

async function runTests() {
  const tests = [];
  let pass = 0, fail = 0;

  function test(name, fn) { tests.push({ name, fn }); }

  test("createLogger returns object with expected methods", () => {
    const log = createLogger("test-skill");
    assert(typeof log.info === "function", "info is function");
    assert(typeof log.warn === "function", "warn is function");
    assert(typeof log.error === "function", "error is function");
    assert(typeof log.step === "function", "step is function");
    assert(typeof log.metric === "function", "metric is function");
  });

  test("info outputs JSON with correct fields when structured logging enabled", () => {
    process.env.SAM_STRUCTURED_LOGGING = "true";
    const log = createLogger("test-skill", "run-123");
    capture();
    log.info("hello world", { extra: 42 });
    restore();
    assert(captured.length === 1, "one log entry");
    const parsed = JSON.parse(captured[0].args[0]);
    assert(parsed.skill === "test-skill", "skill field");
    assert(parsed.runId === "run-123", "runId field");
    assert(parsed.level === "info", "level field");
    assert(parsed.msg === "hello world", "msg field");
    assert(parsed.extra === 42, "extra field");
    assert(typeof parsed.ts === "string", "timestamp present");
    delete process.env.SAM_STRUCTURED_LOGGING;
  });

  test("info falls back to console.log prefix when structured logging disabled", () => {
    delete process.env.SAM_STRUCTURED_LOGGING;
    const log = createLogger("test-skill", "run-456");
    capture();
    log.info("fallback msg");
    restore();
    assert(captured.length === 1, "one log entry");
    assert(captured[0].level === "info", "uses console.log");
    const out = captured[0].args[0];
    assert(out.includes("[test-skill]"), "has prefix");
    assert(out.includes("fallback msg"), "has message");
  });

  test("error outputs to stderr", () => {
    process.env.SAM_STRUCTURED_LOGGING = "true";
    const log = createLogger("test-skill", "run-789");
    capture();
    log.error("boom", { code: "TIMEOUT" });
    restore();
    assert(captured.length === 1, "one entry");
    assert(captured[0].level === "error", "uses console.error");
    const parsed = JSON.parse(captured[0].args[0]);
    assert(parsed.level === "error", "error level");
    assert(parsed.code === "TIMEOUT", "extra field");
    delete process.env.SAM_STRUCTURED_LOGGING;
  });

  test("step() returns end function that logs duration", async () => {
    process.env.SAM_STRUCTURED_LOGGING = "true";
    const log = createLogger("test-skill", "run-abc");
    capture();
    const end = log.step("search_parts");
    await new Promise(r => setTimeout(r, 50));
    end({ outcome: "ok", parts: 3 });
    restore();
    assert(captured.length === 1, "one entry from end()");
    const parsed = JSON.parse(captured[0].args[0]);
    assert(parsed.step === "search_parts", "step name");
    assert(parsed.outcome === "ok", "outcome");
    assert(parsed.parts === 3, "extra");
    assert(typeof parsed.duration_ms === "number", "has duration");
    assert(parsed.duration_ms >= 40, "duration >= 40ms");
    delete process.env.SAM_STRUCTURED_LOGGING;
  });

  test("metric() logs with type=metric", () => {
    process.env.SAM_STRUCTURED_LOGGING = "true";
    const log = createLogger("orchestrator", "run-m1");
    capture();
    log.metric({ parts_priced_rate: 0.8, total_runtime_ms: 45000 });
    restore();
    const parsed = JSON.parse(captured[0].args[0]);
    assert(parsed.type === "metric", "type=metric");
    assert(parsed.parts_priced_rate === 0.8, "metric value");
    delete process.env.SAM_STRUCTURED_LOGGING;
  });

  // Run
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
  origLog(`\nLogger tests: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

runTests();
```

**Step 2: Run test to verify it fails**

Run: `node tests/unit/test-logger.js`
Expected: FAIL with "Cannot find module '../../skills/shared/logger'"

**Step 3: Write minimal implementation**

```javascript
// skills/shared/logger.js
"use strict";

const crypto = require("crypto");

function generateRunId() {
  return crypto.randomBytes(6).toString("hex");
}

function isStructuredLogging() {
  return process.env.SAM_STRUCTURED_LOGGING === "true";
}

function createLogger(skillName, runId) {
  const rid = runId || null;

  function emit(level, msg, extra) {
    if (isStructuredLogging()) {
      const entry = {
        ts: new Date().toISOString(),
        level,
        skill: skillName,
        runId: rid,
        msg,
        ...extra,
      };
      const out = JSON.stringify(entry);
      if (level === "error") {
        console.error(out);
      } else {
        console.log(out);
      }
    } else {
      // Legacy format: [skill-name] message
      const prefix = `[${skillName}]`;
      const parts = [prefix, msg];
      if (extra && Object.keys(extra).length > 0) {
        parts.push(JSON.stringify(extra));
      }
      if (level === "error") {
        console.error(parts.join(" "));
      } else {
        console.log(parts.join(" "));
      }
    }
  }

  return {
    info(msg, extra) {
      emit("info", msg, extra);
    },

    warn(msg, extra) {
      emit("warn", msg, extra);
    },

    error(msg, extra) {
      emit("error", msg, extra);
    },

    step(stepName) {
      const start = Date.now();
      return function end(extra) {
        const duration_ms = Date.now() - start;
        emit("info", `step:${stepName}`, { step: stepName, duration_ms, ...extra });
      };
    },

    metric(data) {
      emit("info", "pipeline_metric", { type: "metric", ...data });
    },
  };
}

module.exports = { createLogger, generateRunId };
```

**Step 4: Run test to verify it passes**

Run: `node tests/unit/test-logger.js`
Expected: All 6 tests pass

**Step 5: Commit**

```bash
git add skills/shared/logger.js tests/unit/test-logger.js
git commit -m "feat: add structured logger module with feature flag"
```

---

### Task 2: Create retry and circuit breaker module

**Files:**
- Create: `skills/shared/retry.js`
- Create: `tests/unit/test-retry.js`

**Step 1: Write the failing test**

```javascript
// tests/unit/test-retry.js
const { withRetry, circuitBreaker, FailureClass } = require("../../skills/shared/retry");

const origLog = console.log;
const origErr = console.error;
function silence() { console.log = () => {}; console.error = () => {}; }
function restore() { console.log = origLog; console.error = origErr; }

function assert(cond, msg) {
  if (!cond) { restore(); throw new Error("FAIL: " + msg); }
}

async function runTests() {
  const tests = [];
  let pass = 0, fail = 0;

  function test(name, fn) { tests.push({ name, fn }); }

  // --- withRetry tests ---

  test("withRetry succeeds on first attempt", async () => {
    let calls = 0;
    const result = await withRetry(async () => { calls++; return "ok"; }, { maxRetries: 2 });
    assert(result === "ok", "returns result");
    assert(calls === 1, "called once");
  });

  test("withRetry retries on retryable error", async () => {
    let calls = 0;
    silence();
    const result = await withRetry(async () => {
      calls++;
      if (calls < 3) {
        const err = new Error("timeout");
        err.retryable = true;
        throw err;
      }
      return "recovered";
    }, { maxRetries: 2, baseDelay: 10 });
    restore();
    assert(result === "recovered", "returns result after retries");
    assert(calls === 3, "called 3 times");
  });

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

  test("withRetry throws after max retries exhausted", async () => {
    let calls = 0;
    silence();
    try {
      await withRetry(async () => {
        calls++;
        const err = new Error("timeout");
        err.retryable = true;
        throw err;
      }, { maxRetries: 2, baseDelay: 10 });
      assert(false, "should have thrown");
    } catch (e) {
      restore();
      assert(calls === 3, "original + 2 retries");
      assert(e.message === "timeout", "last error");
    }
  });

  // --- classifyError tests ---

  test("FailureClass classifies errors correctly", () => {
    assert(FailureClass.isRetryable("TIMEOUT"), "TIMEOUT is retryable");
    assert(FailureClass.isRetryable("STALE_TAB"), "STALE_TAB is retryable");
    assert(FailureClass.isRetryable("NETWORK"), "NETWORK is retryable");
    assert(!FailureClass.isRetryable("AUTH_FAILED"), "AUTH_FAILED is terminal");
    assert(!FailureClass.isRetryable("PLATFORM_DOWN"), "PLATFORM_DOWN is terminal");
    assert(!FailureClass.isRetryable("NOT_FOUND"), "NOT_FOUND is terminal");
    assert(!FailureClass.isRetryable("PARSE_ERROR"), "PARSE_ERROR is terminal");
  });

  // --- circuitBreaker tests ---

  test("circuitBreaker passes through on success", async () => {
    const breaker = circuitBreaker("test-platform", { failThreshold: 3, cooldownMs: 100 });
    const result = await breaker.call(async () => "ok");
    assert(result === "ok", "passes through");
  });

  test("circuitBreaker opens after N failures", async () => {
    const breaker = circuitBreaker("fail-platform", { failThreshold: 3, cooldownMs: 100 });
    silence();
    for (let i = 0; i < 3; i++) {
      try { await breaker.call(async () => { throw new Error("down"); }); } catch {}
    }
    try {
      await breaker.call(async () => "ok");
      restore();
      assert(false, "should have thrown CIRCUIT_OPEN");
    } catch (e) {
      restore();
      assert(e.reason_code === "CIRCUIT_OPEN", "circuit open error");
    }
  });

  test("circuitBreaker resets after cooldown", async () => {
    const breaker = circuitBreaker("cooldown-platform", { failThreshold: 2, cooldownMs: 80 });
    silence();
    for (let i = 0; i < 2; i++) {
      try { await breaker.call(async () => { throw new Error("down"); }); } catch {}
    }
    await new Promise(r => setTimeout(r, 100));
    const result = await breaker.call(async () => "recovered");
    restore();
    assert(result === "recovered", "recovered after cooldown");
  });

  // Run
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
  origLog(`\nRetry tests: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

runTests();
```

**Step 2: Run test to verify it fails**

Run: `node tests/unit/test-retry.js`
Expected: FAIL with "Cannot find module '../../skills/shared/retry'"

**Step 3: Write minimal implementation**

```javascript
// skills/shared/retry.js
"use strict";

const RETRYABLE = new Set(["TIMEOUT", "STALE_TAB", "NETWORK"]);
const TERMINAL = new Set(["AUTH_FAILED", "PLATFORM_DOWN", "NOT_FOUND", "PARSE_ERROR"]);

const FailureClass = {
  TIMEOUT: "TIMEOUT",
  STALE_TAB: "STALE_TAB",
  NETWORK: "NETWORK",
  AUTH_FAILED: "AUTH_FAILED",
  PLATFORM_DOWN: "PLATFORM_DOWN",
  NOT_FOUND: "NOT_FOUND",
  PARSE_ERROR: "PARSE_ERROR",

  isRetryable(code) {
    return RETRYABLE.has(code);
  },

  classify(err) {
    const msg = (err.message || "").toLowerCase();
    if (err.reason_code) return err.reason_code;
    if (msg.includes("timeout") || msg.includes("timed out")) return "TIMEOUT";
    if (msg.includes("login") || msg.includes("redirect")) return "STALE_TAB";
    if (msg.includes("econnrefused") || msg.includes("enotfound") || msg.includes("network")) return "NETWORK";
    if (msg.includes("401") || msg.includes("403") || msg.includes("auth")) return "AUTH_FAILED";
    if (msg.includes("503") || msg.includes("maintenance")) return "PLATFORM_DOWN";
    if (msg.includes("not found") || msg.includes("no results")) return "NOT_FOUND";
    return "UNKNOWN";
  },
};

/**
 * Retry a function with exponential backoff and jitter.
 * @param {Function} fn - async function to retry
 * @param {Object} opts - { maxRetries: 2, baseDelay: 1000, jitter: 0.2 }
 */
async function withRetry(fn, opts = {}) {
  const maxRetries = opts.maxRetries ?? 2;
  const baseDelay = opts.baseDelay ?? 1000;
  const jitter = opts.jitter ?? 0.2;

  let lastError;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;

      // Check if explicitly marked non-retryable
      if (err.retryable === false) throw err;

      // Check if failure class is terminal
      const code = err.reason_code || FailureClass.classify(err);
      if (!FailureClass.isRetryable(code) && err.retryable !== true) throw err;

      if (attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt);
        const jittered = delay * (1 + (Math.random() * 2 - 1) * jitter);
        console.log(`[retry] attempt ${attempt + 1}/${maxRetries} failed (${code}), retrying in ${Math.round(jittered)}ms`);
        await new Promise((r) => setTimeout(r, jittered));
      }
    }
  }
  throw lastError;
}

/**
 * Circuit breaker: fail fast after N consecutive failures.
 * @param {string} name - platform name for logging
 * @param {Object} opts - { failThreshold: 3, cooldownMs: 120000 }
 */
function circuitBreaker(name, opts = {}) {
  const failThreshold = opts.failThreshold ?? 3;
  const cooldownMs = opts.cooldownMs ?? 120000;

  let failures = 0;
  let openedAt = null;

  return {
    async call(fn) {
      // Check if circuit is open
      if (openedAt) {
        const elapsed = Date.now() - openedAt;
        if (elapsed < cooldownMs) {
          const err = new Error(`Circuit open for ${name} — cooling down (${Math.round((cooldownMs - elapsed) / 1000)}s remaining)`);
          err.reason_code = "CIRCUIT_OPEN";
          throw err;
        }
        // Half-open: allow probe
        openedAt = null;
        failures = 0;
      }

      try {
        const result = await fn();
        failures = 0; // Reset on success
        return result;
      } catch (err) {
        failures++;
        if (failures >= failThreshold) {
          openedAt = Date.now();
          console.error(`[circuit-breaker] ${name}: circuit OPEN after ${failures} failures`);
        }
        throw err;
      }
    },

    getState() {
      if (openedAt) {
        return Date.now() - openedAt < cooldownMs ? "open" : "half-open";
      }
      return failures > 0 ? "degraded" : "closed";
    },

    reset() {
      failures = 0;
      openedAt = null;
    },
  };
}

module.exports = { withRetry, circuitBreaker, FailureClass };
```

**Step 4: Run test to verify it passes**

Run: `node tests/unit/test-retry.js`
Expected: All 8 tests pass

**Step 5: Commit**

```bash
git add skills/shared/retry.js tests/unit/test-retry.js
git commit -m "feat: add retry with backoff and circuit breaker module"
```

---

### Task 3: Create data contracts module

**Files:**
- Create: `skills/shared/contracts.js`
- Create: `tests/unit/test-contracts.js`

**Step 1: Write the failing test**

```javascript
// tests/unit/test-contracts.js
const {
  validateLaborResult,
  validatePartQuote,
  validateEstimateLine,
  normalizePrice,
  mergeResults,
} = require("../../skills/shared/contracts");

function assert(cond, msg) {
  if (!cond) throw new Error("FAIL: " + msg);
}

async function runTests() {
  const tests = [];
  let pass = 0, fail = 0;

  function test(name, fn) { tests.push({ name, fn }); }

  // --- normalizePrice ---

  test("normalizePrice parses dollar string", () => {
    assert(normalizePrice("$123.45") === 123.45, "$123.45");
  });

  test("normalizePrice parses comma format", () => {
    assert(normalizePrice("$1,234.56") === 1234.56, "$1,234.56");
  });

  test("normalizePrice parses plain number", () => {
    assert(normalizePrice(42.5) === 42.5, "number passthrough");
  });

  test("normalizePrice returns null for garbage", () => {
    assert(normalizePrice("N/A") === null, "N/A");
    assert(normalizePrice("") === null, "empty string");
    assert(normalizePrice(null) === null, "null");
    assert(normalizePrice(undefined) === null, "undefined");
    assert(normalizePrice("Call for availability") === null, "call text");
  });

  test("normalizePrice returns null for zero/negative", () => {
    assert(normalizePrice("$0.00") === null, "zero");
    assert(normalizePrice("-5") === null, "negative");
  });

  // --- validateLaborResult ---

  test("validateLaborResult normalizes valid input", () => {
    const result = validateLaborResult({
      hours: "2.5",
      operation: "Catalytic Converter R&R",
      source: "MOTOR",
    });
    assert(result.hours === 2.5, "hours parsed");
    assert(result.operation === "Catalytic Converter R&R", "operation");
    assert(result.source === "MOTOR", "source");
    assert(result.confidence === 1, "default confidence");
    assert(result.reason_code === null, "no error");
  });

  test("validateLaborResult returns default on bad input", () => {
    const result = validateLaborResult({});
    assert(result.hours === 0, "default hours");
    assert(result.source === "unknown", "unknown source");
    assert(result.reason_code === "INVALID_LABOR", "flagged invalid");
  });

  // --- validatePartQuote ---

  test("validatePartQuote normalizes valid input", () => {
    const result = validatePartQuote({
      brand: "Dorman",
      part_number: "674-831",
      supplier: "AutoZone",
      unit_price: "$245.99",
      availability: "In Stock",
    });
    assert(result.brand === "Dorman", "brand");
    assert(result.unit_price === 245.99, "price normalized");
    assert(result.source === "partstech", "default source");
    assert(result.reason_code === null, "no error");
  });

  test("validatePartQuote flags unpriceable items", () => {
    const result = validatePartQuote({
      brand: "Dorman",
      part_number: "674-831",
      unit_price: "Call for availability",
    });
    assert(result.unit_price === null, "null price");
    assert(result.reason_code === "NO_PRICE", "flagged");
  });

  // --- validateEstimateLine ---

  test("validateEstimateLine computes total", () => {
    const result = validateEstimateLine({
      type: "part",
      description: "Catalytic Converter",
      qty: 1,
      unit_price: 245.99,
      source: "partstech",
    });
    assert(result.total === 245.99, "total = qty * unit_price");
  });

  // --- mergeResults ---

  test("mergeResults creates new object (no mutation)", () => {
    const base = { labor: { hours: 1.5, source: "AI_fallback" } };
    const overlay = { labor: { hours: 2.5, source: "MOTOR" } };
    const merged = mergeResults(base, overlay);
    assert(merged.labor.source === "MOTOR", "overlay wins");
    assert(base.labor.source === "AI_fallback", "base unchanged");
  });

  test("mergeResults respects source precedence for labor", () => {
    const base = { labor: { hours: 2.5, source: "MOTOR" } };
    const overlay = { labor: { hours: 1.5, source: "AI_fallback" } };
    const merged = mergeResults(base, overlay);
    assert(merged.labor.source === "MOTOR", "MOTOR wins over AI");
    assert(merged.labor.hours === 2.5, "keeps MOTOR hours");
  });

  // Run
  for (const t of tests) {
    try {
      await t.fn();
      pass++;
      console.log(`  ✓ ${t.name}`);
    } catch (e) {
      fail++;
      console.error(`  ✗ ${t.name}: ${e.message}`);
    }
  }
  console.log(`\nContracts tests: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

runTests();
```

**Step 2: Run test to verify it fails**

Run: `node tests/unit/test-contracts.js`
Expected: FAIL with "Cannot find module '../../skills/shared/contracts'"

**Step 3: Write minimal implementation**

```javascript
// skills/shared/contracts.js
"use strict";

const LABOR_PRECEDENCE = ["MOTOR", "shop_default", "AI_fallback", "default"];

/**
 * Safely parse a price string/number to a positive number or null.
 */
function normalizePrice(raw) {
  if (raw == null) return null;
  if (typeof raw === "number") return raw > 0 ? raw : null;
  const str = String(raw).trim();
  if (!str) return null;
  // Reject non-numeric text
  const cleaned = str.replace(/[$,]/g, "");
  const num = parseFloat(cleaned);
  if (isNaN(num) || num <= 0) return null;
  return Math.round(num * 100) / 100;
}

/**
 * Validate and normalize a labor result from ProDemand or other sources.
 */
function validateLaborResult(raw) {
  if (!raw || typeof raw !== "object") {
    return { hours: 0, operation: "", source: "unknown", confidence: 0, reason_code: "INVALID_LABOR" };
  }
  const hours = typeof raw.hours === "number" ? raw.hours : parseFloat(raw.hours);
  return {
    hours: isNaN(hours) || hours < 0 ? 0 : hours,
    operation: raw.operation || raw.procedure || "",
    source: raw.source || "unknown",
    confidence: typeof raw.confidence === "number" ? raw.confidence : (raw.source === "MOTOR" ? 1 : 0.5),
    reason_code: (!hours && hours !== 0) || isNaN(hours) ? "INVALID_LABOR" : null,
  };
}

/**
 * Validate and normalize a part quote from PartsTech or other sources.
 */
function validatePartQuote(raw) {
  if (!raw || typeof raw !== "object") {
    return { brand: "", part_number: "", supplier: "", unit_price: null, availability: "", source: "unknown", reason_code: "INVALID_PART" };
  }
  const price = normalizePrice(raw.unit_price || raw.price);
  return {
    brand: raw.brand || "",
    part_number: raw.part_number || raw.partNumber || "",
    supplier: raw.supplier || "",
    unit_price: price,
    availability: raw.availability || raw.stock || "",
    source: raw.source || "partstech",
    reason_code: price === null ? "NO_PRICE" : null,
  };
}

/**
 * Validate and normalize an estimate line item.
 */
function validateEstimateLine(raw) {
  if (!raw || typeof raw !== "object") {
    return { type: "unknown", description: "", qty: 0, unit_price: 0, total: 0, source: "unknown" };
  }
  const qty = typeof raw.qty === "number" ? raw.qty : parseInt(raw.qty, 10) || 1;
  const unit_price = typeof raw.unit_price === "number" ? raw.unit_price : normalizePrice(raw.unit_price) || 0;
  return {
    type: raw.type || "unknown",
    description: raw.description || "",
    qty,
    unit_price,
    total: Math.round(qty * unit_price * 100) / 100,
    source: raw.source || "unknown",
  };
}

/**
 * Merge two result objects with source precedence.
 * Returns a new object — never mutates base or overlay.
 */
function mergeResults(base, overlay) {
  const merged = JSON.parse(JSON.stringify(base));

  for (const key of Object.keys(overlay)) {
    if (key === "labor" && merged.labor && overlay.labor) {
      // Use source precedence for labor
      const baseIdx = LABOR_PRECEDENCE.indexOf(merged.labor.source);
      const overlayIdx = LABOR_PRECEDENCE.indexOf(overlay.labor.source);
      // Lower index = higher priority. -1 means unknown (lowest priority).
      const basePri = baseIdx === -1 ? 999 : baseIdx;
      const overlayPri = overlayIdx === -1 ? 999 : overlayIdx;
      if (overlayPri <= basePri) {
        merged.labor = JSON.parse(JSON.stringify(overlay.labor));
      }
    } else if (overlay[key] !== undefined) {
      merged[key] = JSON.parse(JSON.stringify(overlay[key]));
    }
  }

  return merged;
}

module.exports = {
  normalizePrice,
  validateLaborResult,
  validatePartQuote,
  validateEstimateLine,
  mergeResults,
  LABOR_PRECEDENCE,
};
```

**Step 4: Run test to verify it passes**

Run: `node tests/unit/test-contracts.js`
Expected: All 12 tests pass

**Step 5: Commit**

```bash
git add skills/shared/contracts.js tests/unit/test-contracts.js
git commit -m "feat: add data contracts module with validation and source precedence"
```

---

### Task 4: Create session manager module

**Files:**
- Create: `skills/shared/session-manager.js`
- Create: `tests/unit/test-session-manager.js`

**Step 1: Write the failing test**

```javascript
// tests/unit/test-session-manager.js
const { SessionManager } = require("../../skills/shared/session-manager");

function assert(cond, msg) {
  if (!cond) throw new Error("FAIL: " + msg);
}

async function runTests() {
  const tests = [];
  let pass = 0, fail = 0;

  function test(name, fn) { tests.push({ name, fn }); }

  test("SessionManager creates with platform configs", () => {
    const sm = new SessionManager({ logger: null });
    assert(typeof sm.checkAuth === "function", "has checkAuth");
    assert(typeof sm.healAuth === "function", "has healAuth");
    assert(typeof sm.preflight === "function", "has preflight");
  });

  test("checkAuth returns unauthenticated for unconfigured platform", async () => {
    const sm = new SessionManager({ logger: null });
    const result = await sm.checkAuth("unknown_platform");
    assert(result.authenticated === false, "not authenticated");
    assert(result.reason_code === "PLATFORM_NOT_CONFIGURED", "correct reason");
  });

  test("preflight returns status for all enabled platforms", async () => {
    // With no env vars set, all platforms should be disabled
    const origAL = process.env.AUTOLEAP_EMAIL;
    const origPT = process.env.PARTSTECH_USERNAME;
    const origPD = process.env.PRODEMAND_USERNAME;
    delete process.env.AUTOLEAP_EMAIL;
    delete process.env.PARTSTECH_USERNAME;
    delete process.env.PRODEMAND_USERNAME;

    const sm = new SessionManager({ logger: null });
    const result = await sm.preflight();
    assert(typeof result === "object", "returns object");
    assert(result.autoleap?.reason_code === "PLATFORM_DISABLED", "autoleap disabled");
    assert(result.partstech?.reason_code === "PLATFORM_DISABLED", "partstech disabled");
    assert(result.prodemand?.reason_code === "PLATFORM_DISABLED", "prodemand disabled");

    // Restore
    if (origAL) process.env.AUTOLEAP_EMAIL = origAL;
    if (origPT) process.env.PARTSTECH_USERNAME = origPT;
    if (origPD) process.env.PRODEMAND_USERNAME = origPD;
  });

  test("healAuth returns failure for unconfigured platform", async () => {
    const sm = new SessionManager({ logger: null });
    const result = await sm.healAuth("unknown_platform");
    assert(result.success === false, "heal failed");
    assert(result.reason_code === "PLATFORM_NOT_CONFIGURED", "correct reason");
  });

  // Run
  for (const t of tests) {
    try {
      await t.fn();
      pass++;
      console.log(`  ✓ ${t.name}`);
    } catch (e) {
      fail++;
      console.error(`  ✗ ${t.name}: ${e.message}`);
    }
  }
  console.log(`\nSession manager tests: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

runTests();
```

**Step 2: Run test to verify it fails**

Run: `node tests/unit/test-session-manager.js`
Expected: FAIL with "Cannot find module"

**Step 3: Write minimal implementation**

```javascript
// skills/shared/session-manager.js
"use strict";

const net = require("net");

const CHROME_CDP_PORT = parseInt(process.env.CHROME_DEBUG_PORT, 10) || 18800;

/**
 * Check if Chrome CDP is reachable on the configured port.
 */
function checkCDP() {
  return new Promise((resolve) => {
    const sock = net.createConnection({ host: "127.0.0.1", port: CHROME_CDP_PORT }, () => {
      sock.destroy();
      resolve(true);
    });
    sock.on("error", () => resolve(false));
    sock.setTimeout(3000, () => { sock.destroy(); resolve(false); });
  });
}

class SessionManager {
  constructor({ logger }) {
    this.log = logger || { info() {}, warn() {}, error() {}, step() { return () => {}; } };
    this.platforms = {
      autoleap: { enabled: !!process.env.AUTOLEAP_EMAIL },
      partstech: { enabled: !!process.env.PARTSTECH_USERNAME },
      prodemand: { enabled: !!process.env.PRODEMAND_USERNAME },
    };
  }

  /**
   * Check authentication status for a platform.
   * Returns { authenticated: bool, reason_code: string|null }
   */
  async checkAuth(platform) {
    const config = this.platforms[platform];
    if (!config) {
      return { authenticated: false, reason_code: "PLATFORM_NOT_CONFIGURED" };
    }
    if (!config.enabled) {
      return { authenticated: false, reason_code: "PLATFORM_DISABLED" };
    }

    try {
      switch (platform) {
        case "autoleap":
          return await this._checkAutoLeap();
        case "partstech":
          return await this._checkPartsTech();
        case "prodemand":
          return await this._checkProDemand();
        default:
          return { authenticated: false, reason_code: "PLATFORM_NOT_CONFIGURED" };
      }
    } catch (err) {
      return { authenticated: false, reason_code: "CHECK_ERROR", error: err.message };
    }
  }

  /**
   * Attempt to heal authentication for a platform.
   * Returns { success: bool, reason_code: string|null }
   */
  async healAuth(platform) {
    const config = this.platforms[platform];
    if (!config || !config.enabled) {
      return { success: false, reason_code: config ? "PLATFORM_DISABLED" : "PLATFORM_NOT_CONFIGURED" };
    }

    try {
      switch (platform) {
        case "autoleap":
          return await this._healAutoLeap();
        case "partstech":
          return await this._healPartsTech();
        case "prodemand":
          return await this._healProDemand();
        default:
          return { success: false, reason_code: "PLATFORM_NOT_CONFIGURED" };
      }
    } catch (err) {
      return { success: false, reason_code: "HEAL_ERROR", error: err.message };
    }
  }

  /**
   * Run preflight checks for all enabled platforms.
   * Returns { platform_name: { authenticated, reason_code, healed? } }
   */
  async preflight() {
    const cdpAlive = await checkCDP();
    const status = { cdp: cdpAlive };

    for (const [name, config] of Object.entries(this.platforms)) {
      if (!config.enabled) {
        status[name] = { authenticated: false, reason_code: "PLATFORM_DISABLED" };
        continue;
      }

      if (!cdpAlive && name !== "autoleap") {
        // PartsTech and ProDemand need browser
        status[name] = { authenticated: false, reason_code: "CDP_UNREACHABLE" };
        continue;
      }

      const check = await this.checkAuth(name);
      if (check.authenticated) {
        status[name] = check;
        continue;
      }

      // Try to heal
      this.log.warn(`${name} auth failed (${check.reason_code}), attempting heal`);
      const heal = await this.healAuth(name);
      status[name] = {
        authenticated: heal.success,
        reason_code: heal.success ? "HEALED" : heal.reason_code,
        healed: heal.success,
      };
    }

    this.log.info("preflight complete", status);
    return status;
  }

  // --- Private platform-specific checks ---
  // These will be wired to actual browser/API checks in the integration phase.
  // For now they provide the interface and return safe defaults.

  async _checkAutoLeap() {
    // Check if cached token exists and is not expired
    const fs = require("fs");
    const os = require("os");
    const path = require("path");
    const tokenPath = path.join(os.tmpdir(), "autoleap-token.json");
    try {
      const data = JSON.parse(fs.readFileSync(tokenPath, "utf8"));
      const expiresAt = data.expiresAt || 0;
      if (Date.now() < expiresAt - 5 * 60 * 1000) {
        return { authenticated: true, reason_code: null, token_source: "cache" };
      }
      return { authenticated: false, reason_code: "TOKEN_EXPIRED" };
    } catch {
      return { authenticated: false, reason_code: "NO_TOKEN_CACHE" };
    }
  }

  async _checkPartsTech() {
    // PartsTech sessions are tab-scoped. We can only verify by checking tab state.
    // During integration, this will use puppeteer to check tab URL.
    return { authenticated: false, reason_code: "NEEDS_BROWSER_CHECK" };
  }

  async _checkProDemand() {
    // ProDemand session lives in browser sessionStorage.
    // During integration, this will check for www2.prodemand.com tab.
    return { authenticated: false, reason_code: "NEEDS_BROWSER_CHECK" };
  }

  async _healAutoLeap() {
    // Will invoke autoleap-api.getToken() which does login if needed
    return { success: false, reason_code: "HEAL_NOT_WIRED" };
  }

  async _healPartsTech() {
    // Will close stale tab and open fresh SSO
    return { success: false, reason_code: "HEAL_NOT_WIRED" };
  }

  async _healProDemand() {
    // Will navigate to login page and fill credentials
    return { success: false, reason_code: "HEAL_NOT_WIRED" };
  }
}

module.exports = { SessionManager, checkCDP };
```

**Step 4: Run test to verify it passes**

Run: `node tests/unit/test-session-manager.js`
Expected: All 4 tests pass

**Step 5: Commit**

```bash
git add skills/shared/session-manager.js tests/unit/test-session-manager.js
git commit -m "feat: add session manager with preflight checks and heal interface"
```

---

### Task 5: Create tab manager module

**Files:**
- Create: `skills/shared/tab-manager.js`
- Create: `tests/unit/test-tab-manager.js`

**Step 1: Write the failing test**

```javascript
// tests/unit/test-tab-manager.js
const { TabManager } = require("../../skills/shared/tab-manager");

function assert(cond, msg) {
  if (!cond) throw new Error("FAIL: " + msg);
}

async function runTests() {
  const tests = [];
  let pass = 0, fail = 0;

  function test(name, fn) { tests.push({ name, fn }); }

  test("TabManager tracks tab ownership", () => {
    const tm = new TabManager();
    tm.register("tab-1", "partstech", "run-abc");
    const info = tm.getInfo("tab-1");
    assert(info.platform === "partstech", "platform");
    assert(info.runId === "run-abc", "runId");
    assert(typeof info.acquiredAt === "number", "has timestamp");
  });

  test("TabManager releases tabs", () => {
    const tm = new TabManager();
    tm.register("tab-2", "prodemand", "run-def");
    tm.release("tab-2");
    const info = tm.getInfo("tab-2");
    assert(info === null, "removed after release");
  });

  test("TabManager detects stale tabs", () => {
    const tm = new TabManager({ staleThresholdMs: 50 });
    tm.register("tab-3", "partstech", "run-old");
    // Manually backdate
    tm._tabs.get("tab-3").acquiredAt = Date.now() - 100;
    const stale = tm.getStaleTabs();
    assert(stale.length === 1, "one stale tab");
    assert(stale[0].tabId === "tab-3", "correct tab");
  });

  test("TabManager touch refreshes timestamp", () => {
    const tm = new TabManager({ staleThresholdMs: 50 });
    tm.register("tab-4", "prodemand", "run-touch");
    tm._tabs.get("tab-4").acquiredAt = Date.now() - 100;
    tm.touch("tab-4");
    const stale = tm.getStaleTabs();
    assert(stale.length === 0, "no stale after touch");
  });

  test("cleanupStaleTabs removes stale entries", () => {
    const tm = new TabManager({ staleThresholdMs: 50 });
    tm.register("tab-5", "partstech", "run-stale");
    tm.register("tab-6", "prodemand", "run-fresh");
    tm._tabs.get("tab-5").acquiredAt = Date.now() - 100;
    const cleaned = tm.cleanupStaleTabs();
    assert(cleaned === 1, "one cleaned");
    assert(tm.getInfo("tab-5") === null, "stale removed");
    assert(tm.getInfo("tab-6") !== null, "fresh kept");
  });

  // Run
  for (const t of tests) {
    try {
      await t.fn();
      pass++;
      console.log(`  ✓ ${t.name}`);
    } catch (e) {
      fail++;
      console.error(`  ✗ ${t.name}: ${e.message}`);
    }
  }
  console.log(`\nTab manager tests: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

runTests();
```

**Step 2: Run test to verify it fails**

Run: `node tests/unit/test-tab-manager.js`
Expected: FAIL with "Cannot find module"

**Step 3: Write minimal implementation**

```javascript
// skills/shared/tab-manager.js
"use strict";

const DEFAULT_STALE_MS = 60000; // 60 seconds

class TabManager {
  constructor(opts = {}) {
    this.staleThresholdMs = opts.staleThresholdMs ?? DEFAULT_STALE_MS;
    this._tabs = new Map();
  }

  /**
   * Register a tab as owned by a run.
   */
  register(tabId, platform, runId) {
    this._tabs.set(tabId, {
      tabId,
      platform,
      runId,
      acquiredAt: Date.now(),
    });
  }

  /**
   * Release a tab (remove from tracking).
   */
  release(tabId) {
    this._tabs.delete(tabId);
  }

  /**
   * Get info for a tracked tab, or null if not tracked.
   */
  getInfo(tabId) {
    return this._tabs.get(tabId) || null;
  }

  /**
   * Refresh the timestamp for a tab (mark as recently validated).
   */
  touch(tabId) {
    const info = this._tabs.get(tabId);
    if (info) {
      info.acquiredAt = Date.now();
    }
  }

  /**
   * Get all tabs that haven't been validated within the stale threshold.
   */
  getStaleTabs() {
    const cutoff = Date.now() - this.staleThresholdMs;
    const stale = [];
    for (const info of this._tabs.values()) {
      if (info.acquiredAt < cutoff) {
        stale.push(info);
      }
    }
    return stale;
  }

  /**
   * Remove all stale tabs from tracking. Returns count removed.
   */
  cleanupStaleTabs() {
    const stale = this.getStaleTabs();
    for (const info of stale) {
      this._tabs.delete(info.tabId);
    }
    return stale.length;
  }

  /**
   * Get all tabs for a specific platform.
   */
  getTabsForPlatform(platform) {
    const tabs = [];
    for (const info of this._tabs.values()) {
      if (info.platform === platform) tabs.push(info);
    }
    return tabs;
  }

  /**
   * Get all tabs for a specific run.
   */
  getTabsForRun(runId) {
    const tabs = [];
    for (const info of this._tabs.values()) {
      if (info.runId === runId) tabs.push(info);
    }
    return tabs;
  }

  /**
   * Release all tabs for a specific run.
   */
  releaseRun(runId) {
    const toRemove = [];
    for (const [tabId, info] of this._tabs.entries()) {
      if (info.runId === runId) toRemove.push(tabId);
    }
    for (const tabId of toRemove) {
      this._tabs.delete(tabId);
    }
    return toRemove.length;
  }
}

module.exports = { TabManager };
```

**Step 4: Run test to verify it passes**

Run: `node tests/unit/test-tab-manager.js`
Expected: All 5 tests pass

**Step 5: Commit**

```bash
git add skills/shared/tab-manager.js tests/unit/test-tab-manager.js
git commit -m "feat: add tab manager with ownership tracking and stale detection"
```

---

### Task 6: Create health check module

**Files:**
- Create: `skills/shared/health.js`
- Create: `tests/unit/test-health.js`

**Step 1: Write the failing test**

```javascript
// tests/unit/test-health.js
const { checkHealth, cleanupArtifacts } = require("../../skills/shared/health");

function assert(cond, msg) {
  if (!cond) throw new Error("FAIL: " + msg);
}

async function runTests() {
  const tests = [];
  let pass = 0, fail = 0;

  function test(name, fn) { tests.push({ name, fn }); }

  test("checkHealth returns expected shape", async () => {
    const result = await checkHealth();
    assert(typeof result === "object", "returns object");
    assert(typeof result.chrome === "boolean", "chrome is boolean");
    assert(typeof result.cdp === "boolean", "cdp is boolean");
    assert(typeof result.disk_free_mb === "number", "disk_free_mb is number");
    assert(typeof result.uptime_s === "number", "uptime_s is number");
  });

  test("cleanupArtifacts returns count", () => {
    const result = cleanupArtifacts({ dryRun: true });
    assert(typeof result.artifacts === "number", "artifacts count");
    assert(typeof result.screenshots === "number", "screenshots count");
  });

  // Run
  for (const t of tests) {
    try {
      await t.fn();
      pass++;
      console.log(`  ✓ ${t.name}`);
    } catch (e) {
      fail++;
      console.error(`  ✗ ${t.name}: ${e.message}`);
    }
  }
  console.log(`\nHealth tests: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

runTests();
```

**Step 2: Run test to verify it fails**

Run: `node tests/unit/test-health.js`
Expected: FAIL with "Cannot find module"

**Step 3: Write minimal implementation**

```javascript
// skills/shared/health.js
"use strict";

const net = require("net");
const os = require("os");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const CHROME_CDP_PORT = parseInt(process.env.CHROME_DEBUG_PORT, 10) || 18800;
const ARTIFACTS_DIR = path.join(os.tmpdir(), "sam-artifacts");
const SCREENSHOTS_DIR = path.join(os.homedir(), ".openclaw", "media", "browser");
const ARTIFACT_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h
const MAX_SCREENSHOTS = 50;

const startTime = Date.now();

function checkPort(port) {
  return new Promise((resolve) => {
    const sock = net.createConnection({ host: "127.0.0.1", port }, () => {
      sock.destroy();
      resolve(true);
    });
    sock.on("error", () => resolve(false));
    sock.setTimeout(3000, () => { sock.destroy(); resolve(false); });
  });
}

function isProcessRunning(name) {
  try {
    const cmd = process.platform === "win32"
      ? `tasklist /FI "IMAGENAME eq ${name}" /NH`
      : `pgrep -f "${name}" 2>/dev/null`;
    const result = execSync(cmd, { timeout: 5000, encoding: "utf8" });
    return result.trim().length > 0;
  } catch {
    return false;
  }
}

function getDiskFreeMb() {
  try {
    if (process.platform === "win32") {
      // Windows: wmic or fallback
      return 999999;
    }
    const result = execSync("df -m / | tail -1 | awk '{print $4}'", { timeout: 5000, encoding: "utf8" });
    return parseInt(result.trim(), 10) || 0;
  } catch {
    return -1;
  }
}

/**
 * Run all health checks. Returns status object.
 */
async function checkHealth() {
  const chrome = isProcessRunning("chrome") || isProcessRunning("chromium");
  const cdp = await checkPort(CHROME_CDP_PORT);
  const disk_free_mb = getDiskFreeMb();
  const uptime_s = Math.round((Date.now() - startTime) / 1000);

  return {
    chrome,
    cdp,
    disk_free_mb,
    uptime_s,
    disk_warning: disk_free_mb > 0 && disk_free_mb < 500,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Clean up old artifacts and excess screenshots.
 * @param {Object} opts - { dryRun: false }
 */
function cleanupArtifacts(opts = {}) {
  const dryRun = opts.dryRun ?? false;
  let artifactsRemoved = 0;
  let screenshotsRemoved = 0;

  // Clean artifacts older than 24h
  if (fs.existsSync(ARTIFACTS_DIR)) {
    const cutoff = Date.now() - ARTIFACT_MAX_AGE_MS;
    try {
      const entries = fs.readdirSync(ARTIFACTS_DIR);
      for (const entry of entries) {
        const full = path.join(ARTIFACTS_DIR, entry);
        try {
          const stat = fs.statSync(full);
          if (stat.mtimeMs < cutoff) {
            if (!dryRun) {
              fs.rmSync(full, { recursive: true, force: true });
            }
            artifactsRemoved++;
          }
        } catch {}
      }
    } catch {}
  }

  // Keep only last N screenshots
  if (fs.existsSync(SCREENSHOTS_DIR)) {
    try {
      const files = fs.readdirSync(SCREENSHOTS_DIR)
        .map((f) => ({ name: f, path: path.join(SCREENSHOTS_DIR, f) }))
        .filter((f) => {
          try { return fs.statSync(f.path).isFile(); } catch { return false; }
        })
        .sort((a, b) => {
          try {
            return fs.statSync(b.path).mtimeMs - fs.statSync(a.path).mtimeMs;
          } catch { return 0; }
        });

      if (files.length > MAX_SCREENSHOTS) {
        const toRemove = files.slice(MAX_SCREENSHOTS);
        for (const f of toRemove) {
          if (!dryRun) {
            try { fs.unlinkSync(f.path); } catch {}
          }
          screenshotsRemoved++;
        }
      }
    } catch {}
  }

  return { artifacts: artifactsRemoved, screenshots: screenshotsRemoved };
}

/**
 * Validate required environment variables are present.
 * Returns { valid: bool, missing: string[] }
 */
function validateEnv(required) {
  const missing = [];
  for (const key of required) {
    if (!process.env[key]) missing.push(key);
  }
  return { valid: missing.length === 0, missing };
}

module.exports = { checkHealth, cleanupArtifacts, validateEnv };
```

**Step 4: Run test to verify it passes**

Run: `node tests/unit/test-health.js`
Expected: Both tests pass

**Step 5: Commit**

```bash
git add skills/shared/health.js tests/unit/test-health.js
git commit -m "feat: add health check module with disk monitoring and artifact cleanup"
```

---

### Task 7: Create unit test runner

**Files:**
- Create: `tests/unit/run.js`

**Step 1: Write the runner**

```javascript
// tests/unit/run.js
"use strict";

const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const testDir = __dirname;
const testFiles = fs.readdirSync(testDir)
  .filter((f) => f.startsWith("test-") && f.endsWith(".js"))
  .sort();

console.log(`\n═══ SAM Unit Tests ═══\n`);
console.log(`Found ${testFiles.length} test files\n`);

let totalPass = 0;
let totalFail = 0;

for (const file of testFiles) {
  const filePath = path.join(testDir, file);
  console.log(`--- ${file} ---`);
  try {
    execSync(`node "${filePath}"`, {
      stdio: "inherit",
      timeout: 30000,
      cwd: path.join(testDir, "../.."),
    });
    totalPass++;
  } catch (err) {
    totalFail++;
    console.error(`  SUITE FAILED: ${file}\n`);
  }
  console.log();
}

console.log(`═══════════════════════════`);
console.log(`Suites: ${totalPass} passed, ${totalFail} failed (${testFiles.length} total)`);
console.log(`═══════════════════════════\n`);

if (totalFail > 0) process.exit(1);
```

**Step 2: Run to verify all unit tests pass**

Run: `node tests/unit/run.js`
Expected: All 6 suites pass (logger, retry, contracts, session-manager, tab-manager, health)

**Step 3: Commit**

```bash
git add tests/unit/run.js
git commit -m "feat: add unit test runner for shared modules"
```

---

## Phase 2: Orchestrator Integration

### Task 8: Add RunContext and feature flags to orchestrator

**Files:**
- Modify: `skills/estimate-builder/scripts/orchestrator.js` (top of file, ~lines 1-80)

**Step 1: Read the current file top**

Read `skills/estimate-builder/scripts/orchestrator.js` lines 1-80 to see current imports.

**Step 2: Add shared module imports and RunContext**

At the top of the file (after existing imports, before skill imports), add:

```javascript
// --- Shared infrastructure (feature-flagged) ---
const { createLogger, generateRunId } = require("../../shared/logger");
const { withRetry, circuitBreaker, FailureClass } = require("../../shared/retry");
const { validateLaborResult, validatePartQuote, normalizePrice, mergeResults } = require("../../shared/contracts");
const { SessionManager } = require("../../shared/session-manager");
const { TabManager } = require("../../shared/tab-manager");
const { checkHealth, cleanupArtifacts, validateEnv } = require("../../shared/health");

// Feature flags
const FEAT_STRUCTURED_LOGGING = process.env.SAM_STRUCTURED_LOGGING === "true";
const FEAT_SESSION_PREFLIGHT = process.env.SAM_SESSION_PREFLIGHT === "true";
const FEAT_RETRY_ENABLED = process.env.SAM_RETRY_ENABLED === "true";

// Shared instances
const sessionManager = new SessionManager({ logger: createLogger("session-manager") });
const tabManager = new TabManager();

// Circuit breakers per platform
const breakers = {
  partstech: circuitBreaker("partstech", { failThreshold: 3, cooldownMs: 120000 }),
  prodemand: circuitBreaker("prodemand", { failThreshold: 3, cooldownMs: 120000 }),
  autoleap: circuitBreaker("autoleap", { failThreshold: 3, cooldownMs: 120000 }),
  alldata: circuitBreaker("alldata", { failThreshold: 3, cooldownMs: 120000 }),
  identifix: circuitBreaker("identifix", { failThreshold: 3, cooldownMs: 120000 }),
};
```

**Step 3: Add RunContext creation inside buildEstimate**

Inside `buildEstimate()` (near line 726), at the very start of the function, add:

```javascript
  // --- RunContext ---
  const runId = generateRunId();
  const log = createLogger("orchestrator", runId);
  const runCtx = {
    runId,
    vehicle: params,
    symptom: params.query,
    shopId: params.shopId || "default",
    startTime: Date.now(),
    steps: [],
  };
  log.info("pipeline start", { query: params.query, year: params.year, make: params.make, model: params.model });
```

Replace subsequent `console.log("[Step X]` calls with `log.info("Step X: ...")` calls. Do this incrementally — change the first 2-3 step logs to validate, then continue.

**Step 4: Add preflight check (feature-flagged)**

After RunContext creation, before Step 1, add:

```javascript
  // --- Preflight (feature-flagged) ---
  if (FEAT_SESSION_PREFLIGHT) {
    const endPreflight = log.step("preflight");
    const preflightStatus = await sessionManager.preflight();
    endPreflight({ status: preflightStatus });
    runCtx.steps.push({ step: "preflight", status: preflightStatus });
  }
```

**Step 5: Run existing E2E test to verify no regression**

Run: `node scripts/test-e2e.js`
Expected: Same results as before (20+ passed). The new code is feature-flagged off by default.

**Step 6: Commit**

```bash
git add skills/estimate-builder/scripts/orchestrator.js
git commit -m "feat: integrate RunContext, logger, and preflight into orchestrator"
```

---

### Task 9: Wire retry and circuit breaker into orchestrator research steps

**Files:**
- Modify: `skills/estimate-builder/scripts/orchestrator.js` (Step 3: research, ~lines 884-1013)

**Step 1: Read Step 3 code**

Read `skills/estimate-builder/scripts/orchestrator.js` lines 884-1013.

**Step 2: Wrap AllData research with retry + breaker**

Find the AllData call (inside Step 3) and wrap it:

```javascript
    // AllData — with retry and circuit breaker
    if (searchAllData && allDataReachable) {
      const endAllData = log.step("alldata_research");
      try {
        const doSearch = async () => {
          return await Promise.race([
            searchAllData({ year, make, model, engine, query: params.query }),
            new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error("AllData timeout"), { retryable: true })), RESEARCH_TIMEOUT)),
          ]);
        };

        const allDataResult = FEAT_RETRY_ENABLED
          ? await breakers.alldata.call(() => withRetry(doSearch, { maxRetries: 1, baseDelay: 2000 }))
          : await doSearch();

        results.diagnosis.alldata = allDataResult;
        endAllData({ outcome: "ok" });
      } catch (err) {
        endAllData({ outcome: "error", reason_code: FailureClass.classify(err) });
        log.warn("AllData research failed", { error: err.message });
      }
    }
```

Apply the same pattern to Identifix and ProDemand calls within Step 3.

**Step 3: Wrap ProDemand with retry + breaker**

For ProDemand (which uses a separate timeout of 75s):

```javascript
    // ProDemand — with retry and circuit breaker
    if (searchProDemand) {
      const endProDemand = log.step("prodemand_research");
      try {
        const doSearch = async () => {
          return await Promise.race([
            searchProDemand({ year, make, model, engine, query: params.query, vin }),
            new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error("ProDemand timeout"), { retryable: true })), PRODEMAND_TIMEOUT)),
          ]);
        };

        const pdResult = FEAT_RETRY_ENABLED
          ? await breakers.prodemand.call(() => withRetry(doSearch, { maxRetries: 1, baseDelay: 3000 }))
          : await doSearch();

        results.diagnosis.prodemand = pdResult;
        endProDemand({ outcome: "ok" });
      } catch (err) {
        endProDemand({ outcome: "error", reason_code: FailureClass.classify(err) });
        log.warn("ProDemand research failed", { error: err.message });
      }
    }
```

**Step 4: Run existing E2E test to verify no regression**

Run: `node scripts/test-e2e.js`
Expected: Same pass count. Retry/breaker logic is gated by `SAM_RETRY_ENABLED=true`.

**Step 5: Commit**

```bash
git add skills/estimate-builder/scripts/orchestrator.js
git commit -m "feat: wrap research steps with retry and circuit breaker"
```

---

### Task 10: Wire retry into parts search and AutoLeap estimate steps

**Files:**
- Modify: `skills/estimate-builder/scripts/orchestrator.js` (Steps 5-6, ~lines 1057-1320)

**Step 1: Read Steps 5-6 code**

Read `skills/estimate-builder/scripts/orchestrator.js` lines 1057-1320.

**Step 2: Wrap parts search with retry + breaker**

Apply the same withRetry + breakers pattern to the PartsTech search call in Step 5.

**Step 3: Wrap AutoLeap estimate creation with retry + breaker**

Apply to the `autoLeapApi.buildEstimate()` call in Step 6.

**Step 4: Add data contract validation at merge points**

After parts results are collected (end of Step 5), validate:

```javascript
    // Validate parts results through contracts
    if (results.parts && Array.isArray(results.parts)) {
      results.parts = results.parts.map((p) => {
        if (p.results && Array.isArray(p.results)) {
          p.results = p.results.map((r) => validatePartQuote(r));
        }
        return p;
      });
    }
```

After ProDemand labor is collected (end of Step 3), validate:

```javascript
    // Validate labor results through contracts
    if (results.diagnosis?.prodemand?.laborTimes) {
      results.diagnosis.prodemand.laborTimes = results.diagnosis.prodemand.laborTimes.map(
        (l) => validateLaborResult(l)
      );
    }
```

**Step 5: Run E2E test**

Run: `node scripts/test-e2e.js`
Expected: Same pass count.

**Step 6: Commit**

```bash
git add skills/estimate-builder/scripts/orchestrator.js
git commit -m "feat: wire retry/breaker into parts search and estimate, add contract validation"
```

---

### Task 11: Add pipeline metrics emission at end of buildEstimate

**Files:**
- Modify: `skills/estimate-builder/scripts/orchestrator.js` (end of buildEstimate, ~line 1451)

**Step 1: Read end of buildEstimate**

Read `skills/estimate-builder/scripts/orchestrator.js` lines 1440-1474.

**Step 2: Add metrics emission before return**

Before the `return results;` statement at the end of buildEstimate, add:

```javascript
  // --- Pipeline metrics ---
  const totalRuntime = Date.now() - runCtx.startTime;
  const partsPriced = (results.parts || []).filter((p) =>
    p.results?.some((r) => r.unit_price != null && r.unit_price > 0)
  ).length;
  const totalParts = (results.parts || []).length;
  const laborSource = results.diagnosis?.prodemand?.laborTimes?.[0]?.source || "unknown";

  log.metric({
    total_runtime_ms: totalRuntime,
    parts_priced_rate: totalParts > 0 ? Math.round((partsPriced / totalParts) * 100) / 100 : 0,
    labor_source: laborSource,
    warnings_count: (results.warnings || []).length,
    steps_completed: runCtx.steps.length,
  });

  // Attach runId to results for downstream use
  results.runId = runId;
  results._runCtx = runCtx;
```

**Step 3: Run E2E test**

Run: `node scripts/test-e2e.js`
Expected: Same pass count.

**Step 4: Commit**

```bash
git add skills/estimate-builder/scripts/orchestrator.js
git commit -m "feat: emit pipeline metrics at end of buildEstimate"
```

---

## Phase 3: Telegram UX and Formatter

### Task 12: Add progress updates to Telegram server

**Files:**
- Modify: `skills/whatsapp-gateway/scripts/server.js`

Note: The Telegram bot is actually `skills/telegram-gateway/scripts/server.js`. Read the actual file first to determine the correct path. The WhatsApp gateway server.js handles WhatsApp, the Telegram gateway handles Telegram. Check both.

**Step 1: Read the Telegram gateway server**

Read `skills/telegram-gateway/scripts/server.js` (or whichever file handles Telegram bot messages and calls buildEstimate).

**Step 2: Add progress callback support**

Add a `progressCallback` parameter to `buildEstimate` calls. In the Telegram handler, define:

```javascript
const FEAT_PROGRESS = process.env.TELEGRAM_PROGRESS_UPDATES === "true";

async function handleEstimateRequest(chatId, messageId, text) {
  // Immediate ACK (already exists)
  const ackMsg = await bot.sendMessage(chatId, "On it! Looking up your vehicle...");
  const ackMsgId = ackMsg.message_id;

  const progressCb = FEAT_PROGRESS ? async (stage) => {
    const messages = {
      diagnosis_done: "Got vehicle specs. Checking repair data...",
      research_done: "Found repair data. Looking up parts pricing...",
      building_estimate: "Building your estimate...",
    };
    if (messages[stage]) {
      try {
        await bot.editMessageText(messages[stage], { chat_id: chatId, message_id: ackMsgId });
      } catch {}
    }
  } : null;

  const params = parseMessage(text);
  params.progressCallback = progressCb;
  const results = await buildEstimate(params);
  // ... format and send
}
```

**Step 3: Wire progressCallback in orchestrator**

In `buildEstimate()` in orchestrator.js, after key steps, call the callback:

```javascript
  // After Step 2.5 (diagnosis):
  if (params.progressCallback) await params.progressCallback("diagnosis_done").catch(() => {});

  // After Step 3 (research):
  if (params.progressCallback) await params.progressCallback("research_done").catch(() => {});

  // Before Step 6 (estimate creation):
  if (params.progressCallback) await params.progressCallback("building_estimate").catch(() => {});
```

**Step 4: Run E2E test**

Run: `node scripts/test-e2e.js`
Expected: Same pass count (progressCallback is null in test).

**Step 5: Commit**

```bash
git add skills/telegram-gateway/scripts/server.js skills/estimate-builder/scripts/orchestrator.js
git commit -m "feat: add Telegram progress updates via message editing"
```

---

### Task 13: Add source labels and degraded notice to formatter

**Files:**
- Modify: `skills/whatsapp-gateway/scripts/formatter.js`

**Step 1: Read formatter.js**

Read `skills/whatsapp-gateway/scripts/formatter.js` fully.

**Step 2: Add source labels to estimate lines**

In the section where labor and parts are formatted, append source labels:

```javascript
// When displaying labor hours:
const laborLabel = laborSource === "MOTOR" ? " (MOTOR)" : laborSource === "AI_fallback" ? " (AI est.)" : "";
// e.g. "Labor: 2.5h${laborLabel}"

// When displaying parts pricing:
// If part has reason_code "NO_PRICE", show "(TBD)" instead of price
const priceDisplay = part.unit_price ? `$${part.unit_price.toFixed(2)}` : "(TBD)";
```

**Step 3: Add degraded-mode notice**

At the bottom of message 1, if warnings are present:

```javascript
// Degraded notice
if (results.warnings && results.warnings.length > 0) {
  const notices = [];
  for (const w of results.warnings) {
    if (w === "NO_MOTOR_LABOR") notices.push("Using estimated labor hours — real book time wasn't available");
    if (w === "NO_PARTS_PRICING") notices.push("Some parts couldn't be priced — marked as TBD");
  }
  if (notices.length > 0) {
    msg1 += "\n\n⚠ " + notices.join("\n⚠ ");
  }
}
```

**Step 4: Add message splitting at 4000 chars**

```javascript
function splitMessage(text, maxLen = 4000) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > maxLen) {
    // Find last newline before limit
    let splitAt = remaining.lastIndexOf("\n", maxLen);
    if (splitAt < maxLen * 0.5) splitAt = maxLen; // Avoid tiny chunks
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}
```

Apply `splitMessage()` to each message before returning from `formatForWhatsApp()`.

**Step 5: Commit**

```bash
git add skills/whatsapp-gateway/scripts/formatter.js
git commit -m "feat: add source labels, degraded notice, and message splitting to formatter"
```

---

### Task 14: Add Markdown escaping utility

**Files:**
- Modify: `skills/whatsapp-gateway/scripts/formatter.js`

**Step 1: Add escape function**

```javascript
/**
 * Escape Markdown-sensitive characters for Telegram/WhatsApp.
 * Only escapes in non-formatting contexts (inside data values, not our own markup).
 */
function escapeMarkdown(text) {
  if (!text) return "";
  // Escape chars that conflict with Telegram MarkdownV2: _ * [ ] ( ) ~ ` > # + - = | { } . !
  // But we use *bold* and _italic_ intentionally, so only escape in data values
  return String(text)
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\[/g, "\\[");
}
```

Use `escapeMarkdown()` when inserting user-provided data (vehicle names, part descriptions, etc.) into formatted messages.

**Step 2: Commit**

```bash
git add skills/whatsapp-gateway/scripts/formatter.js
git commit -m "feat: add Markdown escaping for user data in formatted messages"
```

---

### Task 15: Add user-friendly error messages mapped from reason codes

**Files:**
- Modify: `skills/whatsapp-gateway/scripts/formatter.js`

**Step 1: Add error message map**

```javascript
const ERROR_MESSAGES = {
  PT_NO_PRODUCTS: "Couldn't get live parts pricing right now — estimate includes labor and TBD parts.",
  PT_NO_TAB: "Parts lookup service temporarily unavailable.",
  PT_LOGIN_REDIRECT: "Parts lookup needs re-authentication — try again in a moment.",
  NO_MOTOR_LABOR: "Using estimated labor hours — real book time wasn't available.",
  NO_PARTS_PRICING: "Some parts couldn't be priced — marked as TBD.",
  CIRCUIT_OPEN: "Some research sources are temporarily unavailable — estimate may be less detailed.",
  TIMEOUT: "Research took longer than expected — some details may be missing.",
};

function getErrorMessage(reason_code) {
  return ERROR_MESSAGES[reason_code] || null;
}
```

Export `getErrorMessage` and use it in the server when formatting error responses.

**Step 2: Commit**

```bash
git add skills/whatsapp-gateway/scripts/formatter.js
git commit -m "feat: add user-friendly error messages for reason codes"
```

---

## Phase 4: Platform Adapter Hardening

### Task 16: Harden ProDemand search-direct.js

**Files:**
- Modify: `skills/prodemand-lookup/scripts/search-direct.js`

**Step 1: Read search-direct.js**

Read `skills/prodemand-lookup/scripts/search-direct.js` fully.

**Step 2: Centralize selectors at top of file**

Add selector constants at the top:

```javascript
// --- Selector contract ---
const SELECTORS = {
  searchBox: "input.searchBox",
  oneViewSearch: 'a[data-type="OneViewSearch"]',
  cardRealFixes: ".cardRealFixes .cardHeader",
  cardPartsLabor: ".cardPartsLabor",
  itemViewer: ".itemViewerContainer li",
  articleHeader: ".articleHeader h2",
  laborDetails: "#laborDetails",
  vehicleDetails: "#vehicleDetails",
  qualifierItem: "li.qualifier",
};
```

Replace hardcoded selectors throughout the file with `SELECTORS.xxx` references.

**Step 3: Add confidence field to engine scoring**

In the engine scoring function, add a confidence score to the return:

```javascript
// After scoring all options, attach confidence:
// confidence = 1.0 if score diff between #1 and #2 is > 5
// confidence = 0.7 if score diff is 2-5
// confidence = 0.4 if score diff is 0-1
const scoreDiff = sortedOptions[0].score - (sortedOptions[1]?.score || 0);
const confidence = scoreDiff > 5 ? 1.0 : scoreDiff >= 2 ? 0.7 : 0.4;
```

Return the confidence along with the selected engine option.

**Step 4: Add operation synonym fallback for labor lookup**

```javascript
const LABOR_SYNONYMS = {
  "catalytic converter": ["Catalytic Converter R&R", "Exhaust Manifold/Catalytic Converter", "Converter Replace", "Cat Converter"],
  "brake pads": ["Brake Pads Replace", "Disc Brake Pad", "Front Brake Pad", "Rear Brake Pad"],
  "water pump": ["Water Pump R&R", "Water Pump Replace", "Coolant Pump"],
  "spark plug": ["Spark Plug Replace", "Spark Plug R&R", "Ignition Tune-Up"],
};

function getSynonyms(operation) {
  const key = operation.toLowerCase();
  for (const [base, syns] of Object.entries(LABOR_SYNONYMS)) {
    if (key.includes(base)) return syns;
  }
  return [operation];
}
```

In the labor extraction, if primary operation returns no results, try synonyms:

```javascript
async function extractLabor(page, operation) {
  const synonyms = getSynonyms(operation);
  for (const syn of synonyms) {
    const result = await tryExtractLabor(page, syn);
    if (result && result.hours > 0) {
      return { ...result, operation: syn, source: "MOTOR" };
    }
  }
  return { hours: 0, operation, source: "MOTOR", reason_code: "NO_LABOR_FOUND" };
}
```

**Step 5: Add structured logging**

Import the logger:
```javascript
const { createLogger } = require("../../shared/logger");
```

Replace `console.log(LOG, ...)` with `log.info(...)` throughout. The logger will handle prefix and structured output based on feature flag.

**Step 6: Run E2E test**

Run: `node scripts/test-e2e.js`
Expected: Same pass count.

**Step 7: Commit**

```bash
git add skills/prodemand-lookup/scripts/search-direct.js
git commit -m "feat: harden ProDemand with selectors contract, confidence scoring, synonym fallback, structured logging"
```

---

### Task 17: Harden PartsTech partstech-search.js

**Files:**
- Modify: `skills/autoleap-browser/scripts/partstech-search.js`

**Step 1: Read partstech-search.js**

Read `skills/autoleap-browser/scripts/partstech-search.js` fully.

**Step 2: Add reason codes and structured logging**

Import shared modules:
```javascript
const { createLogger } = require("../../shared/logger");
const { normalizePrice } = require("../../shared/contracts");
```

Add reason codes as constants:
```javascript
const REASON_CODES = {
  PT_NO_TAB: "PT_NO_TAB",
  PT_LOGIN_REDIRECT: "PT_LOGIN_REDIRECT",
  PT_NO_SEARCH_INPUT: "PT_NO_SEARCH_INPUT",
  PT_NO_PRODUCTS: "PT_NO_PRODUCTS",
  PT_NO_PRICEABLE_ITEMS: "PT_NO_PRICEABLE_ITEMS",
};
```

**Step 3: Add result quality filtering**

After products are returned, filter:
```javascript
function filterResults(products) {
  return products.filter((p) => {
    // Remove "Call for availability" items
    if (p.availability?.toLowerCase().includes("call for")) return false;
    // Remove zero-price items
    const price = normalizePrice(p.price || p.unit_price);
    if (price === null) return false;
    // Remove out-of-network items
    if (p.outOfNetwork) return false;
    return true;
  });
}
```

**Step 4: Add selector fallback chains**

```javascript
const SELECTORS = {
  searchInput: ['input[name="search"]', 'input[placeholder*="Search"]', 'input.search-input'],
  resultRow: ['.product-row', 'tr.product-item', '[data-testid="product-row"]'],
  priceCell: ['.price-column', '.product-price', 'td:last-child'],
};

function findSelector(page, selectors) {
  for (const sel of selectors) {
    try {
      const el = page.querySelector(sel);
      if (el) return sel;
    } catch {}
  }
  return null;
}
```

**Step 5: Commit**

```bash
git add skills/autoleap-browser/scripts/partstech-search.js
git commit -m "feat: harden PartsTech with reason codes, quality filtering, selector fallbacks"
```

---

### Task 18: Harden AutoLeap autoleap-api.js

**Files:**
- Modify: `skills/autoleap-browser/scripts/autoleap-api.js`

**Step 1: Read autoleap-api.js**

Read `skills/autoleap-browser/scripts/autoleap-api.js` fully.

**Step 2: Add retry wrapper to API calls**

Import shared modules:
```javascript
const { createLogger } = require("../../shared/logger");
const { withRetry, FailureClass } = require("../../shared/retry");
```

Wrap `apiCall` with retry for transient failures:

```javascript
async function apiCallWithRetry(method, apiPath, body, token) {
  if (process.env.SAM_RETRY_ENABLED !== "true") {
    return apiCall(method, apiPath, body, token);
  }
  return withRetry(
    () => apiCall(method, apiPath, body, token),
    { maxRetries: 2, baseDelay: 1000 }
  );
}
```

Replace `apiCall` usages in `searchCustomer`, `createCustomer`, `createEstimate` with `apiCallWithRetry`.

**Step 3: Add token_source logging**

In `getToken()`, log whether token came from cache or fresh capture:

```javascript
log.info("token acquired", { token_source: cached ? "cache" : "fresh", token_expires_in_min: Math.round((expiresAt - Date.now()) / 60000) });
```

Never log the actual token value.

**Step 4: Add estimate deduplication check**

Before creating a new estimate, check if one already exists for the same vehicle:

```javascript
async function checkDuplicateEstimate(token, customerId, vin) {
  try {
    const estimates = await apiCallWithRetry("GET", `/estimates?customerId=${customerId}&status=draft&limit=5`, null, token);
    if (estimates?.data) {
      return estimates.data.find((e) => e.vehicle?.vin === vin);
    }
  } catch {}
  return null;
}
```

**Step 5: Add buildServices output validation**

```javascript
function validateServices(services) {
  if (!services || !Array.isArray(services) || services.length === 0) {
    return { valid: false, reason: "empty services array" };
  }
  for (const svc of services) {
    if (!svc.title) return { valid: false, reason: "service missing title" };
    if (!svc.items || svc.items.length === 0) return { valid: false, reason: "service has no items" };
  }
  return { valid: true };
}
```

Call before `createEstimate()`.

**Step 6: Run E2E test**

Run: `node scripts/test-e2e.js`
Expected: Same pass count.

**Step 7: Commit**

```bash
git add skills/autoleap-browser/scripts/autoleap-api.js
git commit -m "feat: harden AutoLeap API with retry, token logging, dedup check, validation"
```

---

## Phase 5: Runtime Hardening

### Task 19: Add startup env validation and health command to Telegram bot

**Files:**
- Modify: `skills/telegram-gateway/scripts/server.js`

**Step 1: Read Telegram server**

Read the Telegram gateway server file.

**Step 2: Add startup validation**

At startup, after env loading:

```javascript
const { validateEnv, checkHealth, cleanupArtifacts } = require("../../shared/health");
const { createLogger } = require("../../shared/logger");
const log = createLogger("telegram-gateway");

// Validate required env vars
const envCheck = validateEnv(["TELEGRAM_BOT_TOKEN", "SUPABASE_URL", "SUPABASE_ANON_KEY"]);
if (!envCheck.valid) {
  log.error("Missing required env vars", { missing: envCheck.missing });
  process.exit(1);
}

// Run cleanup on startup
const cleaned = cleanupArtifacts();
if (cleaned.artifacts > 0 || cleaned.screenshots > 0) {
  log.info("startup cleanup", cleaned);
}

// Schedule periodic cleanup (every 6 hours)
setInterval(() => {
  const c = cleanupArtifacts();
  if (c.artifacts > 0 || c.screenshots > 0) log.info("periodic cleanup", c);
}, 6 * 60 * 60 * 1000);
```

**Step 3: Add /health command**

In the message handler, add:

```javascript
if (text.toLowerCase() === "/health") {
  const health = await checkHealth();
  const statusEmoji = health.cdp ? "✅" : "❌";
  const msg = [
    `*SAM Health Check*`,
    `Chrome: ${health.chrome ? "running" : "stopped"}`,
    `CDP (port ${18800}): ${statusEmoji}`,
    `Disk: ${health.disk_free_mb}MB free${health.disk_warning ? " ⚠ LOW" : ""}`,
    `Uptime: ${Math.round(health.uptime_s / 60)}min`,
  ].join("\n");
  await bot.sendMessage(chatId, msg);
  return;
}
```

**Step 4: Commit**

```bash
git add skills/telegram-gateway/scripts/server.js
git commit -m "feat: add startup env validation, /health command, and periodic cleanup"
```

---

### Task 20: Update .env.example with new feature flags

**Files:**
- Modify: `config/.env.example`

**Step 1: Read .env.example**

Read `config/.env.example`.

**Step 2: Add feature flag section**

Append to the file:

```bash
# --- Feature Flags (Browser Hardening) ---
# SAM_STRUCTURED_LOGGING=true      # JSON structured logging (default: false, legacy console.log)
# SAM_SESSION_PREFLIGHT=true       # Auth preflight check before each estimate (default: false)
# SAM_RETRY_ENABLED=true           # Retry + circuit breaker for browser/API calls (default: false)
# TELEGRAM_PROGRESS_UPDATES=true   # Progress message editing in Telegram (default: false)
```

**Step 3: Commit**

```bash
git add config/.env.example
git commit -m "docs: add feature flag env vars to .env.example"
```

---

## Phase 6: Enhanced E2E Testing

### Task 21: Add golden cases and degraded-mode tests to E2E

**Files:**
- Modify: `scripts/test-e2e.js`

**Step 1: Read current E2E test**

Read `scripts/test-e2e.js` fully.

**Step 2: Add golden case section after existing tests**

After the existing test validation (around line 300), add:

```javascript
  // ═══ Golden Cases ═══
  section("Golden Cases (expected ranges)");

  const goldenCases = [
    {
      name: "RAV4 Catalytic Converter",
      params: { year: 2019, make: "Toyota", model: "RAV4", engine: "2.5L", cylinders: 4, fuelType: "gas", query: "P0420 catalyst system efficiency below threshold" },
      expect: { laborMin: 1.0, laborMax: 5.0, hasParts: true },
    },
    {
      name: "Prius Brake Pads",
      params: { year: 2015, make: "Toyota", model: "Prius", engine: "1.8L", cylinders: 4, fuelType: "hybrid", query: "brake pads worn need replacement front and rear" },
      expect: { laborMin: 0.5, laborMax: 2.0, hasParts: true },
    },
    {
      name: "F-150 Misfire",
      params: { year: 2018, make: "Ford", model: "F-150", engine: "5.0L V8", cylinders: 8, fuelType: "gas", query: "P0301 cylinder 1 misfire detected rough idle" },
      expect: { laborMin: 0.5, laborMax: 4.0, hasDiagSteps: true },
    },
    {
      name: "Bolt EV Battery",
      params: { year: 2020, make: "Chevrolet", model: "Bolt EV", engine: "Electric", cylinders: 0, fuelType: "electric", query: "battery range degradation reduced range warning" },
      expect: { evExcluded: true },
    },
    {
      name: "Accord Water Pump",
      params: { year: 2017, make: "Honda", model: "Accord", engine: "2.4L", cylinders: 4, fuelType: "gas", query: "coolant leak water pump area overheating" },
      expect: { laborMin: 2.0, laborMax: 7.0, hasParts: true },
    },
  ];

  for (const gc of goldenCases) {
    try {
      console.log(`\n  Testing: ${gc.name}`);
      const r = await buildEstimate(gc.params);
      if (!r || r.error) {
        warn(`${gc.name}: pipeline returned error: ${r?.error || "null result"}`);
        continue;
      }

      // Check labor range (if ProDemand returned labor)
      const laborHours = r.diagnosis?.prodemand?.laborTimes?.[0]?.hours;
      if (gc.expect.laborMin != null && laborHours != null) {
        if (laborHours >= gc.expect.laborMin && laborHours <= gc.expect.laborMax) {
          pass(`${gc.name}: labor ${laborHours}h in range [${gc.expect.laborMin}-${gc.expect.laborMax}]`);
        } else {
          warn(`${gc.name}: labor ${laborHours}h outside range [${gc.expect.laborMin}-${gc.expect.laborMax}]`);
        }
      } else if (gc.expect.laborMin != null) {
        warn(`${gc.name}: no labor returned from ProDemand`);
      }

      // Check parts found
      if (gc.expect.hasParts) {
        const partsFound = (r.parts || []).some((p) => p.results?.length > 0);
        partsFound ? pass(`${gc.name}: parts found`) : warn(`${gc.name}: no parts results`);
      }

      pass(`${gc.name}: pipeline completed`);
    } catch (err) {
      fail(`${gc.name}: ${err.message}`);
    }
  }
```

**Step 3: Add degraded-mode tests**

These test that the pipeline works when platforms are unavailable:

```javascript
  // ═══ Degraded Mode Tests ═══
  section("Degraded Mode (graceful degradation)");

  // Test: Pipeline completes even if all optional platforms are unavailable
  try {
    // Save and clear optional env vars
    const saved = {};
    for (const key of ["ALLDATA_URL", "IDENTIFIX_URL", "PRODEMAND_URL", "PARTSTECH_URL"]) {
      saved[key] = process.env[key];
      delete process.env[key];
    }

    const r = await buildEstimate({
      year: 2019, make: "Honda", model: "Civic", engine: "2.0L",
      query: "P0420 catalyst system efficiency",
    });

    // Restore
    for (const [k, v] of Object.entries(saved)) {
      if (v) process.env[k] = v;
    }

    if (r && !r.error) {
      pass("Degraded mode: pipeline completes without optional platforms");
      if (r.diagnosis?.ai) pass("Degraded mode: AI diagnosis still works");
    } else {
      fail("Degraded mode: pipeline failed — " + (r?.error || "null"));
    }
  } catch (err) {
    fail("Degraded mode: " + err.message);
  }
```

**Step 4: Run enhanced E2E**

Run: `node scripts/test-e2e.js`
Expected: Existing tests pass. Golden cases may warn if platforms aren't configured locally (that's OK — they'll pass on Pi).

**Step 5: Commit**

```bash
git add scripts/test-e2e.js
git commit -m "feat: add golden cases and degraded-mode tests to E2E suite"
```

---

## Phase 7: Final Integration & Verification

### Task 22: Run full unit test suite

**Step 1:** Run: `node tests/unit/run.js`
Expected: All suites pass (logger, retry, contracts, session-manager, tab-manager, health).

### Task 23: Run E2E test suite

**Step 1:** Run: `node scripts/test-e2e.js`
Expected: Existing tests pass, golden cases report expected results.

### Task 24: Test with structured logging enabled

**Step 1:** Set `SAM_STRUCTURED_LOGGING=true` in env, run E2E.
**Step 2:** Verify JSON log output in console.
**Step 3:** Unset the flag.

### Task 25: Push to GitHub and deploy to Pi

**Step 1:** Push all commits to GitHub.

```bash
git push origin main
```

**Step 2:** SSH to Pi and pull.

```bash
ssh sam@192.168.1.31 "cd /home/sam/ai-auto-advisor && git pull"
```

**Step 3:** Run E2E on Pi.

```bash
ssh sam@192.168.1.31 "cd /home/sam/ai-auto-advisor && node scripts/test-e2e.js"
```

**Step 4:** Enable flags one by one per the rollout plan in the design doc.

---

## Summary

| Phase | Tasks | New Files | Modified Files |
|-------|-------|-----------|----------------|
| 1: Shared modules | 1-7 | 12 (6 modules + 6 tests + runner) | 0 |
| 2: Orchestrator | 8-11 | 0 | 1 (orchestrator.js) |
| 3: Telegram UX | 12-15 | 0 | 3 (server.js, formatter.js, orchestrator.js) |
| 4: Platform adapters | 16-18 | 0 | 3 (search-direct.js, partstech-search.js, autoleap-api.js) |
| 5: Runtime hardening | 19-20 | 0 | 2 (telegram server.js, .env.example) |
| 6: Enhanced E2E | 21 | 0 | 1 (test-e2e.js) |
| 7: Verification | 22-25 | 0 | 0 |

**Total: 25 tasks, ~12 new files, ~10 modified files, ~25 commits**
