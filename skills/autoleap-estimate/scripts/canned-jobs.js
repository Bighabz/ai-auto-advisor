/**
 * AutoLeap — Canned Jobs (Pre-Built Service Packages)
 *
 * Analyzes repair_history to identify common repair patterns and builds
 * reusable job templates. These "canned jobs" let SAM instantly quote
 * common services without running the full diagnostic pipeline.
 *
 * Examples:
 *   - "Oil change for 2019 Civic" → canned job with avg parts/labor
 *   - "Front brake job" → template with pads + rotors + labor
 *   - "60k mile service" → maintenance package
 *
 * Main exports: buildCannedJobsFromHistory(), getCannedJobs(), getCannedJobById()
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

const LOG = "[canned-jobs]";

// --- Supabase Client ---

let supabaseClient = null;

async function getSupabase() {
  if (supabaseClient) return supabaseClient;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY must be set");
  }

  const { createClient } = require("@supabase/supabase-js");
  supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return supabaseClient;
}

// --- Pattern Detection ---

/**
 * Common service patterns to look for in repair history.
 * Each pattern maps repair description keywords to a canned job template.
 */
const SERVICE_PATTERNS = [
  {
    name: "Oil Change",
    category: "maintenance",
    keywords: ["oil change", "oil filter", "lube", "oil service"],
    requiredKeywords: ["oil"],
  },
  {
    name: "Front Brake Job",
    category: "repair",
    keywords: ["front brake", "front pad", "front rotor", "front brake pad"],
    requiredKeywords: ["front", "brake"],
  },
  {
    name: "Rear Brake Job",
    category: "repair",
    keywords: ["rear brake", "rear pad", "rear rotor", "rear brake pad"],
    requiredKeywords: ["rear", "brake"],
  },
  {
    name: "Full Brake Job",
    category: "repair",
    keywords: ["brake job", "all brakes", "4 wheel brake"],
    requiredKeywords: ["brake"],
    excludeKeywords: ["front", "rear"],
  },
  {
    name: "Spark Plug Replacement",
    category: "maintenance",
    keywords: ["spark plug", "tune up", "tune-up", "ignition tune"],
    requiredKeywords: ["spark", "plug"],
  },
  {
    name: "Battery Replacement",
    category: "repair",
    keywords: ["battery replace", "new battery", "battery install"],
    requiredKeywords: ["battery"],
  },
  {
    name: "Alternator Replacement",
    category: "repair",
    keywords: ["alternator"],
    requiredKeywords: ["alternator"],
  },
  {
    name: "Starter Replacement",
    category: "repair",
    keywords: ["starter motor", "starter replace"],
    requiredKeywords: ["starter"],
  },
  {
    name: "Coolant Flush",
    category: "maintenance",
    keywords: ["coolant flush", "coolant change", "antifreeze", "cooling system flush"],
    requiredKeywords: ["coolant"],
  },
  {
    name: "Transmission Fluid Service",
    category: "maintenance",
    keywords: ["transmission fluid", "trans fluid", "atf", "transmission service"],
    requiredKeywords: ["transmission"],
  },
  {
    name: "Air Filter Replacement",
    category: "maintenance",
    keywords: ["air filter", "engine air filter"],
    requiredKeywords: ["air", "filter"],
    excludeKeywords: ["cabin"],
  },
  {
    name: "Cabin Air Filter",
    category: "maintenance",
    keywords: ["cabin filter", "cabin air filter"],
    requiredKeywords: ["cabin", "filter"],
  },
  {
    name: "Serpentine Belt Replacement",
    category: "repair",
    keywords: ["serpentine belt", "drive belt", "belt replace"],
    requiredKeywords: ["belt"],
    excludeKeywords: ["timing"],
  },
  {
    name: "Timing Belt/Chain Service",
    category: "repair",
    keywords: ["timing belt", "timing chain"],
    requiredKeywords: ["timing"],
  },
  {
    name: "Water Pump Replacement",
    category: "repair",
    keywords: ["water pump"],
    requiredKeywords: ["water", "pump"],
  },
  {
    name: "Catalytic Converter Replacement",
    category: "repair",
    keywords: ["catalytic converter", "cat converter", "catalytic"],
    requiredKeywords: ["catalytic"],
  },
  {
    name: "O2 Sensor Replacement",
    category: "repair",
    keywords: ["oxygen sensor", "o2 sensor", "o2sensor"],
    requiredKeywords: ["o2", "sensor"],
  },
  {
    name: "Wheel Alignment",
    category: "maintenance",
    keywords: ["alignment", "wheel alignment", "front end alignment"],
    requiredKeywords: ["alignment"],
  },
  {
    name: "Tire Rotation",
    category: "maintenance",
    keywords: ["tire rotation", "rotate tires"],
    requiredKeywords: ["tire", "rotation"],
  },
  {
    name: "AC Recharge/Service",
    category: "repair",
    keywords: ["ac recharge", "a/c recharge", "ac service", "freon", "refrigerant"],
    requiredKeywords: ["ac"],
  },
];

/**
 * Match a repair description to a service pattern.
 *
 * @param {string} description
 * @returns {object|null} Matched pattern or null
 */
function matchServicePattern(description) {
  const descLower = description.toLowerCase();

  for (const pattern of SERVICE_PATTERNS) {
    // Check required keywords
    const hasRequired = pattern.requiredKeywords.every((kw) => descLower.includes(kw));
    if (!hasRequired) continue;

    // Check exclude keywords
    if (pattern.excludeKeywords) {
      const hasExcluded = pattern.excludeKeywords.some((kw) => descLower.includes(kw));
      if (hasExcluded) continue;
    }

    // Required keywords matched and no exclusions — this pattern matches
    return pattern;
  }

  return null;
}

// --- Build Canned Jobs ---

/**
 * Analyze repair_history and build canned jobs from common patterns.
 *
 * Groups repairs by pattern + vehicle make/model, computes averages,
 * and upserts into the canned_jobs table.
 *
 * @param {number} [minCount=3] - Minimum repairs to create a canned job
 * @returns {object} { created, updated, skipped }
 */
async function buildCannedJobsFromHistory(minCount = 3) {
  console.log(`${LOG} Building canned jobs from repair history (min ${minCount} occurrences)...`);

  const supabase = await getSupabase();

  // Fetch all repair history
  const { data: repairs, error } = await supabase
    .from("repair_history")
    .select("*")
    .not("repair_description", "is", null)
    .limit(2000);

  if (error) {
    console.error(`${LOG} Failed to fetch history: ${error.message}`);
    return { created: 0, updated: 0, skipped: 0, error: error.message };
  }

  if (!repairs || repairs.length === 0) {
    console.log(`${LOG} No repair history to analyze`);
    return { created: 0, updated: 0, skipped: 0 };
  }

  // Group repairs by pattern + make/model
  const groups = {};

  for (const repair of repairs) {
    const pattern = matchServicePattern(repair.repair_description);
    if (!pattern) continue;

    const key = `${pattern.name}|${repair.vehicle_make}|${repair.vehicle_model}`;
    if (!groups[key]) {
      groups[key] = {
        pattern,
        make: repair.vehicle_make,
        model: repair.vehicle_model,
        repairs: [],
        years: new Set(),
      };
    }

    groups[key].repairs.push(repair);
    if (repair.vehicle_year) groups[key].years.add(repair.vehicle_year);
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const [key, group] of Object.entries(groups)) {
    if (group.repairs.length < minCount) {
      skipped++;
      continue;
    }

    // Compute averages
    const avgLaborHours =
      group.repairs.reduce((sum, r) => sum + (r.labor_hours || 0), 0) / group.repairs.length;
    const avgPartsCost =
      group.repairs.reduce((sum, r) => {
        const parts = r.parts_used || [];
        return sum + parts.reduce((ps, p) => ps + (p.cost || 0), 0);
      }, 0) / group.repairs.length;
    const avgTotalCost =
      group.repairs.reduce((sum, r) => sum + (r.total_cost || 0), 0) / group.repairs.length;

    // Build representative line items from most recent repair
    const mostRecent = [...group.repairs].sort(
      (a, b) => new Date(b.completed_at) - new Date(a.completed_at)
    )[0];

    const lineItems = [];
    // Labor line
    lineItems.push({
      description: group.pattern.name,
      type: "labor",
      hours: Math.round(avgLaborHours * 10) / 10,
    });
    // Parts from most recent repair
    if (mostRecent.parts_used?.length > 0) {
      for (const part of mostRecent.parts_used) {
        lineItems.push({
          description: part.name,
          type: "part",
          partNumber: part.partNumber,
          avgCost: Math.round((part.cost || 0) * 100) / 100,
        });
      }
    }

    const years = [...group.years].sort();
    const lastPerformed = [...group.repairs].sort(
      (a, b) => new Date(b.completed_at) - new Date(a.completed_at)
    )[0].completed_at;

    const cannedJob = {
      name: `${group.pattern.name} — ${group.make} ${group.model}`,
      description: `${group.pattern.name} for ${group.make} ${group.model}. Based on ${group.repairs.length} completed repairs.`,
      category: group.pattern.category,
      vehicle_makes: [group.make],
      vehicle_models: [group.model],
      year_range_start: years.length > 0 ? years[0] : null,
      year_range_end: years.length > 0 ? years[years.length - 1] : null,
      line_items: lineItems,
      avg_labor_hours: Math.round(avgLaborHours * 10) / 10,
      avg_parts_cost: Math.round(avgPartsCost * 100) / 100,
      avg_total_cost: Math.round(avgTotalCost * 100) / 100,
      frequency: group.repairs.length,
      created_from_count: group.repairs.length,
      last_performed_at: lastPerformed,
      updated_at: new Date().toISOString(),
    };

    // Check if this canned job already exists
    const { data: existing } = await supabase
      .from("canned_jobs")
      .select("id")
      .eq("name", cannedJob.name)
      .limit(1);

    if (existing && existing.length > 0) {
      // Update existing
      const { error: updateErr } = await supabase
        .from("canned_jobs")
        .update(cannedJob)
        .eq("id", existing[0].id);

      if (updateErr) {
        console.error(`${LOG} Update failed for "${cannedJob.name}": ${updateErr.message}`);
      } else {
        updated++;
      }
    } else {
      // Insert new
      const { error: insertErr } = await supabase
        .from("canned_jobs")
        .insert(cannedJob);

      if (insertErr) {
        console.error(`${LOG} Insert failed for "${cannedJob.name}": ${insertErr.message}`);
      } else {
        created++;
      }
    }
  }

  console.log(`${LOG} Canned jobs: ${created} created, ${updated} updated, ${skipped} skipped (<${minCount} occurrences)`);
  return { created, updated, skipped };
}

// --- Query Canned Jobs ---

/**
 * Get canned jobs applicable to a specific vehicle.
 *
 * Returns jobs that match the vehicle's make/model and year range,
 * sorted by frequency (most common first).
 *
 * @param {object} params
 * @param {string} params.make
 * @param {string} params.model
 * @param {number} [params.year]
 * @param {string} [params.category] - Filter by category (maintenance, repair, etc.)
 * @returns {Array} Matching canned jobs
 */
async function getCannedJobs({ make, model, year, category }) {
  console.log(`${LOG} Getting canned jobs for ${make} ${model}${year ? ` ${year}` : ""}`);

  const supabase = await getSupabase();

  let query = supabase
    .from("canned_jobs")
    .select("*")
    .contains("vehicle_makes", [make])
    .contains("vehicle_models", [model])
    .order("frequency", { ascending: false });

  if (category) query = query.eq("category", category);

  const { data, error } = await query;

  if (error) {
    console.error(`${LOG} Query failed: ${error.message}`);
    return [];
  }

  let jobs = data || [];

  // Filter by year range if provided
  if (year && jobs.length > 0) {
    jobs = jobs.filter((job) => {
      if (!job.year_range_start && !job.year_range_end) return true;
      if (job.year_range_start && year < job.year_range_start) return false;
      if (job.year_range_end && year > job.year_range_end) return false;
      return true;
    });
  }

  console.log(`${LOG} Found ${jobs.length} canned jobs`);
  return jobs;
}

/**
 * Get a specific canned job by ID.
 *
 * @param {string} id
 * @returns {object|null} Canned job or null
 */
async function getCannedJobById(id) {
  const supabase = await getSupabase();

  const { data, error } = await supabase
    .from("canned_jobs")
    .select("*")
    .eq("id", id)
    .single();

  if (error) {
    console.error(`${LOG} Job lookup failed: ${error.message}`);
    return null;
  }

  return data;
}

/**
 * Search canned jobs by description text.
 *
 * @param {string} searchText
 * @param {string} [make] - Optional vehicle make filter
 * @returns {Array} Matching canned jobs
 */
async function searchCannedJobs(searchText, make) {
  const supabase = await getSupabase();

  let query = supabase
    .from("canned_jobs")
    .select("*")
    .textSearch("name", searchText, { type: "websearch" })
    .order("frequency", { ascending: false })
    .limit(10);

  if (make) query = query.contains("vehicle_makes", [make]);

  const { data, error } = await query;

  if (error) {
    console.error(`${LOG} Search failed: ${error.message}`);
    return [];
  }

  return data || [];
}

module.exports = {
  buildCannedJobsFromHistory,
  getCannedJobs,
  getCannedJobById,
  searchCannedJobs,
  // Helpers for testing
  matchServicePattern,
  SERVICE_PATTERNS,
};
