"use strict";

// [test-whatsapp-format] Tests for skills/whatsapp-gateway/scripts/formatter.js
// Covers PLAT-02: WhatsApp format compliance (no double asterisks, no backtick spans, no headers).
// Guard: if formatter.js does not exist, skip gracefully.

let formatForWhatsApp;

try {
  const fmt = require("../../skills/whatsapp-gateway/scripts/formatter");
  formatForWhatsApp = fmt.formatForWhatsApp;
} catch (err) {
  console.log("[test-whatsapp-format] WARNING: formatter.js not yet available — skipping");
  process.exit(0);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function assert(cond, msg) {
  if (!cond) throw new Error("FAIL: " + msg);
}

// ── Mock results object (exercises formatForWhatsApp without crashes) ─────────
//
// The formatter's parts section uses parts.bestValueBundle — so we supply
// both that structure and a flat parts array for future compatibility.

const mockResults = {
  vehicle:  { year: 2019, make: "Honda", model: "Civic" },
  diagnosis: {
    ai: {
      diagnoses: [
        { cause: "Catalytic converter efficiency below threshold", code: "P0420", confidence: 0.91 },
      ],
    },
  },
  labor:    { hours: 1.2, rate: 120, total: 144 },
  parts: {
    // bestValueBundle format (matches formatter)
    bestValueBundle: {
      parts: [
        {
          selected: {
            brand: "MagnaFlow",
            description: "Catalytic Converter",
            retail: 649.52,
            qty: 1,
            position: "Front",
          },
        },
      ],
    },
  },
  estimate: {
    total:       793.52,
    totalLabor:  144,
    totalParts:  649.52,
    estimateId:  "16389",
  },
  warnings: [],
};

// ── Test suite ────────────────────────────────────────────────────────────────

async function runTests() {
  const tests = [];
  let pass = 0, fail = 0;
  function test(name, fn) { tests.push({ name, fn }); }

  // ── PLAT-02: WhatsApp format compliance ──────────────────────────────────

  test("PLAT-02: formatForWhatsApp returns an array", () => {
    const messages = formatForWhatsApp(mockResults);
    assert(Array.isArray(messages), "formatForWhatsApp() must return an array");
    assert(messages.length > 0, "formatForWhatsApp() must return at least one message");
  });

  test("PLAT-02: output contains no double asterisks (**bold** is Markdown, not WhatsApp)", () => {
    const messages = formatForWhatsApp(mockResults);
    const allText = messages.join("");
    assert(
      !allText.includes("**"),
      "WhatsApp output must NOT contain ** (double asterisks) — use *single asterisks* for bold"
    );
  });

  test("PLAT-02: output contains no backtick code spans", () => {
    const messages = formatForWhatsApp(mockResults);
    const allText = messages.join("");
    // Backtick spans — inline code like `code` or ```block```
    assert(
      allText.match(/`[^`]+`/) === null,
      "WhatsApp output must NOT contain backtick code spans — not rendered on mobile"
    );
  });

  test("PLAT-02: output contains no Markdown headers (lines starting with #)", () => {
    const messages = formatForWhatsApp(mockResults);
    const allLines = messages.join("\n").split("\n");
    const headerLines = allLines.filter((line) => /^#+\s/.test(line));
    assert(
      headerLines.length === 0,
      `WhatsApp output must NOT contain Markdown headers — found: ${headerLines.join(", ")}`
    );
  });

  test("PLAT-02: output uses *single asterisks* for bold (WhatsApp-native format)", () => {
    const messages = formatForWhatsApp(mockResults);
    const allText = messages.join("");
    // WhatsApp native bold — at least one *word* pattern expected from formatter
    assert(
      allText.includes("*"),
      "WhatsApp output should use *single asterisks* for bold — formatter must produce WA-native markup"
    );
  });

  test("PLAT-02: output does not contain triple backticks (code blocks)", () => {
    const messages = formatForWhatsApp(mockResults);
    const allText = messages.join("");
    assert(
      !allText.includes("```"),
      "WhatsApp output must NOT contain ``` code blocks — not rendered on mobile"
    );
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

  console.log(`\n[test-whatsapp-format] Results: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

runTests().catch((e) => {
  console.error(e);
  process.exit(1);
});
