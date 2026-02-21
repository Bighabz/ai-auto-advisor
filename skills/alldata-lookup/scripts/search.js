/**
 * AllData Repair — Browser Automation via OpenClaw CDP
 *
 * Automates AllData Repair (repair.alldata.com) to search for:
 *   - OEM repair procedures with step-by-step instructions
 *   - Technical Service Bulletins (TSBs)
 *   - Diagnostic trouble code info
 *   - Wiring diagrams (screenshot capture)
 *   - Torque specs, fluid capacities, special tools
 *   - Labor time estimates
 *
 * Uses the shared browser module for all OpenClaw interactions.
 *
 * Main exports: search(), captureScreenshots(), login()
 */

const path = require("path");
const { execFileSync } = require("child_process");
const browser = require("../../shared/browser");

// --- Config ---
const ALLDATA_URL = process.env.ALLDATA_URL || "https://my.alldata.com";
const ALLDATA_USERNAME = process.env.ALLDATA_USERNAME;
const ALLDATA_PASSWORD = process.env.ALLDATA_PASSWORD;
const LOG = "[alldata]";
const SCREENSHOT_DIR = process.env.ALLDATA_SCREENSHOT_DIR || "/tmp/alldata-screenshots";

// --- Login ---

/**
 * Ensure we're logged in to AllData.
 * Reuses session cookies when available.
 *
 * @returns {{ success: boolean, error?: string }}
 */
async function login() {
  return browser.ensureLoggedIn(
    ALLDATA_URL,
    ALLDATA_USERNAME,
    ALLDATA_PASSWORD,
    LOG,
    ["vehicle", "repair", "procedures", "tsb"]
  );
}

// --- Navigation Helpers ---

/**
 * Navigate to a specific section within AllData.
 * After vehicle is selected, AllData shows sections like:
 * Procedures, TSBs, Wiring, Maintenance, etc.
 *
 * @param {string} section - Section name to navigate to
 * @returns {boolean} true if section was found and clicked
 */
function navigateToSection(section) {
  try {
    const elements = browser.getPageElements();

    // Try exact section match first
    let sectionRef = browser.findRef(elements, section);

    // Try common section aliases
    if (!sectionRef) {
      const aliases = {
        procedures: ["repair procedures", "r&r", "remove and replace", "service"],
        tsb: ["technical service bulletin", "tsbs", "bulletin"],
        wiring: ["wiring diagram", "electrical", "circuit"],
        maintenance: ["maintenance schedule", "scheduled maintenance"],
        dtc: ["diagnostic trouble code", "trouble code", "code"],
        specs: ["specifications", "torque", "capacities"],
      };

      const sectionLower = section.toLowerCase();
      for (const [key, alts] of Object.entries(aliases)) {
        if (sectionLower.includes(key)) {
          for (const alt of alts) {
            sectionRef = browser.findRef(elements, alt);
            if (sectionRef) break;
          }
          if (sectionRef) break;
        }
      }
    }

    if (sectionRef) {
      browser.clickRef(sectionRef);
      browser.waitForLoad();
      console.log(`${LOG} Navigated to section: ${section}`);
      return true;
    }

    return false;
  } catch (err) {
    console.error(`${LOG} Section navigation failed: ${err.message}`);
    return false;
  }
}

/**
 * Determine which AllData section to search based on the query.
 *
 * @param {string} query
 * @returns {string} Section name to navigate to
 */
function classifyQuery(query) {
  const q = query.toLowerCase();

  if (q.match(/[pbcu]\d{4}/i)) return "dtc";
  if (q.includes("tsb") || q.includes("bulletin") || q.includes("recall")) return "tsb";
  if (q.includes("wiring") || q.includes("diagram") || q.includes("circuit")) return "wiring";
  if (q.includes("torque") || q.includes("spec") || q.includes("capacity")) return "specs";
  if (q.includes("maintenance") || q.includes("schedule") || q.includes("interval")) return "maintenance";

  // Default to repair procedures
  return "procedures";
}

// --- Result Extraction ---

/**
 * Extract procedure information from the current AllData page.
 *
 * Looks for procedure steps, torque specs, special tools, and notes
 * in the page snapshot.
 *
 * @returns {object} Extracted procedure data
 */
function extractProcedureData() {
  try {
    const elements = browser.getPageElements();
    const texts = browser.extractTextContent(elements, 15);

    // Extract structured data from page text
    const procedures = [];
    const torqueSpecs = {};
    const specialTools = [];
    const notes = [];
    const relatedTSBs = [];

    for (const text of texts) {
      const textLower = text.toLowerCase();

      // Torque specs: look for patterns like "40 ft-lb", "55 N·m", etc.
      const torqueMatch = text.match(/(.+?):\s*(\d+[\s-]*(?:ft[\s-]*lb|n[·.]?m|lb[\s-]*ft))/i);
      if (torqueMatch) {
        torqueSpecs[torqueMatch[1].trim()] = torqueMatch[2].trim();
        continue;
      }

      // Special tools
      if (textLower.includes("special tool") || textLower.includes("required tool")) {
        specialTools.push(text);
        continue;
      }

      // TSB references
      if (textLower.includes("tsb") || textLower.match(/bulletin\s*#?\s*\d/)) {
        relatedTSBs.push(text);
        continue;
      }

      // Notes/warnings/cautions
      if (textLower.includes("caution") || textLower.includes("warning") || textLower.includes("note:")) {
        notes.push(text);
        continue;
      }

      // Steps (numbered text or procedure descriptions)
      if (text.match(/^\d+[.)]\s/) || text.length > 30) {
        procedures.push(text);
      }
    }

    return { procedures, torqueSpecs, specialTools, notes, relatedTSBs };
  } catch (err) {
    console.error(`${LOG} Procedure extraction failed: ${err.message}`);
    return { procedures: [], torqueSpecs: {}, specialTools: [], notes: [], relatedTSBs: [] };
  }
}

/**
 * Extract labor time from the current page.
 *
 * @returns {{ hours: number, source: string }|null}
 */
function extractLaborTime() {
  try {
    const elements = browser.getPageElements();
    const laborElements = browser.findAllRefs(elements, "labor");
    const timeElements = browser.findAllRefs(elements, "hour");

    const hourPattern = /(\d{1,2}\.?\d*)\s*(?:hrs?|hours?)/i;

    for (const el of [...laborElements, ...timeElements]) {
      const match = el.text.match(hourPattern);
      if (match) {
        const hours = parseFloat(match[1]);
        if (hours >= 0.1 && hours <= 50.0) {
          return { hours, source: "alldata" };
        }
      }
    }

    return null;
  } catch {
    return null;
  }
}

// --- Main Search ---

/**
 * Search AllData for a vehicle + query.
 *
 * Flow:
 *   1. Login (session check)
 *   2. Select vehicle (VIN or YMME)
 *   3. Classify query to determine section
 *   4. Navigate to section
 *   5. Search for query
 *   6. Extract procedure data
 *   7. Capture screenshots
 *   8. Return structured results
 *
 * @param {object} params
 * @param {string} [params.vin] - Vehicle VIN
 * @param {string|number} params.year
 * @param {string} params.make
 * @param {string} params.model
 * @param {string} [params.engine]
 * @param {string} params.query - DTC code, symptom, or system
 * @returns {object} Structured AllData results
 */
async function search({ vin, year, make, model, engine, query }) {
  if (!ALLDATA_USERNAME || !ALLDATA_PASSWORD) {
    console.log(`${LOG} AllData not configured (missing credentials)`);
    return { error: "AllData not configured — set ALLDATA_USERNAME and ALLDATA_PASSWORD" };
  }

  console.log(`${LOG} Searching: ${year} ${make} ${model} ${engine || ""} — ${query}`);

  // Step 1: Login
  const loginResult = await login();
  if (!loginResult.success) {
    console.error(`${LOG} Login failed: ${loginResult.error}`);
    return {
      source: "AllData Repair",
      vehicle: { vin, year, make, model, engine },
      query,
      results: [],
      screenshots: [],
      error: loginResult.error,
    };
  }

  // Step 2: Select vehicle
  const vehicleResult = browser.selectVehicle({ vin, year, make, model, engine }, LOG);
  if (!vehicleResult.success) {
    console.error(`${LOG} Vehicle selection failed: ${vehicleResult.error}`);
    return {
      source: "AllData Repair",
      vehicle: { vin, year, make, model, engine },
      query,
      results: [],
      screenshots: [],
      error: `Vehicle selection failed: ${vehicleResult.error}`,
    };
  }

  // Step 3: Classify query and navigate to section
  const section = classifyQuery(query);
  console.log(`${LOG} Query classified as: ${section}`);
  navigateToSection(section);

  // Step 4: Search within the section
  const searchResult = browser.performSearch(query, ["search", "find", "keyword", "dtc", "symptom"]);
  if (!searchResult.success) {
    console.log(`${LOG} Search input not found — section may already show relevant results`);
  }

  // Step 5: Extract data from results page
  const extracted = extractProcedureData();
  const laborTime = extractLaborTime();

  // Step 6: Capture screenshots of the results
  let screenshots = [];
  try {
    screenshots = await captureScreenshots();
  } catch (err) {
    console.error(`${LOG} Screenshot capture failed: ${err.message}`);
  }

  console.log(`${LOG} Results: ${extracted.procedures.length} procedure steps, ${Object.keys(extracted.torqueSpecs).length} torque specs, ${screenshots.length} screenshots`);

  return {
    source: "AllData Repair",
    vehicle: { vin, year, make, model, engine },
    query,
    section,
    procedures: extracted.procedures,
    torqueSpecs: extracted.torqueSpecs,
    specialTools: extracted.specialTools,
    notes: extracted.notes,
    relatedTSBs: extracted.relatedTSBs,
    laborTime,
    screenshots,
    diagrams_available: screenshots.length > 0,
  };
}

// --- Screenshots ---

/**
 * Capture screenshots of the current AllData page.
 * Captures both the current view and a full-page version.
 *
 * @param {string} [outputDir] - Directory to save screenshots
 * @returns {string[]} Array of screenshot file paths
 */
async function captureScreenshots(outputDir = SCREENSHOT_DIR) {
  try {
    execFileSync("mkdir", ["-p", outputDir], { encoding: "utf-8" });
  } catch {
    // Directory may already exist on Windows — try alternative
    try {
      require("fs").mkdirSync(outputDir, { recursive: true });
    } catch {
      // Ignore — directory likely exists
    }
  }

  const timestamp = Date.now();
  const screenshots = [];

  try {
    // Current view screenshot
    const viewPath = path.join(outputDir, `alldata-view-${timestamp}.png`);
    browser.captureScreenshot(viewPath);
    screenshots.push(viewPath);
    console.log(`${LOG} Screenshot: ${viewPath}`);
  } catch (err) {
    console.error(`${LOG} View screenshot failed: ${err.message}`);
  }

  try {
    // Full page screenshot (captures diagrams below the fold)
    const fullPath = path.join(outputDir, `alldata-full-${timestamp}.png`);
    browser.captureFullPageScreenshot(fullPath);
    screenshots.push(fullPath);
    console.log(`${LOG} Full-page screenshot: ${fullPath}`);
  } catch (err) {
    console.error(`${LOG} Full-page screenshot failed: ${err.message}`);
  }

  return screenshots;
}

module.exports = {
  login,
  search,
  captureScreenshots,
  // Helpers for testing
  classifyQuery,
  navigateToSection,
  extractProcedureData,
  extractLaborTime,
};
