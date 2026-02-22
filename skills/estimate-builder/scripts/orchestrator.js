/**
 * Estimate Builder — Master Orchestrator (Enhanced)
 *
 * Complete pipeline that produces:
 * 1. Diagnosis from AllData/Identifix/ProDemand
 * 2. Best-value parts from PartsTech with vendor comparison
 * 3. Estimate in AutoLeap ready to send to customer
 * 4. Downloadable PDF estimate
 * 5. Full mechanic reference (sensor locations, fluids, torque, tools)
 */

const { decodeVin, isValidVin } = require("../../vin-decoder/scripts/decode");
const { search: searchAllData, captureScreenshots } = require("../../alldata-lookup/scripts/search");
const { searchDirectHit } = require("../../identifix-search/scripts/search");
// Use Puppeteer direct search (bypasses 20s OpenClaw gateway timeout for proxy)
let searchProDemand;
try {
  const directSearch = require("../../prodemand-lookup/scripts/search-direct");
  searchProDemand = directSearch.search;
  console.log("[orchestrator] Using ProDemand direct (Puppeteer) search");
} catch {
  const fallback = require("../../prodemand-lookup/scripts/search");
  searchProDemand = fallback.search;
  console.log("[orchestrator] Using ProDemand OpenClaw search (fallback)");
}
const {
  searchParts,
  searchMultipleParts,
  formatForAutoLeap,
} = require("../../partstech-search/scripts/search");
const {
  findOrCreateCustomer,
  findOrCreateVehicle,
  createEstimate,
} = require("../../autoleap-estimate/scripts/estimate");
const { getVehicleSpecs } = require("../../vehicle-specs/scripts/specs");
const { generateEstimatePDF } = require("../../estimate-pdf/scripts/generate");
const { diagnose } = require("../../ai-diagnostics/scripts/diagnose");
const {
  getVehicleHistory,
  getShopRepairStats,
  findRelatedPriorRepairs,
} = require("../../autoleap-estimate/scripts/history");
const { getCannedJobs } = require("../../autoleap-estimate/scripts/canned-jobs");
const { getShopConfig } = require("../../shop-management/scripts/config");
const { trackEvent } = require("../../shop-management/scripts/usage");

// PartsTech via AutoLeap's embedded session — loads when AUTOLEAP_EMAIL is set (no separate PT credentials needed)
let autoLeapPartstech = null;
if (process.env.AUTOLEAP_EMAIL) {
  try {
    autoLeapPartstech = require("../../autoleap-browser/scripts/partstech-search");
  } catch {
    // partstech-search not available
  }
}

// PartsTech browser (shop.partstech.com) — optional, loads when PARTSTECH_USERNAME is set (cart + ordering)
let partstechOrder = null;
if (process.env.PARTSTECH_USERNAME) {
  try {
    partstechOrder = require("../../partstech-order/scripts/order");
  } catch {
    // partstech-order skill not installed — ordering disabled
  }
}

// AutoLeap REST API client — token captured from Chrome via puppeteer CDP, then direct REST calls
let autoLeapApi = null;
if (process.env.AUTOLEAP_EMAIL) {
  try {
    autoLeapApi = require("../../autoleap-browser/scripts/autoleap-api");
  } catch {
    // autoleap-api not available — estimate creation disabled
  }
}
// Legacy reference kept null so handleApprovalAndOrder gracefully returns "not configured"
const autoLeapBrowser = null;

/**
 * Classify request type for routing
 */
function classifyRequest(query) {
  const maintenanceKeywords = [
    "oil change", "brake", "pad", "rotor", "tire rotation",
    "alignment", "tune up", "spark plug", "transmission fluid",
    "coolant flush", "cabin filter", "air filter", "battery",
    "belt", "hose", "wiper",
  ];

  const dtcMatch = query.match(/[PBCU][0-9]{4}/gi);
  const isDTC = dtcMatch && dtcMatch.length > 0;
  const isMaintenance = maintenanceKeywords.some((kw) =>
    query.toLowerCase().includes(kw)
  );

  return {
    type: isDTC ? "diagnostic" : isMaintenance ? "maintenance" : "general",
    dtcCodes: dtcMatch || [],
  };
}

/**
 * Determine what parts are needed based on diagnosis
 */
function extractPartsNeeded(query, researchResults) {
  const partsNeeded = [];

  // Priority 1: Use repair plan parts (richest data — includes position, qty, search terms)
  if (researchResults?.ai?.repair_plan?.parts?.length > 0) {
    for (const part of researchResults.ai.repair_plan.parts) {
      if (part.conditional && part.condition) {
        // Conditional parts — still include but mark as conditional
        partsNeeded.push({
          partType: part.search_terms?.[0] || part.name,
          searchTerms: part.search_terms || [part.name],
          position: part.position || null,
          qty: part.qty || 1,
          oemPreferred: part.oem_preferred || false,
          conditional: true,
          condition: part.condition,
        });
      } else {
        partsNeeded.push({
          partType: part.search_terms?.[0] || part.name,
          searchTerms: part.search_terms || [part.name],
          position: part.position || null,
          qty: part.qty || 1,
          oemPreferred: part.oem_preferred || false,
        });
      }
    }
    if (partsNeeded.length > 0) {
      return partsNeeded;
    }
  }

  // Priority 2: Use AI diagnosis parts (flat list, less data)
  if (researchResults?.ai?.diagnoses?.length > 0) {
    for (const diag of researchResults.ai.diagnoses) {
      if (diag.parts_needed && diag.confidence >= 0.5) {
        for (const part of diag.parts_needed) {
          if (!partsNeeded.some((p) => p.partType === part)) {
            partsNeeded.push({ partType: part });
          }
        }
      }
    }
    if (partsNeeded.length > 0) {
      return partsNeeded;
    }
  }

  // Fallback: Extract from query keywords
  const queryLower = query.toLowerCase();

  // Catalytic converter
  if (queryLower.includes("catalytic") || queryLower.includes("catalyst")) {
    partsNeeded.push({ partType: "catalytic converter" });
  }

  // O2 sensor (P0420 or explicit mention)
  if (queryLower.includes("p0420") || queryLower.includes("o2 sensor") || queryLower.includes("oxygen sensor")) {
    partsNeeded.push({ partType: "oxygen sensor", position: "downstream" });
    partsNeeded.push({ partType: "oxygen sensor", position: "upstream" });
  }

  // Common DTC to parts mapping
  const dtcPartsMap = {
    "P0171": [{ partType: "mass air flow sensor" }, { partType: "fuel injector" }],
    "P0300": [{ partType: "spark plug" }, { partType: "ignition coil" }],
    "P0442": [{ partType: "gas cap" }, { partType: "evap canister purge valve" }],
    "P0128": [{ partType: "thermostat" }],
    "P0340": [{ partType: "camshaft position sensor" }],
    "P0335": [{ partType: "crankshaft position sensor" }],
  };

  const dtcMatch = query.match(/[PBCU][0-9]{4}/gi);
  if (dtcMatch) {
    for (const dtc of dtcMatch) {
      const mapped = dtcPartsMap[dtc.toUpperCase()];
      if (mapped) partsNeeded.push(...mapped);
    }
  }

  // Brake job
  if (queryLower.includes("brake") || queryLower.includes("pad") || queryLower.includes("rotor")) {
    if (queryLower.includes("front") || !queryLower.includes("rear")) {
      partsNeeded.push({ partType: "brake pads", position: "front" });
      if (queryLower.includes("rotor")) partsNeeded.push({ partType: "brake rotor", position: "front" });
    }
    if (queryLower.includes("rear") || !queryLower.includes("front")) {
      partsNeeded.push({ partType: "brake pads", position: "rear" });
      if (queryLower.includes("rotor")) partsNeeded.push({ partType: "brake rotor", position: "rear" });
    }
  }

  // Oil change
  if (queryLower.includes("oil change")) {
    partsNeeded.push({ partType: "oil filter" });
    partsNeeded.push({ partType: "drain plug gasket" });
  }

  // Common single-part replacements
  const singlePartMap = [
    { keywords: ["water pump"],          part: "water pump" },
    { keywords: ["alternator"],          part: "alternator" },
    { keywords: ["starter"],             part: "starter" },
    { keywords: ["thermostat"],          part: "thermostat" },
    { keywords: ["radiator"],            part: "radiator" },
    { keywords: ["battery"],             part: "battery" },
    { keywords: ["fuel pump"],           part: "fuel pump" },
    { keywords: ["fuel filter"],         part: "fuel filter" },
    { keywords: ["air filter"],          part: "air filter" },
    { keywords: ["cabin filter", "cabin air filter"], part: "cabin air filter" },
    { keywords: ["spark plug"],          part: "spark plug" },
    { keywords: ["ignition coil"],       part: "ignition coil" },
    { keywords: ["mass air flow", "maf sensor"], part: "mass air flow sensor" },
    { keywords: ["throttle body"],       part: "throttle body" },
    { keywords: ["egr valve"],           part: "egr valve" },
    { keywords: ["pcv valve"],           part: "pcv valve" },
    { keywords: ["timing belt"],         part: { partType: "timing belt", searchTerms: ["timing belt kit"] } },
    { keywords: ["timing chain"],        part: "timing chain kit" },
    { keywords: ["serpentine belt", "drive belt"], part: "serpentine belt" },
    { keywords: ["wheel bearing"],       part: "wheel bearing hub assembly" },
    { keywords: ["cv axle", "cv shaft"], part: "cv axle shaft" },
    { keywords: ["strut", "shock absorber", "shocks"], part: "strut assembly" },
    { keywords: ["control arm"],         part: "control arm" },
    { keywords: ["tie rod"],             part: "tie rod end" },
    { keywords: ["power steering pump"], part: "power steering pump" },
    { keywords: ["ac compressor", "a/c compressor"], part: "ac compressor" },
  ];

  for (const { keywords, part } of singlePartMap) {
    if (keywords.some(k => queryLower.includes(k))) {
      if (!partsNeeded.some(p => p.partType === (typeof part === "string" ? part : part.partType))) {
        partsNeeded.push(typeof part === "string" ? { partType: part } : part);
      }
    }
  }

  return partsNeeded;
}

/**
 * Format AI diagnosis into a readable summary
 */
function formatDiagnosisSummary(aiDiagnosis) {
  if (!aiDiagnosis?.diagnoses?.length) return "No AI diagnosis available";

  const lines = ["AI DIAGNOSTIC RESULTS:"];
  for (let i = 0; i < aiDiagnosis.diagnoses.length; i++) {
    const d = aiDiagnosis.diagnoses[i];
    const pct = Math.round(d.confidence * 100);
    lines.push(`   ${i + 1}. ${d.cause} — ${pct}% confidence`);
    if (d.reasoning) lines.push(`      ${d.reasoning}`);
  }

  if (aiDiagnosis.low_confidence_warning) {
    lines.push("   ⚠️ Low confidence — recommend further diagnostic verification");
  }

  if (aiDiagnosis.recalls?.length > 0) {
    lines.push(`   📋 ${aiDiagnosis.recalls.length} open recall(s) found for this vehicle`);
  }

  return lines.join("\n");
}

/**
 * Format the final response for service advisor
 */
function formatServiceAdvisorResponse(results) {
  const { vehicle, diagnosis, parts, estimate, mechanicSpecs, pdfPath } = results;

  let response = `
═══════════════════════════════════════════════════════════════
  ESTIMATE READY — ${vehicle.year} ${vehicle.make} ${vehicle.model} ${vehicle.trim || ""}
═══════════════════════════════════════════════════════════════

📋 VEHICLE (Exact for Parts Accuracy)
   ${vehicle.year} ${vehicle.make} ${vehicle.model} ${vehicle.trim || ""}
   Engine: ${vehicle.engine?.displacement || "?"} ${vehicle.engine?.cylinders || "?"}cyl ${vehicle.engine?.fuelType || ""}
   VIN: ${vehicle.vin || "N/A"}
   Trans: ${vehicle.transmission || "N/A"} | Drive: ${vehicle.driveType || "N/A"}

🔍 DIAGNOSIS
${diagnosis?.summary || "See research results"}
`;

  // AI Diagnosis confidence details
  if (diagnosis?.ai?.diagnoses?.length > 0) {
    response += `
   CONFIDENCE SCORES:
`;
    for (const d of diagnosis.ai.diagnoses) {
      const bar = "█".repeat(Math.round(d.confidence * 20)) + "░".repeat(20 - Math.round(d.confidence * 20));
      const corr = d.identifix_corroborated ? ` ✓ Identifix ${d.identifix_success_rate}%` : "";
      const hist = d.history_adjusted ? " ★ History" : "";
      response += `   ${bar} ${Math.round(d.confidence * 100)}% ${d.cause}${corr}${hist}\n`;
    }

    // Show diagnostic path
    if (diagnosis.ai.diagnostic_path) {
      const pathLabels = {
        kb_direct: "Knowledge Base (high confidence)",
        kb_with_claude: "Knowledge Base + AI verification",
        claude_only: "AI Analysis",
      };
      response += `   Source: ${pathLabels[diagnosis.ai.diagnostic_path] || diagnosis.ai.diagnostic_path}\n`;
    }

    if (diagnosis.ai.diagnostic_steps?.length > 0) {
      response += `
   RECOMMENDED DIAGNOSTIC STEPS:
`;
      for (let i = 0; i < diagnosis.ai.diagnostic_steps.length; i++) {
        response += `   ${i + 1}. ${diagnosis.ai.diagnostic_steps[i]}\n`;
      }
    }
  }

  // Research platform results
  const alldata = diagnosis?.alldata;
  const identifix = diagnosis?.identifix;
  const prodemand = diagnosis?.prodemand;

  if ((alldata && !alldata.error) || (identifix && !identifix.error) || (prodemand && !prodemand.error)) {
    response += `
🔬 PLATFORM RESEARCH
`;
    if (identifix && !identifix.error && identifix.fixCount > 0) {
      response += `   Identifix Direct-Hit: ${identifix.fixCount} known fixes\n`;
      if (identifix.topFix) {
        response += `   → Top fix: ${identifix.topFix.description?.substring(0, 80) || "N/A"}`;
        if (identifix.topFix.successRate) response += ` (${identifix.topFix.successRate}% success)`;
        response += `\n`;
      }
      if (identifix.misdiagnosisWarnings?.length > 0) {
        response += `   ⚠️ MISDIAGNOSIS WARNING: ${identifix.misdiagnosisWarnings[0]}\n`;
      }
    }

    if (prodemand && !prodemand.error) {
      const realFixCount = prodemand.realFixes?.length || 0;
      const laborCount = prodemand.laborTimes?.length || 0;
      if (realFixCount > 0 || laborCount > 0) {
        response += `   ProDemand: ${realFixCount} Real Fixes, ${laborCount} labor times\n`;
        if (prodemand.realFixes?.[0]) {
          const rf = prodemand.realFixes[0];
          if (rf.symptom) response += `   → ${rf.symptom}`;
          if (rf.cause) response += ` → ${rf.cause}`;
          response += `\n`;
        }
      }
    }

    if (alldata && !alldata.error) {
      const procCount = alldata.procedures?.length || 0;
      const torqueCount = Object.keys(alldata.torqueSpecs || {}).length;
      if (procCount > 0 || torqueCount > 0) {
        response += `   AllData: ${procCount} procedure steps, ${torqueCount} torque specs`;
        if (alldata.diagrams_available) response += `, diagrams captured`;
        response += `\n`;
      }
      if (alldata.notes?.length > 0) {
        response += `   ⚠️ NOTE: ${alldata.notes[0]}\n`;
      }
    }
  }

  // Vehicle history
  if (results.vehicleHistory?.vehicleVisits > 0) {
    response += `
📜 VEHICLE HISTORY (${results.vehicleHistory.vehicleVisits} prior visits)
`;
    if (results.vehicleHistory.lastVisit) {
      const lastDate = new Date(results.vehicleHistory.lastVisit);
      response += `   Last visit: ${lastDate.toLocaleDateString()}\n`;
    }
    if (results.vehicleHistory.totalSpent) {
      response += `   Total spent: $${results.vehicleHistory.totalSpent.toFixed(2)}\n`;
    }
    if (results.vehicleHistory.insight) {
      response += `   → ${results.vehicleHistory.insight}\n`;
    }
    if (results.vehicleHistory.relatedRepairs?.length > 0) {
      for (const repair of results.vehicleHistory.relatedRepairs.slice(0, 3)) {
        const date = repair.completed_at ? new Date(repair.completed_at).toLocaleDateString() : "?";
        response += `   • ${date}: ${repair.repair_description} ($${repair.total_cost || 0})\n`;
      }
    }
  }

  // Shop-wide stats
  if (results.shopStats?.totalRepairs > 0) {
    const stats = results.shopStats;
    response += `
📊 SHOP EXPERIENCE
   ${stats.totalRepairs} similar repairs on ${vehicle.make} ${vehicle.model}`;
    if (stats.successRate !== null) response += ` — ${stats.successRate}% success rate`;
    response += `\n`;
    if (stats.avgLaborHours) response += `   Avg labor: ${stats.avgLaborHours}h | Avg cost: $${stats.avgCost}\n`;
    if (stats.comebacks > 0) response += `   ⚠️ ${stats.comebacks} comeback(s) recorded\n`;
  }

  // Canned jobs (maintenance requests)
  if (results.cannedJobs?.length > 0) {
    response += `
📋 CANNED JOBS AVAILABLE
`;
    for (const job of results.cannedJobs.slice(0, 3)) {
      response += `   • ${job.name}: ~${job.avg_labor_hours}h labor, ~$${job.avg_total_cost} total (${job.frequency}x performed)\n`;
    }
  }

  // Repair Plan details (when available)
  const rp = diagnosis?.ai?.repair_plan;
  if (rp) {
    // Labor source
    if (rp.labor) {
      const sourceLabel = rp.labor.source === "ari" ? "ARI Labor Guide" :
                          rp.labor.source === "labor_cache" ? "Cached Labor Data" :
                          rp.labor.source === "prodemand" ? "ProDemand" :
                          rp.labor.source === "claude" ? "AI Estimated" :
                          rp.labor.source || "Estimated";
      response += `
   LABOR: ${rp.labor.hours}h (${sourceLabel}) — ${rp.labor.category || "standard"}
`;
      if (rp.labor.requires_lift) response += `   Requires lift: Yes\n`;
      if (rp.labor.special_notes) response += `   Note: ${rp.labor.special_notes}\n`;
    }

    // Verification steps
    if (rp.verification) {
      response += `
   VERIFICATION:
`;
      if (rp.verification.before_repair) response += `   Before: ${rp.verification.before_repair}\n`;
      if (rp.verification.after_repair) response += `   After:  ${rp.verification.after_repair}\n`;
    }

    // Tools needed
    if (rp.tools?.length > 0) {
      response += `
   TOOLS NEEDED:
`;
      for (const tool of rp.tools) {
        response += `   - ${tool}\n`;
      }
    }

    // Torque specs from repair plan
    if (rp.torque_specs && Object.keys(rp.torque_specs).length > 0) {
      response += `
   TORQUE SPECS (from repair plan):
`;
      for (const [component, spec] of Object.entries(rp.torque_specs)) {
        response += `   - ${component}: ${spec}\n`;
      }
    }
  }

  // Parts with best value highlighted
  if (parts?.bestValueBundle?.parts?.length > 0) {
    response += `
🛒 PARTS — BEST VALUE (Ready to Order)
`;
    for (const item of parts.bestValueBundle.parts) {
      if (item.selected) {
        const p = item.selected;
        response += `   ✓ ${p.brand} ${p.description}${p.position ? ` (${p.position})` : ""}
     Part #: ${p.partNumber} | $${p.totalCost.toFixed(2)} | ${p.availability}
     Supplier: ${p.supplier}
`;
      } else {
        response += `   ✗ ${item.requested.partType} — NOT FOUND
`;
      }
    }
    response += `
   PARTS TOTAL: $${parts.bestValueBundle.totalCost.toFixed(2)}
   ${parts.bestValueBundle.allInStock ? "✓ All in stock" : "⚠️ Some parts need to be ordered"}
`;

    // OEM alternatives
    if (parts.oemAlternatives?.length > 0) {
      response += `
   OEM ALTERNATIVES:
`;
      for (const alt of parts.oemAlternatives.slice(0, 3)) {
        response += `   • ${alt.brand} ${alt.partNumber}: $${alt.totalCost.toFixed(2)}
`;
      }
    }
  }

  // Estimate totals
  if (estimate?.total) {
    response += `
💰 ESTIMATE TOTAL
   Labor:        $${estimate.totalLabor}
   Parts:        $${estimate.totalParts}
   Shop Supplies: $${estimate.shopSupplies}
   Tax:          $${estimate.tax}
   ─────────────────
   TOTAL:        $${estimate.total}
`;
    if (estimate.estimateId) {
      const estRef = estimate.estimateCode || estimate.estimateId;
      response += `
   AutoLeap Estimate #${estRef} (Ready to send to customer)
`;
    }
  }

  // Mechanic reference info
  if (mechanicSpecs) {
    response += `
🔧 MECHANIC REFERENCE
`;
    // Sensor locations
    if (mechanicSpecs.sensorLocations) {
      response += `
   SENSOR LOCATIONS:
   ${mechanicSpecs.sensorLocations.bankIdentification || ""}
`;
      const sensors = mechanicSpecs.sensorLocations.sensors || {};
      for (const [key, sensor] of Object.entries(sensors)) {
        if (typeof sensor === "object" && sensor.name) {
          response += `   • ${sensor.name}: ${sensor.location}
`;
        }
      }
    }

    // Fluids
    if (mechanicSpecs.fluids) {
      const oil = mechanicSpecs.fluids.engineOil || {};
      const coolant = mechanicSpecs.fluids.coolant || {};
      response += `
   FLUID SPECS:
   • Oil: ${oil.capacityWithFilter || "?"} — ${oil.weight || "?"}
   • Coolant: ${coolant.capacity || "?"} — ${coolant.type || "?"}
`;
    }

    // Torque specs
    if (mechanicSpecs.torqueSpecs) {
      response += `
   TORQUE SPECS:
`;
      const t = mechanicSpecs.torqueSpecs;
      if (t.oilDrainPlug?.value) response += `   • Oil Drain Plug: ${t.oilDrainPlug.value}\n`;
      if (t.o2Sensor?.value) response += `   • O2 Sensor: ${t.o2Sensor.value}\n`;
      if (t.wheelLugNuts?.value) response += `   • Lug Nuts: ${t.wheelLugNuts.value}\n`;
    }

    // Special tools
    if (mechanicSpecs.specialTools?.length > 0) {
      response += `
   SPECIAL TOOLS:
`;
      for (const tool of mechanicSpecs.specialTools.slice(0, 5)) {
        response += `   • ${tool}\n`;
      }
    }
  }

  // Ordering status
  if (results.cartStatus) {
    if (results.cartStatus.ready_to_order) {
      response += `
📦 ORDERING: ${results.cartStatus.item_count} parts held in PartsTech cart ($${results.cartStatus.total})
   Reply "order those parts" to place the order.
`;
    } else if (results.cartStatus.error) {
      response += `
📦 ORDERING: Browser ordering unavailable — ${results.cartStatus.error}
   Parts can still be ordered manually from the estimate above.
`;
    }
  } else if (partstechOrder) {
    response += `
📦 ORDERING: PartsTech browser ordering available — parts can be added to cart on request.
`;
  }

  // PDF download
  if (pdfPath) {
    response += `
📄 ESTIMATE PDF: ${pdfPath}
   (Ready to download or email to customer)
`;
  }

  response += `
═══════════════════════════════════════════════════════════════
`;

  return response;
}

/**
 * Handle approval and place parts order via AutoLeap browser.
 *
 * Called when SA texts "approved" — goes back into AutoLeap and
 * places the parts order through the embedded PartsTech.
 *
 * @param {object} lastEstimateResults - Results from the last buildEstimate() call
 * @returns {object} { success, orderId, total, partsOrdered, error }
 */
async function handleApprovalAndOrder(lastEstimateResults) {
  if (!autoLeapBrowser) {
    return { success: false, error: "AutoLeap browser not configured" };
  }

  if (!lastEstimateResults?.estimate?.estimateId) {
    return { success: false, error: "No estimate ID from previous estimate" };
  }

  const orderResult = autoLeapBrowser.order.placePartsOrder(
    lastEstimateResults.estimate.estimateId
  );

  // Track order event
  if (orderResult.success) {
    const vehicle = lastEstimateResults.vehicle;
    const orderShopId = lastEstimateResults.shopId || process.env.SHOP_ID || null;
    trackEvent(orderShopId, "order_placed", {
      vehicle: { year: vehicle.year, make: vehicle.make, model: vehicle.model },
      partsOrdered: orderResult.partsOrdered || 0,
      total: orderResult.total,
      source: "autoleap_browser",
    }).catch(() => {});
  }

  return orderResult;
}

/**
 * Handle "order those parts" request from SA.
 *
 * Takes the parts from the last estimate's bestValueBundle and
 * places an order via PartsTech browser automation or AutoLeap browser.
 *
 * @param {object} lastEstimateResults - Results from the last buildEstimate() call
 * @returns {object} { success, order, cart_summary, error }
 */
async function handleOrderRequest(lastEstimateResults) {
  // If estimate was created via browser, use AutoLeap browser for ordering
  if (lastEstimateResults?.estimateSource === "browser" && autoLeapBrowser) {
    return handleApprovalAndOrder(lastEstimateResults);
  }

  if (!partstechOrder) {
    return { success: false, error: "PartsTech browser ordering not available (set PARTSTECH_URL env var)" };
  }

  if (!lastEstimateResults?.parts?.bestValueBundle?.parts) {
    return { success: false, error: "No parts from a previous estimate to order" };
  }

  const vehicle = lastEstimateResults.vehicle;
  const bundleParts = lastEstimateResults.parts.bestValueBundle.parts;

  // Filter to parts that were actually found (have a selected part)
  const partsToOrder = bundleParts
    .filter((item) => item.selected)
    .map((item) => ({
      partType: item.requested.partType,
      position: item.requested.position || null,
      partNumber: item.selected.partNumber,
      brand: item.selected.brand,
      supplier: item.selected.supplier,
      qty: item.requested.qty || 1,
    }));

  if (partsToOrder.length === 0) {
    return { success: false, error: "No orderable parts in the estimate" };
  }

  console.log(`[orchestrator] Ordering ${partsToOrder.length} parts via PartsTech browser...`);

  // Add to cart
  const cartResult = await partstechOrder.addMultipleToCart({
    vin: vehicle.vin,
    year: vehicle.year,
    make: vehicle.make,
    model: vehicle.model,
    parts: partsToOrder,
  });

  if (cartResult.error) {
    return { success: false, error: cartResult.error };
  }

  if (cartResult.failed?.length > 0) {
    console.log(`[orchestrator] ${cartResult.failed.length} parts could not be added to cart`);
  }

  // Place the order
  const orderResult = await partstechOrder.placeOrder();

  // Track order event
  const orderShopId = lastEstimateResults.shopId || process.env.SHOP_ID || null;
  if (orderResult.success) {
    trackEvent(orderShopId, "order_placed", {
      vehicle: { year: vehicle.year, make: vehicle.make, model: vehicle.model },
      partsOrdered: cartResult.added?.length || 0,
      total: cartResult.cart_summary?.total,
    }).catch(() => {});
  }

  return {
    success: orderResult.success,
    order: orderResult,
    added: cartResult.added,
    failed: cartResult.failed,
    cart_summary: cartResult.cart_summary,
    error: orderResult.error || null,
  };
}

/**
 * Main pipeline: Build complete estimate
 */
async function buildEstimate(params) {
  const shopId = params.shopId || process.env.SHOP_ID || null;
  const shopConfig = await getShopConfig(shopId);
  const startTime = Date.now();
  const results = {
    shopId,
    vehicle: null,
    diagnosis: null,
    parts: null,
    estimate: null,
    mechanicSpecs: null,
    pdfPath: null,
    screenshots: [],
    wiringDiagrams: [],
    tsbs: [],
    dtcTestPlan: [],
  };

  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  ESTIMATE BUILDER — Starting Full Pipeline");
  console.log("═══════════════════════════════════════════════════════════════");

  // ─── Step 1: Vehicle Identification (Exact) ───
  console.log("\n[Step 1] Decoding vehicle (exact specs for parts accuracy)...");
  let vehicle;
  if (params.vin && isValidVin(params.vin)) {
    vehicle = await decodeVin(params.vin);
  } else {
    vehicle = {
      vin: params.vin || null,
      year: params.year,
      make: params.make,
      model: params.model,
      trim: params.trim || null,
      engine: {
        displacement: params.engine,
        cylinders: params.cylinders,
        fuelType: params.fuelType,
      },
      transmission: params.transmission,
      driveType: params.driveType,
    };
  }
  vehicle.mileage = params.mileage;
  results.vehicle = vehicle;

  console.log(`  → ${vehicle.year} ${vehicle.make} ${vehicle.model} ${vehicle.trim || ""}`);
  console.log(`  → Engine: ${vehicle.engine?.displacement || "?"}`);
  console.log(`  → VIN: ${vehicle.vin || "Not provided"}`);

  // ─── Step 2: Classify & Route ───
  const requestInfo = classifyRequest(params.query);
  console.log(`\n[Step 2] Request type: ${requestInfo.type}`);
  if (requestInfo.dtcCodes.length > 0) {
    console.log(`  → DTC codes: ${requestInfo.dtcCodes.join(", ")}`);
  }

  // ─── Step 2.5: AI Diagnosis ───
  if (requestInfo.type === "diagnostic") {
    console.log("\n[Step 2.5] Running AI diagnostic engine...");
    try {
      const aiDiagnosis = await diagnose({
        vin: vehicle.vin,
        year: vehicle.year,
        make: vehicle.make,
        model: vehicle.model,
        engine: vehicle.engine?.displacement,
        dtcCodes: requestInfo.dtcCodes,
        symptoms: params.query,
        mileage: vehicle.mileage,
      });

      if (!aiDiagnosis.error) {
        results.diagnosis = {
          ai: aiDiagnosis,
          summary: formatDiagnosisSummary(aiDiagnosis),
        };
        console.log(`  → Top cause: ${aiDiagnosis.diagnoses?.[0]?.cause || "Unknown"} (${Math.round((aiDiagnosis.diagnoses?.[0]?.confidence || 0) * 100)}%)`);
        if (aiDiagnosis.low_confidence_warning) {
          console.log("  → ⚠️ Low confidence — recommend further diagnosis");
        }

        // Track diagnosis event
        trackEvent(shopId, "diagnosis_run", {
          vehicle: { year: vehicle.year, make: vehicle.make, model: vehicle.model },
          topCause: aiDiagnosis.diagnoses?.[0]?.cause,
          confidence: aiDiagnosis.diagnoses?.[0]?.confidence,
          path: aiDiagnosis.diagnostic_path,
          query: params.query,
        }).catch(() => {});
      } else {
        console.error(`  → AI diagnosis error: ${aiDiagnosis.error}`);
      }
    } catch (err) {
      console.error(`  → AI diagnosis failed: ${err.message}`);
    }
  }

  // ─── Step 2.7: Vehicle History & Shop Experience ───
  console.log("\n[Step 2.7] Checking repair history...");
  try {
    // Check this specific vehicle's history
    const historyResult = await findRelatedPriorRepairs(
      { vin: vehicle.vin, year: vehicle.year, make: vehicle.make, model: vehicle.model },
      { dtcCodes: requestInfo.dtcCodes, diagnoses: results.diagnosis?.ai?.diagnoses || [] }
    );

    results.vehicleHistory = historyResult;

    if (historyResult.insight) {
      console.log(`  → ${historyResult.insight}`);
    }
    if (historyResult.vehicleVisits > 0) {
      console.log(`  → ${historyResult.vehicleVisits} prior visits, $${historyResult.totalSpent || 0} total spent`);
    }

    // Apply confidence adjustment from history
    if (historyResult.confidenceAdjustment !== 0 && results.diagnosis?.ai?.diagnoses?.length > 0) {
      const adj = historyResult.confidenceAdjustment;
      results.diagnosis.ai.diagnoses[0].confidence = Math.min(
        0.95,
        Math.max(0.05, results.diagnosis.ai.diagnoses[0].confidence + adj)
      );
      results.diagnosis.ai.diagnoses[0].history_adjusted = true;
      console.log(`  → Confidence adjusted by ${adj > 0 ? "+" : ""}${(adj * 100).toFixed(0)}%`);
    }

    // Get shop-wide stats for this repair type
    if (results.diagnosis?.ai?.diagnoses?.[0]?.cause) {
      const shopStats = await getShopRepairStats({
        make: vehicle.make,
        model: vehicle.model,
        cause: results.diagnosis.ai.diagnoses[0].cause,
      });

      if (shopStats.totalRepairs > 0) {
        results.shopStats = shopStats;
        console.log(`  → Shop experience: ${shopStats.totalRepairs} similar repairs, ${shopStats.successRate || "?"}% success rate`);
      }
    }

    // For maintenance requests, check for applicable canned jobs
    if (requestInfo.type === "maintenance") {
      const cannedJobs = await getCannedJobs({
        make: vehicle.make,
        model: vehicle.model,
        year: vehicle.year,
      });

      if (cannedJobs.length > 0) {
        results.cannedJobs = cannedJobs;
        console.log(`  → ${cannedJobs.length} canned jobs available`);
      }
    }
  } catch (err) {
    console.error(`  → History check failed (non-fatal): ${err.message}`);
  }

  // ─── Step 3: Sequential Research (browser skills share one tab) ───
  console.log("\n[Step 3] Researching across databases...");

  let alldata = null, identifix = null, prodemand = null;
  const researchQuery = {
    vin: vehicle.vin,
    year: vehicle.year,
    make: vehicle.make,
    model: vehicle.model,
    engine: vehicle.engine?.displacement,
    query: params.query,
  };

  // Timeout wrapper — prevents a hung browser skill from blocking the pipeline
  const withTimeout = (promise, ms, label) =>
    Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timeout after ${ms / 1000}s`)), ms)),
    ]);

  // Fast URL reachability check — skip browser automation if URL is blocked (403) or down
  const isReachable = async (url, timeoutMs = 5000) => {
    try {
      const fetch = (await import("node-fetch")).default;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const resp = await fetch(url, { method: "HEAD", signal: controller.signal, redirect: "follow" });
      clearTimeout(timer);
      return resp.ok; // 200-299 only
    } catch { return false; }
  };

  const RESEARCH_TIMEOUT = 25000;    // 25s for OpenClaw platforms (AllData, Identifix)
  const PRODEMAND_TIMEOUT = 75000;   // 75s for ProDemand (real browser, vehicle selection + search)

  if (requestInfo.type === "diagnostic") {
    // Pre-check each platform's URL before attempting browser automation
    const alldataUrl = process.env.ALLDATA_URL || "https://my.alldata.com";
    const identifixUrl = process.env.IDENTIFIX_URL || "https://www.identifix.com";

    // ProDemand goes through Chrome's PAC proxy or TAPE API — skip reachability check
    const prodemandViaProxy = !!(process.env.PRODEMAND_USERNAME && process.env.PRODEMAND_PASSWORD);
    const [alldataUp, identifixUp] = await Promise.all([
      isReachable(alldataUrl),
      isReachable(identifixUrl),
    ]);

    console.log(`  → Reachability: AllData=${alldataUp ? "ok" : "blocked"}, Identifix=${identifixUp ? "ok" : "blocked"}, ProDemand=${prodemandViaProxy ? "proxy" : "no creds"}`);

    // Phase 1: Run OpenClaw browser platforms sequentially (share one tab),
    // ProDemand (Puppeteer/TAPE) runs in parallel since it uses a separate process.
    const prodemandPromise = prodemandViaProxy
      ? withTimeout(searchProDemand(researchQuery), PRODEMAND_TIMEOUT, "ProDemand").catch((e) => ({ error: e.message }))
      : Promise.resolve({ error: "ProDemand not configured" });

    // AllData → Identifix sequential (OpenClaw browser)
    if (alldataUp) {
      alldata = await withTimeout(searchAllData(researchQuery), RESEARCH_TIMEOUT, "AllData").catch((e) => ({ error: e.message }));
    } else {
      alldata = { error: "AllData unreachable from this network (IP blocked)" };
    }

    if (identifixUp) {
      identifix = await withTimeout(searchDirectHit(researchQuery), RESEARCH_TIMEOUT, "Identifix").catch((e) => ({ error: e.message }));
    } else {
      identifix = { error: "Identifix unreachable from this network" };
    }

    // Collect ProDemand result (may already be done if it used TAPE API)
    prodemand = await prodemandPromise;
  } else {
    // Maintenance — just labor times
    const prodemandViaProxy = !!(process.env.PRODEMAND_USERNAME && process.env.PRODEMAND_PASSWORD);
    if (prodemandViaProxy) {
      prodemand = await withTimeout(searchProDemand(researchQuery), PRODEMAND_TIMEOUT, "ProDemand").catch((e) => ({ error: e.message }));
    } else {
      prodemand = { error: "ProDemand not configured" };
    }
  }

  results.diagnosis = {
    ...results.diagnosis,
    alldata,
    identifix,
    prodemand,
  };

  // Collect AllData screenshots, wiring diagrams, and TSBs
  if (alldata?.screenshots?.length > 0) {
    results.screenshots = [...(results.screenshots || []), ...alldata.screenshots];
  }
  if (alldata?.wiringDiagrams?.length > 0) {
    results.wiringDiagrams = alldata.wiringDiagrams;
    console.log(`    AllData wiring: ${alldata.wiringDiagrams.length} diagram(s)`);
  }
  if (alldata?.tsbs?.length > 0) {
    results.tsbs = alldata.tsbs;
    console.log(`    AllData TSBs: ${alldata.tsbs.length}`);
  }

  // Collect ProDemand DTC test plan
  if (prodemand?.dtcTestPlan?.length > 0) {
    results.dtcTestPlan = prodemand.dtcTestPlan;
    console.log(`    ProDemand test plan: ${prodemand.dtcTestPlan.length} step(s)`);
  }

  // Use Identifix top fix to boost AI diagnosis confidence when they agree
  if (identifix?.topFix && results.diagnosis?.ai?.diagnoses?.length > 0) {
    const topFixDesc = identifix.topFix.description?.toLowerCase() || "";
    for (const diag of results.diagnosis.ai.diagnoses) {
      const causeWords = diag.cause?.toLowerCase().split(/\s+/) || [];
      const overlap = causeWords.filter((w) => w.length > 3 && topFixDesc.includes(w)).length;
      if (overlap >= 2 && identifix.topFix.successRate >= 50) {
        diag.identifix_corroborated = true;
        diag.identifix_success_rate = identifix.topFix.successRate;
        // Small confidence bump when Identifix agrees
        diag.confidence = Math.min(0.95, diag.confidence + 0.05);
      }
    }
  }

  // Use ProDemand labor times as fallback labor source
  if (prodemand?.laborTimes?.length > 0 && !prodemand.error) {
    results.prodemandLabor = prodemand.laborTimes;
  }

  console.log(`  → Research complete`);
  if (alldata && !alldata.error) console.log(`    AllData: ${alldata.procedures?.length || 0} procedures, ${Object.keys(alldata.torqueSpecs || {}).length} torque specs`);
  if (identifix && !identifix.error) console.log(`    Identifix: ${identifix.fixCount || 0} fixes, top fix ${identifix.topFix?.successRate || "?"}% success`);
  if (prodemand && !prodemand.error) console.log(`    ProDemand: ${prodemand.realFixes?.length || 0} Real Fixes, ${prodemand.laborTimes?.length || 0} labor times`);

  // ─── Step 4: Get Vehicle Specs (Mechanic Reference) ───
  console.log("\n[Step 4] Getting mechanic reference specs...");

  const repairType = params.query.toLowerCase().includes("o2") ? "o2-sensor" :
                     params.query.toLowerCase().includes("oil") ? "oil-change" :
                     params.query.toLowerCase().includes("brake") ? "brakes" :
                     params.query.toLowerCase().includes("spark") ? "spark-plugs" : null;

  results.mechanicSpecs = await getVehicleSpecs({
    vehicle,
    repairType,
  });

  // Merge AllData torque specs and special tools into mechanic specs
  if (alldata && !alldata.error && results.mechanicSpecs) {
    if (alldata.torqueSpecs && Object.keys(alldata.torqueSpecs).length > 0) {
      results.mechanicSpecs.torqueSpecs = {
        ...results.mechanicSpecs.torqueSpecs,
        ...Object.fromEntries(
          Object.entries(alldata.torqueSpecs).map(([k, v]) => [k, { value: v, source: "alldata" }])
        ),
      };
    }
    if (alldata.specialTools?.length > 0) {
      const existing = new Set((results.mechanicSpecs.specialTools || []).map((t) => t.toLowerCase()));
      const newTools = alldata.specialTools.filter((t) => !existing.has(t.toLowerCase()));
      results.mechanicSpecs.specialTools = [
        ...(results.mechanicSpecs.specialTools || []),
        ...newTools,
      ];
    }
  }

  console.log(`  → Sensor locations: ${results.mechanicSpecs.sensorLocations?.totalO2Sensors || 0} O2 sensors`);
  console.log(`  → Fluids: Oil ${results.mechanicSpecs.fluids?.engineOil?.weight || "?"}`);

  // ─── Step 5: Parts Search — Best Value ───
  console.log("\n[Step 5] Searching parts with vendor comparison...");

  const partsNeeded = extractPartsNeeded(params.query, results.diagnosis);
  console.log(`  → Parts needed: ${partsNeeded.map((p) => p.partType).join(", ") || "None identified"}`);

  if (partsNeeded.length > 0) {
    if (autoLeapPartstech) {
      // AutoLeap embedded PartsTech — uses Chrome session, no separate PT credentials needed
      results.parts = await autoLeapPartstech.searchPartsPricing({
        year: vehicle.year,
        make: vehicle.make,
        model: vehicle.model,
        vin: vehicle.vin || null,
        partsList: partsNeeded,
      });
    } else if (partstechOrder) {
      // Fallback: shop.partstech.com browser (requires PARTSTECH_USERNAME)
      results.parts = await partstechOrder.searchPartsPricing({
        year: vehicle.year,
        make: vehicle.make,
        model: vehicle.model,
        vin: vehicle.vin || null,
        partsList: partsNeeded,
      });
    } else if (vehicle.vin) {
      // Fallback: REST API (requires VIN + PARTSTECH_API_KEY)
      results.parts = await searchMultipleParts(vehicle.vin, partsNeeded);
    } else {
      console.log(`  → Skipped (set AUTOLEAP_EMAIL to enable parts pricing via AutoLeap)`);
    }

    if (results.parts) {
      console.log(`  → Best value bundle: $${results.parts.bestValueBundle?.totalCost?.toFixed(2) || "N/A"}`);
      console.log(`  → Suppliers: ${results.parts.bestValueBundle?.suppliers?.join(", ") || "N/A"}`);

      // Track parts search event
      trackEvent(shopId, "parts_searched", {
        vehicle: { year: vehicle.year, make: vehicle.make, model: vehicle.model },
        partsCount: partsNeeded.length,
        totalCost: results.parts.bestValueBundle?.totalCost,
        platformsUsed: ["partstech"],
      }).catch(() => {});

      // Collect OEM alternatives
      results.oemAlternatives = [];
      for (const res of results.parts.individualResults || []) {
        if (res.bestValue?.oem) {
          results.oemAlternatives.push(res.bestValue.oem);
        }
      }
      results.parts.oemAlternatives = results.oemAlternatives;
    }
  } else {
    console.log(`  → Skipped (no parts identified)`);
  }

  // ─── Step 5.5: Pre-stage Cart (Optional) ───
  if (partstechOrder && results.parts?.bestValueBundle?.parts?.length > 0) {
    console.log("\n[Step 5.5] Pre-staging parts in PartsTech cart...");
    try {
      const nonConditionalParts = results.parts.bestValueBundle.parts
        .filter((item) => item.selected && !item.requested?.conditional)
        .map((item) => ({
          partType: item.requested.partType,
          position: item.requested.position || null,
          partNumber: item.selected.partNumber,
          brand: item.selected.brand,
          supplier: item.selected.supplier,
          qty: item.requested.qty || 1,
        }));

      if (nonConditionalParts.length > 0) {
        const cartResult = await partstechOrder.addMultipleToCart({
          vin: vehicle.vin,
          year: vehicle.year,
          make: vehicle.make,
          model: vehicle.model,
          parts: nonConditionalParts,
        });

        results.cartStatus = cartResult.cart_summary || { error: cartResult.error };
        console.log(`  → Cart: ${cartResult.added?.length || 0} added, ${cartResult.failed?.length || 0} failed`);
      }
    } catch (err) {
      console.error(`  → Cart pre-staging failed (non-fatal): ${err.message}`);
      results.cartStatus = { error: err.message };
    }
  }

  // ─── Step 6: Build Estimate in AutoLeap ───
  if (autoLeapApi && params.customer) {
    // Direct REST API path — token from Chrome CDP session, then REST calls
    console.log("\n[Step 6] Creating estimate in AutoLeap (API)...");

    try {
      const estParts = results.parts?.bestValueBundle?.parts || [];
      const apiEstimate = await autoLeapApi.buildEstimate({
        customerName: params.customer.name,
        phone: params.customer.phone || null,
        vehicleYear: vehicle.year,
        vehicleMake: vehicle.make,
        vehicleModel: vehicle.model,
        vin: vehicle.vin || null,
        diagnosis: results.diagnosis,
        parts: estParts,
      });

      if (apiEstimate.success) {
        results.estimate = {
          success: true,
          estimateId: apiEstimate.estimateId,
          estimateCode: apiEstimate.estimateCode,
          total: apiEstimate.total,
          customerName: apiEstimate.customerName,
          vehicleDesc: apiEstimate.vehicleDesc,
        };
        results.estimateSource = "autoleap-api";
        console.log(`  → Estimate ${apiEstimate.estimateCode} created for ${apiEstimate.customerName}`);
        console.log(`  → Vehicle: ${apiEstimate.vehicleDesc}`);
        console.log(`  → Total: $${apiEstimate.total}`);

        trackEvent(shopId, "estimate_created", {
          vehicle: { year: vehicle.year, make: vehicle.make, model: vehicle.model },
          total: apiEstimate.total,
          estimateId: apiEstimate.estimateId,
          source: "autoleap-api",
          partsCount: estParts.length,
          platformsUsed: [
            alldata && !alldata.error ? "alldata" : null,
            identifix && !identifix.error ? "identifix" : null,
            prodemand && !prodemand.error ? "prodemand" : null,
          ].filter(Boolean),
        }).catch(() => {});
      } else {
        console.error(`  → AutoLeap API estimate failed: ${apiEstimate.error}`);
        results.estimate = { error: apiEstimate.error };
      }
    } catch (err) {
      console.error(`  → AutoLeap API error: ${err.message}`);
      results.estimate = { error: err.message };
    }
  } else if (params.customer) {
    // Fallback: API-based estimate (existing code)
    console.log("\n[Step 6] Creating estimate in AutoLeap (API)...");

    try {
      const customer = await findOrCreateCustomer(params.customer);
      const autoLeapVehicle = await findOrCreateVehicle({
        customerId: customer.id,
        vin: vehicle.vin,
        year: vehicle.year,
        make: vehicle.make,
        model: vehicle.model,
        mileage: vehicle.mileage || 0,
      });

      // Build line items from parts
      const lineItems = [];

      // Get labor hours: repair plan → ProDemand → params → default
      const repairPlan = results.diagnosis?.ai?.repair_plan;
      let laborHours = repairPlan?.labor?.hours || null;
      let laborSource = repairPlan?.labor?.source || null;

      // Fallback to ProDemand labor times
      if (!laborHours && results.prodemandLabor?.length > 0) {
        laborHours = results.prodemandLabor[0].hours;
        laborSource = "prodemand";
      }

      laborHours = laborHours || params.laborHours || 1.0;
      laborSource = laborSource || "estimated";

      // Add labor line
      lineItems.push({
        description: params.query,
        laborHours,
        partsCost: 0,
      });
      console.log(`  → Labor: ${laborHours}h (source: ${laborSource})`);

      // Add parts from best value bundle
      if (results.parts?.bestValueBundle?.parts) {
        for (const item of results.parts.bestValueBundle.parts) {
          if (item.selected) {
            lineItems.push({
              description: `${item.selected.brand} ${item.selected.description}`,
              laborHours: 0,
              partsCost: item.selected.totalCost,
              partNumber: item.selected.partNumber,
            });
          }
        }
      }

      results.estimate = await createEstimate({
        customerId: customer.id,
        vehicleId: autoLeapVehicle.id,
        lineItems,
        shopConfig,
      });
      results.estimateSource = "api";

      console.log(`  → Estimate created: ${results.estimate.estimateId}`);
      console.log(`  → Total: $${results.estimate.total}`);

      // Track estimate creation event
      trackEvent(shopId, "estimate_created", {
        vehicle: { year: vehicle.year, make: vehicle.make, model: vehicle.model },
        total: results.estimate.total,
        estimateId: results.estimate.estimateId,
        source: "api",
        partsCount: results.parts?.bestValueBundle?.parts?.length || 0,
        platformsUsed: [
          alldata && !alldata.error ? "alldata" : null,
          identifix && !identifix.error ? "identifix" : null,
          prodemand && !prodemand.error ? "prodemand" : null,
        ].filter(Boolean),
      }).catch(() => {});
    } catch (err) {
      console.error(`  → AutoLeap error: ${err.message}`);
      results.estimate = { error: err.message };
    }
  } else {
    console.log("\n[Step 6] Skipped AutoLeap (provide customer info to create)");
  }

  // ─── Step 7: Generate PDF Estimate ───
  console.log("\n[Step 7] Generating PDF estimate...");

  try {
    // Build labor lines for PDF — use repair plan hours, then ProDemand, then params
    const pdfRepairPlan = results.diagnosis?.ai?.repair_plan;
    const pdfLaborHours = pdfRepairPlan?.labor?.hours ||
      (results.prodemandLabor?.length > 0 ? results.prodemandLabor[0].hours : null) ||
      params.laborHours || 1.0;
    const laborLines = [{
      description: params.query,
      hours: pdfLaborHours,
      rate: shopConfig.shop.laborRatePerHour,
      total: pdfLaborHours * shopConfig.shop.laborRatePerHour,
    }];

    // Build parts lines for PDF
    const partLines = [];
    if (results.parts?.bestValueBundle?.parts) {
      for (const item of results.parts.bestValueBundle.parts) {
        if (item.selected) {
          const p = item.selected;
          partLines.push({
            description: p.description,
            partNumber: p.partNumber,
            qty: 1,
            unitPrice: p.totalCost,
            total: p.totalCost,
            supplier: p.supplier,
          });
        }
      }
    }

    // Calculate totals
    const laborTotal = laborLines.reduce((sum, l) => sum + l.total, 0);
    const partsTotal = partLines.reduce((sum, p) => sum + p.total, 0) * (1 + shopConfig.markup.partsMarkupPercent / 100);
    const suppliesTotal = Math.min(
      (laborTotal + partsTotal) * (shopConfig.shop.shopSuppliesPercent / 100),
      shopConfig.shop.shopSuppliesCap
    );
    const subtotal = laborTotal + partsTotal + suppliesTotal;
    const taxTotal = subtotal * shopConfig.shop.taxRate;
    const grandTotal = subtotal + taxTotal;

    results.pdfPath = await generateEstimatePDF({
      shop: shopConfig.shop,
      customer: params.customer,
      vehicle: {
        year: vehicle.year,
        make: vehicle.make,
        model: vehicle.model,
        trim: vehicle.trim,
        engine: vehicle.engine?.displacement,
        vin: vehicle.vin,
        mileage: vehicle.mileage,
      },
      diagnosis: results.diagnosis?.summary,
      laborLines,
      partLines,
      partsOptions: results.parts?.bestValueBundle?.parts?.[0] ? {
        aftermarket: results.parts.bestValueBundle.parts[0].selected,
        oem: results.oemAlternatives?.[0],
      } : null,
      totals: {
        labor: laborTotal,
        parts: partsTotal,
        supplies: suppliesTotal,
        tax: taxTotal,
        total: grandTotal,
      },
      mechanicSpecs: results.mechanicSpecs,
      outputPath: require("path").join(require("os").tmpdir(), `estimate-${vehicle.year}-${vehicle.make}-${vehicle.model}-${Date.now()}.pdf`),
    });

    console.log(`  → PDF: ${results.pdfPath}`);
  } catch (err) {
    console.error(`  → PDF generation error: ${err.message}`);
  }

  // ─── Step 8: Capture Procedure Screenshots ───
  if (requestInfo.type === "diagnostic") {
    console.log("\n[Step 8] Capturing procedure screenshots...");
    try {
      const newScreenshots = await captureScreenshots();
      results.screenshots = [...(results.screenshots || []), ...newScreenshots];
      console.log(`  → ${newScreenshots.length} new screenshots (${results.screenshots.length} total)`);
    } catch {
      // Keep any screenshots already collected from research
    }
  }

  // ─── Done ───
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n═══════════════════════════════════════════════════════════════`);
  console.log(`  Pipeline complete in ${elapsed}s`);
  console.log(`═══════════════════════════════════════════════════════════════\n`);

  // Format response for service advisor
  results.formattedResponse = formatServiceAdvisorResponse(results);

  return results;
}

module.exports = {
  buildEstimate,
  handleOrderRequest,
  handleApprovalAndOrder,
  classifyRequest,
  extractPartsNeeded,
  formatDiagnosisSummary,
  formatServiceAdvisorResponse,
};
