const {
  validateLaborResult,
  validatePartQuote,
  validateEstimateLine,
  normalizePrice,
  mergeResults,
} = require("../../skills/shared/contracts");

function assert(cond, msg) {
  if (!cond) throw new Error("FAIL: " + msg);
}

async function runTests() {
  const tests = [];
  let pass = 0, fail = 0;

  function test(name, fn) { tests.push({ name, fn }); }

  test("normalizePrice parses dollar string", () => {
    assert(normalizePrice("$123.45") === 123.45, "$123.45");
  });

  test("normalizePrice parses comma format", () => {
    assert(normalizePrice("$1,234.56") === 1234.56, "$1,234.56");
  });

  test("normalizePrice parses plain number", () => {
    assert(normalizePrice(42.5) === 42.5, "number passthrough");
  });

  test("normalizePrice returns null for garbage", () => {
    assert(normalizePrice("N/A") === null, "N/A");
    assert(normalizePrice("") === null, "empty string");
    assert(normalizePrice(null) === null, "null");
    assert(normalizePrice(undefined) === null, "undefined");
    assert(normalizePrice("Call for availability") === null, "call text");
  });

  test("normalizePrice returns null for zero/negative", () => {
    assert(normalizePrice("$0.00") === null, "zero");
    assert(normalizePrice("-5") === null, "negative");
  });

  test("validateLaborResult normalizes valid input", () => {
    const result = validateLaborResult({
      hours: "2.5",
      operation: "Catalytic Converter R&R",
      source: "MOTOR",
    });
    assert(result.hours === 2.5, "hours parsed");
    assert(result.operation === "Catalytic Converter R&R", "operation");
    assert(result.source === "MOTOR", "source");
    assert(result.confidence === 1, "default confidence");
    assert(result.reason_code === null, "no error");
  });

  test("validateLaborResult returns default on bad input", () => {
    const result = validateLaborResult({});
    assert(result.hours === 0, "default hours");
    assert(result.source === "unknown", "unknown source");
    assert(result.reason_code === "INVALID_LABOR", "flagged invalid");
  });

  test("validatePartQuote normalizes valid input", () => {
    const result = validatePartQuote({
      brand: "Dorman",
      part_number: "674-831",
      supplier: "AutoZone",
      unit_price: "$245.99",
      availability: "In Stock",
    });
    assert(result.brand === "Dorman", "brand");
    assert(result.unit_price === 245.99, "price normalized");
    assert(result.source === "partstech", "default source");
    assert(result.reason_code === null, "no error");
  });

  test("validatePartQuote flags unpriceable items", () => {
    const result = validatePartQuote({
      brand: "Dorman",
      part_number: "674-831",
      unit_price: "Call for availability",
    });
    assert(result.unit_price === null, "null price");
    assert(result.reason_code === "NO_PRICE", "flagged");
  });

  test("validateEstimateLine computes total", () => {
    const result = validateEstimateLine({
      type: "part",
      description: "Catalytic Converter",
      qty: 1,
      unit_price: 245.99,
      source: "partstech",
    });
    assert(result.total === 245.99, "total = qty * unit_price");
  });

  test("mergeResults creates new object (no mutation)", () => {
    const base = { labor: { hours: 1.5, source: "AI_fallback" } };
    const overlay = { labor: { hours: 2.5, source: "MOTOR" } };
    const merged = mergeResults(base, overlay);
    assert(merged.labor.source === "MOTOR", "overlay wins");
    assert(base.labor.source === "AI_fallback", "base unchanged");
  });

  test("mergeResults respects source precedence for labor", () => {
    const base = { labor: { hours: 2.5, source: "MOTOR" } };
    const overlay = { labor: { hours: 1.5, source: "AI_fallback" } };
    const merged = mergeResults(base, overlay);
    assert(merged.labor.source === "MOTOR", "MOTOR wins over AI");
    assert(merged.labor.hours === 2.5, "keeps MOTOR hours");
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
  console.log(`\nContracts tests: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

runTests();
