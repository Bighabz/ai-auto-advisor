/**
 * Shop Onboarding — Create and configure new shops for SAM.
 *
 * Handles the full onboarding flow:
 *   1. Create shop record in Supabase with settings
 *   2. Validate platform credentials are reachable
 *   3. Generate env var template for the shop
 *
 * Main exports: onboardShop(), validatePlatformAccess(),
 *   generateEnvTemplate(), deactivateShop()
 */

const { getShopById, DEFAULT_SETTINGS } = require("./config");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

const LOG = "[shop-onboard]";

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

// --- Platform Definitions ---

const PLATFORMS = [
  {
    key: "alldata",
    name: "AllData Repair",
    envVars: ["ALLDATA_USERNAME", "ALLDATA_PASSWORD"],
    required: false,
    description: "Procedures, torque specs, wiring diagrams",
  },
  {
    key: "identifix",
    name: "Identifix Direct-Hit",
    envVars: ["IDENTIFIX_USERNAME", "IDENTIFIX_PASSWORD"],
    required: false,
    description: "Success-rated fixes, misdiagnosis warnings",
  },
  {
    key: "prodemand",
    name: "ProDemand / Mitchell 1",
    envVars: ["PRODEMAND_USERNAME", "PRODEMAND_PASSWORD"],
    required: false,
    description: "Real Fixes, labor times, parts info, TAPE API",
  },
  {
    key: "partstech_api",
    name: "PartsTech (API)",
    envVars: ["PARTSTECH_API_KEY"],
    required: false,
    description: "Parts search and pricing via API",
  },
  {
    key: "partstech_browser",
    name: "PartsTech (Browser)",
    envVars: ["PARTSTECH_URL", "PARTSTECH_USERNAME"],
    required: false,
    description: "Parts ordering via browser automation",
  },
  {
    key: "autoleap",
    name: "AutoLeap",
    envVars: ["AUTOLEAP_PARTNER_ID", "AUTOLEAP_AUTH_KEY"],
    required: false,
    description: "Estimate creation, repair history, customer management",
  },
  {
    key: "ari",
    name: "ARI Labor Guides",
    envVars: ["ARI_URL"],
    required: false,
    description: "Labor time lookups via browser automation",
  },
];

// --- Onboarding ---

/**
 * Create a new shop in Supabase and set up initial config.
 *
 * @param {object} params
 * @param {string} params.name - Shop display name (e.g. "Mike's Auto Repair")
 * @param {string} params.slug - URL-safe identifier (e.g. "mikes-auto")
 * @param {string} [params.ownerEmail] - Shop owner's email
 * @param {object} [params.settings] - Override default settings
 * @param {string[]} [params.platforms] - Platform keys to enable
 * @returns {object} Created shop record or { error }
 */
async function onboardShop({ name, slug, ownerEmail, settings, platforms }) {
  if (!name || !slug) {
    return { error: "Shop name and slug are required" };
  }

  // Validate slug format
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug) || slug.length < 3) {
    return { error: "Slug must be lowercase alphanumeric with hyphens, min 3 chars (e.g. 'mikes-auto')" };
  }

  console.log(`${LOG} Onboarding new shop: "${name}" (${slug})`);

  const supabase = await getSupabase();

  // Check for duplicate slug
  const { data: existing } = await supabase
    .from("shops")
    .select("id")
    .eq("slug", slug)
    .single();

  if (existing) {
    return { error: `Slug "${slug}" is already taken` };
  }

  // Merge settings with defaults
  const mergedSettings = { ...DEFAULT_SETTINGS, ...(settings || {}) };

  // Validate platform keys
  const validPlatformKeys = PLATFORMS.map((p) => p.key);
  const enabledPlatforms = (platforms || []).filter((p) => validPlatformKeys.includes(p));

  const { data: shop, error } = await supabase
    .from("shops")
    .insert({
      name,
      slug,
      owner_email: ownerEmail || null,
      settings: mergedSettings,
      platforms_enabled: enabledPlatforms,
    })
    .select()
    .single();

  if (error) {
    console.error(`${LOG} Onboard failed: ${error.message}`);
    return { error: error.message };
  }

  console.log(`${LOG} Shop created: ${shop.id} (${shop.name})`);

  return {
    shop,
    envTemplate: generateEnvTemplate(shop.id, enabledPlatforms),
    nextSteps: buildNextSteps(enabledPlatforms),
  };
}

/**
 * Validate which platforms have credentials configured in env vars.
 *
 * Does NOT test live connectivity — just checks if the required
 * env vars are present. For live validation, the individual skills
 * handle auth on first use.
 *
 * @param {string[]} [platformKeys] - Specific platforms to check (default: all)
 * @returns {object} { configured: [...], missing: [...] }
 */
function validatePlatformAccess(platformKeys) {
  const toCheck = platformKeys
    ? PLATFORMS.filter((p) => platformKeys.includes(p.key))
    : PLATFORMS;

  const configured = [];
  const missing = [];

  for (const platform of toCheck) {
    const missingVars = platform.envVars.filter((v) => !process.env[v]);

    if (missingVars.length === 0) {
      configured.push({
        key: platform.key,
        name: platform.name,
        status: "ready",
      });
    } else {
      missing.push({
        key: platform.key,
        name: platform.name,
        missingVars,
        description: platform.description,
      });
    }
  }

  console.log(`${LOG} Platform check: ${configured.length} configured, ${missing.length} missing`);

  return { configured, missing };
}

/**
 * Generate an env var template for a shop's enabled platforms.
 *
 * @param {string} shopId - Shop UUID
 * @param {string[]} platformKeys - Enabled platform keys
 * @returns {string} Env var template text
 */
function generateEnvTemplate(shopId, platformKeys) {
  const lines = [
    "# SAM — Shop Environment Variables",
    `# Shop ID: ${shopId}`,
    `# Generated: ${new Date().toISOString().split("T")[0]}`,
    "",
    "# --- Supabase (Required) ---",
    "SUPABASE_URL=",
    "SUPABASE_ANON_KEY=",
    "",
    "# --- Claude AI (Required) ---",
    "ANTHROPIC_API_KEY=",
    "",
  ];

  const enabledPlatforms = PLATFORMS.filter((p) => platformKeys.includes(p.key));

  if (enabledPlatforms.length > 0) {
    lines.push("# --- Platform Credentials ---");

    for (const platform of enabledPlatforms) {
      lines.push(`# ${platform.name} — ${platform.description}`);
      for (const envVar of platform.envVars) {
        lines.push(`${envVar}=`);
      }
      lines.push("");
    }
  }

  lines.push("# --- Optional ---");
  lines.push("SHOP_ID=" + shopId);
  lines.push("");

  return lines.join("\n");
}

/**
 * Build next-steps checklist for a newly onboarded shop.
 *
 * @param {string[]} platformKeys
 * @returns {string[]} Ordered list of next steps
 */
function buildNextSteps(platformKeys) {
  const steps = [
    "Set SUPABASE_URL and SUPABASE_ANON_KEY in your environment",
    "Set ANTHROPIC_API_KEY for Claude AI diagnostics",
  ];

  const enabledPlatforms = PLATFORMS.filter((p) => platformKeys.includes(p.key));
  for (const p of enabledPlatforms) {
    steps.push(`Set ${p.envVars.join(" and ")} for ${p.name}`);
  }

  steps.push("Set SHOP_ID to your shop UUID in the deployment environment");
  steps.push("Send a test message to SAM to verify the setup");

  return steps;
}

/**
 * Deactivate a shop (soft delete).
 *
 * @param {string} shopId
 * @returns {object} Updated shop record or { error }
 */
async function deactivateShop(shopId) {
  const shop = await getShopById(shopId);
  if (!shop) {
    return { error: `Shop not found: ${shopId}` };
  }

  const supabase = await getSupabase();

  const { data, error } = await supabase
    .from("shops")
    .update({
      active: false,
      updated_at: new Date().toISOString(),
    })
    .eq("id", shop.id)
    .select()
    .single();

  if (error) {
    console.error(`${LOG} Deactivate failed: ${error.message}`);
    return { error: error.message };
  }

  console.log(`${LOG} Shop deactivated: ${shop.name}`);
  return data;
}

module.exports = {
  onboardShop,
  validatePlatformAccess,
  generateEnvTemplate,
  deactivateShop,
  PLATFORMS,
};
