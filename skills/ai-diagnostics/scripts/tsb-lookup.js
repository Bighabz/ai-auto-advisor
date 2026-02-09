/**
 * TSB Lookup — NHTSA Recall & Complaint Search with Supabase Caching
 *
 * Queries the free NHTSA APIs for vehicle recalls and complaints,
 * with a 30-day Supabase cache (tsb_cache table) to avoid
 * redundant API calls.
 *
 * Main export: lookupTSBs(make, model, year)
 */

const { getSupabase } = require("./embeddings");

const NHTSA_RECALLS_URL =
  "https://api.nhtsa.gov/recalls/recallsByVehicle";
const NHTSA_COMPLAINTS_URL =
  "https://api.nhtsa.gov/complaints/complaintsByVehicle";

/**
 * Fetch active recalls from NHTSA for a specific vehicle
 * @param {string} make - Vehicle make (e.g. "Toyota")
 * @param {string} model - Vehicle model (e.g. "Camry")
 * @param {number|string} year - Model year (e.g. 2020)
 * @returns {object[]} Array of recall objects from NHTSA
 */
async function checkRecalls(make, model, year) {
  const fetch = (await import("node-fetch")).default;

  const url = `${NHTSA_RECALLS_URL}?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}&modelYear=${encodeURIComponent(year)}`;

  console.log(`[ai-diagnostics] Fetching recalls: ${make} ${model} ${year}`);

  const response = await fetch(url);

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(
      `NHTSA recalls API error: ${response.status} — ${errText}`
    );
  }

  const data = await response.json();

  // NHTSA uses "Count" (Pascal case) and "results" (lowercase)
  const results = data.results || [];
  console.log(
    `[ai-diagnostics] Found ${results.length} recalls for ${make} ${model} ${year}`
  );

  return results;
}

/**
 * Fetch consumer complaints from NHTSA for a specific vehicle
 * @param {string} make - Vehicle make (e.g. "Toyota")
 * @param {string} model - Vehicle model (e.g. "Camry")
 * @param {number|string} year - Model year (e.g. 2020)
 * @returns {object[]} Array of complaint objects from NHTSA
 */
async function checkComplaints(make, model, year) {
  const fetch = (await import("node-fetch")).default;

  const url = `${NHTSA_COMPLAINTS_URL}?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}&modelYear=${encodeURIComponent(year)}`;

  console.log(
    `[ai-diagnostics] Fetching complaints: ${make} ${model} ${year}`
  );

  const response = await fetch(url);

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(
      `NHTSA complaints API error: ${response.status} — ${errText}`
    );
  }

  const data = await response.json();

  const results = data.results || [];
  console.log(
    `[ai-diagnostics] Found ${results.length} complaints for ${make} ${model} ${year}`
  );

  return results;
}

/**
 * Look up TSBs, recalls, and complaints for a vehicle.
 * Uses Supabase cache (30-day TTL) to avoid redundant NHTSA calls.
 *
 * @param {string} make - Vehicle make (e.g. "Toyota")
 * @param {string} model - Vehicle model (e.g. "Camry")
 * @param {number|string} year - Model year (e.g. 2020)
 * @returns {object} { recalls: [...], complaints: [...], cached: boolean }
 */
async function lookupTSBs(make, model, year) {
  // Normalize inputs for consistent cache keys
  const normMake = String(make).trim().toUpperCase();
  const normModel = String(model).trim().toUpperCase();
  const normYear = parseInt(year, 10);

  if (!normMake || !normModel || isNaN(normYear)) {
    return {
      error: "Invalid vehicle parameters: make, model, and year are required",
    };
  }

  // --- Check cache first ---
  try {
    const db = getSupabase();

    const { data: cached, error: cacheErr } = await db
      .from("tsb_cache")
      .select("*")
      .eq("vehicle_make", normMake)
      .eq("vehicle_model", normModel)
      .eq("vehicle_year", normYear)
      .gt("expires_at", new Date().toISOString())
      .order("fetched_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (cacheErr) {
      console.error(
        `[ai-diagnostics] Cache lookup error: ${cacheErr.message}`
      );
      // Fall through to fresh fetch on cache error
    }

    if (cached) {
      console.log(
        `[ai-diagnostics] Cache hit for ${normMake} ${normModel} ${normYear} (expires ${cached.expires_at})`
      );
      return {
        recalls: cached.recall_data || [],
        complaints: cached.complaint_data || [],
        cached: true,
      };
    }

    console.log(
      `[ai-diagnostics] Cache miss for ${normMake} ${normModel} ${normYear} — fetching from NHTSA`
    );
  } catch (err) {
    console.error(
      `[ai-diagnostics] Cache check failed, proceeding with fresh fetch: ${err.message}`
    );
  }

  // --- Fetch fresh data from NHTSA ---
  let recalls = [];
  let complaints = [];

  try {
    // Fetch recalls and complaints in parallel
    const [recallResult, complaintResult] = await Promise.allSettled([
      checkRecalls(make, model, year),
      checkComplaints(make, model, year),
    ]);

    if (recallResult.status === "fulfilled") {
      recalls = recallResult.value;
    } else {
      console.error(
        `[ai-diagnostics] Recall fetch failed: ${recallResult.reason.message}`
      );
    }

    if (complaintResult.status === "fulfilled") {
      complaints = complaintResult.value;
    } else {
      console.error(
        `[ai-diagnostics] Complaint fetch failed: ${complaintResult.reason.message}`
      );
    }
  } catch (err) {
    console.error(`[ai-diagnostics] NHTSA fetch error: ${err.message}`);
    return {
      recalls: [],
      complaints: [],
      cached: false,
      error: `NHTSA fetch failed: ${err.message}`,
    };
  }

  // --- Cache the results ---
  try {
    const db = getSupabase();

    // Upsert: delete any existing (possibly expired) rows for this vehicle,
    // then insert fresh data
    await db
      .from("tsb_cache")
      .delete()
      .eq("vehicle_make", normMake)
      .eq("vehicle_model", normModel)
      .eq("vehicle_year", normYear);

    const { error: insertErr } = await db.from("tsb_cache").insert({
      vehicle_make: normMake,
      vehicle_model: normModel,
      vehicle_year: normYear,
      recall_data: recalls,
      complaint_data: complaints,
      tsb_data: null, // NHTSA public API does not serve TSB data directly
      fetched_at: new Date().toISOString(),
      // expires_at defaults to now() + 30 days via the DB column default
    });

    if (insertErr) {
      console.error(
        `[ai-diagnostics] Cache write failed: ${insertErr.message}`
      );
    } else {
      console.log(
        `[ai-diagnostics] Cached NHTSA data for ${normMake} ${normModel} ${normYear}`
      );
    }
  } catch (err) {
    // Cache write failure is non-fatal — data was still retrieved
    console.error(
      `[ai-diagnostics] Cache write error (non-fatal): ${err.message}`
    );
  }

  return {
    recalls,
    complaints,
    cached: false,
  };
}

module.exports = {
  checkRecalls,
  checkComplaints,
  lookupTSBs,
};
