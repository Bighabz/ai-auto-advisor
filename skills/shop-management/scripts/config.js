/**
 * Shop Configuration — Supabase-Backed Multi-Shop Config
 *
 * Replaces the single-shop JSON file config with a database-backed
 * system that supports multiple shops. Falls back to the local JSON
 * config file when no shop ID is provided (backward compatible).
 *
 * Main exports: getShopConfig(), getShopById(), listActiveShops(),
 *   updateShopSettings(), getShopPlatforms()
 */

const fs = require("fs");
const path = require("path");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SHOP_CONFIG_PATH =
  process.env.SHOP_CONFIG_PATH || path.join(__dirname, "../../../config/shop-config.json");

const LOG = "[shop-config]";

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

// --- Default Settings ---

const DEFAULT_SETTINGS = {
  laborRatePerHour: 135.0,
  diagnosticFee: 89.99,
  shopSuppliesPercent: 5,
  shopSuppliesCap: 35.0,
  taxRate: 0.0775,
  partsMarkupPercent: 40,
  fluidsMarkupPercent: 30,
  subletMarkupPercent: 20,
  defaultPartsType: "aftermarket",
  preferredSuppliers: ["AutoZone Commercial", "O'Reilly Auto Parts", "NAPA"],
  showOEMandAftermarket: true,
  warrantyLabor: "12 months / 12,000 miles",
  warrantyParts: "Per manufacturer warranty",
  paymentTerms: "Due upon completion",
  disclaimers: [
    "Estimate based on initial diagnosis. Additional repairs may be needed upon teardown.",
    "Prices subject to change based on parts availability.",
  ],
};

// --- Local Config Fallback ---

/**
 * Load shop config from local JSON file.
 * Used when no shop ID is provided (single-shop / backward compatible mode).
 *
 * @returns {object} Shop config in the format the orchestrator expects
 */
function loadLocalConfig() {
  try {
    const raw = fs.readFileSync(SHOP_CONFIG_PATH, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    console.error(`${LOG} Local config load failed: ${err.message}`);
    // Return defaults in the expected format
    return transformToOrchestratorFormat("Default Shop", DEFAULT_SETTINGS);
  }
}

/**
 * Transform flat settings into the nested format the orchestrator expects.
 *
 * The orchestrator expects:
 *   { shop: { name, laborRatePerHour, ... }, markup: { ... }, preferences: { ... }, estimateDefaults: { ... } }
 *
 * @param {string} shopName
 * @param {object} settings - Flat settings object
 * @returns {object} Nested config
 */
function transformToOrchestratorFormat(shopName, settings) {
  const s = { ...DEFAULT_SETTINGS, ...settings };

  return {
    shop: {
      name: shopName,
      laborRatePerHour: s.laborRatePerHour,
      diagnosticFee: s.diagnosticFee,
      shopSuppliesPercent: s.shopSuppliesPercent,
      shopSuppliesCap: s.shopSuppliesCap,
      taxRate: s.taxRate,
    },
    markup: {
      partsMarkupPercent: s.partsMarkupPercent,
      fluidsMarkupPercent: s.fluidsMarkupPercent,
      subletMarkupPercent: s.subletMarkupPercent,
    },
    preferences: {
      defaultPartsType: s.defaultPartsType,
      preferredSuppliers: s.preferredSuppliers || [],
      showOEMandAftermarket: s.showOEMandAftermarket !== false,
      includeFluidCapacities: true,
      includeTorqueSpecs: true,
      captureProductScreenshots: true,
    },
    estimateDefaults: {
      warrantyLabor: s.warrantyLabor,
      warrantyParts: s.warrantyParts,
      paymentTerms: s.paymentTerms,
      disclaimers: s.disclaimers || [],
    },
  };
}

// --- Shop Config (Main) ---

/**
 * Get shop config for the orchestrator.
 *
 * If shopId is provided, loads from Supabase.
 * If not, falls back to local JSON config file.
 *
 * @param {string} [shopId] - Shop UUID or slug
 * @returns {object} Shop config in orchestrator format
 */
async function getShopConfig(shopId) {
  // No shop ID → use local config (backward compatible)
  if (!shopId) {
    return loadLocalConfig();
  }

  console.log(`${LOG} Loading config for shop: ${shopId}`);

  const shop = await getShopById(shopId);
  if (!shop) {
    console.error(`${LOG} Shop not found: ${shopId} — using defaults`);
    return transformToOrchestratorFormat("Unknown Shop", DEFAULT_SETTINGS);
  }

  return transformToOrchestratorFormat(shop.name, shop.settings || {});
}

/**
 * Get a shop record by ID or slug.
 *
 * @param {string} shopIdOrSlug - UUID or slug
 * @returns {object|null} Shop record or null
 */
async function getShopById(shopIdOrSlug) {
  const supabase = await getSupabase();

  // Try UUID first, then slug
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(shopIdOrSlug);

  const { data, error } = await supabase
    .from("shops")
    .select("*")
    .eq(isUuid ? "id" : "slug", shopIdOrSlug)
    .eq("active", true)
    .single();

  if (error) {
    console.error(`${LOG} Shop lookup failed: ${error.message}`);
    return null;
  }

  return data;
}

/**
 * List all active shops.
 *
 * @returns {Array} Active shop records
 */
async function listActiveShops() {
  const supabase = await getSupabase();

  const { data, error } = await supabase
    .from("shops")
    .select("id, name, slug, platforms_enabled, created_at")
    .eq("active", true)
    .order("created_at", { ascending: true });

  if (error) {
    console.error(`${LOG} List shops failed: ${error.message}`);
    return [];
  }

  return data || [];
}

/**
 * Update shop settings (partial update — merges with existing).
 *
 * @param {string} shopId
 * @param {object} settingsUpdate - Partial settings to merge
 * @returns {object} Updated shop record
 */
async function updateShopSettings(shopId, settingsUpdate) {
  const supabase = await getSupabase();

  // Fetch current settings
  const shop = await getShopById(shopId);
  if (!shop) {
    return { error: `Shop not found: ${shopId}` };
  }

  const mergedSettings = { ...shop.settings, ...settingsUpdate };

  const { data, error } = await supabase
    .from("shops")
    .update({
      settings: mergedSettings,
      updated_at: new Date().toISOString(),
    })
    .eq("id", shop.id)
    .select()
    .single();

  if (error) {
    console.error(`${LOG} Settings update failed: ${error.message}`);
    return { error: error.message };
  }

  console.log(`${LOG} Updated settings for "${shop.name}"`);
  return data;
}

/**
 * Get which platforms a shop has enabled.
 *
 * @param {string} shopId
 * @returns {object} { platforms: string[], allPlatforms: object[] }
 */
async function getShopPlatforms(shopId) {
  const shop = await getShopById(shopId);
  if (!shop) {
    return { platforms: [], allPlatforms: [] };
  }

  const ALL_PLATFORMS = [
    { key: "alldata", name: "AllData Repair", type: "browser", envVars: ["ALLDATA_USERNAME", "ALLDATA_PASSWORD"] },
    { key: "identifix", name: "Identifix Direct-Hit", type: "browser", envVars: ["IDENTIFIX_USERNAME", "IDENTIFIX_PASSWORD"] },
    { key: "prodemand", name: "ProDemand / Mitchell 1", type: "browser", envVars: ["PRODEMAND_USERNAME", "PRODEMAND_PASSWORD"] },
    { key: "partstech_api", name: "PartsTech (API)", type: "api", envVars: ["PARTSTECH_API_KEY"] },
    { key: "partstech_browser", name: "PartsTech (Browser)", type: "browser", envVars: ["PARTSTECH_URL", "PARTSTECH_USERNAME"] },
    { key: "autoleap", name: "AutoLeap", type: "api", envVars: ["AUTOLEAP_PARTNER_ID", "AUTOLEAP_AUTH_KEY"] },
    { key: "ari", name: "ARI Labor Guides", type: "browser", envVars: ["ARI_URL"] },
  ];

  const allPlatforms = ALL_PLATFORMS.map((p) => ({
    ...p,
    enabled: (shop.platforms_enabled || []).includes(p.key),
    configured: p.envVars.every((v) => !!process.env[v]),
  }));

  return {
    platforms: shop.platforms_enabled || [],
    allPlatforms,
  };
}

module.exports = {
  getShopConfig,
  getShopById,
  listActiveShops,
  updateShopSettings,
  getShopPlatforms,
  loadLocalConfig,
  DEFAULT_SETTINGS,
};
