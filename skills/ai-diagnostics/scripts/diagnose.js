/**
 * Diagnose — Main Diagnostic Engine for AI Diagnostics Skill
 *
 * Orchestrates the full diagnostic pipeline:
 *   1. Build query text from DTC codes + symptoms + vehicle info
 *   2. Generate embedding via OpenAI
 *   3. Vector search for similar past cases (RAG)
 *   3.5. Check for repair plan in knowledge base
 *   4. TSB/Recall lookup via NHTSA
 *   5. Conditional Claude synthesis (skip if KB match >= 0.70 with repair plan)
 *   6. Confidence scoring adjustment
 *   6.5. Labor cache lookup + ARI live fallback (overrides labor hours if found)
 *   7. Build repair plan (from KB or from Claude output)
 *   8. Log result to Supabase
 *   9. Return structured diagnosis with repair_plan
 *
 * Main export: diagnose({ vin, year, make, model, engine, dtcCodes, symptoms, mileage })
 */

const { generateEmbedding, searchSimilarCases, getSupabase } = require("./embeddings");
const { lookupTSBs } = require("./tsb-lookup");

// ARI labor lookup — optional, only used when ARI_URL is set
let lookupLaborTimeLive = null;
if (process.env.ARI_URL) {
  try {
    lookupLaborTimeLive = require("../../ari-labor/scripts/lookup").lookupLaborTime;
  } catch {
    // ari-labor skill not installed — skip silently
  }
}

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const CLAUDE_MODEL = "claude-sonnet-4-5-20250929";
const MAX_TOKENS = 4096;

const SYSTEM_PROMPT = `You are an expert automotive diagnostic AI. Given a vehicle, DTC code(s), symptoms, similar past cases from our database, and any relevant TSBs/recalls, provide a structured diagnosis.

Rules:
1. Rank causes by probability. Never exceed 95% confidence.
2. Confidence scores must sum to ~100% across all causes.
3. If RAG cases strongly agree, weight them heavily.
4. If a TSB exists for this exact vehicle+DTC, mention it prominently.
5. Always suggest diagnostic verification steps before committing to a repair.
6. Flag common misdiagnoses.
7. Be conservative — recommend diagnosis verification for anything below 80%.

Respond ONLY with valid JSON matching this schema:
{
  "diagnoses": [
    {
      "cause": "string",
      "confidence": 0.0-0.95,
      "reasoning": "string",
      "parts_needed": ["string"],
      "labor_category": "basic|intermediate|advanced",
      "labor_hours": number,
      "common_misdiagnosis": "string or null"
    }
  ],
  "diagnostic_steps": ["string"],
  "summary": "string"
}`;

/**
 * Build query text from diagnostic input for embedding generation
 * @param {object} input - Diagnostic input
 * @returns {string} Combined text for embedding
 */
function buildQueryText({ dtcCodes, symptoms, year, make, model, engine }) {
  const parts = [];

  if (dtcCodes && dtcCodes.length > 0) {
    parts.push(`DTC: ${dtcCodes.join(", ")}`);
  }
  if (symptoms) {
    parts.push(`Symptoms: ${symptoms}`);
  }
  if (make) parts.push(make);
  if (model) parts.push(model);
  if (year) parts.push(String(year));
  if (engine) parts.push(engine);

  return parts.join(" ");
}

/**
 * Format RAG results into readable text for the Claude prompt
 * @param {object[]} cases - Similar cases from vector search
 * @returns {string} Formatted text block
 */
function formatRAGResults(cases) {
  if (!cases || cases.length === 0) {
    return "No similar past cases found in the database.";
  }

  return cases
    .map((c, i) => {
      const similarity = (c.similarity * 100).toFixed(1);
      const vehicle =
        [c.vehicle_make, c.vehicle_model].filter(Boolean).join(" ") || "Any vehicle";
      const yearRange =
        c.year_range_start && c.year_range_end
          ? ` (${c.year_range_start}-${c.year_range_end})`
          : "";

      const lines = [
        `Case ${i + 1} [${similarity}% similarity]:`,
        `  DTC: ${c.dtc_code}${c.dtc_description ? ` — ${c.dtc_description}` : ""}`,
        `  Vehicle: ${vehicle}${yearRange}`,
        `  Cause: ${c.cause}`,
      ];

      if (c.cause_category) lines.push(`  Category: ${c.cause_category}`);
      if (c.confidence_base != null) lines.push(`  Base Confidence: ${(c.confidence_base * 100).toFixed(0)}%`);
      if (c.success_rate != null) lines.push(`  Historical Success Rate: ${(c.success_rate * 100).toFixed(0)}%`);
      if (c.parts_needed) {
        const parts = Array.isArray(c.parts_needed) ? c.parts_needed : [];
        if (parts.length > 0) lines.push(`  Parts: ${parts.join(", ")}`);
      }
      if (c.labor_category) lines.push(`  Labor: ${c.labor_category} (~${c.labor_hours_estimate || "?"}h)`);
      if (c.common_misdiagnosis) lines.push(`  Common Misdiagnosis: ${c.common_misdiagnosis}`);
      if (c.diagnostic_steps && c.diagnostic_steps.length > 0) {
        lines.push(`  Diagnostic Steps: ${c.diagnostic_steps.join("; ")}`);
      }

      return lines.join("\n");
    })
    .join("\n\n");
}

/**
 * Format TSB/recall results into readable text for the Claude prompt
 * @param {object} tsbResult - Result from lookupTSBs()
 * @returns {string} Formatted text block
 */
function formatTSBResults(tsbResult) {
  const sections = [];

  const recalls = tsbResult.recalls || [];
  if (recalls.length > 0) {
    const recallText = recalls
      .slice(0, 10) // cap at 10 to keep prompt manageable
      .map((r, i) => {
        const lines = [`Recall ${i + 1}:`];
        if (r.NHTSACampaignNumber) lines.push(`  Campaign: ${r.NHTSACampaignNumber}`);
        if (r.Component) lines.push(`  Component: ${r.Component}`);
        if (r.Summary) lines.push(`  Summary: ${r.Summary}`);
        if (r.Consequence) lines.push(`  Consequence: ${r.Consequence}`);
        if (r.Remedy) lines.push(`  Remedy: ${r.Remedy}`);
        return lines.join("\n");
      })
      .join("\n\n");
    sections.push(`RECALLS (${recalls.length} found):\n${recallText}`);
  } else {
    sections.push("RECALLS: None found.");
  }

  const complaints = tsbResult.complaints || [];
  if (complaints.length > 0) {
    const complaintText = complaints
      .slice(0, 10)
      .map((c, i) => {
        const lines = [`Complaint ${i + 1}:`];
        if (c.components) lines.push(`  Component: ${c.components}`);
        if (c.summary) lines.push(`  Summary: ${c.summary}`);
        if (c.odiNumber) lines.push(`  ODI#: ${c.odiNumber}`);
        return lines.join("\n");
      })
      .join("\n\n");
    sections.push(`COMPLAINTS (${complaints.length} found):\n${complaintText}`);
  } else {
    sections.push("COMPLAINTS: None found.");
  }

  return sections.join("\n\n");
}

/**
 * Fetch the repair_plan column from diagnostic_knowledge for a specific case ID
 * @param {string} caseId - The ID of the knowledge base record
 * @returns {object|null} The repair_plan object, or null if not found
 */
async function fetchRepairPlanFromKB(caseId) {
  try {
    const db = getSupabase();
    const { data, error } = await db
      .from("diagnostic_knowledge")
      .select("repair_plan")
      .eq("id", caseId)
      .maybeSingle();

    if (error) {
      console.error(`[ai-diagnostics] Failed to fetch repair_plan for case ${caseId}: ${error.message}`);
      return null;
    }

    if (data && data.repair_plan) {
      console.log(`[ai-diagnostics] Found repair_plan in KB for case ${caseId}`);
      return data.repair_plan;
    }

    return null;
  } catch (err) {
    console.error(`[ai-diagnostics] Error fetching repair_plan (non-fatal): ${err.message}`);
    return null;
  }
}

/**
 * Look up cached labor time data for a specific vehicle + procedure
 * @param {string} make - Vehicle make
 * @param {string} model - Vehicle model
 * @param {number|string} year - Vehicle year
 * @param {string} procedureName - Repair procedure name (partial match)
 * @returns {object|null} Labor data { labor_hours, labor_source, notes } or null
 */
async function lookupLaborCache(make, model, year, procedureName) {
  try {
    const db = getSupabase();
    const { data, error } = await db
      .from("labor_cache")
      .select("labor_hours, labor_source, notes")
      .eq("vehicle_make", (make || "").toUpperCase())
      .eq("vehicle_model", (model || "").toUpperCase())
      .eq("vehicle_year", parseInt(year, 10))
      .ilike("procedure_name", `%${procedureName.replace(/%/g, "\\%").replace(/_/g, "\\_")}%`)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    if (error) {
      console.error(`[ai-diagnostics] Labor cache lookup failed: ${error.message}`);
      return null;
    }

    if (data) {
      console.log(`[ai-diagnostics] Labor cache hit: ${data.labor_hours}h (source: ${data.labor_source})`);
      return data;
    }

    return null;
  } catch (err) {
    console.error(`[ai-diagnostics] Labor cache error (non-fatal): ${err.message}`);
    return null;
  }
}

/**
 * Build diagnoses array directly from KB RAG cases (no Claude needed)
 * @param {object[]} ragCases - Top RAG cases (already filtered for quality)
 * @returns {object[]} Diagnoses in the standard format
 */
function buildDiagnosesFromKB(ragCases) {
  return ragCases.map((c) => ({
    cause: c.cause,
    confidence: c.confidence_base || 0.5,
    reasoning: `Based on ${(c.similarity * 100).toFixed(0)}% match in knowledge base`,
    parts_needed: c.parts_needed || [],
    labor_category: c.labor_category || "intermediate",
    labor_hours: c.labor_hours_estimate || 1.0,
    common_misdiagnosis: c.common_misdiagnosis || null,
  }));
}

/**
 * Build a repair plan object from Claude-generated diagnosis output
 * @param {object} claudeResult - Parsed Claude response
 * @returns {object} Repair plan structure
 */
function buildRepairPlanFromClaude(claudeResult) {
  const diagnoses = claudeResult.diagnoses || [];
  const topDiag = diagnoses[0] || {};

  // Merge parts from all high-confidence diagnoses (>= 0.30) to build a complete plan
  const allParts = [];
  const seenParts = new Set();
  for (const diag of diagnoses) {
    if ((diag.confidence || 0) < 0.30) continue;
    for (const p of diag.parts_needed || []) {
      const key = p.toLowerCase();
      if (!seenParts.has(key)) {
        seenParts.add(key);
        allParts.push({
          name: p,
          position: null,
          qty: 1,
          type: "any",
          oem_preferred: false,
          conditional: diag !== topDiag, // non-primary cause parts are conditional
          condition: diag !== topDiag ? `If ${diag.cause} is confirmed` : null,
          search_terms: [p],
        });
      }
    }
  }

  return {
    parts: allParts,
    labor: {
      hours: topDiag.labor_hours || 1.0,
      source: "claude",
      category: topDiag.labor_category || "intermediate",
      requires_lift: false,
      special_notes: null,
    },
    tools: [],
    torque_specs: {},
    verification: {
      before_repair: (claudeResult.diagnostic_steps && claudeResult.diagnostic_steps[0]) || null,
      after_repair: "Clear codes and verify repair",
    },
    diagrams_needed: [],
  };
}

/**
 * Build the user prompt for Claude
 * @param {object} input - Diagnostic input
 * @param {object[]} ragCases - Similar cases from vector search
 * @param {object} tsbResult - TSB/recall lookup result
 * @param {object} [kbRepairPlan] - Optional repair plan from KB to include as context
 * @returns {string} Fully formed user prompt
 */
function buildUserPrompt(input, ragCases, tsbResult, kbRepairPlan) {
  const lines = [
    `Vehicle: ${input.year} ${input.make} ${input.model}`,
    `Engine: ${input.engine || "Unknown"}`,
    `Mileage: ${input.mileage || "Unknown"}`,
    `VIN: ${input.vin || "Not provided"}`,
    "",
    `DTC Code(s): ${input.dtcCodes ? input.dtcCodes.join(", ") : "None provided"}`,
    `Symptoms: ${input.symptoms || "None described"}`,
    "",
    "=== SIMILAR PAST CASES (from our database) ===",
    formatRAGResults(ragCases),
    "",
    "=== TSBs & RECALLS ===",
    formatTSBResults(tsbResult),
    "",
  ];

  // If a repair plan from KB is provided as context, include it for Claude to adjust
  if (kbRepairPlan) {
    lines.push(
      "=== EXISTING REPAIR PLAN (from knowledge base — use as starting point, adjust as needed) ===",
      JSON.stringify(kbRepairPlan, null, 2),
      ""
    );
  }

  lines.push("Provide your diagnosis as JSON.");

  return lines.join("\n");
}

/**
 * Call Anthropic Claude API for diagnostic synthesis
 * @param {string} userPrompt - Formatted user prompt
 * @returns {object} Parsed JSON response from Claude
 */
async function callClaude(userPrompt) {
  if (!ANTHROPIC_API_KEY) {
    throw new Error("Missing ANTHROPIC_API_KEY in environment");
  }

  const fetch = (await import("node-fetch")).default;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: userPrompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Anthropic API error: ${response.status} — ${errText}`);
  }

  const data = await response.json();

  // Extract text from the response content blocks
  const textBlock = data.content.find((block) => block.type === "text");
  if (!textBlock) {
    throw new Error("No text content in Anthropic API response");
  }

  // Parse JSON from Claude's response — handle possible markdown code fences
  let jsonText = textBlock.text.trim();
  if (jsonText.startsWith("```")) {
    // Strip markdown code fences
    jsonText = jsonText.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    console.error(`[ai-diagnostics] Failed to parse Claude response as JSON: ${err.message}`);
    console.error(`[ai-diagnostics] Raw response: ${jsonText.slice(0, 500)}`);
    throw new Error(`Claude returned invalid JSON: ${err.message}`);
  }

  return parsed;
}

/**
 * Calculate vehicle specificity bonus based on RAG case matches
 * @param {object[]} ragCases - RAG results
 * @param {string} make - Target vehicle make
 * @param {string} model - Target vehicle model
 * @returns {number} Bonus: 0.10 for exact make+model, 0.05 for make only, 0 otherwise
 */
function vehicleSpecificityBonus(ragCases, make, model) {
  if (!ragCases || ragCases.length === 0) return 0;

  const normMake = (make || "").toUpperCase();
  const normModel = (model || "").toUpperCase();

  // Check if any top cases match exact make + model
  const exactMatch = ragCases.some(
    (c) =>
      (c.vehicle_make || "").toUpperCase() === normMake &&
      (c.vehicle_model || "").toUpperCase() === normModel
  );
  if (exactMatch) return 0.10;

  // Check if any top cases match make only
  const makeMatch = ragCases.some(
    (c) => (c.vehicle_make || "").toUpperCase() === normMake
  );
  if (makeMatch) return 0.05;

  return 0;
}

/**
 * Calculate mileage factor based on typical failure ranges
 * Higher confidence when mileage falls in common failure windows.
 * @param {number|null} mileage - Vehicle mileage
 * @returns {number} Factor between 0.0 and 1.0
 */
function mileageFactor(mileage) {
  if (!mileage || mileage <= 0) return 0.5; // neutral when unknown

  // Common failure mileage windows (these represent typical wear patterns)
  // Higher factor when mileage is in a common failure range
  if (mileage >= 60000 && mileage <= 120000) return 0.9;  // most common failure window
  if (mileage >= 30000 && mileage < 60000) return 0.7;    // moderate wear
  if (mileage >= 120000 && mileage <= 200000) return 0.8;  // high-mileage failures
  if (mileage > 200000) return 0.6;                        // extreme mileage, less predictable
  if (mileage < 30000) return 0.4;                          // low mileage, failures less common

  return 0.5;
}

/**
 * Apply confidence scoring algorithm to Claude's diagnoses
 *
 * Final confidence = (rag_similarity * 0.30) + (base_confidence * 0.25) + (success_rate * 0.25)
 *                  + (vehicle_specificity_bonus * 0.10) + (mileage_factor * 0.10)
 *
 * @param {object[]} diagnoses - Diagnoses from Claude
 * @param {object[]} ragCases - RAG search results
 * @param {string} make - Vehicle make
 * @param {string} model - Vehicle model
 * @param {number|null} mileage - Vehicle mileage
 * @returns {object[]} Diagnoses with adjusted confidence scores
 */
function applyConfidenceScoring(diagnoses, ragCases, make, model, mileage) {
  const vBonus = vehicleSpecificityBonus(ragCases, make, model);
  const mFactor = mileageFactor(mileage);

  // Compute average RAG similarity across top cases
  const avgSimilarity =
    ragCases && ragCases.length > 0
      ? ragCases.reduce((sum, c) => sum + (c.similarity || 0), 0) / ragCases.length
      : 0.5; // neutral if no RAG results

  return diagnoses.map((diag) => {
    // Find the best-matching RAG case for this specific diagnosis
    const matchingCase = ragCases.find(
      (c) =>
        c.cause &&
        diag.cause &&
        c.cause.toLowerCase().includes(diag.cause.toLowerCase().split(" ")[0])
    );

    const ragSimilarity = matchingCase ? matchingCase.similarity : avgSimilarity;
    const baseConfidence = diag.confidence || 0.5;
    const successRate = matchingCase ? (matchingCase.success_rate || 0.5) : 0.5;

    const finalConfidence =
      ragSimilarity * 0.30 +
      baseConfidence * 0.25 +
      successRate * 0.25 +
      vBonus * 0.10 +
      mFactor * 0.10;

    // Cap at 0.95, floor at 0.05
    const capped = Math.min(0.95, Math.max(0.05, finalConfidence));

    return {
      ...diag,
      confidence: parseFloat(capped.toFixed(4)),
    };
  });
}

/**
 * Log the diagnosis result to the diagnosis_log table in Supabase
 * @param {object} input - Original diagnostic input
 * @param {object} result - Final diagnosis result
 * @param {number} processingTimeMs - Total processing time
 * @param {number} ragCasesUsed - Number of RAG cases used
 */
async function logDiagnosis(input, result, processingTimeMs, ragCasesUsed) {
  try {
    const db = getSupabase();

    const topDiagnosis = result.diagnoses && result.diagnoses.length > 0
      ? result.diagnoses[0]
      : null;

    const row = {
      vin: input.vin || null,
      vehicle_year: input.year ? parseInt(input.year, 10) : null,
      vehicle_make: input.make || null,
      vehicle_model: input.model || null,
      engine: input.engine || null,
      mileage: input.mileage ? parseInt(input.mileage, 10) : null,
      dtc_codes: input.dtcCodes || null,
      symptoms: input.symptoms || null,
      top_prediction: topDiagnosis ? topDiagnosis.cause : null,
      top_confidence: topDiagnosis ? topDiagnosis.confidence : null,
      all_predictions: result.diagnoses || null,
      tsbs_found: result.tsbs || null,
      recalls_found: result.recalls || null,
      rag_cases_used: ragCasesUsed,
      diagnostic_path: result.diagnostic_path || null,
      processing_time_ms: processingTimeMs,
    };

    const { error } = await db.from("diagnosis_log").insert(row);

    if (error) {
      console.error(`[ai-diagnostics] Failed to log diagnosis: ${error.message}`);
    } else {
      console.log(`[ai-diagnostics] Diagnosis logged successfully`);
    }
  } catch (err) {
    // Logging failure is non-fatal — the diagnosis was still produced
    console.error(`[ai-diagnostics] Diagnosis logging error (non-fatal): ${err.message}`);
  }
}

/**
 * Main diagnostic engine
 *
 * Orchestrates: embed query -> vector search -> TSB lookup -> Claude synthesis -> log result
 *
 * @param {object} input
 * @param {string} [input.vin] - Vehicle Identification Number
 * @param {number|string} input.year - Vehicle year
 * @param {string} input.make - Vehicle make
 * @param {string} input.model - Vehicle model
 * @param {string} [input.engine] - Engine type/size
 * @param {string[]} [input.dtcCodes] - Array of DTC codes (e.g. ["P0300", "P0171"])
 * @param {string} [input.symptoms] - Free-text symptom description
 * @param {number} [input.mileage] - Vehicle mileage
 * @returns {object} Structured diagnosis result
 */
async function diagnose(input) {
  const startTime = Date.now();

  const { vin, year, make, model, engine, dtcCodes, symptoms, mileage } = input;

  // Validate minimum required input
  if (!make || !model || !year) {
    return { error: "Vehicle make, model, and year are required" };
  }
  if ((!dtcCodes || dtcCodes.length === 0) && !symptoms) {
    return { error: "At least one DTC code or symptom description is required" };
  }

  console.log(`[ai-diagnostics] Starting diagnosis for ${year} ${make} ${model}`);
  if (dtcCodes && dtcCodes.length > 0) {
    console.log(`[ai-diagnostics] DTC codes: ${dtcCodes.join(", ")}`);
  }

  // ----------------------------------------------------------------
  // Step 1: Build query text for embedding
  // ----------------------------------------------------------------
  const queryText = buildQueryText(input);
  console.log(`[ai-diagnostics] Query text: "${queryText}"`);

  // ----------------------------------------------------------------
  // Step 2: Generate embedding
  // ----------------------------------------------------------------
  let embedding = null;
  try {
    embedding = await generateEmbedding(queryText);
    console.log(`[ai-diagnostics] Embedding generated (${embedding.length} dimensions)`);
  } catch (err) {
    console.error(`[ai-diagnostics] Embedding generation failed: ${err.message}`);
    console.log(`[ai-diagnostics] Continuing without embeddings — will use claude_only path`);
  }

  // ----------------------------------------------------------------
  // Step 3: Vector search + TSB lookup (in parallel)
  // ----------------------------------------------------------------
  let ragCases = [];
  let tsbResult = { recalls: [], complaints: [] };

  try {
    // Build filters for vector search
    const filters = {};
    if (dtcCodes && dtcCodes.length > 0) filters.dtc = dtcCodes[0]; // primary DTC
    if (make) filters.make = make;
    if (model) filters.model = model;
    if (year) filters.year = parseInt(year, 10);

    const searchPromises = [lookupTSBs(make, model, year)];
    if (embedding) {
      searchPromises.unshift(searchSimilarCases(embedding, filters, 10, 0.5));
    }

    const results = await Promise.allSettled(searchPromises);

    // If we had embedding, first result is RAG, second is TSB
    // If no embedding, only result is TSB
    const ragResult = embedding ? results[0] : null;
    const tsbFetchResult = embedding ? results[1] : results[0];

    if (ragResult) {
      if (ragResult.status === "fulfilled") {
        ragCases = ragResult.value || [];
        console.log(`[ai-diagnostics] RAG search: ${ragCases.length} similar cases found`);
      } else {
        console.error(`[ai-diagnostics] RAG search failed: ${ragResult.reason.message}`);
      }
    } else {
      console.log(`[ai-diagnostics] Skipping RAG search — no embedding available`);
    }

    if (tsbFetchResult.status === "fulfilled") {
      tsbResult = tsbFetchResult.value;
      if (tsbResult.error) {
        console.error(`[ai-diagnostics] TSB lookup returned error: ${tsbResult.error}`);
      } else {
        const recallCount = (tsbResult.recalls || []).length;
        const complaintCount = (tsbResult.complaints || []).length;
        console.log(
          `[ai-diagnostics] TSB lookup: ${recallCount} recalls, ${complaintCount} complaints${tsbResult.cached ? " (cached)" : ""}`
        );
      }
    } else {
      console.error(`[ai-diagnostics] TSB lookup failed: ${tsbFetchResult.reason.message}`);
    }
  } catch (err) {
    console.error(`[ai-diagnostics] Search phase error: ${err.message}`);
    // Continue with empty results — Claude can still reason from DTCs + symptoms
  }

  // ----------------------------------------------------------------
  // Step 3.1: DTC-based direct lookup (fallback when no embedding)
  // ----------------------------------------------------------------
  if (ragCases.length === 0 && dtcCodes && dtcCodes.length > 0) {
    console.log(`[ai-diagnostics] No RAG results — trying DTC-based direct lookup...`);
    try {
      const supabase = getSupabase();
      let query = supabase
        .from("diagnostic_knowledge")
        .select("id, dtc_code, cause, cause_category, confidence_base, success_rate, parts_needed, labor_category, labor_hours_estimate, diagnostic_steps, common_misdiagnosis, vehicle_make, vehicle_model, source, repair_plan")
        .in("dtc_code", dtcCodes)
        .order("confidence_base", { ascending: false })
        .limit(15);

      // Prefer vehicle-specific matches
      if (make) query = query.or(`vehicle_make.eq.${make},vehicle_make.is.null`);

      const { data, error } = await query;
      if (!error && data && data.length > 0) {
        // Convert to ragCase-like format for downstream compatibility
        ragCases = data.map((row) => ({
          id: row.id,
          dtc_code: row.dtc_code,
          cause: row.cause,
          cause_category: row.cause_category,
          confidence_base: row.confidence_base,
          success_rate: row.success_rate,
          parts_needed: row.parts_needed,
          labor_category: row.labor_category,
          labor_hours_estimate: row.labor_hours_estimate,
          diagnostic_steps: row.diagnostic_steps,
          common_misdiagnosis: row.common_misdiagnosis,
          vehicle_make: row.vehicle_make,
          vehicle_model: row.vehicle_model,
          source: row.source,
          repair_plan: row.repair_plan,
          similarity: row.confidence_base || 0.5, // use confidence_base as proxy
        }));
        // Boost vehicle-specific matches
        ragCases.forEach((c) => {
          if (c.vehicle_make === make && c.vehicle_model === model) {
            c.similarity = Math.min(0.95, (c.similarity || 0.5) + 0.15);
          }
        });
        ragCases.sort((a, b) => b.similarity - a.similarity);
        console.log(`[ai-diagnostics] DTC direct lookup: ${ragCases.length} matches found`);
      }
    } catch (err) {
      console.error(`[ai-diagnostics] DTC direct lookup failed (non-fatal): ${err.message}`);
    }
  }

  // ----------------------------------------------------------------
  // Step 3.5: Check for repair plan in knowledge base
  // ----------------------------------------------------------------
  let kbRepairPlan = null;
  let topRagSimilarity = 0;

  if (ragCases.length > 0) {
    topRagSimilarity = ragCases[0].similarity || 0;

    // Fetch repair_plan at 0.50 threshold (lower than kb_direct's 0.70)
    // because kb_with_claude path needs the plan even at moderate similarity
    if (topRagSimilarity >= 0.50 && ragCases[0].id) {
      kbRepairPlan = await fetchRepairPlanFromKB(ragCases[0].id);
    }
  }

  // ----------------------------------------------------------------
  // Step 4: Conditional Claude synthesis
  // Paths: kb_direct, kb_with_claude, claude_only
  // ----------------------------------------------------------------
  let claudeResult = null;
  let adjustedDiagnoses = [];
  let repairPlan = null;
  let diagnosticPath = "claude_only";
  let diagnosticSteps = [];

  if (kbRepairPlan && topRagSimilarity >= 0.70) {
    // ----- PATH: kb_direct -----
    // High-confidence KB match with repair plan — skip Claude entirely
    diagnosticPath = "kb_direct";
    console.log(`[ai-diagnostics] Path: kb_direct (similarity: ${(topRagSimilarity * 100).toFixed(1)}%, repair_plan found)`);

    // Build diagnoses from KB data
    const topCases = ragCases.filter((c) => c.similarity >= 0.50).slice(0, 5);
    adjustedDiagnoses = buildDiagnosesFromKB(topCases);

    // Apply confidence scoring to KB-derived diagnoses
    adjustedDiagnoses = applyConfidenceScoring(
      adjustedDiagnoses,
      ragCases,
      make,
      model,
      mileage
    );

    // Use the KB repair plan directly
    repairPlan = kbRepairPlan;

    // Extract diagnostic steps from top RAG case if available
    if (ragCases[0].diagnostic_steps && ragCases[0].diagnostic_steps.length > 0) {
      diagnosticSteps = ragCases[0].diagnostic_steps;
    }

  } else if (kbRepairPlan && topRagSimilarity < 0.70) {
    // ----- PATH: kb_with_claude -----
    // KB repair plan exists but confidence is lower — let Claude adjust
    diagnosticPath = "kb_with_claude";
    console.log(`[ai-diagnostics] Path: kb_with_claude (similarity: ${(topRagSimilarity * 100).toFixed(1)}%, passing repair_plan as context)`);

    try {
      const userPrompt = buildUserPrompt(input, ragCases, tsbResult, kbRepairPlan);
      console.log(`[ai-diagnostics] Calling Claude for synthesis (with KB repair plan context)...`);
      claudeResult = await callClaude(userPrompt);
      console.log(
        `[ai-diagnostics] Claude returned ${(claudeResult.diagnoses || []).length} diagnoses`
      );

      adjustedDiagnoses = claudeResult.diagnoses || [];
      adjustedDiagnoses = applyConfidenceScoring(
        adjustedDiagnoses,
        ragCases,
        make,
        model,
        mileage
      );

      // Start with KB repair plan, then merge Claude's adjustments
      // Claude may identify additional parts or adjust labor based on symptoms
      const claudePlan = buildRepairPlanFromClaude(claudeResult);
      repairPlan = { ...kbRepairPlan };

      // Merge any additional parts Claude identified that aren't in the KB plan
      if (claudePlan.parts.length > 0 && repairPlan.parts) {
        const kbPartNames = new Set(repairPlan.parts.map((p) => (p.name || "").toLowerCase()));
        for (const cp of claudePlan.parts) {
          if (!kbPartNames.has((cp.name || "").toLowerCase())) {
            repairPlan.parts.push({ ...cp, conditional: true, condition: "Identified by AI analysis" });
          }
        }
      }

      // If Claude suggests different labor hours, take the higher (more conservative) estimate
      if (claudePlan.labor && repairPlan.labor) {
        if (claudePlan.labor.hours > repairPlan.labor.hours) {
          repairPlan.labor.hours = claudePlan.labor.hours;
          repairPlan.labor.special_notes = repairPlan.labor.special_notes
            ? `${repairPlan.labor.special_notes}. AI adjusted labor up from KB estimate.`
            : "AI adjusted labor up from KB estimate.";
        }
      }

      diagnosticSteps = claudeResult.diagnostic_steps || [];
    } catch (err) {
      console.error(`[ai-diagnostics] Claude synthesis failed: ${err.message}`);
      return { error: `Claude synthesis failed: ${err.message}` };
    }

  } else {
    // ----- PATH: claude_only -----
    // No KB repair plan — full Claude synthesis (original behavior)
    diagnosticPath = "claude_only";
    console.log(`[ai-diagnostics] Path: claude_only (no KB repair plan available)`);

    try {
      const userPrompt = buildUserPrompt(input, ragCases, tsbResult);
      console.log(`[ai-diagnostics] Calling Claude for synthesis...`);
      claudeResult = await callClaude(userPrompt);
      console.log(
        `[ai-diagnostics] Claude returned ${(claudeResult.diagnoses || []).length} diagnoses`
      );

      adjustedDiagnoses = claudeResult.diagnoses || [];
      adjustedDiagnoses = applyConfidenceScoring(
        adjustedDiagnoses,
        ragCases,
        make,
        model,
        mileage
      );

      // Build repair plan from Claude output
      repairPlan = buildRepairPlanFromClaude(claudeResult);
      diagnosticSteps = claudeResult.diagnostic_steps || [];
    } catch (err) {
      console.error(`[ai-diagnostics] Claude synthesis failed: ${err.message}`);
      return { error: `Claude synthesis failed: ${err.message}` };
    }
  }

  // Sort by confidence descending
  adjustedDiagnoses.sort((a, b) => b.confidence - a.confidence);

  // ----------------------------------------------------------------
  // Step 5: Labor cache lookup (overrides labor hours in repair plan)
  // ----------------------------------------------------------------
  if (repairPlan && adjustedDiagnoses.length > 0) {
    // Use the top diagnosis cause as the procedure name for labor lookup
    const procedureName = adjustedDiagnoses[0].cause || "";
    if (procedureName) {
      let laborData = await lookupLaborCache(make, model, year, procedureName);

      // If cache miss and ARI is available, try live ARI lookup
      if (!laborData && lookupLaborTimeLive) {
        console.log(`[ai-diagnostics] Labor cache miss — trying live ARI lookup...`);
        try {
          const ariResult = await lookupLaborTimeLive({
            year, make, model, procedure: procedureName,
          });
          if (ariResult && !ariResult.error) {
            laborData = {
              labor_hours: ariResult.labor_hours,
              labor_source: ariResult.source || "ari",
              notes: ariResult.notes,
            };
            console.log(`[ai-diagnostics] ARI live lookup: ${ariResult.labor_hours}h`);
          } else if (ariResult?.error) {
            console.log(`[ai-diagnostics] ARI lookup failed (non-fatal): ${ariResult.error}`);
          }
        } catch (ariErr) {
          console.error(`[ai-diagnostics] ARI lookup error (non-fatal): ${ariErr.message}`);
        }
      }

      if (laborData) {
        console.log(`[ai-diagnostics] Overriding labor hours: ${laborData.labor_hours}h (source: ${laborData.labor_source})`);

        // Override labor in repair plan
        if (repairPlan.labor) {
          repairPlan.labor.hours = laborData.labor_hours;
          repairPlan.labor.source = laborData.labor_source || "labor_cache";
          if (laborData.notes) {
            repairPlan.labor.special_notes = laborData.notes;
          }
        }

        // Also update labor_hours in the top diagnosis for consistency
        adjustedDiagnoses[0].labor_hours = laborData.labor_hours;
      }
    }
  }

  // ----------------------------------------------------------------
  // Step 6: Build final result
  // ----------------------------------------------------------------
  const processingTimeMs = Date.now() - startTime;
  const topConfidence =
    adjustedDiagnoses.length > 0 ? adjustedDiagnoses[0].confidence : 0;

  const result = {
    diagnoses: adjustedDiagnoses,
    repair_plan: repairPlan,
    tsbs: tsbResult.complaints || [],
    recalls: tsbResult.recalls || [],
    diagnostic_steps: diagnosticSteps,
    diagnostic_path: diagnosticPath,
    low_confidence_warning: topConfidence < 0.70,
    processing_time_ms: processingTimeMs,
  };

  console.log(
    `[ai-diagnostics] Diagnosis complete in ${processingTimeMs}ms — path: ${diagnosticPath}, top confidence: ${(topConfidence * 100).toFixed(1)}%${result.low_confidence_warning ? " (LOW)" : ""}`
  );

  // ----------------------------------------------------------------
  // Step 7: Log to database (non-blocking, non-fatal)
  // ----------------------------------------------------------------
  await logDiagnosis(input, result, processingTimeMs, ragCases.length);

  return result;
}

module.exports = {
  diagnose,
  // Exported for testing / composition
  buildQueryText,
  formatRAGResults,
  formatTSBResults,
  buildUserPrompt,
  applyConfidenceScoring,
  vehicleSpecificityBonus,
  mileageFactor,
  // New helpers for repair plan support
  fetchRepairPlanFromKB,
  lookupLaborCache,
  buildDiagnosesFromKB,
  buildRepairPlanFromClaude,
};
