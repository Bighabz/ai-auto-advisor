/**
 * seed-data.js — Knowledge Base Seeder for AI Diagnostics
 *
 * Seeds Supabase with:
 *   Tier 1: ~200 DTC code references (dtc_codes table)
 *   Tier 2: ~500 DTC-to-cause mappings (diagnostic_knowledge table)
 *   Tier 3: ~100 vehicle-specific patterns (diagnostic_knowledge table)
 *
 * Run once during setup:  node seed-data.js
 */

const { insertBatch, getSupabase } = require("./embeddings");

// ---------------------------------------------------------------------------
// Tier 1: DTC Code Reference Data (~200 codes)
// ---------------------------------------------------------------------------

const DTC_CODES = require("./seed-dtc-codes");

// ---------------------------------------------------------------------------
// Tier 2: DTC-to-Cause Mappings (~500 entries)
// ---------------------------------------------------------------------------

const CAUSE_MAPPINGS = require("./seed-cause-mappings");

// ---------------------------------------------------------------------------
// Tier 3: Vehicle-Specific Patterns (~100 entries)
// ---------------------------------------------------------------------------

const VEHICLE_PATTERNS = require("./seed-vehicle-patterns");

// ---------------------------------------------------------------------------
// Seed functions
// ---------------------------------------------------------------------------

async function seedDtcCodes() {
  const db = getSupabase();
  const batchSize = 50;
  let inserted = 0;
  let errors = 0;

  console.log(`[ai-diagnostics] Seeding ${DTC_CODES.length} DTC codes...`);

  for (let i = 0; i < DTC_CODES.length; i += batchSize) {
    const batch = DTC_CODES.slice(i, i + batchSize);

    const { error } = await db.from("dtc_codes").upsert(batch, { onConflict: "code" });

    if (error) {
      console.error(`[ai-diagnostics] DTC batch insert failed at index ${i}: ${error.message}`);
      errors += batch.length;
    } else {
      inserted += batch.length;
      console.log(`[ai-diagnostics] DTC codes: ${inserted}/${DTC_CODES.length} inserted`);
    }
  }

  console.log(`[ai-diagnostics] DTC codes complete: ${inserted} inserted, ${errors} errors`);
  return { inserted, errors };
}

async function seedCauseMappings() {
  console.log(`[ai-diagnostics] Seeding ${CAUSE_MAPPINGS.length} cause mappings...`);
  const result = await insertBatch(CAUSE_MAPPINGS, 20);
  console.log(`[ai-diagnostics] Cause mappings complete: ${result.inserted} inserted, ${result.errors} errors`);
  return result;
}

async function seedVehiclePatterns() {
  console.log(`[ai-diagnostics] Seeding ${VEHICLE_PATTERNS.length} vehicle-specific patterns...`);
  const result = await insertBatch(VEHICLE_PATTERNS, 20);
  console.log(`[ai-diagnostics] Vehicle patterns complete: ${result.inserted} inserted, ${result.errors} errors`);
  return result;
}

async function main() {
  console.log("[ai-diagnostics] Starting knowledge base seed...");
  console.log("[ai-diagnostics] ========================================");

  const dtcResult = await seedDtcCodes();
  const causeResult = await seedCauseMappings();
  const vehicleResult = await seedVehiclePatterns();

  console.log("[ai-diagnostics] ========================================");
  console.log("[ai-diagnostics] Seed complete!");
  console.log(`[ai-diagnostics]   DTC codes:        ${dtcResult.inserted} inserted, ${dtcResult.errors} errors`);
  console.log(`[ai-diagnostics]   Cause mappings:   ${causeResult.inserted} inserted, ${causeResult.errors} errors`);
  console.log(`[ai-diagnostics]   Vehicle patterns: ${vehicleResult.inserted} inserted, ${vehicleResult.errors} errors`);
}

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("[ai-diagnostics] Seed failed:", err);
      process.exit(1);
    });
}

module.exports = { seedDtcCodes, seedCauseMappings, seedVehiclePatterns };
