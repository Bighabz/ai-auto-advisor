/**
 * Shop Usage Tracking & Analytics Dashboard
 *
 * Logs usage events per shop and provides dashboard analytics:
 *   - Estimates created, diagnoses run, orders placed
 *   - Average estimate totals, top repairs
 *   - Monthly usage reports
 *
 * Main exports: trackEvent(), getShopDashboard(), getShopMonthlyReport()
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

const LOG = "[shop-usage]";

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

// --- Event Tracking ---

/**
 * Track a usage event for a shop.
 * Non-fatal — errors are logged but don't break the pipeline.
 *
 * @param {string} shopId - Shop UUID
 * @param {string} eventType - One of: estimate_created, diagnosis_run, order_placed, history_synced, canned_job_used, parts_searched
 * @param {object} [metadata] - Additional event data (e.g., estimate total, vehicle info)
 */
async function trackEvent(shopId, eventType, metadata = {}) {
  if (!shopId) return; // No shop context — skip silently

  try {
    const supabase = await getSupabase();

    const { error } = await supabase
      .from("shop_usage")
      .insert({
        shop_id: shopId,
        event_type: eventType,
        metadata,
      });

    if (error) {
      console.error(`${LOG} Track event failed: ${error.message}`);
    }
  } catch (err) {
    console.error(`${LOG} Track event error: ${err.message}`);
  }
}

// --- Dashboard Analytics ---

/**
 * Get dashboard stats for a shop.
 *
 * Returns current month stats plus all-time totals.
 *
 * @param {string} shopId - Shop UUID
 * @returns {object} Dashboard data
 */
async function getShopDashboard(shopId) {
  console.log(`${LOG} Building dashboard for shop: ${shopId}`);

  const supabase = await getSupabase();

  // Get all events for this shop (last 90 days)
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

  const { data: events, error } = await supabase
    .from("shop_usage")
    .select("event_type, metadata, created_at")
    .eq("shop_id", shopId)
    .gte("created_at", ninetyDaysAgo)
    .order("created_at", { ascending: false })
    .limit(1000);

  if (error) {
    console.error(`${LOG} Dashboard query failed: ${error.message}`);
    return { error: error.message };
  }

  const allEvents = events || [];

  // Current month boundaries
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const thisMonthEvents = allEvents.filter((e) => e.created_at >= monthStart);

  // Count by event type
  const countByType = (evts, type) => evts.filter((e) => e.event_type === type).length;

  // Extract estimate totals for average calculation
  const estimateEvents = thisMonthEvents.filter((e) => e.event_type === "estimate_created");
  const estimateTotals = estimateEvents
    .map((e) => parseFloat(e.metadata?.total || 0))
    .filter((t) => t > 0);
  const avgEstimateTotal = estimateTotals.length > 0
    ? Math.round(estimateTotals.reduce((a, b) => a + b, 0) / estimateTotals.length)
    : 0;

  // Top repairs (from diagnosis events)
  const diagEvents = allEvents.filter((e) => e.event_type === "diagnosis_run");
  const repairCounts = {};
  for (const e of diagEvents) {
    const cause = e.metadata?.topCause || e.metadata?.query;
    if (cause) {
      repairCounts[cause] = (repairCounts[cause] || 0) + 1;
    }
  }
  const topRepairs = Object.entries(repairCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([repair, count]) => ({ repair, count }));

  // Platform usage (from metadata)
  const platformCounts = {};
  for (const e of allEvents) {
    const platforms = e.metadata?.platformsUsed || [];
    for (const p of platforms) {
      platformCounts[p] = (platformCounts[p] || 0) + 1;
    }
  }

  return {
    thisMonth: {
      estimates: countByType(thisMonthEvents, "estimate_created"),
      diagnoses: countByType(thisMonthEvents, "diagnosis_run"),
      orders: countByType(thisMonthEvents, "order_placed"),
      partSearches: countByType(thisMonthEvents, "parts_searched"),
      avgEstimateTotal,
    },
    last90Days: {
      estimates: countByType(allEvents, "estimate_created"),
      diagnoses: countByType(allEvents, "diagnosis_run"),
      orders: countByType(allEvents, "order_placed"),
      totalEvents: allEvents.length,
    },
    topRepairs,
    platformUsage: platformCounts,
  };
}

/**
 * Get detailed monthly report for a shop.
 *
 * @param {string} shopId
 * @param {string} yearMonth - Format: "2026-02"
 * @returns {object} Monthly report
 */
async function getShopMonthlyReport(shopId, yearMonth) {
  console.log(`${LOG} Monthly report for shop ${shopId}: ${yearMonth}`);

  const supabase = await getSupabase();

  // Parse year-month
  const [year, month] = yearMonth.split("-").map(Number);
  const monthStart = new Date(year, month - 1, 1).toISOString();
  const monthEnd = new Date(year, month, 1).toISOString();

  const { data: events, error } = await supabase
    .from("shop_usage")
    .select("event_type, metadata, created_at")
    .eq("shop_id", shopId)
    .gte("created_at", monthStart)
    .lt("created_at", monthEnd)
    .order("created_at", { ascending: true })
    .limit(2000);

  if (error) {
    console.error(`${LOG} Monthly report query failed: ${error.message}`);
    return { error: error.message };
  }

  const allEvents = events || [];

  // Daily breakdown
  const dailyCounts = {};
  for (const e of allEvents) {
    const day = e.created_at.split("T")[0];
    if (!dailyCounts[day]) dailyCounts[day] = { estimates: 0, diagnoses: 0, orders: 0 };
    if (e.event_type === "estimate_created") dailyCounts[day].estimates++;
    if (e.event_type === "diagnosis_run") dailyCounts[day].diagnoses++;
    if (e.event_type === "order_placed") dailyCounts[day].orders++;
  }

  // Revenue estimate (sum of estimate totals)
  const estimateEvents = allEvents.filter((e) => e.event_type === "estimate_created");
  const totalRevenue = estimateEvents.reduce((sum, e) => sum + (parseFloat(e.metadata?.total) || 0), 0);

  // Vehicle make/model breakdown
  const vehicleCounts = {};
  for (const e of allEvents) {
    const vehicle = e.metadata?.vehicle;
    if (vehicle) {
      const key = `${vehicle.make} ${vehicle.model}`;
      vehicleCounts[key] = (vehicleCounts[key] || 0) + 1;
    }
  }
  const topVehicles = Object.entries(vehicleCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([vehicle, count]) => ({ vehicle, count }));

  return {
    month: yearMonth,
    summary: {
      totalEvents: allEvents.length,
      estimates: estimateEvents.length,
      diagnoses: allEvents.filter((e) => e.event_type === "diagnosis_run").length,
      orders: allEvents.filter((e) => e.event_type === "order_placed").length,
      estimatedRevenue: Math.round(totalRevenue),
    },
    dailyBreakdown: dailyCounts,
    topVehicles,
  };
}

module.exports = {
  trackEvent,
  getShopDashboard,
  getShopMonthlyReport,
};
