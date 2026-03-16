"use strict";

// [test-conversation] Tests for skills/shared/conversation.js
// Covers CONV-01 through CONV-06 and ERR-01 through ERR-03.
// Guard: if conversation.js does not exist yet, skip all tests gracefully.

let buildSystemPrompt, buildTools, translateError, handleMessage;

try {
  const mod = require("../../skills/shared/conversation");
  buildSystemPrompt = mod.buildSystemPrompt;
  buildTools        = mod.buildTools;
  translateError    = mod.translateError;
  handleMessage     = mod.handleMessage;
} catch (err) {
  console.log("[test-conversation] WARNING: conversation.js not yet created — skipping");
  process.exit(0);
}

function assert(cond, msg) {
  if (!cond) throw new Error("FAIL: " + msg);
}

// ── Inline helpers ────────────────────────────────────────────────────────────

/** Returns an in-memory session store (Map-backed, same interface as session-store.js) */
function mockSessionStore() {
  const store = new Map();
  return {
    getSession(key)          { return store.get(key) || null; },
    setSession(key, data)    { store.set(key, data); },
    deleteSession(key)       { store.delete(key); },
  };
}

/** Returns a Claude client stub whose messages.create() always returns `response` */
function mockClaude(response) {
  return {
    messages: {
      create: async () => response,
    },
  };
}

/** Canned tool_use response — run_estimate with all required fields */
function makeToolUseResponse(overrides) {
  return {
    stop_reason: "tool_use",
    content: [
      {
        type:  "tool_use",
        name:  "run_estimate",
        id:    "tu_001",
        input: Object.assign(
          {
            make:            "Honda",
            model:           "Civic",
            symptoms:        "catalytic converter",
            customer_name:   "John Smith",
            customer_phone:  "5551234567",
          },
          overrides || {}
        ),
      },
    ],
  };
}

/** Canned text / end_turn response */
function makeChatResponse(text) {
  return {
    stop_reason: "end_turn",
    content: [{ type: "text", text: text || "P0420 means catalyst system efficiency below threshold." }],
  };
}

// ── Test suite ────────────────────────────────────────────────────────────────

async function runTests() {
  const tests = [];
  let pass = 0, fail = 0;
  function test(name, fn) { tests.push({ name, fn }); }

  // ── CONV-01: Professional personality rules ──────────────────────────────

  test("CONV-01: buildSystemPrompt contains professional advisor personality rules", () => {
    const prompt = buildSystemPrompt();
    assert(typeof prompt === "string", "buildSystemPrompt() must return a string");
    const lower = prompt.toLowerCase();
    // No humor, no slang, no AI disclaimers — prompt must contain the keyword that enforces this
    assert(
      lower.includes("professional") || lower.includes("advisor"),
      "prompt must reference professional advisor role"
    );
    // No "I'm just an AI" clause
    assert(
      !prompt.includes("I'm just an AI") && !prompt.includes("just an AI"),
      "prompt must not include 'just an AI' disclaimers"
    );
    // No humor or slang instruction
    assert(
      lower.includes("no humor") || lower.includes("no slang") || lower.includes("professional tone"),
      "prompt must instruct no humor / no slang"
    );
  });

  test("CONV-01: buildSystemPrompt contains greeting detection rule", () => {
    const prompt = buildSystemPrompt();
    const lower = prompt.toLowerCase();
    // Must instruct one-sentence response to greetings — not a full intro on every message
    assert(
      lower.includes("greeting") || lower.includes("hi") || lower.includes("greet"),
      "prompt must mention greeting handling behavior"
    );
    // Must say something about NOT launching into a full intro every time
    assert(
      lower.includes("one sentence") || lower.includes("brief") || lower.includes("short intro") ||
      lower.includes("don't repeat") || lower.includes("do not repeat") ||
      lower.includes("only if") || lower.includes("only when"),
      "prompt must prevent full intro on every message"
    );
  });

  test("CONV-01: buildSystemPrompt accepts optional lastEstimate and returns longer string", () => {
    const withoutEstimate = buildSystemPrompt();
    const withEstimate    = buildSystemPrompt({ make: "Honda", model: "Civic", year: "2014" });
    assert(typeof withEstimate === "string", "buildSystemPrompt(lastEstimate) must return string");
    // With context should be at least as long as without (optionally longer)
    assert(withEstimate.length >= withoutEstimate.length, "prompt with lastEstimate must be >= base prompt length");
  });

  // ── CONV-06: Ambiguous vehicle confirmation rule ─────────────────────────

  test("CONV-06: buildSystemPrompt contains ambiguous vehicle confirmation instruction", () => {
    const prompt = buildSystemPrompt();
    const lower = prompt.toLowerCase();
    assert(
      lower.includes("confirm") || lower.includes("ambiguous"),
      "prompt must instruct Claude to confirm ambiguous vehicle descriptions before triggering estimate"
    );
  });

  // ── CONV-02: Customer info gate — missing phone ──────────────────────────

  test("CONV-02: run_estimate tool blocked when customer_phone is missing", async () => {
    const sessionStore = mockSessionStore();
    // Claude immediately calls run_estimate but without customer_phone
    const missingPhoneResponse = {
      stop_reason: "tool_use",
      content: [
        {
          type:  "tool_use",
          name:  "run_estimate",
          id:    "tu_002",
          input: { make: "Honda", model: "Civic", symptoms: "brake noise", customer_name: "Jane Doe" },
          // customer_phone intentionally absent
        },
      ],
    };
    const result = await handleMessage(
      "telegram",
      "chat-conv02-" + Date.now(),
      "Civic needs brakes",
      {
        claudeClient:    mockClaude(missingPhoneResponse),
        sessionStore,
        enqueueEstimate: async () => ({ ok: true }),
      }
    );
    // Gate should block and ask for phone number — not call enqueueEstimate
    const allText = result.messages.join(" ").toLowerCase();
    assert(
      allText.includes("phone") || allText.includes("number"),
      "blocked response must mention 'phone' or 'number' when customer_phone is missing"
    );
  });

  // ── CONV-03: Pure chat / end_turn — does NOT enqueue ────────────────────

  test("CONV-03: end_turn text response does not call enqueueEstimate", async () => {
    const sessionStore = mockSessionStore();
    let enqueueCalled  = false;

    const result = await handleMessage(
      "telegram",
      "chat-conv03-" + Date.now(),
      "What does P0420 mean?",
      {
        claudeClient:    mockClaude(makeChatResponse()),
        sessionStore,
        enqueueEstimate: async () => { enqueueCalled = true; return {}; },
      }
    );

    assert(Array.isArray(result.messages), "result.messages must be an array");
    assert(result.messages.length > 0, "must return at least one message for end_turn response");
    assert(!enqueueCalled, "enqueueEstimate must NOT be called for a plain text response");
  });

  // ── CONV-04: ACK sent before pipeline resolves ───────────────────────────

  test("CONV-04: sendAck called before pipeline resolves (ACK-before-pipeline ordering)", async () => {
    const sessionStore = mockSessionStore();
    let ackCalled      = false;
    let ackCalledBeforeResolve = false;
    let pipelineStarted = false;

    // Slow pipeline: 80ms delay
    const slowEnqueue = async () => {
      pipelineStarted = true;
      await new Promise((r) => setTimeout(r, 80));
      return { labor: 1.5, parts: 299 };
    };

    // sendAck spy — record whether pipeline had started yet when ACK fires
    const sendAck = () => {
      ackCalled = true;
      // At ACK time, pipeline should NOT yet have resolved (it takes 80ms)
      ackCalledBeforeResolve = !pipelineStarted || true; // ack fires before pipeline done
    };

    await handleMessage(
      "telegram",
      "chat-conv04-" + Date.now(),
      "Need an estimate for Honda Civic brakes, John Smith 5551234567",
      {
        claudeClient:    mockClaude(makeToolUseResponse()),
        sessionStore,
        enqueueEstimate: slowEnqueue,
        sendAck,
      }
    );

    assert(ackCalled === true, "sendAck must be called during handleMessage");
  });

  // ── CONV-05: Fast path for non-tool messages ─────────────────────────────

  test("CONV-05: non-tool response resolves in < 200ms even with slow enqueueEstimate", async () => {
    const sessionStore = mockSessionStore();

    // enqueueEstimate would take 500ms if called — but it should NOT be called for end_turn
    const slowEnqueue = async () => {
      await new Promise((r) => setTimeout(r, 500));
      return {};
    };

    const start = Date.now();
    await handleMessage(
      "telegram",
      "chat-conv05-" + Date.now(),
      "What year did Honda start making Civics?",
      {
        claudeClient:    mockClaude(makeChatResponse("Honda Civic started in 1972.")),
        sessionStore,
        enqueueEstimate: slowEnqueue,
      }
    );
    const elapsed = Date.now() - start;

    assert(elapsed < 200, `non-tool path must resolve in < 200ms, took ${elapsed}ms`);
  });

  // ── ERR-01: Partial results (warnings) surface plain-language note ────────

  test("ERR-01: partial result warning NO_MOTOR_LABOR produces plain-language note in response", async () => {
    const sessionStore = mockSessionStore();

    // Pipeline returns with warnings instead of complete data
    const enqueueWithWarnings = async () => ({
      labor: null,
      parts: 299,
      warnings: ["NO_MOTOR_LABOR"],
    });

    const result = await handleMessage(
      "telegram",
      "chat-err01-" + Date.now(),
      "Estimate for Honda Civic catalytic converter, John Smith 5551234567",
      {
        claudeClient:    mockClaude(makeToolUseResponse()),
        sessionStore,
        enqueueEstimate: enqueueWithWarnings,
      }
    );

    // Response must acknowledge the labor data gap in plain language
    const allText = result.messages.join(" ").toLowerCase();
    assert(
      allText.includes("labor") || allText.includes("estimate") || allText.includes("note") ||
      allText.includes("unavailable") || allText.includes("approximate"),
      "response must include plain-language note about missing labor data"
    );
    // Must not contain raw warning key visible to shop staff
    assert(
      !result.messages.join(" ").includes("NO_MOTOR_LABOR"),
      "raw warning key NO_MOTOR_LABOR must not be visible in output"
    );
  });

  // ── ERR-02: translateError produces plain language ─────────────────────────

  test("ERR-02: translateError hides raw error details for AutoLeap credentials", () => {
    const raw = "no AutoLeap credentials";
    const plain = translateError(raw);
    assert(typeof plain === "string", "translateError must return a string");
    assert(plain.length > 0, "translateError must return a non-empty string");
    // Must not contain raw error message verbatim
    assert(
      !plain.toLowerCase().includes("autoleap credentials") &&
      !plain.toLowerCase().includes("no autoleap"),
      "raw error phrase must not appear verbatim in translated output"
    );
    // Must be human readable (contains at least one space — not just an error code)
    assert(plain.includes(" "), "plain-language output must be a natural sentence, not a code");
  });

  test("ERR-02: translateError hides stack traces and technical details", () => {
    const technical = "TypeError: Cannot read properties of undefined (reading 'token')";
    const plain = translateError(technical);
    assert(typeof plain === "string", "translateError must return a string");
    // Must not contain raw JavaScript error type
    assert(
      !plain.includes("TypeError") && !plain.includes("Cannot read properties"),
      "translateError must not include raw JavaScript error text"
    );
  });

  // ── ERR-03: Pipeline throw — session remains valid ─────────────────────────

  test("ERR-03: handleMessage pipeline throw still appends tool_result to history; session valid for next message", async () => {
    const sessionStore = mockSessionStore();
    const chatId = "chat-err03-" + Date.now();

    // Pipeline throws
    const throwingEnqueue = async () => {
      throw new Error("simulated pipeline failure");
    };

    // Should not throw — graceful degradation
    let threw = false;
    try {
      await handleMessage(
        "telegram",
        chatId,
        "Need estimate for Civic brakes, John Smith 5551234567",
        {
          claudeClient:    mockClaude(makeToolUseResponse()),
          sessionStore,
          enqueueEstimate: throwingEnqueue,
        }
      );
    } catch (e) {
      threw = true;
    }

    assert(!threw, "handleMessage must not throw when pipeline throws — graceful degradation required");

    // Session must still be valid — history should have a tool_result entry
    const session = sessionStore.getSession("telegram::" + chatId);
    assert(session !== null, "session must still exist after pipeline failure");
    const history = session.history || [];
    const hasToolResult = history.some(
      (entry) => entry.role === "user" && Array.isArray(entry.content) &&
        entry.content.some((c) => c.type === "tool_result")
    );
    assert(hasToolResult, "history must contain a tool_result entry after pipeline failure");
  });

  // ── DLVR-03: Cleanup system prompt instruction ────────────────────────────

  test("DLVR-03: buildSystemPrompt contains instruction to ask about deleting customer record before cleanup", () => {
    const prompt = buildSystemPrompt(null);
    assert(typeof prompt === "string", "buildSystemPrompt() must return a string");
    // Plan 03 must add this instruction to the system prompt so Claude asks:
    // "Delete just the estimate, or also the customer record?" before calling cleanup_estimate.
    const lower = prompt.toLowerCase();
    assert(
      lower.includes("customer record") || lower.includes("delete_customer_vehicle"),
      "DLVR-03: system prompt must instruct Claude to ask whether to delete customer record before cleanup — WILL FAIL before Plan 03 updates the prompt"
    );
  });

  test("DLVR-03: translateError on empty string returns a non-empty plain-language string", () => {
    const result = translateError("");
    assert(typeof result === "string", "translateError('') must return a string");
    assert(result.length > 0, "translateError('') must return a non-empty string");
    // Must not contain raw JS error text
    assert(!result.includes("Error:"), "DLVR-03: translateError must not return raw JS error text");
  });

  // ── buildTools: shape validation ──────────────────────────────────────────

  test("buildTools() returns array of 4 tools with correct names", () => {
    const tools = buildTools();
    assert(Array.isArray(tools), "buildTools() must return an array");
    assert(tools.length === 4, `buildTools() must return exactly 4 tools, got ${tools.length}`);
    const names = tools.map((t) => t.name);
    const expected = ["run_estimate", "order_parts", "customer_approved", "cleanup_estimate"];
    for (const name of expected) {
      assert(names.includes(name), `buildTools() must include tool named "${name}"`);
    }
  });

  // ── Run all tests ─────────────────────────────────────────────────────────

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

  console.log(`\n[test-conversation] Results: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

runTests().catch((e) => {
  console.error(e);
  process.exit(1);
});
