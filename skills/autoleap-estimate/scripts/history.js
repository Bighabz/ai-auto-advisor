/**
 * AutoLeap — Repair History & Shop Analytics
 *
 * Pulls completed repair orders from AutoLeap Partner API,
 * caches them in Supabase (repair_history table), and provides:
 *   - Vehicle-specific repair history
 *   - Shop-wide repair statistics for a make/model
 *   - Related prior repairs that inform current diagnosis
 *
 * Uses the same auth as estimate.js (shared AutoLeap Partner API token).
 *
 * Main exports: getVehicleHistory(), getShopRepairStats(),
 *   findRelatedPriorRepairs(), syncRepairHistory()
 */

const { authenticate } = require("./estimate");

const AUTOLEAP_API_URL =
  process.env.AUTOLEAP_API_URL || "https://partnerapi.myautoleap.com/v2";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

const LOG = "[autoleap-history]";

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

// --- AutoLeap API Helpers ---

/**
 * Make an authenticated AutoLeap API request.
 * Reuses the shared authenticate() from estimate.js.
 *
 * @param {string} method
 * @param {string} path
 * @returns {object} API response
 */
async function apiRequest(method, path) {
  const fetch = (await import("node-fetch")).default;
  const token = await authenticate();

  const response = await fetch(`${AUTOLEAP_API_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`AutoLeap API ${method} ${path}: ${response.status} — ${errText}`);
  }

  return response.json();
}

/**
 * Normalize a raw AutoLeap repair order + line items into a cache record.
 *
 * @param {object} ro - Raw repair order from AutoLeap API
 * @param {Array} lineItems - Line items for this RO
 * @param {object} [defaults] - Fallback values { vin, make, model }
 * @returns {object} Normalized repair_history record
 */
function normalizeRepairOrder(ro, lineItems, defaults = {}) {
  const partsUsed = [];
  let totalLaborHours = 0;

  for (const item of (Array.isArray(lineItems) ? lineItems : [])) {
    if (item.partNumber || item.partsCost > 0) {
      partsUsed.push({
        name: item.description,
        partNumber: item.partNumber || null,
        cost: item.partsCost || 0,
      });
    }
    totalLaborHours += item.laborHours || 0;
  }

  const dtcCodes = [];
  const dtcMatches = (ro.description || "").match(/[PBCU]\d{4}/gi);
  if (dtcMatches) dtcCodes.push(...dtcMatches.map((d) => d.toUpperCase()));

  return {
    autoleap_ro_id: ro.id,
    vehicle_vin: ro.vehicle?.vin || defaults.vin || null,
    vehicle_year: ro.vehicle?.year || null,
    vehicle_make: ro.vehicle?.make || defaults.make || "Unknown",
    vehicle_model: ro.vehicle?.model || defaults.model || "Unknown",
    vehicle_engine: ro.vehicle?.engine || null,
    customer_name: null, // PII — not cached
    repair_description: ro.description || ro.title || "Repair",
    dtc_codes: dtcCodes,
    parts_used: partsUsed,
    labor_hours: totalLaborHours,
    total_cost: ro.total || ro.totalCost || 0,
    outcome: ro.comeback ? "comeback" : "successful",
    completed_at: ro.completedAt || ro.updatedAt || new Date().toISOString(),
    synced_at: new Date().toISOString(),
  };
}

// --- Vehicle History ---

/**
 * Get repair history for a specific vehicle from cache or AutoLeap.
 *
 * Checks Supabase cache first (repair_history table).
 * If stale (>24h since last sync) or empty, pulls from AutoLeap and caches.
 *
 * @param {object} params
 * @param {string} [params.vin] - Vehicle VIN
 * @param {string|number} [params.year]
 * @param {string} [params.make]
 * @param {string} [params.model]
 * @returns {object} { repairs: [], totalRepairs: number, lastVisit: string|null }
 */
async function getVehicleHistory({ vin, year, make, model }) {
  console.log(`${LOG} Getting history for ${vin || `${year} ${make} ${model}`}`);

  const supabase = await getSupabase();

  // Check cache first
  let query = supabase
    .from("repair_history")
    .select("*")
    .order("completed_at", { ascending: false });

  if (vin) {
    query = query.eq("vehicle_vin", vin);
  } else if (make && model) {
    query = query.eq("vehicle_make", make).eq("vehicle_model", model);
    if (year) query = query.eq("vehicle_year", year);
  } else {
    return { repairs: [], totalRepairs: 0, lastVisit: null };
  }

  const { data: cached, error: cacheErr } = await query.limit(50);

  if (cacheErr) {
    console.error(`${LOG} Cache query failed: ${cacheErr.message}`);
  }

  // If we have recent cache data (<24h), use it
  if (cached && cached.length > 0) {
    // Use the most recent synced_at across all records (not just the first)
    const maxSyncTime = Math.max(...cached.map((r) => new Date(r.synced_at).getTime()));
    const ageHours = (Date.now() - maxSyncTime) / (1000 * 60 * 60);

    if (ageHours < 24) {
      console.log(`${LOG} Using cached history (${cached.length} repairs, ${ageHours.toFixed(1)}h old)`);
      return formatHistoryResult(cached);
    }
  }

  // Pull fresh data from AutoLeap
  try {
    const freshRepairs = await fetchRepairOrdersFromAutoLeap(vin, make, model);
    if (freshRepairs.length > 0) {
      await cacheRepairHistory(freshRepairs);
      console.log(`${LOG} Synced ${freshRepairs.length} repairs from AutoLeap`);
      return formatHistoryResult(freshRepairs);
    }
  } catch (err) {
    console.error(`${LOG} AutoLeap fetch failed: ${err.message}`);
  }

  // Fall back to whatever cache we had
  if (cached && cached.length > 0) {
    console.log(`${LOG} Using stale cache (${cached.length} repairs)`);
    return formatHistoryResult(cached);
  }

  return { repairs: [], totalRepairs: 0, lastVisit: null };
}

/**
 * Fetch completed repair orders from AutoLeap for a vehicle.
 *
 * @param {string} [vin]
 * @param {string} [make]
 * @param {string} [model]
 * @returns {Array} Normalized repair records
 */
async function fetchRepairOrdersFromAutoLeap(vin, make, model) {
  const repairs = [];

  try {
    // Find the vehicle in AutoLeap
    let vehicleId = null;

    if (vin) {
      const vehicleResult = await apiRequest("GET", `/partners/vehicles?vin=${encodeURIComponent(vin)}`);
      if (vehicleResult.data?.length > 0) {
        vehicleId = vehicleResult.data[0].id;
      }
    }

    if (!vehicleId) {
      console.log(`${LOG} Vehicle not found in AutoLeap`);
      return repairs;
    }

    // Get repair orders for this vehicle
    const roResult = await apiRequest("GET", `/partners/repair-orders?vehicleId=${vehicleId}&status=completed`);
    const repairOrders = roResult.data || roResult || [];

    for (const ro of (Array.isArray(repairOrders) ? repairOrders : [])) {
      let lineItems = [];
      try {
        const itemsResult = await apiRequest("GET", `/partners/repair-orders/${ro.id}/items`);
        lineItems = itemsResult.data || itemsResult || [];
      } catch {
        // Some ROs might not have accessible items
      }

      repairs.push(normalizeRepairOrder(ro, lineItems, { vin, make, model }));
    }
  } catch (err) {
    console.error(`${LOG} AutoLeap RO fetch failed: ${err.message}`);
  }

  return repairs;
}

/**
 * Cache repair records in Supabase.
 * Upserts on autoleap_ro_id to avoid duplicates.
 *
 * @param {Array} repairs
 */
async function cacheRepairHistory(repairs) {
  if (repairs.length === 0) return;

  const supabase = await getSupabase();

  // Upsert in batches of 50
  for (let i = 0; i < repairs.length; i += 50) {
    const batch = repairs.slice(i, i + 50);
    const { error } = await supabase
      .from("repair_history")
      .upsert(batch, { onConflict: "autoleap_ro_id" });

    if (error) {
      console.error(`${LOG} Cache upsert failed: ${error.message}`);
    }
  }
}

/**
 * Format raw repair records into a structured result.
 *
 * @param {Array} repairs
 * @returns {object}
 */
function formatHistoryResult(repairs) {
  const sorted = [...repairs].sort(
    (a, b) => new Date(b.completed_at) - new Date(a.completed_at)
  );

  return {
    repairs: sorted,
    totalRepairs: sorted.length,
    lastVisit: sorted.length > 0 ? sorted[0].completed_at : null,
    totalSpent: sorted.reduce((sum, r) => sum + (r.total_cost || 0), 0),
  };
}

// --- Shop-Wide Analytics ---

/**
 * Get shop-wide repair statistics for a specific repair type on a vehicle model.
 *
 * Example: "How many catalytic converter replacements have we done on 2016-2019 Civics?"
 *
 * @param {object} params
 * @param {string} params.make
 * @param {string} params.model
 * @param {number} [params.yearStart]
 * @param {number} [params.yearEnd]
 * @param {string} [params.cause] - Repair description keyword (e.g. "catalytic converter")
 * @returns {object} { totalRepairs, successRate, avgLaborHours, avgCost, comebacks }
 */
async function getShopRepairStats({ make, model, yearStart, yearEnd, cause }) {
  console.log(`${LOG} Shop stats: ${cause || "all"} on ${make} ${model}`);

  const supabase = await getSupabase();

  let query = supabase
    .from("repair_history")
    .select("*")
    .eq("vehicle_make", make)
    .eq("vehicle_model", model);

  if (yearStart) query = query.gte("vehicle_year", yearStart);
  if (yearEnd) query = query.lte("vehicle_year", yearEnd);

  // Limit to prevent unbounded queries on busy shops
  query = query.limit(1000);

  const { data, error } = await query;

  if (error) {
    console.error(`${LOG} Stats query failed: ${error.message}`);
    return { totalRepairs: 0, error: error.message };
  }

  let filtered = data || [];

  // Filter by cause keyword if provided
  if (cause && filtered.length > 0) {
    const causeWords = cause.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    filtered = filtered.filter((r) => {
      const desc = r.repair_description?.toLowerCase() || "";
      return causeWords.some((w) => desc.includes(w));
    });
  }

  if (filtered.length === 0) {
    return { totalRepairs: 0, successRate: null, avgLaborHours: null, avgCost: null, comebacks: 0 };
  }

  const successful = filtered.filter((r) => r.outcome === "successful").length;
  const comebacks = filtered.filter((r) => r.outcome === "comeback").length;
  const known = filtered.filter((r) => r.outcome !== "unknown").length;
  const totalLaborHours = filtered.reduce((sum, r) => sum + (r.labor_hours || 0), 0);
  const totalCost = filtered.reduce((sum, r) => sum + (r.total_cost || 0), 0);

  return {
    totalRepairs: filtered.length,
    successRate: known > 0 ? Math.round((successful / known) * 100) : null,
    avgLaborHours: Math.round((totalLaborHours / filtered.length) * 10) / 10,
    avgCost: Math.round(totalCost / filtered.length),
    comebacks,
    successCount: successful,
    knownOutcomes: known,
  };
}

// --- Prior Repair Relevance ---

/**
 * Find prior repairs on this vehicle that are relevant to the current diagnosis.
 *
 * Looks for:
 *   - Same DTC codes seen before
 *   - Related system repairs (e.g., prior O2 sensor → current P0420 = likely cat now)
 *   - Recent comebacks (warranty concerns)
 *
 * @param {object} vehicle - { vin, year, make, model }
 * @param {object} diagnosis - { dtcCodes: [], diagnoses: [{ cause }] }
 * @returns {object} { relatedRepairs, insight, confidenceAdjustment }
 */
async function findRelatedPriorRepairs(vehicle, diagnosis) {
  const history = await getVehicleHistory(vehicle);

  if (history.totalRepairs === 0) {
    return { relatedRepairs: [], insight: null, confidenceAdjustment: 0 };
  }

  const relatedRepairs = [];
  const dtcCodes = diagnosis?.dtcCodes || [];
  const causes = (diagnosis?.diagnoses || []).map((d) => d.cause?.toLowerCase() || "");

  for (const repair of history.repairs) {
    let relevanceScore = 0;
    const reasons = [];

    // Check for overlapping DTC codes
    const sharedDTCs = (repair.dtc_codes || []).filter((code) =>
      dtcCodes.some((dc) => dc.toUpperCase() === code.toUpperCase())
    );
    if (sharedDTCs.length > 0) {
      relevanceScore += 3;
      reasons.push(`Same DTC: ${sharedDTCs.join(", ")}`);
    }

    // Check for related system keywords
    const repairDesc = repair.repair_description?.toLowerCase() || "";
    for (const cause of causes) {
      const causeWords = cause.split(/\s+/).filter((w) => w.length > 3);
      const overlap = causeWords.filter((w) => repairDesc.includes(w)).length;
      if (overlap >= 2) {
        relevanceScore += 2;
        reasons.push(`Related repair: ${repair.repair_description}`);
        break;
      }
    }

    // Check for escalation pattern (e.g., O2 sensor → catalytic converter)
    const escalationPatterns = [
      { prior: ["o2 sensor", "oxygen sensor"], current: ["catalytic", "converter", "p0420"] },
      { prior: ["spark plug", "ignition coil"], current: ["misfire", "p0300", "p0301", "p0302"] },
      { prior: ["mass air flow", "maf"], current: ["lean", "p0171", "p0174"] },
      { prior: ["thermostat"], current: ["overheating", "coolant", "p0128"] },
      { prior: ["battery", "alternator"], current: ["no start", "crank", "electrical"] },
    ];

    for (const pattern of escalationPatterns) {
      const priorMatch = pattern.prior.some((p) => repairDesc.includes(p));
      const currentMatch = pattern.current.some((c) =>
        causes.some((cause) => cause.includes(c)) ||
        dtcCodes.some((dtc) => dtc.toLowerCase().includes(c))
      );

      if (priorMatch && currentMatch) {
        relevanceScore += 4;
        reasons.push(`Escalation pattern detected`);
        break;
      }
    }

    // Recent comeback flag
    if (repair.outcome === "comeback") {
      relevanceScore += 2;
      reasons.push("Previous comeback");
    }

    if (relevanceScore >= 2) {
      relatedRepairs.push({
        ...repair,
        relevanceScore,
        reasons,
      });
    }
  }

  // Sort by relevance
  relatedRepairs.sort((a, b) => b.relevanceScore - a.relevanceScore);

  // Generate insight text
  let insight = null;
  let confidenceAdjustment = 0;

  if (relatedRepairs.length > 0) {
    const top = relatedRepairs[0];
    const daysSince = top.completed_at
      ? Math.round((Date.now() - new Date(top.completed_at).getTime()) / (1000 * 60 * 60 * 24))
      : null;

    if (top.reasons.some((r) => r.includes("Escalation"))) {
      insight = `This vehicle had ${top.repair_description} ${daysSince ? `${daysSince} days ago` : "previously"}. ${top.reasons.find((r) => r.includes("Escalation"))} — the current issue may be the root cause that was missed.`;
      confidenceAdjustment = 0.10;
    } else if (top.reasons.some((r) => r.includes("Same DTC"))) {
      insight = `This vehicle was in ${daysSince ? `${daysSince} days ago` : "previously"} for the same DTC code(s). Prior repair: ${top.repair_description}. If the same code is back, the root cause may not have been addressed.`;
      confidenceAdjustment = 0.08;
    } else if (top.reasons.some((r) => r.includes("comeback"))) {
      insight = `Previous repair (${top.repair_description}) was a comeback. Extra diagnostic verification recommended.`;
      confidenceAdjustment = -0.05;
    } else {
      insight = `Related prior repair: ${top.repair_description} (${daysSince ? `${daysSince} days ago` : "prior visit"}).`;
      confidenceAdjustment = 0.03;
    }
  }

  return {
    relatedRepairs: relatedRepairs.slice(0, 5),
    insight,
    confidenceAdjustment,
    vehicleVisits: history.totalRepairs,
    totalSpent: history.totalSpent,
    lastVisit: history.lastVisit,
  };
}

// --- Sync ---

/**
 * Bulk sync all completed repair orders from AutoLeap to Supabase.
 * Intended for initial setup or periodic background sync.
 *
 * Fetches all completed ROs, caches them, and returns a summary.
 *
 * @returns {object} { synced, errors, total }
 */
async function syncRepairHistory() {
  console.log(`${LOG} Starting full repair history sync...`);

  let page = 1;
  let totalSynced = 0;
  let totalErrors = 0;
  let hasMore = true;

  while (hasMore) {
    try {
      const result = await apiRequest("GET", `/partners/repair-orders?status=completed&page=${page}&limit=50`);
      const orders = result.data || result || [];

      if (!Array.isArray(orders) || orders.length === 0) {
        hasMore = false;
        break;
      }

      const repairs = [];

      for (const ro of orders) {
        try {
          let lineItems = [];
          try {
            const itemsResult = await apiRequest("GET", `/partners/repair-orders/${ro.id}/items`);
            lineItems = itemsResult.data || itemsResult || [];
          } catch {
            // Skip items if not accessible
          }

          repairs.push(normalizeRepairOrder(ro, lineItems));
        } catch (err) {
          totalErrors++;
          console.error(`${LOG} Error processing RO ${ro.id}: ${err.message}`);
        }
      }

      if (repairs.length > 0) {
        await cacheRepairHistory(repairs);
        totalSynced += repairs.length;
      }

      console.log(`${LOG} Page ${page}: synced ${repairs.length} repairs`);
      page++;

      // Safety limit — stop after 20 pages (1000 ROs)
      if (page > 20) {
        console.log(`${LOG} Reached page limit (20 pages)`);
        hasMore = false;
      }
    } catch (err) {
      console.error(`${LOG} Sync page ${page} failed: ${err.message}`);
      hasMore = false;
    }
  }

  console.log(`${LOG} Sync complete: ${totalSynced} synced, ${totalErrors} errors`);
  return { synced: totalSynced, errors: totalErrors, total: totalSynced + totalErrors };
}

module.exports = {
  getVehicleHistory,
  getShopRepairStats,
  findRelatedPriorRepairs,
  syncRepairHistory,
  // Helpers for testing
  fetchRepairOrdersFromAutoLeap,
  cacheRepairHistory,
  formatHistoryResult,
};
