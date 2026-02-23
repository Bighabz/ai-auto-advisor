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

  test("FailureClass classifies errors correctly", () => {
    assert(FailureClass.isRetryable("TIMEOUT"), "TIMEOUT is retryable");
    assert(FailureClass.isRetryable("STALE_TAB"), "STALE_TAB is retryable");
    assert(FailureClass.isRetryable("NETWORK"), "NETWORK is retryable");
    assert(!FailureClass.isRetryable("AUTH_FAILED"), "AUTH_FAILED is terminal");
    assert(!FailureClass.isRetryable("PLATFORM_DOWN"), "PLATFORM_DOWN is terminal");
    assert(!FailureClass.isRetryable("NOT_FOUND"), "NOT_FOUND is terminal");
    assert(!FailureClass.isRetryable("PARSE_ERROR"), "PARSE_ERROR is terminal");
  });

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
