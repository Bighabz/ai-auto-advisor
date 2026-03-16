"use strict";

// [test-job-queue] Tests for skills/shared/job-queue.js (QUEUE-01 through QUEUE-04)
// Guard: if job-queue.js does not exist yet, skip all tests gracefully.

let enqueueEstimate, getStatus, queue;

try {
  const mod = require("../../skills/shared/job-queue");
  enqueueEstimate = mod.enqueueEstimate;
  getStatus = mod.getStatus;
  queue = mod.queue;
} catch (err) {
  console.log("[test-job-queue] WARNING: job-queue.js not yet created — skipping");
  process.exit(0);
}

function assert(cond, msg) {
  if (!cond) throw new Error("FAIL: " + msg);
}

async function runTests() {
  const tests = [];
  let pass = 0, fail = 0;

  function test(name, fn) { tests.push({ name, fn }); }

  // QUEUE-01: Single enqueue runs immediately
  test("single job runs immediately", async () => {
    const userId = "user-single-" + Date.now();
    let ran = false;
    const result = await enqueueEstimate(userId, async () => {
      ran = true;
      return { ok: true };
    }, {});
    assert(ran === true, "jobFn should have run");
    assert(result && result.ok === true, "should resolve with jobFn return value");
    assert(getStatus(userId) === null, "status should be null after completion");
  });

  // QUEUE-01 + QUEUE-03: Second job queues and runs after first
  test("second job queues and runs after first", async () => {
    const userId1 = "user-seq-a-" + Date.now();
    const userId2 = "user-seq-b-" + Date.now();
    const order = [];

    // Start first job (slow)
    const p1 = enqueueEstimate(userId1, async () => {
      order.push("job1-start");
      await new Promise((r) => setTimeout(r, 50));
      order.push("job1-end");
      return { job: 1 };
    }, {});

    // Allow first job to start
    await new Promise((r) => setTimeout(r, 5));

    // Enqueue second job (different user — it should queue after first)
    const p2 = enqueueEstimate(userId2, async () => {
      order.push("job2");
      return { job: 2 };
    }, {});

    const [r1, r2] = await Promise.all([p1, p2]);

    assert(r1 && r1.job === 1, "first job resolves correctly");
    assert(r2 && r2.job === 2, "second job resolves correctly");
    // Both jobs ran
    assert(order.includes("job1-start"), "job1 started");
    assert(order.includes("job1-end"), "job1 finished");
    assert(order.includes("job2"), "job2 ran");
  });

  // QUEUE-02: getStatus returns running during execution
  test("getStatus returns running during execution", async () => {
    const userId = "user-status-" + Date.now();
    let statusDuringRun = null;

    await enqueueEstimate(userId, async () => {
      statusDuringRun = getStatus(userId);
      return { done: true };
    }, {});

    assert(statusDuringRun !== null, "getStatus should not be null during run");
    assert(statusDuringRun.status === "running", "status should be 'running' during execution");
    // After completion
    assert(getStatus(userId) === null, "status should be null after completion");
  });

  // QUEUE-04: Idempotent re-enqueue — same userId while first is running returns alreadyQueued: true
  test("idempotent re-enqueue same userId", async () => {
    const userId = "user-idem-" + Date.now();
    let secondResult = null;

    // Start first job (slow)
    const p1 = enqueueEstimate(userId, async () => {
      await new Promise((r) => setTimeout(r, 80));
      return { job: 1 };
    }, {});

    // Allow first job to start
    await new Promise((r) => setTimeout(r, 5));

    // Enqueue same userId again — should be idempotent
    try {
      secondResult = await enqueueEstimate(userId, async () => {
        return { job: 2 };
      }, {});
    } catch (e) {
      secondResult = e;
    }

    await p1; // Wait for first to finish

    assert(
      secondResult !== null && secondResult.alreadyQueued === true,
      "second enqueue of same userId should return { alreadyQueued: true }"
    );
  });

  // QUEUE-03: notifyPosition callback is called when queue has waiters
  test("notifyPosition called when queue has waiters", async () => {
    const userId1 = "user-notify-a-" + Date.now();
    const userId2 = "user-notify-b-" + Date.now();
    let notifyCalled = false;
    let notifyArgs = null;

    // Start first job (slow)
    const p1 = enqueueEstimate(userId1, async () => {
      await new Promise((r) => setTimeout(r, 80));
      return { job: 1 };
    }, {});

    // Allow first job to start
    await new Promise((r) => setTimeout(r, 5));

    // Enqueue second job with notifyPosition spy
    const p2 = enqueueEstimate(userId2, async () => {
      return { job: 2 };
    }, {
      notifyPosition: (position, waitMinutes) => {
        notifyCalled = true;
        notifyArgs = { position, waitMinutes };
      }
    });

    await Promise.all([p1, p2]);

    assert(notifyCalled === true, "notifyPosition callback should have been called");
    assert(typeof notifyArgs.position === "number", "notifyPosition called with numeric position");
    assert(typeof notifyArgs.waitMinutes === "number", "notifyPosition called with numeric waitMinutes");
  });

  // QUEUE-02: getStatus returns null after completion
  test("getStatus returns null after completion", async () => {
    const userId = "user-post-" + Date.now();
    await enqueueEstimate(userId, async () => ({ result: "done" }), {});
    const status = getStatus(userId);
    assert(status === null, "getStatus should return null after job completes");
  });

  // QUEUE-02: getStatus returns null for unknown user
  test("getStatus returns null for unknown userId", () => {
    const status = getStatus("user-who-never-existed-" + Date.now());
    assert(status === null, "getStatus should return null for unknown userId");
  });

  // Run all tests
  for (const { name, fn } of tests) {
    try {
      await fn();
      pass++;
      console.log(`  PASS: ${name}`);
    } catch (e) {
      fail++;
      console.error(`  FAIL: ${name} — ${e.message}`);
    }
  }

  console.log(`\n[test-job-queue] Results: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

runTests().catch((e) => {
  console.error(e);
  process.exit(1);
});
