/**
 * Embeddings — Vector Operations for AI Diagnostics
 *
 * Handles OpenAI embedding generation and Supabase pgvector
 * similarity search for the diagnostic knowledge base.
 *
 * Uses: OpenAI text-embedding-3-small (1536 dimensions)
 * Storage: Supabase pgvector via match_diagnostic_cases RPC
 */

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const EMBEDDING_MODEL = "text-embedding-3-small";

let supabase = null;

/**
 * Get or create a Supabase client (singleton)
 */
function getSupabase() {
  if (!supabase) {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      throw new Error("Missing SUPABASE_URL or SUPABASE_ANON_KEY in environment");
    }
    supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return supabase;
}

/**
 * Generate an embedding vector from text using OpenAI
 * @param {string} text - The text to embed
 * @returns {number[]} 1536-dimension embedding vector
 */
async function generateEmbedding(text) {
  if (!OPENAI_API_KEY) {
    throw new Error("Missing OPENAI_API_KEY in environment");
  }

  const fetch = (await import("node-fetch")).default;

  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: text,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI embeddings API error: ${response.status} — ${errText}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
}

/**
 * Build a searchable text string from diagnostic case data
 * @param {object} caseData - Diagnostic case fields
 * @returns {string} Concatenated text for embedding
 */
function buildEmbeddingText(caseData) {
  const parts = [
    caseData.dtc_code,
    caseData.dtc_description,
    caseData.vehicle_make,
    caseData.vehicle_model,
    caseData.year_range_start && caseData.year_range_end
      ? `${caseData.year_range_start}-${caseData.year_range_end}`
      : null,
    caseData.engine_type,
    caseData.cause,
    caseData.cause_category,
    caseData.common_misdiagnosis,
  ].filter(Boolean);

  return parts.join(" ");
}

/**
 * Search for similar diagnostic cases using pgvector
 * @param {number[]} embedding - Query embedding vector
 * @param {object} [filters] - Optional filters
 * @param {string} [filters.dtc] - Filter by DTC code
 * @param {string} [filters.make] - Filter by vehicle make
 * @param {string} [filters.model] - Filter by vehicle model
 * @param {number} [filters.year] - Filter by vehicle year
 * @param {number} [limit=10] - Max results to return
 * @param {number} [threshold=0.5] - Minimum similarity threshold
 * @returns {object[]} Matching cases ranked by similarity
 */
async function searchSimilarCases(embedding, filters = {}, limit = 10, threshold = 0.5) {
  const db = getSupabase();

  const { data, error } = await db.rpc("match_diagnostic_cases", {
    query_embedding: embedding,
    match_threshold: threshold,
    match_count: limit,
    filter_dtc: filters.dtc || null,
    filter_make: filters.make || null,
    filter_model: filters.model || null,
    filter_year: filters.year || null,
  });

  if (error) {
    console.error(`[ai-diagnostics] Vector search failed: ${error.message}`);
    throw new Error(`Supabase vector search failed: ${error.message}`);
  }

  console.log(`[ai-diagnostics] Vector search returned ${data.length} cases (threshold: ${threshold})`);
  return data;
}

/**
 * Insert a new diagnostic case into the knowledge base with its embedding
 * @param {object} caseData - The diagnostic case fields
 * @param {number[]} [embedding] - Pre-computed embedding (will generate if not provided)
 * @returns {object} The inserted row
 */
async function insertCase(caseData, embedding = null) {
  const db = getSupabase();

  if (!embedding) {
    const text = buildEmbeddingText(caseData);
    embedding = await generateEmbedding(text);
    console.log(`[ai-diagnostics] Generated embedding for: ${caseData.dtc_code} — ${caseData.cause}`);
  }

  const row = {
    dtc_code: caseData.dtc_code,
    dtc_description: caseData.dtc_description || null,
    vehicle_make: caseData.vehicle_make || null,
    vehicle_model: caseData.vehicle_model || null,
    year_range_start: caseData.year_range_start || null,
    year_range_end: caseData.year_range_end || null,
    engine_type: caseData.engine_type || null,
    cause: caseData.cause,
    cause_category: caseData.cause_category || null,
    confidence_base: caseData.confidence_base ?? 0.5,
    success_rate: caseData.success_rate || null,
    parts_needed: caseData.parts_needed || null,
    labor_category: caseData.labor_category || null,
    labor_hours_estimate: caseData.labor_hours_estimate || null,
    diagnostic_steps: caseData.diagnostic_steps || null,
    common_misdiagnosis: caseData.common_misdiagnosis || null,
    source: caseData.source || "community",
    embedding,
  };

  const { data, error } = await db.from("diagnostic_knowledge").insert(row).select().single();

  if (error) {
    console.error(`[ai-diagnostics] Insert failed: ${error.message}`);
    throw new Error(`Failed to insert diagnostic case: ${error.message}`);
  }

  console.log(`[ai-diagnostics] Inserted case: ${data.id} (${caseData.dtc_code})`);
  return data;
}

/**
 * Batch insert multiple diagnostic cases with embeddings
 * Generates embeddings in batches to respect OpenAI rate limits
 * @param {object[]} cases - Array of diagnostic case objects
 * @param {number} [batchSize=20] - Number of embeddings to generate per batch
 * @returns {object} { inserted: number, errors: number }
 */
async function insertBatch(cases, batchSize = 20) {
  const db = getSupabase();
  let inserted = 0;
  let errors = 0;

  for (let i = 0; i < cases.length; i += batchSize) {
    const batch = cases.slice(i, i + batchSize);
    const texts = batch.map((c) => buildEmbeddingText(c));

    // Generate embeddings for the batch in one API call
    let embeddings;
    try {
      embeddings = await generateEmbeddingBatch(texts);
    } catch (err) {
      console.error(`[ai-diagnostics] Batch embedding failed at index ${i}: ${err.message}`);
      errors += batch.length;
      continue;
    }

    // Build rows with embeddings
    const rows = batch.map((caseData, idx) => ({
      dtc_code: caseData.dtc_code,
      dtc_description: caseData.dtc_description || null,
      vehicle_make: caseData.vehicle_make || null,
      vehicle_model: caseData.vehicle_model || null,
      year_range_start: caseData.year_range_start || null,
      year_range_end: caseData.year_range_end || null,
      engine_type: caseData.engine_type || null,
      cause: caseData.cause,
      cause_category: caseData.cause_category || null,
      confidence_base: caseData.confidence_base ?? 0.5,
      success_rate: caseData.success_rate || null,
      parts_needed: caseData.parts_needed || null,
      labor_category: caseData.labor_category || null,
      labor_hours_estimate: caseData.labor_hours_estimate || null,
      diagnostic_steps: caseData.diagnostic_steps || null,
      common_misdiagnosis: caseData.common_misdiagnosis || null,
      source: caseData.source || "community",
      embedding: embeddings[idx],
    }));

    const { error } = await db.from("diagnostic_knowledge").insert(rows);

    if (error) {
      console.error(`[ai-diagnostics] Batch insert failed at index ${i}: ${error.message}`);
      errors += batch.length;
    } else {
      inserted += batch.length;
      console.log(`[ai-diagnostics] Inserted batch ${Math.floor(i / batchSize) + 1}: ${batch.length} cases (${inserted}/${cases.length} total)`);
    }
  }

  console.log(`[ai-diagnostics] Batch complete: ${inserted} inserted, ${errors} errors`);
  return { inserted, errors };
}

/**
 * Generate embeddings for multiple texts in a single API call
 * @param {string[]} texts - Array of texts to embed
 * @returns {number[][]} Array of embedding vectors
 */
async function generateEmbeddingBatch(texts) {
  if (!OPENAI_API_KEY) {
    throw new Error("Missing OPENAI_API_KEY in environment");
  }

  const fetch = (await import("node-fetch")).default;

  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: texts,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI embeddings batch API error: ${response.status} — ${errText}`);
  }

  const data = await response.json();

  // Sort by index to ensure correct order
  return data.data
    .sort((a, b) => a.index - b.index)
    .map((item) => item.embedding);
}

module.exports = {
  generateEmbedding,
  generateEmbeddingBatch,
  buildEmbeddingText,
  searchSimilarCases,
  insertCase,
  insertBatch,
  getSupabase,
};
