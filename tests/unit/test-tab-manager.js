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
