/**
 * Identifix Direct-Hit — Browser Automation via OpenClaw CDP
 *
 * Automates Identifix (identifix.com) to search Direct-Hit for:
 *   - Known fixes ranked by success rate
 *   - Community-reported fixes with parts and labor
 *   - Misdiagnosis warnings
 *   - Related symptom clusters
 *
 * No public API available — uses browser automation exclusively.
 * Uses the shared browser module for all OpenClaw interactions.
 *
 * Main exports: searchDirectHit(), login()
 */

const browser = require("../../shared/browser");

// --- Config ---
const IDENTIFIX_URL = process.env.IDENTIFIX_URL || "https://www.identifix.com";
const IDENTIFIX_USERNAME = process.env.IDENTIFIX_USERNAME;
const IDENTIFIX_PASSWORD = process.env.IDENTIFIX_PASSWORD;
const LOG = "[identifix]";

// --- Login ---

/**
 * Ensure we're logged in to Identifix.
 * Reuses session cookies when available.
 *
 * @returns {{ success: boolean, error?: string }}
 */
async function login() {
  return browser.ensureLoggedIn(
    IDENTIFIX_URL,
    IDENTIFIX_USERNAME,
    IDENTIFIX_PASSWORD,
    LOG,
    ["direct-hit", "vehicle", "hotline", "community"]
  );
}

// --- Result Extraction ---

/**
 * Extract known fixes from the Direct-Hit results page.
 *
 * Direct-Hit typically shows a table/list of fixes with:
 *   - Fix description
 *   - Success rate (percentage)
 *   - Parts replaced
 *   - Labor hours
 *   - Number of confirmed reports
 *
 * @returns {Array<{description: string, successRate: number|null, partsReplaced: string[], laborHours: number|null, confirmedCount: number|null}>}
 */
function extractKnownFixes() {
  try {
    const elements = browser.getPageElements();
    const fixes = [];

    // Look for fix descriptions — typically longer text entries
    const texts = browser.extractTextContent(elements, 20);

    const percentPattern = /(\d{1,3})%/;
    const hoursPattern = /(\d{1,2}\.?\d*)\s*(?:hrs?|hours?)/i;
    const countPattern = /(\d+)\s*(?:confirmed|reports?|fixes)/i;

    // Group adjacent elements into fix entries
    let currentFix = null;

    for (const el of elements) {
      const text = el.text;
      const textLower = text.toLowerCase();

      // Detect start of a new fix entry
      // Identifix fixes often start with a symptom or cause description
      if (text.length > 30 && !textLower.includes("search") && !textLower.includes("vehicle")) {
        if (currentFix) fixes.push(currentFix);
        currentFix = {
          description: text,
          successRate: null,
          partsReplaced: [],
          laborHours: null,
          confirmedCount: null,
        };
        continue;
      }

      if (!currentFix) continue;

      // Extract success rate
      const percentMatch = text.match(percentPattern);
      if (percentMatch && !currentFix.successRate) {
        const rate = parseInt(percentMatch[1], 10);
        if (rate >= 1 && rate <= 100) {
          currentFix.successRate = rate;
        }
        continue;
      }

      // Extract labor hours
      const hoursMatch = text.match(hoursPattern);
      if (hoursMatch && !currentFix.laborHours) {
        currentFix.laborHours = parseFloat(hoursMatch[1]);
        continue;
      }

      // Extract confirmed count
      const countMatch = text.match(countPattern);
      if (countMatch && !currentFix.confirmedCount) {
        currentFix.confirmedCount = parseInt(countMatch[1], 10);
        continue;
      }

      // Extract parts (shorter text entries near a fix)
      if (text.length > 5 && text.length < 60 && !textLower.includes("search")) {
        if (textLower.includes("replace") || textLower.includes("sensor") ||
            textLower.includes("valve") || textLower.includes("gasket") ||
            textLower.includes("solenoid") || textLower.includes("pump") ||
            textLower.includes("module") || textLower.includes("coil") ||
            textLower.includes("plug") || textLower.includes("filter")) {
          currentFix.partsReplaced.push(text);
        }
      }
    }

    // Push the last fix
    if (currentFix) fixes.push(currentFix);

    return fixes;
  } catch (err) {
    console.error(`${LOG} Fix extraction failed: ${err.message}`);
    return [];
  }
}

/**
 * Extract misdiagnosis warnings from the results page.
 * Identifix sometimes flags common misdiagnoses.
 *
 * @returns {string[]} Array of warning texts
 */
function extractMisdiagnosisWarnings() {
  try {
    const elements = browser.getPageElements();
    const warnings = [];

    for (const el of elements) {
      const textLower = el.text.toLowerCase();
      if (textLower.includes("misdiagnos") || textLower.includes("common mistake") ||
          textLower.includes("often confused") || textLower.includes("frequently misdiagnosed") ||
          textLower.includes("do not replace") || textLower.includes("check first")) {
        warnings.push(el.text);
      }
    }

    return warnings;
  } catch {
    return [];
  }
}

// --- Main Search ---

/**
 * Search Direct-Hit for known fixes.
 *
 * Flow:
 *   1. Login (session check)
 *   2. Select vehicle (YMME)
 *   3. Navigate to Direct-Hit section
 *   4. Enter DTC or symptom
 *   5. Extract results table
 *   6. Identify misdiagnosis warnings
 *   7. Return structured data
 *
 * @param {object} params
 * @param {string|number} params.year
 * @param {string} params.make
 * @param {string} params.model
 * @param {string} [params.engine]
 * @param {string} params.query - DTC code or symptom description
 * @returns {object} Known fixes with success rates
 */
async function searchDirectHit({ year, make, model, engine, query }) {
  if (!IDENTIFIX_USERNAME || !IDENTIFIX_PASSWORD) {
    console.log(`${LOG} Identifix not configured (missing credentials)`);
    return { error: "Identifix not configured — set IDENTIFIX_USERNAME and IDENTIFIX_PASSWORD" };
  }

  console.log(`${LOG} Searching Direct-Hit: ${year} ${make} ${model} — ${query}`);

  // Step 1: Login
  const loginResult = await login();
  if (!loginResult.success) {
    console.error(`${LOG} Login failed: ${loginResult.error}`);
    return {
      source: "Identifix Direct-Hit",
      vehicle: { year, make, model, engine },
      query,
      knownFixes: [],
      error: loginResult.error,
    };
  }

  // Step 2: Select vehicle
  const vehicleResult = browser.selectVehicle({ year, make, model, engine }, LOG);
  if (!vehicleResult.success) {
    console.error(`${LOG} Vehicle selection failed: ${vehicleResult.error}`);
    return {
      source: "Identifix Direct-Hit",
      vehicle: { year, make, model, engine },
      query,
      knownFixes: [],
      error: `Vehicle selection failed: ${vehicleResult.error}`,
    };
  }

  // Step 3: Navigate to Direct-Hit
  const elements = browser.getPageElements();
  let directHitRef = browser.findRef(elements, "direct-hit");
  if (!directHitRef) directHitRef = browser.findRef(elements, "direct hit");
  if (!directHitRef) directHitRef = browser.findRef(elements, "known fixes");
  if (!directHitRef) directHitRef = browser.findRef(elements, "community");

  if (directHitRef) {
    browser.clickRef(directHitRef);
    browser.waitForLoad();
    console.log(`${LOG} Navigated to Direct-Hit`);
  }

  // Step 4: Search for DTC or symptom
  const searchResult = browser.performSearch(query, [
    "search", "dtc", "symptom", "keyword", "complaint", "find",
  ]);
  if (!searchResult.success) {
    console.log(`${LOG} Search input not found — results may be filtered by vehicle`);
  }

  // Step 5: Extract results
  const knownFixes = extractKnownFixes();
  const misdiagnosisWarnings = extractMisdiagnosisWarnings();

  // Identify top fix (highest success rate with confirmed reports)
  let topFix = null;
  if (knownFixes.length > 0) {
    const ranked = [...knownFixes]
      .filter((f) => f.successRate !== null)
      .sort((a, b) => (b.successRate || 0) - (a.successRate || 0));
    topFix = ranked[0] || knownFixes[0];
  }

  console.log(`${LOG} Results: ${knownFixes.length} fixes, ${misdiagnosisWarnings.length} warnings`);

  return {
    source: "Identifix Direct-Hit",
    vehicle: { year, make, model, engine },
    query,
    knownFixes,
    misdiagnosisWarnings,
    topFix,
    fixCount: knownFixes.length,
  };
}

module.exports = {
  login,
  searchDirectHit,
  // Helpers for testing
  extractKnownFixes,
  extractMisdiagnosisWarnings,
};
