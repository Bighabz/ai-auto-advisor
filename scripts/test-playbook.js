/**
 * Direct playbook test — run on Pi via: node scripts/test-playbook.js
 * No Telegram, no orchestrator, no Claude diagnosis. Just the browser flow.
 */
const { runPlaybook } = require("../skills/autoleap-browser/scripts/playbook");

const testData = {
  customer: { name: "Test Customer", phone: "555-0000" },
  vehicle: { year: 2002, make: "Toyota", model: "RAV4", vin: null },
  diagnosis: {
    ai: {
      diagnoses: [{ cause: "Catalytic converter failure", confidence: 0.9 }],
      repair_plan: { labor: { description: "Replace catalytic converter", hours: 1.3 } },
    },
    codes: ["P0420"],
  },
  parts: [
    {
      requested: { partType: "catalytic converter", searchTerms: ["catalytic converter"] },
      selected: { description: "Catalytic Converter", brand: "MagnaFlow", partNumber: "51356", price: 281.78, totalCost: 281.78 },
    },
  ],
  progressCallback: (phase) => { console.log(`[test] Progress: ${phase}`); return Promise.resolve(); },
};

(async () => {
  console.log("=== PLAYBOOK TEST START ===");
  console.log(`Customer: ${testData.customer.name}`);
  console.log(`Vehicle: ${testData.vehicle.year} ${testData.vehicle.make} ${testData.vehicle.model}`);
  console.log(`Parts: ${testData.parts.length}`);
  console.log("");

  try {
    const result = await runPlaybook(testData);
    console.log("");
    console.log("=== PLAYBOOK RESULT ===");
    console.log(JSON.stringify(result, null, 2));

    if (result.success) {
      console.log(`\nSUCCESS: Estimate ${result.roNumber || result.estimateId}`);
      console.log(`  Total: $${result.total} (labor $${result.totalLabor} + parts $${result.totalParts})`);
      console.log(`  Labor: ${result.laborHours}h`);
      console.log(`  Parts added: ${result.partsAdded.length}`);
      console.log(`  PDF: ${result.pdfPath || "none"}`);
      console.log(`  Warnings: ${result.warnings.length}`);
    } else {
      console.log(`\nFAILED: ${result.error}`);
      console.log(`  Warnings: ${JSON.stringify(result.warnings)}`);
    }
  } catch (err) {
    console.error(`\nCRASH: ${err.message}`);
    console.error(err.stack);
  }
  process.exit(0);
})();
