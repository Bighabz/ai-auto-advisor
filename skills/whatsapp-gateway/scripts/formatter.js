/**
 * WhatsApp Mobile Formatter
 *
 * Converts orchestrator results into WhatsApp-friendly messages:
 *   - No wide box-drawing characters (wrap badly on mobile)
 *   - Split into 2-3 messages for readability
 *   - First message under 1000 chars (headline + total)
 *   - Quick-reply prompts at the end
 */

const LOG = "[wa-format]";

/**
 * Format estimate results for WhatsApp delivery.
 * Returns an array of message strings to send sequentially.
 *
 * @param {object} results - Output from buildEstimate()
 * @returns {string[]} Array of WhatsApp messages (send in order)
 */
function formatForWhatsApp(results) {
  const messages = [];
  const { vehicle, diagnosis, parts, estimate, mechanicSpecs, pdfPath } = results;

  // ── Message 1: Headline + Diagnosis + Total (< 1000 chars) ──
  let msg1 = "";

  const vName = `${vehicle.year} ${vehicle.make} ${vehicle.model} ${vehicle.trim || ""}`.trim();
  msg1 += `*ESTIMATE READY*\n`;
  msg1 += `${vName}\n`;
  if (vehicle.engine?.displacement) msg1 += `Engine: ${vehicle.engine.displacement}\n`;
  if (vehicle.vin) msg1 += `VIN: ${vehicle.vin}\n`;
  msg1 += `\n`;

  // Diagnosis headline
  if (diagnosis?.ai?.diagnoses?.length > 0) {
    const top = diagnosis.ai.diagnoses[0];
    const conf = Math.round((top.confidence || 0) * 100);
    msg1 += `*Diagnosis:* ${top.cause} (${conf}% confidence)\n`;

    if (diagnosis.ai.diagnoses.length > 1) {
      const second = diagnosis.ai.diagnoses[1];
      const conf2 = Math.round((second.confidence || 0) * 100);
      msg1 += `Also possible: ${second.cause} (${conf2}%)\n`;
    }

    if (diagnosis.ai.low_confidence_warning) {
      msg1 += `\u26A0 Low confidence — recommend further diagnostic verification\n`;
    }

    if (diagnosis.ai.recalls?.length > 0) {
      msg1 += `\u{1F4CB} ${diagnosis.ai.recalls.length} open recall(s) found\n`;
    }
    msg1 += `\n`;
  }

  // Estimate total
  if (estimate?.total) {
    msg1 += `*ESTIMATE TOTAL: $${estimate.total}*\n`;
    msg1 += `Labor: $${estimate.totalLabor} | Parts: $${estimate.totalParts}\n`;
    msg1 += `Shop supplies: $${estimate.shopSupplies} | Tax: $${estimate.tax}\n`;
    if (estimate.estimateId) {
      msg1 += `AutoLeap: ${estimate.estimateId}\n`;
    }
  } else if (parts?.bestValueBundle?.totalCost) {
    // No AutoLeap estimate but have parts pricing
    const rp = diagnosis?.ai?.repair_plan;
    const laborHours = rp?.labor?.hours || 1.0;
    const laborRate = 135; // default
    const laborTotal = laborHours * laborRate;
    const partsTotal = parts.bestValueBundle.totalCost;
    const rough = laborTotal + partsTotal;
    msg1 += `*ESTIMATED COST: ~$${rough.toFixed(0)}+*\n`;
    msg1 += `Labor: ~${laborHours}h ($${laborTotal.toFixed(0)}) | Parts: $${partsTotal.toFixed(2)}\n`;
    msg1 += `_(+ tax & shop supplies)_\n`;
  }

  if (pdfPath) {
    msg1 += `\n\u{1F4C4} PDF estimate attached`;
  }

  messages.push(msg1.trim());

  // ── Message 2: Details (diagnosis steps, parts, repair plan) ──
  let msg2 = "";

  // Diagnostic steps
  if (diagnosis?.ai?.diagnostic_steps?.length > 0) {
    msg2 += `*DIAGNOSTIC STEPS:*\n`;
    for (let i = 0; i < Math.min(diagnosis.ai.diagnostic_steps.length, 4); i++) {
      msg2 += `${i + 1}. ${diagnosis.ai.diagnostic_steps[i]}\n`;
    }
    msg2 += `\n`;
  }

  // Repair plan labor + tools
  const rp = diagnosis?.ai?.repair_plan;
  if (rp) {
    if (rp.labor) {
      const srcLabel = rp.labor.source === "ari" ? "ARI" :
                       rp.labor.source === "labor_cache" ? "Cached" :
                       rp.labor.source === "prodemand" ? "ProDemand" :
                       "Estimated";
      msg2 += `*LABOR:* ${rp.labor.hours}h (${srcLabel})`;
      if (rp.labor.requires_lift) msg2 += ` \u{1F6E0} Needs lift`;
      msg2 += `\n`;
      if (rp.labor.special_notes) msg2 += `_${rp.labor.special_notes}_\n`;
      msg2 += `\n`;
    }

    if (rp.verification) {
      msg2 += `*VERIFY:*\n`;
      if (rp.verification.before_repair) msg2 += `Before: ${rp.verification.before_repair}\n`;
      if (rp.verification.after_repair) msg2 += `After: ${rp.verification.after_repair}\n`;
      msg2 += `\n`;
    }
  }

  // Parts list
  if (parts?.bestValueBundle?.parts?.length > 0) {
    msg2 += `*PARTS:*\n`;
    for (const item of parts.bestValueBundle.parts) {
      if (item.selected) {
        const p = item.selected;
        msg2 += `\u2713 ${p.brand} ${p.description}`;
        if (p.position) msg2 += ` (${p.position})`;
        msg2 += `\n  #${p.partNumber} | $${p.totalCost.toFixed(2)} | ${p.availability}\n`;
      }
    }
    msg2 += `Total: $${parts.bestValueBundle.totalCost.toFixed(2)}`;
    msg2 += parts.bestValueBundle.allInStock ? ` \u2713 All in stock` : ` \u26A0 Some backordered`;
    msg2 += `\n`;
  }

  // Platform research summary
  const platforms = [];
  if (diagnosis?.identifix && !diagnosis.identifix.error && diagnosis.identifix.fixCount > 0) {
    platforms.push(`Identifix: ${diagnosis.identifix.fixCount} known fixes`);
  }
  if (diagnosis?.prodemand && !diagnosis.prodemand.error) {
    const rfCount = diagnosis.prodemand.realFixes?.length || 0;
    if (rfCount > 0) platforms.push(`ProDemand: ${rfCount} Real Fixes`);
  }
  if (diagnosis?.alldata && !diagnosis.alldata.error) {
    const procCount = diagnosis.alldata.procedures?.length || 0;
    if (procCount > 0) platforms.push(`AllData: ${procCount} procedures`);
  }
  if (platforms.length > 0) {
    msg2 += `\n*RESEARCH:* ${platforms.join(" | ")}\n`;
  }

  if (msg2.trim()) {
    messages.push(msg2.trim());
  }

  // ── Message 3: Mechanic reference (torque, fluids, tools) ──
  let msg3 = "";

  if (mechanicSpecs) {
    msg3 += `*MECHANIC REFERENCE:*\n`;

    if (rp?.torque_specs && Object.keys(rp.torque_specs).length > 0) {
      msg3 += `\n_Torque specs:_\n`;
      for (const [comp, spec] of Object.entries(rp.torque_specs)) {
        msg3 += `\u2022 ${comp}: ${spec}\n`;
      }
    } else if (mechanicSpecs.torqueSpecs) {
      msg3 += `\n_Torque specs:_\n`;
      const t = mechanicSpecs.torqueSpecs;
      if (t.oilDrainPlug?.value) msg3 += `\u2022 Oil drain plug: ${t.oilDrainPlug.value}\n`;
      if (t.o2Sensor?.value) msg3 += `\u2022 O2 sensor: ${t.o2Sensor.value}\n`;
      if (t.wheelLugNuts?.value) msg3 += `\u2022 Lug nuts: ${t.wheelLugNuts.value}\n`;
    }

    if (rp?.tools?.length > 0) {
      msg3 += `\n_Tools needed:_\n`;
      for (const tool of rp.tools.slice(0, 6)) {
        msg3 += `\u2022 ${tool}\n`;
      }
    }

    if (mechanicSpecs.fluids) {
      const oil = mechanicSpecs.fluids.engineOil || {};
      msg3 += `\n_Fluids:_\n`;
      msg3 += `\u2022 Oil: ${oil.capacityWithFilter || "?"} — ${oil.weight || "?"}\n`;
    }

    if (mechanicSpecs.sensorLocations?.sensors) {
      msg3 += `\n_Sensor locations:_\n`;
      const sensors = mechanicSpecs.sensorLocations.sensors;
      for (const [key, sensor] of Object.entries(sensors)) {
        if (typeof sensor === "object" && sensor.name) {
          msg3 += `\u2022 ${sensor.name}: ${sensor.location}\n`;
        }
      }
    }
  }

  if (msg3.trim()) {
    messages.push(msg3.trim());
  }

  // ── Final: Quick-reply prompt ──
  let prompt = "";
  if (results.cartStatus?.ready_to_order) {
    prompt += `\u{1F4E6} Reply *ORDER* to place parts ($${results.cartStatus.total})\n`;
  }
  if (estimate?.estimateId) {
    prompt += `\u{1F4E9} Reply *SEND* to email estimate to customer\n`;
  }
  prompt += `\u2753 Reply *HELP* for more options`;

  messages.push(prompt.trim());

  console.log(`${LOG} Formatted ${messages.length} messages (${messages.map(m => m.length).join("+")} chars)`);
  return messages;
}

/**
 * Format a help response.
 * @returns {string}
 */
function formatHelp() {
  return [
    `*SAM — AI Service Advisor*`,
    ``,
    `Send me a vehicle + problem and I'll build a complete estimate:`,
    ``,
    `_Examples:_`,
    `\u2022 "2019 Civic 2.0L P0420"`,
    `\u2022 "front brakes 2017 F-150"`,
    `\u2022 "oil change 2020 Camry 87k miles"`,
    `\u2022 "P0300 misfire 2018 Silverado 5.3L customer Mike 555-1234"`,
    ``,
    `*Commands:*`,
    `\u2022 *ORDER* — Place parts from last estimate`,
    `\u2022 *SEND* — Email estimate to customer`,
    `\u2022 *HELP* — Show this message`,
  ].join("\n");
}

/**
 * Format a status/ping response.
 * @returns {string}
 */
function formatStatus() {
  return `*SAM is online* \u2713\nReady to build estimates.`;
}

module.exports = { formatForWhatsApp, formatHelp, formatStatus };
