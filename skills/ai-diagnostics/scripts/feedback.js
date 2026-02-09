/**
 * Feedback — Outcome Tracking & Learning Loop for AI Diagnostics
 *
 * Records technician outcomes against AI predictions, tracks accuracy
 * stats, and feeds confirmed diagnoses back into the knowledge base
 * to improve future predictions.
 *
 * Tables used:
 *   - diagnosis_log (read — look up original predictions)
 *   - diagnosis_outcomes (read/write — store outcomes)
 *   - diagnostic_knowledge (write — via insertCase for learning)
 */

const { getSupabase, insertCase } = require("./embeddings");

// ---------------------------------------------------------------------------
// recordOutcome — Store a technician's outcome for a diagnosis
// ---------------------------------------------------------------------------

/**
 * Record the actual outcome of a diagnosis
 * @param {string} diagnosisId - UUID of the diagnosis_log entry
 * @param {string} actualCause - What the technician determined was the real cause
 * @param {boolean} wasCorrect - Whether the AI's top prediction matched
 * @param {object[]|null} partsUsed - Array of parts used (stored as jsonb)
 * @param {number|null} laborHours - Actual labor hours spent
 * @param {string|null} notes - Technician notes
 * @returns {object} The inserted outcome row, or { error } on failure
 */
async function recordOutcome(diagnosisId, actualCause, wasCorrect, partsUsed, laborHours, notes) {
  try {
    const db = getSupabase();

    // Look up the original diagnosis to get the predicted cause
    const { data: diagLog, error: lookupErr } = await db
      .from("diagnosis_log")
      .select("id, top_prediction")
      .eq("id", diagnosisId)
      .single();

    if (lookupErr) {
      console.error(`[ai-diagnostics] Failed to look up diagnosis ${diagnosisId}: ${lookupErr.message}`);
      return { error: `Diagnosis not found: ${lookupErr.message}` };
    }

    const row = {
      diagnosis_log_id: diagnosisId,
      predicted_cause: diagLog.top_prediction,
      actual_cause: actualCause,
      was_correct: wasCorrect,
      parts_used: partsUsed || null,
      labor_actual_hours: laborHours || null,
      technician_notes: notes || null,
    };

    const { data, error } = await db
      .from("diagnosis_outcomes")
      .insert(row)
      .select()
      .single();

    if (error) {
      console.error(`[ai-diagnostics] Failed to record outcome: ${error.message}`);
      return { error: `Failed to record outcome: ${error.message}` };
    }

    console.log(`[ai-diagnostics] Outcome recorded: ${data.id} (correct: ${wasCorrect})`);
    return data;
  } catch (err) {
    console.error(`[ai-diagnostics] recordOutcome error: ${err.message}`);
    return { error: err.message };
  }
}

// ---------------------------------------------------------------------------
// getAccuracyStats — Aggregate accuracy metrics
// ---------------------------------------------------------------------------

/**
 * Get accuracy statistics across all recorded outcomes
 * @returns {object} { overall: { total, correct, accuracy }, byDtc: { [code]: { total, correct, accuracy } } }
 */
async function getAccuracyStats() {
  try {
    const db = getSupabase();

    // Total diagnoses (all logged, regardless of outcome)
    const { count: totalDiagnoses, error: countErr } = await db
      .from("diagnosis_log")
      .select("id", { count: "exact", head: true });

    if (countErr) {
      console.error(`[ai-diagnostics] Failed to count diagnoses: ${countErr.message}`);
      return { error: `Failed to count diagnoses: ${countErr.message}` };
    }

    // All outcomes joined with diagnosis_log for DTC codes
    const { data: outcomes, error: outcomeErr } = await db
      .from("diagnosis_outcomes")
      .select("was_correct, diagnosis_log!inner(dtc_codes)");

    if (outcomeErr) {
      console.error(`[ai-diagnostics] Failed to fetch outcomes: ${outcomeErr.message}`);
      return { error: `Failed to fetch outcomes: ${outcomeErr.message}` };
    }

    // Overall stats
    const totalWithOutcomes = outcomes.length;
    const totalCorrect = outcomes.filter((o) => o.was_correct).length;
    const overallAccuracy = totalWithOutcomes > 0
      ? Math.round((totalCorrect / totalWithOutcomes) * 10000) / 100
      : 0;

    // Per-DTC stats
    const byDtc = {};

    for (const outcome of outcomes) {
      const dtcCodes = outcome.diagnosis_log?.dtc_codes || [];

      for (const code of dtcCodes) {
        if (!byDtc[code]) {
          byDtc[code] = { total: 0, correct: 0, accuracy: 0 };
        }
        byDtc[code].total += 1;
        if (outcome.was_correct) {
          byDtc[code].correct += 1;
        }
      }
    }

    // Calculate per-DTC accuracy percentages
    for (const code of Object.keys(byDtc)) {
      const entry = byDtc[code];
      entry.accuracy = entry.total > 0
        ? Math.round((entry.correct / entry.total) * 10000) / 100
        : 0;
    }

    const stats = {
      overall: {
        total: totalDiagnoses,
        withOutcomes: totalWithOutcomes,
        correct: totalCorrect,
        accuracy: overallAccuracy,
      },
      byDtc,
    };

    console.log(`[ai-diagnostics] Accuracy stats: ${totalCorrect}/${totalWithOutcomes} correct (${overallAccuracy}%) across ${totalDiagnoses} total diagnoses`);
    return stats;
  } catch (err) {
    console.error(`[ai-diagnostics] getAccuracyStats error: ${err.message}`);
    return { error: err.message };
  }
}

// ---------------------------------------------------------------------------
// learnFromOutcome — Feed confirmed diagnoses back into knowledge base
// ---------------------------------------------------------------------------

/**
 * Create a new knowledge base entry from a confirmed diagnosis outcome.
 * This strengthens future predictions for similar vehicle+DTC combinations.
 *
 * @param {string} diagnosisId - UUID of the diagnosis_log entry
 * @param {string} actualCause - The confirmed actual cause
 * @returns {object} The new diagnostic_knowledge entry, or { error }
 */
async function learnFromOutcome(diagnosisId, actualCause) {
  try {
    const db = getSupabase();

    // Look up the original diagnosis for vehicle info and DTC codes
    const { data: diagLog, error: lookupErr } = await db
      .from("diagnosis_log")
      .select("*")
      .eq("id", diagnosisId)
      .single();

    if (lookupErr) {
      console.error(`[ai-diagnostics] Failed to look up diagnosis ${diagnosisId}: ${lookupErr.message}`);
      return { error: `Diagnosis not found: ${lookupErr.message}` };
    }

    const dtcCodes = diagLog.dtc_codes || [];

    if (dtcCodes.length === 0) {
      console.warn(`[ai-diagnostics] No DTC codes found for diagnosis ${diagnosisId}, skipping learning`);
      return { error: "No DTC codes found on the original diagnosis" };
    }

    // Create a knowledge entry for each DTC code in the diagnosis
    const insertedEntries = [];

    for (const dtcCode of dtcCodes) {
      const caseData = {
        dtc_code: dtcCode,
        dtc_description: null,
        vehicle_make: diagLog.vehicle_make || null,
        vehicle_model: diagLog.vehicle_model || null,
        year_range_start: diagLog.vehicle_year || null,
        year_range_end: diagLog.vehicle_year || null,
        engine_type: diagLog.engine || null,
        cause: actualCause,
        cause_category: null,
        confidence_base: 0.6,
        success_rate: 1.0,
        parts_needed: null,
        labor_category: null,
        labor_hours_estimate: null,
        diagnostic_steps: null,
        common_misdiagnosis: null,
        source: "outcome_learning",
      };

      const entry = await insertCase(caseData);
      insertedEntries.push(entry);

      console.log(
        `[ai-diagnostics] Learned from outcome: ${dtcCode} on ${diagLog.vehicle_year} ${diagLog.vehicle_make} ${diagLog.vehicle_model} -> "${actualCause}"`
      );
    }

    // Return single entry if one DTC, array if multiple
    if (insertedEntries.length === 1) {
      return insertedEntries[0];
    }
    return insertedEntries;
  } catch (err) {
    console.error(`[ai-diagnostics] learnFromOutcome error: ${err.message}`);
    return { error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  recordOutcome,
  getAccuracyStats,
  learnFromOutcome,
};
