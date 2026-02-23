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
