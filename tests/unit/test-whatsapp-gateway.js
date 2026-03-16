"use strict";

// [test-whatsapp-gateway] Tests for skills/whatsapp-gateway/scripts/server.js
// Covers PLAT-01 (conversation.js delegation) and PLAT-03 (sendAck injection).
// Guard: if conversation.js or server.js do not exist yet, skip gracefully.

const fs = require("fs");
const path = require("path");

let handleMessage;
let serverSrc;

// Guard 1: require conversation.js
try {
  const conv = require("../../skills/shared/conversation");
  handleMessage = conv.handleMessage;
} catch (err) {
  console.log("[test-whatsapp-gateway] WARNING: conversation.js not yet available — skipping");
  process.exit(0);
}

// Guard 2: require server.js (read source text for architecture checks)
const serverPath = path.join(__dirname, "../../skills/whatsapp-gateway/scripts/server.js");
if (!fs.existsSync(serverPath)) {
  console.log("[test-whatsapp-gateway] WARNING: whatsapp-gateway/server.js not yet refactored — Plan 02 must create it");
  process.exit(0);
}
serverSrc = fs.readFileSync(serverPath, "utf8");

// Try to require server.js (may fail due to side effects — that is OK)
let serverMod = null;
try {
  serverMod = require("../../skills/whatsapp-gateway/scripts/server");
} catch (_) {
  // server.js may fail to require (calls listen() on load) — source checks still run
}

// ── Helpers (same pattern as test-conversation.js) ────────────────────────────

function assert(cond, msg) {
  if (!cond) throw new Error("FAIL: " + msg);
}

function mockSessionStore() {
  const store = new Map();
  return {
    getSession(key)       { return store.get(key) || null; },
    setSession(key, data) { store.set(key, data); },
    deleteSession(key)    { store.delete(key); },
  };
}

function mockClaude(response) {
  return {
    messages: {
      create: async () => response,
    },
  };
}

// ── Test suite ────────────────────────────────────────────────────────────────

async function runTests() {
  const tests = [];
  let pass = 0, fail = 0;
  function test(name, fn) { tests.push({ name, fn }); }

  // ── PLAT-01: Architecture — server.js must delegate to conversation.js ──────

  test("PLAT-01: server.js imports conversation.handleMessage (source-level check)", () => {
    // After Plan 02 refactor, server.js must call conversation.handleMessage
    assert(
      serverSrc.includes("conversation") && serverSrc.includes("handleMessage"),
      "server.js must import and call conversation.handleMessage — WILL FAIL before Plan 02 refactor"
    );
  });

  test("PLAT-01: server.js does not contain detectCommand in active code path", () => {
    // Remove single-line comments to avoid matching commented-out code
    const strippedSrc = serverSrc
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
    // After Plan 02, bespoke detectCommand routing must be gone
    assert(
      !strippedSrc.includes("detectCommand("),
      "server.js must NOT contain detectCommand() in active code — WILL FAIL before Plan 02 removes bespoke routing"
    );
  });

  // ── PLAT-03: sendAck injected via conversation.handleMessage ────────────────

  test("PLAT-03: sendAck is called when Claude responds with tool_use (via conversation.handleMessage)", async () => {
    const sessionStore = mockSessionStore();
    let ackCalled = false;

    // tool_use response — sendAck must fire before pipeline result returns
    const toolUseResponse = {
      stop_reason: "tool_use",
      content: [
        {
          type:  "tool_use",
          name:  "run_estimate",
          id:    "tu_wa_001",
          input: {
            make:           "Honda",
            model:          "Civic",
            symptoms:       "P0420",
            customer_name:  "Jane Doe",
            customer_phone: "5551234567",
          },
        },
      ],
    };

    const sendAck = () => { ackCalled = true; };

    await handleMessage(
      "whatsapp",
      "whatsapp:+15551234567",
      "2019 Honda Civic P0420 — customer Jane Doe 5551234567",
      {
        sendAck,
        claudeClient:    mockClaude(toolUseResponse),
        sessionStore,
        enqueueEstimate: async () => ({ labor: 1.5, parts: 299, vehicle: { year: 2019, make: "Honda", model: "Civic" }, diagnosis: { ai: { diagnoses: [] } }, estimate: {}, warnings: [] }),
      }
    );

    assert(ackCalled === true, "sendAck must be called when conversation.handleMessage processes a tool_use response for WhatsApp platform");
  });

  // ── Phone normalization stub (PLAT-01 / Plan 02 contract) ──────────────────

  test("PLAT-01: normalizeWaPhone exported from server.js (Plan 02 contract)", () => {
    // Plan 02 must export normalizeWaPhone so tests can verify session key normalization
    const hasExport = serverMod && typeof serverMod.normalizeWaPhone === "function";
    assert(
      hasExport,
      "normalizeWaPhone not exported from server.js — Plan 02 must export it"
    );
  });

  test("PLAT-01: normalizeWaPhone strips whatsapp: prefix", () => {
    if (!serverMod || typeof serverMod.normalizeWaPhone !== "function") {
      throw new Error("FAIL: normalizeWaPhone not exported — Plan 02 must export it");
    }
    const fn = serverMod.normalizeWaPhone;
    assert(fn("whatsapp:+15551234567") === "+15551234567", "normalizeWaPhone('whatsapp:+15551234567') must return '+15551234567'");
    assert(fn("15551234567") === "+15551234567",           "normalizeWaPhone('15551234567') must return '+15551234567'");
    assert(fn("+15551234567") === "+15551234567",          "normalizeWaPhone('+15551234567') must return '+15551234567'");
  });

  // ── Run all tests ──────────────────────────────────────────────────────────

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

  console.log(`\n[test-whatsapp-gateway] Results: ${pass} passed, ${fail} failed`);
  // Exit 1 so RED state is confirmed — Wave 0 tests are expected to fail
  if (fail > 0) process.exit(1);
}

runTests().catch((e) => {
  console.error(e);
  process.exit(1);
});
