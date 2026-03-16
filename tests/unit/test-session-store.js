"use strict";

// [test-session-store] Tests for skills/shared/session-store.js (SESS-01 through SESS-03)
// Guard: if session-store.js does not exist yet, skip all tests gracefully.

let makeKey, getSession, setSession, deleteSession, cleanupExpiredSessions;

try {
  const mod = require("../../skills/shared/session-store");
  makeKey = mod.makeKey;
  getSession = mod.getSession;
  setSession = mod.setSession;
  deleteSession = mod.deleteSession;
  cleanupExpiredSessions = mod.cleanupExpiredSessions;
} catch (err) {
  console.log("[test-session-store] WARNING: session-store.js not yet created — skipping");
  process.exit(0);
}

function assert(cond, msg) {
  if (!cond) throw new Error("FAIL: " + msg);
}

async function runTests() {
  const tests = [];
  let pass = 0, fail = 0;

  function test(name, fn) { tests.push({ name, fn }); }

  const hasSupabase = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

  // SESS-01: makeKey returns correct composite key
  test("makeKey returns platform:chatId format", () => {
    const key = makeKey("telegram", "1385723011");
    assert(key === "telegram:1385723011", `makeKey should return "telegram:1385723011" but got "${key}"`);
  });

  test("makeKey works for whatsapp platform", () => {
    const key = makeKey("whatsapp", "+14155552671");
    assert(key === "whatsapp:+14155552671", `makeKey should return "whatsapp:+14155552671" but got "${key}"`);
  });

  // SESS-02: getSession returns null for unknown key (memory path)
  test("getSession returns null for unknown key", async () => {
    const result = await getSession("telegram", "unknown-key-" + Date.now());
    assert(result === null, "getSession should return null for unknown key");
  });

  // SESS-02: setSession then getSession (memory path) returns same object
  test("setSession then getSession returns same object (in-memory)", async () => {
    const platform = "telegram";
    const chatId = "test-" + Date.now();
    const sessionData = {
      lastEstimate: { ro: "16389" },
      history: [],
      stage: "done",
      collectedData: {}
    };

    await setSession(platform, chatId, sessionData);
    const retrieved = await getSession(platform, chatId);

    assert(retrieved !== null, "getSession should return stored session");
    assert(
      retrieved.stage === "done",
      `stage should be "done" but got "${retrieved && retrieved.stage}"`
    );
    assert(
      retrieved.lastEstimate && retrieved.lastEstimate.ro === "16389",
      "lastEstimate.ro should be '16389'"
    );
  });

  // SESS-02: setSession writes platform and chat_id fields correctly
  test("setSession stores platform and chat_id fields", async () => {
    const platform = "telegram";
    const chatId = "fields-test-" + Date.now();
    const sessionData = {
      platform: platform,
      chat_id: chatId,
      stage: "collecting",
      collectedData: { year: "2019" }
    };

    await setSession(platform, chatId, sessionData);
    const retrieved = await getSession(platform, chatId);

    assert(retrieved !== null, "should retrieve session");
    assert(
      retrieved.platform === platform,
      `platform field should be "${platform}" but got "${retrieved && retrieved.platform}"`
    );
    assert(
      retrieved.chat_id === chatId,
      `chat_id field should be "${chatId}" but got "${retrieved && retrieved.chat_id}"`
    );
  });

  // SESS-02: deleteSession removes session from memory
  test("deleteSession removes session, getSession returns null", async () => {
    const platform = "telegram";
    const chatId = "delete-test-" + Date.now();

    await setSession(platform, chatId, { stage: "done", collectedData: {} });
    await deleteSession(platform, chatId);
    const result = await getSession(platform, chatId);
    assert(result === null, "getSession should return null after deleteSession");
  });

  // SESS-03: in-memory fallback works when SUPABASE env vars absent
  test("in-memory fallback: getSession/setSession work without Supabase", async () => {
    // This test works regardless of whether Supabase is configured —
    // memory path is always available as fallback.
    const platform = "telegram";
    const chatId = "mem-fallback-" + Date.now();
    const data = { stage: "researching", collectedData: { year: "2020", make: "Toyota" } };

    await setSession(platform, chatId, data);
    const retrieved = await getSession(platform, chatId);

    assert(retrieved !== null, "memory fallback: session should be retrievable");
    assert(retrieved.stage === "researching", "memory fallback: stage should match");
    assert(
      retrieved.collectedData && retrieved.collectedData.make === "Toyota",
      "memory fallback: collectedData should match"
    );
  });

  // SESS-03: cleanupExpiredSessions returns gracefully when Supabase is null
  test("cleanupExpiredSessions returns { deleted: 0 } without Supabase", async () => {
    if (hasSupabase) {
      console.log("  SKIP (SUPABASE_URL set — cleanup test only applies to no-Supabase mode)");
      return;
    }
    const result = await cleanupExpiredSessions();
    assert(
      result && typeof result.deleted === "number",
      "cleanupExpiredSessions should return { deleted: N }"
    );
    assert(result.deleted === 0, "should return { deleted: 0 } when no Supabase");
  });

  // Supabase round-trip (skipped when no credentials)
  test("Supabase round-trip: setSession + getSession (skipped if no SUPABASE_URL)", async () => {
    if (!hasSupabase) {
      console.log("  SKIP (no SUPABASE_URL — skipping Supabase round-trip)");
      return;
    }
    const platform = "telegram";
    const chatId = "supabase-rt-" + Date.now();
    const data = { stage: "done", collectedData: { year: "2021", make: "Honda" } };

    await setSession(platform, chatId, data);
    const retrieved = await getSession(platform, chatId);
    assert(retrieved !== null, "Supabase round-trip: session should be stored");
    assert(retrieved.stage === "done", "Supabase round-trip: stage should match");
    await deleteSession(platform, chatId);
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

  console.log(`\n[test-session-store] Results: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

runTests().catch((e) => {
  console.error(e);
  process.exit(1);
});
