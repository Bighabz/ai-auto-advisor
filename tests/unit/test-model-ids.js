"use strict";

// [test-model-ids] Tests for model ID hygiene (MODEL-01 through MODEL-03)
// Reads source files directly — no require() of non-existent modules.
// These tests will FAIL before Plan 01-04 (intentional RED state).

const fs = require("fs");
const path = require("path");

function assert(cond, msg) {
  if (!cond) throw new Error("FAIL: " + msg);
}

async function runTests() {
  const tests = [];
  let pass = 0, fail = 0;

  function test(name, fn) { tests.push({ name, fn }); }

  // Load source files (cwd is project root — set by run.js)
  const serverPath = path.join(process.cwd(), "skills/telegram-gateway/scripts/server.js");
  const diagnosePath = path.join(process.cwd(), "skills/ai-diagnostics/scripts/diagnose.js");
  const motorNavPath = path.join(process.cwd(), "skills/autoleap-browser/scripts/helpers/motor-nav.js");

  let server, diagnose, motorNav;
  try {
    server = fs.readFileSync(serverPath, "utf8");
  } catch (e) {
    server = null;
  }
  try {
    diagnose = fs.readFileSync(diagnosePath, "utf8");
  } catch (e) {
    diagnose = null;
  }
  try {
    motorNav = fs.readFileSync(motorNavPath, "utf8");
  } catch (e) {
    motorNav = null;
  }

  // MODEL-01: server.js must not contain deprecated claude-3-haiku-20240307
  test("server.js does NOT contain deprecated claude-3-haiku-20240307", () => {
    if (!server) throw new Error("FAIL: server.js not found at " + serverPath);
    assert(
      !server.includes("claude-3-haiku-20240307"),
      "server.js must not contain deprecated model ID 'claude-3-haiku-20240307' — use CLAUDE_HAIKU_MODEL env var"
    );
  });

  // MODEL-01: server.js must not hardcode sonnet model ID
  test("server.js does NOT hardcode claude-sonnet-4-5-20250929", () => {
    if (!server) throw new Error("FAIL: server.js not found at " + serverPath);
    assert(
      !server.includes('"claude-sonnet-4-5-20250929"'),
      "server.js model must be env var, not hardcoded string 'claude-sonnet-4-5-20250929'"
    );
  });

  // MODEL-01: server.js must reference CLAUDE_SONNET_MODEL env var
  test("server.js contains process.env.CLAUDE_SONNET_MODEL", () => {
    if (!server) throw new Error("FAIL: server.js not found at " + serverPath);
    assert(
      server.includes("process.env.CLAUDE_SONNET_MODEL"),
      "server.js should use process.env.CLAUDE_SONNET_MODEL instead of a hardcoded model string"
    );
  });

  // MODEL-02: diagnose.js must not hardcode sonnet model ID
  test("diagnose.js does NOT hardcode claude-sonnet-4-5-20250929", () => {
    if (!diagnose) throw new Error("FAIL: diagnose.js not found at " + diagnosePath);
    assert(
      !diagnose.includes('"claude-sonnet-4-5-20250929"'),
      "diagnose.js model must be env var, not hardcoded string 'claude-sonnet-4-5-20250929'"
    );
  });

  // MODEL-02: diagnose.js must not use bare CLAUDE_MODEL const set to hardcoded string
  test("diagnose.js does NOT assign hardcoded model string to CLAUDE_MODEL constant", () => {
    if (!diagnose) throw new Error("FAIL: diagnose.js not found at " + diagnosePath);
    // Pattern: const CLAUDE_MODEL = "claude-..." (any hardcoded string literal)
    const hasHardcodedConst = /const\s+CLAUDE_MODEL\s*=\s*["']claude-[^"']+["']/.test(diagnose);
    assert(
      !hasHardcodedConst,
      "diagnose.js must not assign a hardcoded model string to CLAUDE_MODEL — use process.env.CLAUDE_SONNET_MODEL"
    );
  });

  // MODEL-02: diagnose.js must reference CLAUDE_SONNET_MODEL env var
  test("diagnose.js contains process.env.CLAUDE_SONNET_MODEL", () => {
    if (!diagnose) throw new Error("FAIL: diagnose.js not found at " + diagnosePath);
    assert(
      diagnose.includes("process.env.CLAUDE_SONNET_MODEL"),
      "diagnose.js should use process.env.CLAUDE_SONNET_MODEL instead of a hardcoded model string"
    );
  });

  // MODEL-03: motor-nav.js must not contain deprecated claude-3-haiku-20240307
  test("motor-nav.js does NOT contain deprecated claude-3-haiku-20240307", () => {
    if (!motorNav) throw new Error("FAIL: motor-nav.js not found at " + motorNavPath);
    assert(
      !motorNav.includes("claude-3-haiku-20240307"),
      "motor-nav.js must not contain deprecated model ID 'claude-3-haiku-20240307' — use CLAUDE_HAIKU_MODEL env var"
    );
  });

  // MODEL-03: motor-nav.js must not hardcode claude-haiku-4-5 string
  test("motor-nav.js does NOT hardcode any claude-haiku model string", () => {
    if (!motorNav) throw new Error("FAIL: motor-nav.js not found at " + motorNavPath);
    // Match any hardcoded claude-haiku string in quotes
    const hasHardcodedHaiku = /"claude-haiku[^"]*"/.test(motorNav);
    assert(
      !hasHardcodedHaiku,
      "motor-nav.js must not contain a hardcoded haiku model string — use process.env.CLAUDE_HAIKU_MODEL"
    );
  });

  // MODEL-03: motor-nav.js must reference CLAUDE_HAIKU_MODEL env var
  test("motor-nav.js contains process.env.CLAUDE_HAIKU_MODEL", () => {
    if (!motorNav) throw new Error("FAIL: motor-nav.js not found at " + motorNavPath);
    assert(
      motorNav.includes("process.env.CLAUDE_HAIKU_MODEL"),
      "motor-nav.js should use process.env.CLAUDE_HAIKU_MODEL instead of a hardcoded model string"
    );
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

  console.log(`\n[test-model-ids] Results: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

runTests().catch((e) => {
  console.error(e);
  process.exit(1);
});
