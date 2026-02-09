/**
 * test-local.js — Local test runner for SAM diagnostics engine
 *
 * Tests DB connectivity, knowledge base queries, and optionally
 * runs a full AI diagnosis if ANTHROPIC_API_KEY is available.
 *
 * Usage: node scripts/test-local.js
 *        node scripts/test-local.js --full   (runs full AI diagnosis)
 */

// --- Load env vars from config/.env ---
const fs = require("fs");
const path = require("path");
const envPath = path.join(__dirname, "..", "config", ".env");
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx);
    const val = trimmed.slice(eqIdx + 1);
    if (!process.env[key]) process.env[key] = val;
  }
  console.log("  Loaded env from config/.env");
}

const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const fullMode = process.argv.includes("--full");

// --- Helpers ---

function pass(label) { console.log(`  ✓ ${label}`); }
function fail(label, err) { console.log(`  ✗ ${label}: ${err}`); }
function section(label) { console.log(`\n── ${label} ${"─".repeat(Math.max(0, 50 - label.length))}`); }

// --- Test 1: DB Connectivity ---

async function testConnection() {
  section("DB Connectivity");

  const { data, error } = await supabase.from("dtc_codes").select("code").limit(1);
  if (error) { fail("Supabase connection", error.message); return false; }
  pass(`Connected to Supabase (${process.env.SUPABASE_URL})`);
  return true;
}

// --- Test 2: Table Counts ---

async function testTableCounts() {
  section("Table Counts");

  const tables = [
    { name: "dtc_codes", expected: 170 },
    { name: "diagnostic_knowledge", expected: 250 },
    { name: "labor_cache", expected: 900 },
  ];

  for (const t of tables) {
    const { count, error } = await supabase.from(t.name).select("*", { count: "exact", head: true });
    if (error) { fail(t.name, error.message); continue; }
    const ok = count >= t.expected;
    if (ok) pass(`${t.name}: ${count} rows (expected ${t.expected}+)`);
    else fail(`${t.name}: ${count} rows (expected ${t.expected}+)`);
  }
}

// --- Test 3: DTC Lookup ---

async function testDtcLookup() {
  section("DTC Lookup (P0420)");

  const { data, error } = await supabase
    .from("dtc_codes")
    .select("*")
    .eq("code", "P0420")
    .single();

  if (error) { fail("DTC lookup", error.message); return; }
  pass(`Found: ${data.code} — ${data.description}`);
  pass(`Category: ${data.category}, Severity: ${data.severity}`);
}

// --- Test 4: Knowledge Base Query ---

async function testKnowledgeQuery() {
  section("Knowledge Base Query (P0420)");

  const { data, error } = await supabase
    .from("diagnostic_knowledge")
    .select("cause, cause_category, confidence_base, success_rate, parts_needed, repair_plan")
    .eq("dtc_code", "P0420")
    .order("confidence_base", { ascending: false })
    .limit(5);

  if (error) { fail("KB query", error.message); return; }
  pass(`Found ${data.length} causes for P0420`);

  for (const row of data) {
    const conf = (row.confidence_base * 100).toFixed(0);
    const hasRepairPlan = row.repair_plan ? " [has repair plan]" : "";
    console.log(`    ${conf}% — ${row.cause}${hasRepairPlan}`);
  }
}

// --- Test 5: Vehicle-Specific Pattern ---

async function testVehiclePattern() {
  section("Vehicle-Specific Pattern (P0300 + Chevy Silverado 5.3L)");

  const { data, error } = await supabase
    .from("diagnostic_knowledge")
    .select("cause, confidence_base, parts_needed, common_misdiagnosis, source")
    .eq("dtc_code", "P0300")
    .eq("vehicle_make", "Chevrolet")
    .eq("vehicle_model", "Silverado")
    .limit(3);

  if (error) { fail("Vehicle pattern query", error.message); return; }
  if (data.length === 0) { fail("No vehicle-specific pattern found"); return; }

  pass(`Found ${data.length} Silverado-specific cause(s)`);
  for (const row of data) {
    console.log(`    ${(row.confidence_base * 100).toFixed(0)}% — ${row.cause}`);
    if (row.common_misdiagnosis) console.log(`    ⚠ Misdiag: ${row.common_misdiagnosis}`);
  }
}

// --- Test 6: Labor Cache ---

async function testLaborCache() {
  section("Labor Cache (Honda Civic)");

  const { data, error } = await supabase
    .from("labor_cache")
    .select("procedure_name, labor_hours, notes")
    .eq("vehicle_make", "Honda")
    .eq("vehicle_model", "Civic")
    .order("procedure_name")
    .limit(10);

  if (error) { fail("Labor cache query", error.message); return; }
  pass(`Found ${data.length} labor times for Honda Civic`);

  for (const row of data) {
    const note = row.notes ? ` (${row.notes})` : "";
    console.log(`    ${row.labor_hours}h — ${row.procedure_name}${note}`);
  }
}

// --- Test 7: Repair Plan Detail ---

async function testRepairPlan() {
  section("Repair Plan Detail (P0420 + Honda Civic)");

  const { data, error } = await supabase
    .from("diagnostic_knowledge")
    .select("repair_plan")
    .eq("dtc_code", "P0420")
    .eq("vehicle_make", "Honda")
    .eq("vehicle_model", "Civic")
    .not("repair_plan", "is", null)
    .limit(1)
    .single();

  if (error) { fail("Repair plan query", error.message); return; }
  if (!data || !data.repair_plan) { fail("No repair plan found"); return; }

  const rp = data.repair_plan;
  pass(`Repair plan loaded`);
  console.log(`    Parts: ${rp.parts.map(p => p.name).join(", ")}`);
  console.log(`    Labor: ${rp.labor.hours}h (${rp.labor.category})`);
  console.log(`    Tools: ${rp.tools.slice(0, 3).join(", ")}...`);
  if (rp.torque_specs) {
    const specs = Object.entries(rp.torque_specs);
    console.log(`    Torque specs: ${specs.length} items`);
  }
  if (rp.verification) {
    console.log(`    Verification: before + after procedures defined`);
  }
}

// --- Test 8: Full AI Diagnosis (optional) ---

async function testFullDiagnosis() {
  section("Full AI Diagnosis (requires ANTHROPIC_API_KEY)");

  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("  ⏭ Skipped — set ANTHROPIC_API_KEY to enable");
    console.log("  Run: set ANTHROPIC_API_KEY=sk-ant-... && node scripts/test-local.js --full");
    return;
  }

  try {
    const { diagnose } = require("../skills/ai-diagnostics/scripts/diagnose");

    console.log("  Running diagnosis for 2018 Honda Civic P0420...\n");

    const result = await diagnose({
      year: 2018,
      make: "Honda",
      model: "Civic",
      engine: "2.0L",
      mileage: 95000,
      dtcCodes: ["P0420"],
      symptoms: "Check engine light on, slight sulfur smell from exhaust",
    });

    if (result.error) {
      fail(`Diagnosis error: ${result.error}`);
      return;
    }

    pass(`Diagnosis complete (${result.diagnostic_path || result.path || "unknown"} path)`);
    console.log(`    Processing: ${result.processing_time_ms || "?"}ms`);

    if (result.causes && result.causes.length > 0) {
      console.log(`    Top causes:`);
      for (const c of result.causes.slice(0, 3)) {
        const conf = ((c.confidence || 0) * 100).toFixed(0);
        console.log(`      ${conf}% — ${c.cause}`);
      }
    }

    if (result.repair_plan) {
      console.log(`    Repair plan: ${result.repair_plan.parts?.length || 0} parts, ${result.repair_plan.labor?.hours || "?"}h labor`);
    }

    if (result.tsbs) {
      console.log(`    TSBs found: ${result.tsbs.length}`);
    }
  } catch (err) {
    fail(`Diagnosis failed: ${err.message}`);
  }
}

// --- Main ---

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  SAM — Local Test Runner");
  console.log("═══════════════════════════════════════════════════════════");

  const connected = await testConnection();
  if (!connected) {
    console.log("\n✗ Cannot connect to Supabase. Check your credentials.");
    process.exit(1);
  }

  await testTableCounts();
  await testDtcLookup();
  await testKnowledgeQuery();
  await testVehiclePattern();
  await testLaborCache();
  await testRepairPlan();

  if (fullMode) {
    await testFullDiagnosis();
  } else {
    section("Full AI Diagnosis");
    console.log("  ⏭ Skipped — run with --full flag to test AI diagnosis");
    console.log("  Requires: ANTHROPIC_API_KEY env var");
  }

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("  Tests complete!");
  console.log("═══════════════════════════════════════════════════════════\n");
}

main().catch((err) => {
  console.error("TEST FAILED:", err);
  process.exit(1);
});
