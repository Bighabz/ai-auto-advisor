/**
 * ProDemand / Mitchell 1 — Browser Automation + TAPE API
 *
 * Searches ProDemand for:
 *   - Real Fixes (symptom → confirmed cause → repair)
 *   - Labor times per operation
 *   - OEM and aftermarket part numbers
 *   - Repair procedures
 *   - Fluid capacities and specifications
 *
 * Dual mode:
 *   - TAPE API (preferred): Direct API access if partner token available
 *   - Browser automation (fallback): OpenClaw CDP for shops without API access
 *
 * Uses the shared browser module for all OpenClaw interactions.
 *
 * Main exports: search(), hasTapeApi()
 */

const browser = require("../../shared/browser");

// --- Config ---
const PRODEMAND_URL = process.env.PRODEMAND_URL || "https://prodemand.mitchell1.com";
const PRODEMAND_USERNAME = process.env.PRODEMAND_USERNAME;
const PRODEMAND_PASSWORD = process.env.PRODEMAND_PASSWORD;
const PRODEMAND_TAPE_TOKEN = process.env.PRODEMAND_TAPE_TOKEN || null;
const LOG = "[prodemand]";

// --- TAPE API (Partner Access) ---

/**
 * Check if TAPE API is available (partner-level access).
 * @returns {boolean}
 */
function hasTapeApi() {
  return !!PRODEMAND_TAPE_TOKEN;
}

/**
 * Search via TAPE API (if partner access granted).
 *
 * @param {object} params
 * @param {string} params.vin - Vehicle VIN (required for TAPE)
 * @param {string} params.query - Search term
 * @param {string} [params.intent] - TAPE intent: Labor, Parts, Fluids, Maintenance, Wiring, TSB, DTC
 * @returns {object} API response
 */
async function searchViaTape({ vin, query, intent }) {
  const fetch = (await import("node-fetch")).default;

  console.log(`${LOG} TAPE API: ${intent || "Labor"} — ${query}`);

  const response = await fetch(`${PRODEMAND_URL}/tape/api/launch`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${PRODEMAND_TAPE_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      vin,
      intent: intent || "Labor",
      searchTerm: query,
    }),
  });

  if (!response.ok) {
    throw new Error(`TAPE API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

// --- Browser Automation (Fallback) ---

/**
 * Ensure we're logged in to ProDemand.
 *
 * @returns {{ success: boolean, error?: string }}
 */
async function login() {
  return browser.ensureLoggedIn(
    PRODEMAND_URL,
    PRODEMAND_USERNAME,
    PRODEMAND_PASSWORD,
    LOG,
    ["real fix", "labor", "vehicle", "repair", "parts"]
  );
}

/**
 * Extract Real Fixes from the ProDemand results page.
 *
 * Real Fixes show: symptom → confirmed cause → repair action
 * with confidence indicators based on community reporting.
 *
 * @returns {Array<{symptom: string, cause: string, repair: string, confidence: string|null}>}
 */
function extractRealFixes() {
  try {
    const elements = browser.getPageElements();
    const fixes = [];

    let currentFix = null;

    for (const el of elements) {
      const text = el.text;
      const textLower = text.toLowerCase();

      // Detect Real Fix entries — typically start with symptom descriptions
      if (textLower.includes("symptom") || textLower.includes("complaint") ||
          textLower.includes("condition")) {
        if (currentFix && currentFix.symptom) fixes.push(currentFix);
        currentFix = { symptom: text, cause: null, repair: null, confidence: null };
        continue;
      }

      if (!currentFix) continue;

      // Cause/diagnosis
      if ((textLower.includes("cause") || textLower.includes("diagnos") ||
           textLower.includes("found") || textLower.includes("confirmed")) && !currentFix.cause) {
        currentFix.cause = text;
        continue;
      }

      // Repair action
      if ((textLower.includes("repair") || textLower.includes("replace") ||
           textLower.includes("fix") || textLower.includes("install")) && !currentFix.repair) {
        currentFix.repair = text;
        continue;
      }

      // Confidence indicator
      if (textLower.includes("high confidence") || textLower.includes("medium confidence") ||
          textLower.includes("low confidence")) {
        currentFix.confidence = text;
      }
    }

    if (currentFix && currentFix.symptom) fixes.push(currentFix);
    return fixes;
  } catch (err) {
    console.error(`${LOG} Real Fix extraction failed: ${err.message}`);
    return [];
  }
}

/**
 * Extract labor times from the current ProDemand page.
 *
 * @returns {Array<{procedure: string, hours: number, source: string}>}
 */
function extractLaborTimes() {
  try {
    const elements = browser.getPageElements();
    const laborTimes = [];
    const hourPattern = /(\d{1,2}\.?\d*)\s*(?:hrs?|hours?)/i;

    for (const el of elements) {
      const match = el.text.match(hourPattern);
      if (match) {
        const hours = parseFloat(match[1]);
        if (hours >= 0.1 && hours <= 50.0) {
          laborTimes.push({
            procedure: el.text,
            hours,
            source: "prodemand",
          });
        }
      }
    }

    return laborTimes;
  } catch (err) {
    console.error(`${LOG} Labor time extraction failed: ${err.message}`);
    return [];
  }
}

/**
 * Extract part numbers from the current ProDemand page.
 *
 * @returns {Array<{name: string, oemNumber: string|null, position: string|null}>}
 */
function extractPartNumbers() {
  try {
    const elements = browser.getPageElements();
    const parts = [];

    // OEM part numbers typically follow patterns like: XX-XXXX-XXXX or XXXXXXXX
    const oemPattern = /\b(\d{2}[-\s]?\d{3,5}[-\s]?\d{2,5})\b/;

    for (const el of elements) {
      const match = el.text.match(oemPattern);
      if (match && el.text.length > 10) {
        parts.push({
          name: el.text,
          oemNumber: match[1],
          position: null,
        });
      }
    }

    return parts;
  } catch (err) {
    console.error(`${LOG} Part number extraction failed: ${err.message}`);
    return [];
  }
}

/**
 * Search ProDemand via browser automation.
 *
 * Flow:
 *   1. Login (session check)
 *   2. Select vehicle (VIN or YMME)
 *   3. Search for query
 *   4. Extract Real Fixes
 *   5. Extract labor times
 *   6. Extract part numbers
 *   7. Return structured results
 *
 * @param {object} params
 * @param {string} [params.vin]
 * @param {string|number} params.year
 * @param {string} params.make
 * @param {string} params.model
 * @param {string} [params.engine]
 * @param {string} params.query
 * @returns {object} Structured ProDemand results
 */
async function searchViaBrowser({ vin, year, make, model, engine, query }) {
  console.log(`${LOG} Browser search: ${year} ${make} ${model} — ${query}`);

  // Step 1: Login
  const loginResult = await login();
  if (!loginResult.success) {
    console.error(`${LOG} Login failed: ${loginResult.error}`);
    return {
      source: "ProDemand (browser)",
      vehicle: { vin, year, make, model, engine },
      query,
      realFixes: [],
      laborTimes: [],
      partNumbers: [],
      error: loginResult.error,
    };
  }

  // Step 2: Select vehicle
  const vehicleResult = browser.selectVehicle({ vin, year, make, model, engine }, LOG);
  if (!vehicleResult.success) {
    console.error(`${LOG} Vehicle selection failed: ${vehicleResult.error}`);
    return {
      source: "ProDemand (browser)",
      vehicle: { vin, year, make, model, engine },
      query,
      realFixes: [],
      laborTimes: [],
      partNumbers: [],
      error: `Vehicle selection failed: ${vehicleResult.error}`,
    };
  }

  // Step 3: Navigate to Real Fixes section if available
  const elements = browser.getPageElements();
  let realFixRef = browser.findRef(elements, "real fix");
  if (!realFixRef) realFixRef = browser.findRef(elements, "real fixes");
  if (!realFixRef) realFixRef = browser.findRef(elements, "confirmed fix");

  if (realFixRef) {
    browser.clickRef(realFixRef);
    browser.waitForLoad("networkidle");
    console.log(`${LOG} Navigated to Real Fixes`);
  }

  // Step 4: Search for query
  const searchResult = browser.performSearch(query, [
    "search", "find", "keyword", "dtc", "symptom", "component",
  ]);
  if (!searchResult.success) {
    console.log(`${LOG} Search input not found — trying main search`);
  }

  // Step 5: Extract data
  const realFixes = extractRealFixes();
  const laborTimes = extractLaborTimes();
  const partNumbers = extractPartNumbers();

  console.log(`${LOG} Results: ${realFixes.length} Real Fixes, ${laborTimes.length} labor times, ${partNumbers.length} part numbers`);

  return {
    source: "ProDemand (browser)",
    vehicle: { vin, year, make, model, engine },
    query,
    realFixes,
    laborTimes,
    partNumbers,
  };
}

// --- Main Router ---

/**
 * Main search function — tries TAPE API first, falls back to browser.
 *
 * @param {object} params
 * @param {string} [params.vin]
 * @param {string|number} [params.year]
 * @param {string} [params.make]
 * @param {string} [params.model]
 * @param {string} [params.engine]
 * @param {string} params.query
 * @param {string} [params.intent] - TAPE intent (Labor, Parts, etc.)
 * @returns {object} Search results from TAPE API or browser
 */
async function search(params) {
  if (!PRODEMAND_USERNAME && !PRODEMAND_PASSWORD && !PRODEMAND_TAPE_TOKEN) {
    console.log(`${LOG} ProDemand not configured (missing credentials)`);
    return { error: "ProDemand not configured — set PRODEMAND_USERNAME/PRODEMAND_PASSWORD or PRODEMAND_TAPE_TOKEN" };
  }

  // Try TAPE API first (faster, more structured)
  if (hasTapeApi() && params.vin) {
    console.log(`${LOG} Using TAPE API...`);
    try {
      return await searchViaTape(params);
    } catch (err) {
      console.error(`${LOG} TAPE API failed: ${err.message} — falling back to browser`);
    }
  }

  // Fallback to browser automation
  console.log(`${LOG} Using browser automation...`);
  return searchViaBrowser(params);
}

module.exports = {
  search,
  hasTapeApi,
  login,
  // Helpers for testing
  searchViaTape,
  searchViaBrowser,
  extractRealFixes,
  extractLaborTimes,
  extractPartNumbers,
};
