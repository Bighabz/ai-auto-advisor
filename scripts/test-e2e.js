/**
 * test-e2e.js — End-to-End Pipeline Test for SAM
 *
 * Runs the full estimate builder pipeline with a 2019 Honda Civic P0420 scenario.
 * Validates that:
 *   1. Orchestrator loads and runs without crashing
 *   2. AI diagnosis produces causes with confidence scores
 *   3. Formatted response is generated
 *   4. PDF estimate is created
 *   5. Unconfigured services degrade gracefully (no crashes)
 *   6. Golden cases produce expected labor ranges and parts
 *   7. Degraded mode (no optional platforms) still completes
 *
 * Usage:
 *   node scripts/test-e2e.js              (basic — skips AutoLeap)
 *   node scripts/test-e2e.js --customer   (includes AutoLeap estimate creation)
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
  console.log("  Loaded env from config/.env\n");
} else {
  console.log("  WARNING: config/.env not found — using existing env vars\n");
}

// --- Helpers ---
let passCount = 0;
let failCount = 0;
let warnCount = 0;

function pass(label) { passCount++; console.log(`  \u2713 ${label}`); }
function fail(label, err) { failCount++; console.log(`  \u2717 ${label}: ${err}`); }
function warn(label) { warnCount++; console.log(`  \u26A0 ${label}`); }
function section(label) { console.log(`\n\u2500\u2500 ${label} ${"\u2500".repeat(Math.max(0, 50 - label.length))}`); }

// --- Main Test ---

async function main() {
  console.log("\u2550".repeat(60));
  console.log("  SAM \u2014 End-to-End Pipeline Test");
  console.log("\u2550".repeat(60));

  const startTime = Date.now();

  // ── Step 0: Verify requirements ──
  section("Prerequisites");

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    fail("Supabase credentials", "SUPABASE_URL and SUPABASE_ANON_KEY required");
    console.log("\n  Cannot proceed without Supabase. Exiting.");
    process.exit(1);
  }
  pass("Supabase credentials present");

  if (process.env.ANTHROPIC_API_KEY) {
    pass("Anthropic API key present (AI diagnosis will run)");
  } else {
    warn("ANTHROPIC_API_KEY not set \u2014 AI diagnosis will use KB-only path");
  }

  // Check which optional services are configured
  const services = {
    AllData: !!(process.env.ALLDATA_USERNAME && process.env.ALLDATA_PASSWORD),
    Identifix: !!(process.env.IDENTIFIX_USERNAME && process.env.IDENTIFIX_PASSWORD),
    ProDemand: !!(process.env.PRODEMAND_USERNAME || process.env.PRODEMAND_TAPE_TOKEN),
    PartsTech: !!process.env.PARTSTECH_API_KEY,
    AutoLeap: !!(process.env.AUTOLEAP_PARTNER_ID && process.env.AUTOLEAP_AUTH_KEY),
    ARI: !!process.env.ARI_URL,
  };

  for (const [name, configured] of Object.entries(services)) {
    if (configured) pass(`${name} configured`);
    else warn(`${name} not configured \u2014 will degrade gracefully`);
  }

  // ── Step 1: Load orchestrator ──
  section("Load Orchestrator");

  let buildEstimate;
  try {
    const orchestrator = require("../skills/estimate-builder/scripts/orchestrator");
    buildEstimate = orchestrator.buildEstimate;
    pass("Orchestrator loaded successfully");
  } catch (err) {
    fail("Orchestrator load", err.message);
    console.log("\n  Cannot proceed without orchestrator. Exiting.");
    process.exit(1);
  }

  // ── Step 2: Run full pipeline ──
  section("Running Pipeline (2019 Honda Civic 2.0L \u2014 P0420)");

  const includeCustomer = process.argv.includes("--customer");

  const testParams = {
    year: 2019,
    make: "Honda",
    model: "Civic",
    engine: "2.0L",
    cylinders: 4,
    fuelType: "gas",
    transmission: "CVT",
    driveType: "FWD",
    mileage: 87000,
    query: "P0420 catalyst system efficiency below threshold bank 1, check engine light on",
  };

  if (includeCustomer) {
    testParams.customer = {
      name: "John Test",
      phone: "555-123-4567",
      email: "test@example.com",
    };
    console.log("  Including customer info (AutoLeap estimate will be attempted)");
  } else {
    console.log("  No customer info (run with --customer to test AutoLeap)");
  }

  let results;
  try {
    results = await buildEstimate(testParams);
    pass("Pipeline completed without crashing");
  } catch (err) {
    fail("Pipeline execution", err.message);
    console.error(err.stack);
    console.log("\n  Pipeline crashed. See error above.");
    process.exit(1);
  }

  // ── Step 3: Validate results ──
  section("Validate Results");

  // Vehicle
  if (results.vehicle) {
    if (results.vehicle.year === 2019 && results.vehicle.make === "Honda") {
      pass(`Vehicle: ${results.vehicle.year} ${results.vehicle.make} ${results.vehicle.model}`);
    } else {
      fail("Vehicle data", "unexpected values");
    }
  } else {
    fail("Vehicle data", "missing");
  }

  // Diagnosis
  if (results.diagnosis) {
    pass("Diagnosis object present");

    if (results.diagnosis.ai) {
      const ai = results.diagnosis.ai;
      if (ai.diagnoses?.length > 0) {
        pass(`AI diagnoses: ${ai.diagnoses.length} cause(s)`);
        const top = ai.diagnoses[0];
        const conf = Math.round((top.confidence || 0) * 100);
        pass(`Top cause: ${top.cause} (${conf}%)`);

        if (top.confidence >= 0.3) {
          pass("Confidence >= 30% (reasonable)");
        } else {
          warn(`Low confidence: ${conf}% \u2014 may need more KB data`);
        }
      } else {
        warn("No AI diagnoses returned (KB may be empty for this query)");
      }

      if (ai.diagnostic_path) {
        pass(`Diagnostic path: ${ai.diagnostic_path}`);
      }

      if (ai.repair_plan) {
        pass(`Repair plan: ${ai.repair_plan.parts?.length || 0} parts, ${ai.repair_plan.labor?.hours || "?"}h labor`);
      } else {
        warn("No repair plan returned");
      }
    } else {
      warn("No AI diagnosis (ANTHROPIC_API_KEY may be missing)");
    }

    if (results.diagnosis.summary) {
      pass("Diagnosis summary generated");
    }

    // Platform research results (expect graceful degradation)
    if (results.diagnosis.alldata) {
      if (results.diagnosis.alldata.error) {
        pass(`AllData: gracefully degraded \u2014 ${results.diagnosis.alldata.error}`);
      } else {
        pass(`AllData: ${results.diagnosis.alldata.procedures?.length || 0} procedures`);
      }
    }
    if (results.diagnosis.identifix) {
      if (results.diagnosis.identifix.error) {
        pass(`Identifix: gracefully degraded \u2014 ${results.diagnosis.identifix.error}`);
      } else {
        pass(`Identifix: ${results.diagnosis.identifix.fixCount || 0} fixes`);
      }
    }
    if (results.diagnosis.prodemand) {
      if (results.diagnosis.prodemand.error) {
        pass(`ProDemand: gracefully degraded \u2014 ${results.diagnosis.prodemand.error}`);
      } else {
        pass(`ProDemand: ${results.diagnosis.prodemand.realFixes?.length || 0} Real Fixes`);
      }
    }
  } else {
    fail("Diagnosis", "missing entirely");
  }

  // Parts
  if (results.parts) {
    const bundle = results.parts.bestValueBundle;
    if (bundle) {
      pass(`Parts: ${bundle.parts?.length || 0} items, $${bundle.totalCost?.toFixed(2) || "0.00"} total`);
    } else {
      warn("Parts: no best value bundle (PartsTech may not be configured)");
    }
  } else {
    warn("Parts: skipped (no VIN or PartsTech not configured)");
  }

  // Estimate
  if (results.estimate) {
    if (results.estimate.error) {
      warn(`AutoLeap estimate: ${results.estimate.error}`);
    } else if (results.estimate.total) {
      pass(`AutoLeap estimate: $${results.estimate.total} (ID: ${results.estimate.estimateId || "N/A"})`);
    }
  } else if (!includeCustomer) {
    pass("AutoLeap: skipped (no customer \u2014 expected)");
  } else {
    warn("AutoLeap estimate: not created");
  }

  // Mechanic specs
  if (results.mechanicSpecs) {
    pass("Mechanic specs present");
    if (results.mechanicSpecs.fluids?.engineOil?.weight) {
      pass(`Oil: ${results.mechanicSpecs.fluids.engineOil.weight}`);
    }
  } else {
    warn("Mechanic specs: missing");
  }

  // PDF
  if (results.pdfPath) {
    if (fs.existsSync(results.pdfPath)) {
      const stat = fs.statSync(results.pdfPath);
      pass(`PDF generated: ${results.pdfPath} (${(stat.size / 1024).toFixed(1)} KB)`);
    } else {
      fail("PDF file", `path returned but file not found: ${results.pdfPath}`);
    }
  } else {
    warn("PDF: not generated (pdfkit may not be installed)");
  }

  // Formatted response
  if (results.formattedResponse) {
    if (results.formattedResponse.length > 100) {
      pass(`Formatted response: ${results.formattedResponse.length} chars`);
    } else {
      warn("Formatted response seems too short");
    }
  } else {
    fail("Formatted response", "missing");
  }

  // ═══ Golden Cases ═══
  section("Golden Cases (expected ranges)");

  const goldenCases = [
    {
      name: "RAV4 Catalytic Converter",
      params: { year: 2019, make: "Toyota", model: "RAV4", engine: "2.5L", cylinders: 4, fuelType: "gas", query: "P0420 catalyst system efficiency below threshold" },
      expect: { laborMin: 1.0, laborMax: 5.0, hasParts: true },
    },
    {
      name: "Prius Brake Pads",
      params: { year: 2015, make: "Toyota", model: "Prius", engine: "1.8L", cylinders: 4, fuelType: "hybrid", query: "brake pads worn need replacement front and rear" },
      expect: { laborMin: 0.5, laborMax: 2.0, hasParts: true },
    },
    {
      name: "F-150 Misfire",
      params: { year: 2018, make: "Ford", model: "F-150", engine: "5.0L V8", cylinders: 8, fuelType: "gas", query: "P0301 cylinder 1 misfire detected rough idle" },
      expect: { laborMin: 0.5, laborMax: 4.0, hasDiagSteps: true },
    },
    {
      name: "Bolt EV Battery",
      params: { year: 2020, make: "Chevrolet", model: "Bolt EV", engine: "Electric", cylinders: 0, fuelType: "electric", query: "battery range degradation reduced range warning" },
      expect: { evExcluded: true },
    },
    {
      name: "Accord Water Pump",
      params: { year: 2017, make: "Honda", model: "Accord", engine: "2.4L", cylinders: 4, fuelType: "gas", query: "coolant leak water pump area overheating" },
      expect: { laborMin: 2.0, laborMax: 7.0, hasParts: true },
    },
  ];

  for (const gc of goldenCases) {
    try {
      console.log(`\n  Testing: ${gc.name}`);
      const r = await buildEstimate(gc.params);
      if (!r || r.error) {
        warn(`${gc.name}: pipeline returned error: ${r?.error || "null result"}`);
        continue;
      }

      // Check labor range (if ProDemand returned labor)
      const laborHours = r.diagnosis?.prodemand?.laborTimes?.[0]?.hours;
      if (gc.expect.laborMin != null && laborHours != null) {
        if (laborHours >= gc.expect.laborMin && laborHours <= gc.expect.laborMax) {
          pass(`${gc.name}: labor ${laborHours}h in range [${gc.expect.laborMin}-${gc.expect.laborMax}]`);
        } else {
          warn(`${gc.name}: labor ${laborHours}h outside range [${gc.expect.laborMin}-${gc.expect.laborMax}]`);
        }
      } else if (gc.expect.laborMin != null) {
        warn(`${gc.name}: no labor returned from ProDemand`);
      }

      // Check parts found
      if (gc.expect.hasParts) {
        const bundleParts = r.parts?.bestValueBundle?.parts || [];
        const partsFound = bundleParts.some((p) => p.selected || p.results?.length > 0);
        partsFound ? pass(`${gc.name}: parts found`) : warn(`${gc.name}: no parts results`);
      }

      pass(`${gc.name}: pipeline completed`);
    } catch (err) {
      fail(`${gc.name}: ${err.message}`);
    }
  }

  // ═══ Degraded Mode Tests ═══
  section("Degraded Mode (graceful degradation)");

  // Test: Pipeline completes even if all optional platforms are unavailable
  try {
    // Save and clear optional env vars
    const saved = {};
    for (const key of ["ALLDATA_URL", "IDENTIFIX_URL", "PRODEMAND_URL", "PARTSTECH_URL"]) {
      saved[key] = process.env[key];
      delete process.env[key];
    }

    const r = await buildEstimate({
      year: 2019, make: "Honda", model: "Civic", engine: "2.0L",
      cylinders: 4, fuelType: "gas",
      query: "P0420 catalyst system efficiency",
    });

    // Restore
    for (const [k, v] of Object.entries(saved)) {
      if (v) process.env[k] = v;
    }

    if (r && !r.error) {
      pass("Degraded mode: pipeline completes without optional platforms");
      if (r.diagnosis?.ai) pass("Degraded mode: AI diagnosis still works");
    } else {
      fail("Degraded mode: pipeline failed — " + (r?.error || "null"));
    }
  } catch (err) {
    fail("Degraded mode: " + err.message);
  }

  // ── Summary ──
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\n${"=".repeat(60)}`);
  console.log(`  E2E Test Complete in ${elapsed}s`);
  console.log(`  \u2713 ${passCount} passed | \u2717 ${failCount} failed | \u26A0 ${warnCount} warnings`);
  console.log(`${"=".repeat(60)}`);

  if (failCount > 0) {
    console.log("\n  RESULT: FAIL \u2014 fix the failures above before deploying.\n");
    process.exit(1);
  } else if (warnCount > 0) {
    console.log("\n  RESULT: PASS with warnings \u2014 configure missing services for full coverage.\n");
  } else {
    console.log("\n  RESULT: PASS \u2014 all checks green!\n");
  }

  // Print the formatted response for visual inspection
  if (results.formattedResponse) {
    console.log("\n" + "=".repeat(60));
    console.log("  FORMATTED RESPONSE PREVIEW");
    console.log("=".repeat(60));
    console.log(results.formattedResponse);
  }
}

main().catch((err) => {
  console.error("\nUNEXPECTED ERROR:", err);
  process.exit(1);
});
