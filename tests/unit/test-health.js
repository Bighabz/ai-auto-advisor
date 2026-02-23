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
