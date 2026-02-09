/**
 * seed-all-via-supabase.js — Seeds all data directly via Supabase client.
 *
 * Inserts DTC codes, cause mappings, vehicle patterns, repair plans,
 * and labor times WITHOUT requiring OpenAI embeddings.
 *
 * The diagnostic_knowledge entries are inserted without the embedding
 * column — diagnose.js will use claude_only path until embeddings
 * are generated (can be done later with OpenAI key).
 *
 * Usage: node scripts/seed-all-via-supabase.js
 * Requires: SUPABASE_URL and SUPABASE_ANON_KEY env vars
 */

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error("ERROR: Set SUPABASE_URL and SUPABASE_ANON_KEY env vars");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// --- Helpers ---

async function batchInsert(table, rows, batchSize = 50, upsertKey = null) {
  let inserted = 0;
  let errors = 0;

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);

    const query = upsertKey
      ? supabase.from(table).upsert(batch, { onConflict: upsertKey })
      : supabase.from(table).insert(batch);

    const { error } = await query;

    if (error) {
      console.error(`  [${table}] Batch ${i}-${i + batch.length} failed: ${error.message}`);
      errors += batch.length;
    } else {
      inserted += batch.length;
    }
  }

  return { inserted, errors };
}

// --- Seed DTC Codes ---

async function seedDtcCodes() {
  const DTC_CODES = require("../skills/ai-diagnostics/scripts/seed-dtc-codes");
  console.log(`\n[1/5] Seeding ${DTC_CODES.length} DTC codes...`);
  const result = await batchInsert("dtc_codes", DTC_CODES, 50, "code");
  console.log(`  Done: ${result.inserted} inserted, ${result.errors} errors`);
  return result;
}

// --- Seed Cause Mappings (diagnostic_knowledge, no embeddings) ---

async function seedCauseMappings() {
  const PART_A = require("../skills/ai-diagnostics/scripts/seed-causes-a");
  const PART_B = require("../skills/ai-diagnostics/scripts/seed-causes-b");
  const allCauses = [...PART_A, ...PART_B];

  console.log(`\n[2/5] Seeding ${allCauses.length} cause mappings (no embeddings)...`);

  const rows = allCauses.map((c) => ({
    dtc_code: c.dtc_code,
    dtc_description: c.dtc_description || null,
    vehicle_make: c.vehicle_make || null,
    vehicle_model: c.vehicle_model || null,
    year_range_start: c.year_range_start || null,
    year_range_end: c.year_range_end || null,
    engine_type: c.engine_type || null,
    cause: c.cause,
    cause_category: c.cause_category || null,
    confidence_base: c.confidence_base ?? 0.5,
    success_rate: c.success_rate || null,
    parts_needed: c.parts_needed || null,
    labor_category: c.labor_category || null,
    labor_hours_estimate: c.labor_hours_estimate || null,
    diagnostic_steps: c.diagnostic_steps || null,
    common_misdiagnosis: c.common_misdiagnosis || null,
    source: c.source || "community",
    // embedding: null — skipped, vector search won't match but claude_only path works
  }));

  const result = await batchInsert("diagnostic_knowledge", rows, 50);
  console.log(`  Done: ${result.inserted} inserted, ${result.errors} errors`);
  return result;
}

// --- Seed Vehicle Patterns (diagnostic_knowledge, no embeddings) ---

async function seedVehiclePatterns() {
  const VEHICLE_PATTERNS = require("../skills/ai-diagnostics/scripts/seed-vehicle-patterns");
  console.log(`\n[3/5] Seeding ${VEHICLE_PATTERNS.length} vehicle-specific patterns (no embeddings)...`);

  const rows = VEHICLE_PATTERNS.map((c) => ({
    dtc_code: c.dtc_code,
    dtc_description: c.dtc_description || null,
    vehicle_make: c.vehicle_make || null,
    vehicle_model: c.vehicle_model || null,
    year_range_start: c.year_range_start || null,
    year_range_end: c.year_range_end || null,
    engine_type: c.engine_type || null,
    cause: c.cause,
    cause_category: c.cause_category || null,
    confidence_base: c.confidence_base ?? 0.5,
    success_rate: c.success_rate || null,
    parts_needed: c.parts_needed || null,
    labor_category: c.labor_category || null,
    labor_hours_estimate: c.labor_hours_estimate || null,
    diagnostic_steps: c.diagnostic_steps || null,
    common_misdiagnosis: c.common_misdiagnosis || null,
    source: c.source || "community",
  }));

  const result = await batchInsert("diagnostic_knowledge", rows, 50);
  console.log(`  Done: ${result.inserted} inserted, ${result.errors} errors`);
  return result;
}

// --- Seed Repair Plans (update existing diagnostic_knowledge rows) ---

async function seedRepairPlans() {
  let REPAIR_PLANS;
  try {
    REPAIR_PLANS = require("../skills/ai-diagnostics/scripts/seed-repair-plans");
  } catch {
    console.log("\n[4/5] seed-repair-plans.js not found — skipping");
    return { inserted: 0, errors: 0 };
  }

  // seed-repair-plans.js exports an array of { dtc_code, vehicle_make, vehicle_model, repair_plan }
  // We need to update existing diagnostic_knowledge rows
  console.log(`\n[4/5] Seeding ${REPAIR_PLANS.length} repair plans...`);

  let updated = 0;
  let errors = 0;

  for (const plan of REPAIR_PLANS) {
    const { data, error } = await supabase
      .from("diagnostic_knowledge")
      .update({ repair_plan: plan.repair_plan })
      .eq("dtc_code", plan.dtc_code)
      .eq("vehicle_make", plan.vehicle_make)
      .eq("vehicle_model", plan.vehicle_model)
      .select("id")
      .limit(1);

    if (error) {
      errors++;
    } else if (data && data.length > 0) {
      updated++;
    } else {
      // No matching row — insert as new entry with repair plan
      const { error: insertError } = await supabase
        .from("diagnostic_knowledge")
        .insert({
          dtc_code: plan.dtc_code,
          vehicle_make: plan.vehicle_make,
          vehicle_model: plan.vehicle_model,
          cause: plan.repair_plan.diagnosis || plan.dtc_code,
          repair_plan: plan.repair_plan,
          source: "repair_plan_seed",
        });

      if (insertError) {
        errors++;
      } else {
        updated++;
      }
    }
  }

  console.log(`  Done: ${updated} updated/inserted, ${errors} errors`);
  return { inserted: updated, errors };
}

// --- Seed Labor Times ---

async function seedLaborTimes() {
  let LABOR_TIMES;
  try {
    LABOR_TIMES = require("../skills/ai-diagnostics/scripts/seed-labor-times");
  } catch {
    console.log("\n[5/5] seed-labor-times.js not found — skipping");
    return { inserted: 0, errors: 0 };
  }

  console.log(`\n[5/5] Seeding ${LABOR_TIMES.length} labor times...`);
  const result = await batchInsert("labor_cache", LABOR_TIMES, 50);
  console.log(`  Done: ${result.inserted} inserted, ${result.errors} errors`);
  return result;
}

// --- Main ---

async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  SAM — Full Database Seed (via Supabase MCP)");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  URL: ${SUPABASE_URL}`);

  const r1 = await seedDtcCodes();
  const r2 = await seedCauseMappings();
  const r3 = await seedVehiclePatterns();
  const r4 = await seedRepairPlans();
  const r5 = await seedLaborTimes();

  const totalInserted = r1.inserted + r2.inserted + r3.inserted + r4.inserted + r5.inserted;
  const totalErrors = r1.errors + r2.errors + r3.errors + r4.errors + r5.errors;

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log(`  SEED COMPLETE: ${totalInserted} inserted, ${totalErrors} errors`);
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("\n  Note: Embeddings not generated (need OPENAI_API_KEY).");
  console.log("  The diagnose.js will use claude_only path until embeddings are added.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("SEED FAILED:", err);
    process.exit(1);
  });
