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

// ── Utilities ──

/**
 * Escape user-provided text so it doesn't break Markdown formatting.
 * Only escapes characters that could interfere — our own markup is added separately.
 */
function escapeMarkdown(text) {
  if (!text) return "";
  return String(text)
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\[/g, "\\[");
}

/**
 * Split a long message at newline boundaries to stay under maxLen.
 */
function splitMessage(text, maxLen = 4000) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > maxLen) {
    let splitAt = remaining.lastIndexOf("\n", maxLen);
    if (splitAt < maxLen * 0.5) splitAt = maxLen;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

/**
 * User-friendly error messages mapped from reason codes.
 */
const ERROR_MESSAGES = {
  PT_NO_PRODUCTS: "Couldn't get live parts pricing right now \u2014 estimate includes labor and TBD parts.",
  PT_NO_TAB: "Parts lookup service temporarily unavailable.",
  PT_LOGIN_REDIRECT: "Parts lookup needs re-authentication \u2014 try again in a moment.",
  NO_MOTOR_LABOR: "Using estimated labor hours \u2014 real book time wasn't available.",
  NO_PARTS_PRICING: "Some parts couldn't be priced \u2014 marked as TBD.",
  PRICING_GATE_BLOCKED: "Parts pricing needs review \u2014 check AutoLeap before sending to customer.",
  CIRCUIT_OPEN: "Some research sources are temporarily unavailable \u2014 estimate may be less detailed.",
  TIMEOUT: "Research took longer than expected \u2014 some details may be missing.",
  PDF_AUTOLEAP_UNAVAILABLE: "AutoLeap PDF couldn't be downloaded \u2014 view estimate in AutoLeap directly.",
};

function getErrorMessage(reason_code) {
  return ERROR_MESSAGES[reason_code] || null;
}

/**
 * Format estimate results for WhatsApp delivery.
 * Returns an array of message strings to send sequentially.
 *
 * @param {object} results - Output from buildEstimate()
 * @returns {string[]} Array of WhatsApp messages (send in order)
 */
function formatForWhatsApp(results) {
  const messages = [];
  const { vehicle, diagnosis, parts, estimate, mechanicSpecs, pdfPath, tsbs, dtcTestPlan } = results;

  // Pricing gate: suppress dollar totals and PDF when customer_ready is false
  const blocked = results.customer_ready === false;

  // ── Message 1: Headline + Diagnosis + Total (< 1000 chars) ──
  let msg1 = "";

  const vName = escapeMarkdown(`${vehicle.year} ${vehicle.make} ${vehicle.model} ${vehicle.trim || ""}`.trim());
  msg1 += blocked ? `*ESTIMATE — INTERNAL REVIEW*\n` : `*ESTIMATE READY*\n`;
  msg1 += `${vName}\n`;
  if (vehicle.engine?.displacement) msg1 += `Engine: ${escapeMarkdown(vehicle.engine.displacement)}\n`;
  if (vehicle.vin) msg1 += `VIN: ${escapeMarkdown(vehicle.vin)}\n`;
  msg1 += `\n`;

  // Diagnosis headline
  if (diagnosis?.ai?.diagnoses?.length > 0) {
    const top = diagnosis.ai.diagnoses[0];
    const conf = Math.round((top.confidence || 0) * 100);
    msg1 += `*Diagnosis:* ${escapeMarkdown(top.cause)} (${conf}% confidence)\n`;

    if (diagnosis.ai.diagnoses.length > 1) {
      const second = diagnosis.ai.diagnoses[1];
      const conf2 = Math.round((second.confidence || 0) * 100);
      msg1 += `Also possible: ${escapeMarkdown(second.cause)} (${conf2}%)\n`;
    }

    if (diagnosis.ai.low_confidence_warning) {
      msg1 += `\u26A0 Low confidence — recommend further diagnostic verification\n`;
    }

    if (diagnosis.ai.recalls?.length > 0) {
      msg1 += `\u{1F4CB} ${diagnosis.ai.recalls.length} open recall(s) found\n`;
    }
    msg1 += `\n`;
  }

  // Estimate total — suppressed when pricing gate is blocked
  if (blocked) {
    msg1 += `\n\u26A0 *Parts pricing couldn't be resolved — review before sending*\n`;
  } else if (estimate?.total) {
    msg1 += `*ESTIMATE TOTAL: $${estimate.total.toFixed(2)}*\n`;
    if (estimate.totalLabor != null && estimate.totalParts != null) {
      msg1 += `Labor: $${estimate.totalLabor.toFixed(2)} | Parts: $${estimate.totalParts.toFixed(2)}\n`;
    }
    if (estimate.estimateId) {
      msg1 += `AutoLeap: #${estimate.estimateCode || estimate.estimateId}\n`;
    }
  } else {
    msg1 += `_Pricing in AutoLeap estimate_\n`;
  }

  if (pdfPath && !blocked) {
    msg1 += `\n\u{1F4C4} PDF estimate attached`;
  }

  if (results.warnings?.length > 0) {
    const notices = [];
    for (const w of results.warnings) {
      const friendly = getErrorMessage(w.code);
      if (friendly) {
        notices.push(friendly);
      } else if (w.msg) {
        notices.push(w.msg);
      }
    }
    if (notices.length > 0) {
      msg1 += "\n\n\u26A0 " + notices.join("\n\u26A0 ");
    }
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

  // ProDemand DTC test plan
  if (dtcTestPlan?.length > 0) {
    msg2 += `*DTC TEST PLAN (ProDemand):*\n`;
    for (const step of dtcTestPlan.slice(0, 5)) {
      msg2 += `${step.step}. ${step.action}\n`;
    }
    msg2 += `\n`;
  }

  // Repair plan labor + tools
  const rp = diagnosis?.ai?.repair_plan;
  if (rp) {
    if (rp.labor) {
      const src = rp.labor.source;
      const srcLabel = (src === "prodemand" || src === "ari" || src === "labor_cache") ? "MOTOR" :
                       src === "ai_fallback" ? "AI est." :
                       src === "estimated" ? "AI est." :
                       src ? src : "TBD";
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

  // Parts list — show part names; retail totals come from AutoLeap (not wholesale cost)
  if (parts?.bestValueBundle?.parts?.length > 0) {
    const isNative = results.estimateSource === "autoleap-native";
    msg2 += isNative ? `*PARTS (via PartsTech \u2192 AutoLeap):*\n` : `*PARTS:*\n`;
    for (const item of parts.bestValueBundle.parts) {
      if (item.selected) {
        const p = item.selected;
        msg2 += `\u2713 ${escapeMarkdown(p.brand)} ${escapeMarkdown(p.description)}`;
        if (p.position) msg2 += ` (${escapeMarkdown(p.position)})`;
        msg2 += `\n  #${escapeMarkdown(p.partNumber)} | ${escapeMarkdown(p.availability)}\n`;
        // Don't show wholesale price — AutoLeap has the retail price
      }
    }
    if (blocked) {
      msg2 += `_Parts pricing pending — review in AutoLeap_\n`;
    } else if (estimate?.totalParts > 0) {
      msg2 += `*Parts Total (retail): $${estimate.totalParts.toFixed(2)}*\n`;
    } else {
      msg2 += `_See AutoLeap estimate for parts pricing_\n`;
    }
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

  // AllData TSBs
  if (tsbs?.length > 0) {
    msg3 += msg3.trim() ? `\n` : ``;
    msg3 += `*TECHNICAL SERVICE BULLETINS (AllData):*\n`;
    for (const tsb of tsbs.slice(0, 4)) {
      msg3 += `\u2022 *${tsb.number}* — ${tsb.title}`;
      if (tsb.date) msg3 += ` (${tsb.date})`;
      msg3 += `\n`;
      if (tsb.summary) msg3 += `  _${tsb.summary.slice(0, 120)}_\n`;
    }
  }

  if (msg3.trim()) {
    messages.push(msg3.trim());
  }

  // ── Final: Quick-reply prompt ──
  let prompt = "";
  if (results.estimateSent?.success) {
    prompt += `\u2705 Estimate sent to customer via ${results.estimateSent.sentVia}\n`;
    prompt += `\u{1F4E6} Reply *APPROVED* when customer confirms\n`;
  } else if (results.cartStatus?.ready_to_order) {
    prompt += `\u{1F4E6} Reply *ORDER* to place parts ($${results.cartStatus.total})\n`;
  }
  if (estimate?.estimateId && !results.estimateSent?.success) {
    prompt += `\u{1F4E9} Reply *SEND* to email estimate to customer\n`;
  }
  prompt += `\u2753 Reply *HELP* for more options`;

  messages.push(prompt.trim());

  // Split any message that exceeds 4000 chars
  const finalMessages = [];
  for (const m of messages) {
    finalMessages.push(...splitMessage(m, 4000));
  }

  console.log(`${LOG} Formatted ${finalMessages.length} messages (${finalMessages.map(m => m.length).join("+")} chars)`);
  return finalMessages;
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
    `\u2022 *APPROVED* — Customer approved, order parts`,
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

/**
 * Format a greeting response.
 * @returns {string}
 */
function formatGreeting() {
  return [
    `Hey! \u{1F44B} I'm SAM, your AI Service Advisor.`,
    ``,
    `Send me a vehicle + problem and I'll build a complete estimate with diagnosis, parts pricing, and labor times.`,
    ``,
    `_Example: "2019 Civic P0420"_`,
    ``,
    `Reply *HELP* for more examples.`,
  ].join("\n");
}

/**
 * Format research results for immediate delivery to tech.
 * Sent before the estimate is built so tech can start working.
 *
 * @param {object} results - Partial results (diagnosis + research, no estimate yet)
 * @returns {string[]} Array of WhatsApp messages
 */
function formatResearchFirst(results) {
  const messages = [];
  const { vehicle, diagnosis } = results;

  const vName = escapeMarkdown(`${vehicle.year} ${vehicle.make} ${vehicle.model}`.trim());
  let msg = `*RESEARCH READY* \u{1F50D}\n${vName}\n\n`;

  // Diagnosis
  if (diagnosis?.ai?.diagnoses?.length > 0) {
    const top = diagnosis.ai.diagnoses[0];
    const conf = Math.round((top.confidence || 0) * 100);
    msg += `*Diagnosis:* ${escapeMarkdown(top.cause)} (${conf}%)\n`;
    if (top.reasoning) msg += `_${escapeMarkdown(top.reasoning)}_\n`;
    msg += `\n`;
  }

  // Diagnostic steps
  if (diagnosis?.ai?.diagnostic_steps?.length > 0) {
    msg += `*Steps:*\n`;
    for (let i = 0; i < Math.min(diagnosis.ai.diagnostic_steps.length, 4); i++) {
      msg += `${i + 1}. ${diagnosis.ai.diagnostic_steps[i]}\n`;
    }
    msg += `\n`;
  }

  // Platform research
  if (diagnosis?.identifix && !diagnosis.identifix.error && diagnosis.identifix.fixCount > 0) {
    msg += `*Identifix:* ${diagnosis.identifix.fixCount} known fixes\n`;
    if (diagnosis.identifix.topFix?.description) {
      msg += `\u2192 ${diagnosis.identifix.topFix.description.substring(0, 100)}\n`;
    }
  }

  if (diagnosis?.alldata && !diagnosis.alldata.error) {
    const procCount = diagnosis.alldata.procedures?.length || 0;
    if (procCount > 0) {
      msg += `*AllData:* ${procCount} procedure steps\n`;
    }
    if (diagnosis.alldata.torqueSpecs && Object.keys(diagnosis.alldata.torqueSpecs).length > 0) {
      msg += `_Torque specs available_\n`;
    }
  }

  if (diagnosis?.prodemand && !diagnosis.prodemand.error) {
    const rfCount = diagnosis.prodemand.realFixes?.length || 0;
    if (rfCount > 0) {
      msg += `*ProDemand:* ${rfCount} Real Fixes\n`;
    }
  }

  msg += `\n_Building estimate in AutoLeap..._`;

  messages.push(msg.trim());
  return messages;
}

module.exports = { formatForWhatsApp, formatHelp, formatStatus, formatGreeting, formatResearchFirst, getErrorMessage, escapeMarkdown, splitMessage };
