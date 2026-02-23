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
