/**
 * ARI Labor Time Lookup — Browser Automation via OpenClaw CDP
 *
 * Automates the ARI Free Labor Guide at web.ari.app to look up
 * labor times for a given vehicle + repair procedure.
 *
 * Uses OpenClaw's managed browser (Chrome DevTools Protocol) with
 * the snapshot system for AI-driven page navigation.
 *
 * Results are cached in the Supabase `labor_cache` table with a
 * 90-day TTL to minimize repeated lookups.
 *
 * Main export: lookupLaborTime({ year, make, model, procedure })
 */

const { execSync } = require("child_process");
const { getSupabase } = require("../../ai-diagnostics/scripts/embeddings");

// --- Config ---
const ARI_URL = process.env.ARI_URL || "https://web.ari.app";
const CACHE_TTL_DAYS = 90;

// --- Browser Helpers ---

/**
 * Ensure the OpenClaw managed browser is running.
 * Starts it if not already active.
 */
function ensureBrowser() {
  try {
    const status = execSync("openclaw browser --browser-profile openclaw status", {
      encoding: "utf-8",
    });
    if (!status.includes("running")) {
      execSync("openclaw browser --browser-profile openclaw start");
    }
  } catch {
    execSync("openclaw browser --browser-profile openclaw start");
  }
}

/**
 * Take a snapshot of the current browser page.
 * Returns the raw snapshot text output from OpenClaw.
 * @returns {string} Snapshot text
 */
function takeSnapshot() {
  return execSync("openclaw browser --browser-profile openclaw snapshot", {
    encoding: "utf-8",
  });
}

/**
 * Click an element by its snapshot ref number.
 * @param {number|string} ref - The element ref from a snapshot
 */
function clickRef(ref) {
  execSync(`openclaw browser --browser-profile openclaw click ${ref}`, {
    encoding: "utf-8",
  });
}

/**
 * Type text into an element by its snapshot ref number.
 * @param {number|string} ref - The element ref from a snapshot
 * @param {string} text - The text to type
 * @param {boolean} [submit=false] - Whether to press Enter after typing
 */
function typeInRef(ref, text, submit = false) {
  const submitFlag = submit ? " --submit" : "";
  execSync(
    `openclaw browser --browser-profile openclaw type ${ref} "${text}"${submitFlag}`,
    { encoding: "utf-8" }
  );
}

/**
 * Wait for the page to reach a specific load state.
 * @param {string} [state="networkidle"] - Load state to wait for
 */
function waitForLoad(state = "networkidle") {
  execSync(`openclaw browser --browser-profile openclaw wait --load ${state}`, {
    encoding: "utf-8",
  });
}

/**
 * Navigate to a URL in the managed browser.
 * @param {string} url - The URL to open
 */
function navigateTo(url) {
  execSync(`openclaw browser --browser-profile openclaw open "${url}"`, {
    encoding: "utf-8",
  });
}

// --- Snapshot Parsing ---

/**
 * Parse the OpenClaw snapshot text into an array of element objects.
 *
 * Snapshot lines typically look like:
 *   [ref] type "visible text"
 * e.g.:
 *   [12] button "Search"
 *   [23] input "Year"
 *   [45] link "Honda"
 *
 * This parser extracts { ref, type, text } from each line that has
 * a bracketed ref number.
 *
 * @param {string} snapshotText - Raw snapshot output from OpenClaw
 * @returns {Array<{ref: string, type: string, text: string}>} Parsed elements
 */
function parseSnapshot(snapshotText) {
  const elements = [];
  const lines = snapshotText.split("\n");

  for (const line of lines) {
    // Match lines like: [12] button "Search" or [12] input "Year"
    // Also handle lines like: [12] "Some text" (no explicit type)
    const match = line.match(/\[(\d+)\]\s+(?:(\w+)\s+)?["']([^"']*?)["']/);
    if (match) {
      elements.push({
        ref: match[1],
        type: match[2] || "unknown",
        text: match[3],
      });
      continue;
    }

    // Also match lines with unquoted text: [12] button Submit
    const matchUnquoted = line.match(/\[(\d+)\]\s+(\w+)\s+(.+)/);
    if (matchUnquoted) {
      elements.push({
        ref: matchUnquoted[1],
        type: matchUnquoted[2],
        text: matchUnquoted[3].trim(),
      });
    }
  }

  return elements;
}

/**
 * Find the ref for an element by partial text match (case-insensitive).
 *
 * @param {Array<{ref: string, type: string, text: string}>} elements - Parsed snapshot elements
 * @param {string} textMatch - Partial text to search for
 * @returns {string|null} The ref number, or null if not found
 */
function findRef(elements, textMatch) {
  const needle = textMatch.toLowerCase();
  const found = elements.find((el) => el.text.toLowerCase().includes(needle));
  return found ? found.ref : null;
}

/**
 * Find all refs matching a partial text (case-insensitive).
 *
 * @param {Array<{ref: string, type: string, text: string}>} elements - Parsed snapshot elements
 * @param {string} textMatch - Partial text to search for
 * @returns {Array<{ref: string, type: string, text: string}>} Matching elements
 */
function findAllRefs(elements, textMatch) {
  const needle = textMatch.toLowerCase();
  return elements.filter((el) => el.text.toLowerCase().includes(needle));
}

// --- Caching ---

/**
 * Cache a labor lookup result in the Supabase labor_cache table.
 *
 * @param {object} params
 * @param {string} params.vehicle_make - Vehicle make (will be uppercased)
 * @param {string} params.vehicle_model - Vehicle model (will be uppercased)
 * @param {number} params.vehicle_year - Vehicle year
 * @param {string} params.procedure_name - Procedure name from ARI
 * @param {number} params.labor_hours - Labor hours from ARI
 * @param {string} [params.notes] - Additional notes
 * @returns {object} The inserted row, or { error } on failure
 */
async function cacheResult({
  vehicle_make,
  vehicle_model,
  vehicle_year,
  procedure_name,
  labor_hours,
  notes,
}) {
  try {
    const db = getSupabase();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + CACHE_TTL_DAYS * 24 * 60 * 60 * 1000);

    const row = {
      vehicle_make: (vehicle_make || "").toUpperCase(),
      vehicle_model: (vehicle_model || "").toUpperCase(),
      vehicle_year: parseInt(vehicle_year, 10),
      procedure_name: procedure_name,
      labor_hours: parseFloat(labor_hours),
      labor_source: "ari",
      notes: notes || null,
      fetched_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
    };

    const { data, error } = await db
      .from("labor_cache")
      .insert(row)
      .select()
      .single();

    if (error) {
      console.error(`[ari-labor] Cache insert failed: ${error.message}`);
      return { error: `Cache insert failed: ${error.message}` };
    }

    console.log(
      `[ari-labor] Cached: ${row.vehicle_year} ${row.vehicle_make} ${row.vehicle_model} — ${row.procedure_name} (${row.labor_hours}h)`
    );
    return data;
  } catch (err) {
    console.error(`[ari-labor] Cache error (non-fatal): ${err.message}`);
    return { error: `Cache error: ${err.message}` };
  }
}

/**
 * Check the labor_cache for an existing, non-expired result before
 * performing a live browser lookup.
 *
 * @param {string} make - Vehicle make
 * @param {string} model - Vehicle model
 * @param {number|string} year - Vehicle year
 * @param {string} procedure - Procedure name (partial match)
 * @returns {object|null} Cached result or null
 */
async function checkCache(make, model, year, procedure) {
  try {
    const db = getSupabase();
    const { data, error } = await db
      .from("labor_cache")
      .select("labor_hours, procedure_name, notes, labor_source")
      .eq("vehicle_make", (make || "").toUpperCase())
      .eq("vehicle_model", (model || "").toUpperCase())
      .eq("vehicle_year", parseInt(year, 10))
      .ilike("procedure_name", `%${procedure.replace(/%/g, "\\%").replace(/_/g, "\\_")}%`)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    if (error) {
      console.error(`[ari-labor] Cache check failed: ${error.message}`);
      return null;
    }

    if (data) {
      console.log(`[ari-labor] Cache hit: ${data.labor_hours}h (source: ${data.labor_source})`);
    }

    return data || null;
  } catch (err) {
    console.error(`[ari-labor] Cache check error (non-fatal): ${err.message}`);
    return null;
  }
}

// --- Main Lookup ---

/**
 * Look up labor time from ARI Free Labor Guide via browser automation.
 *
 * Flow:
 *   1. Check cache first — return immediately if found
 *   2. Start managed browser if needed
 *   3. Navigate to ARI
 *   4. Select vehicle (year, make, model)
 *   5. Search for procedure
 *   6. Extract labor hours from results
 *   7. Cache the result
 *   8. Return structured data
 *
 * @param {object} params
 * @param {number|string} params.year - Vehicle model year
 * @param {string} params.make - Vehicle make (e.g. "Honda")
 * @param {string} params.model - Vehicle model (e.g. "Civic")
 * @param {string} params.procedure - Procedure name (e.g. "Brake pads - front")
 * @returns {object} { labor_hours, procedure_name, notes, source } or { error }
 */
async function lookupLaborTime({ year, make, model, procedure }) {
  // --- Validate inputs ---
  if (!year || !make || !model || !procedure) {
    return { error: "Missing required fields: year, make, model, and procedure are all required" };
  }

  console.log(`[ari-labor] Looking up: ${year} ${make} ${model} — "${procedure}"`);

  // --- Step 1: Check cache first ---
  const cached = await checkCache(make, model, year, procedure);
  if (cached) {
    console.log(`[ari-labor] Returning cached result`);
    return {
      labor_hours: cached.labor_hours,
      procedure_name: cached.procedure_name,
      notes: cached.notes,
      source: cached.labor_source || "ari",
    };
  }

  console.log(`[ari-labor] Cache miss — performing live ARI lookup`);

  // --- Step 2: Ensure browser is running ---
  try {
    ensureBrowser();
  } catch (err) {
    console.error(`[ari-labor] Failed to start browser: ${err.message}`);
    return { error: `Browser start failed: ${err.message}` };
  }

  // --- Step 3: Navigate to ARI ---
  try {
    navigateTo(ARI_URL);
    waitForLoad("networkidle");
  } catch (err) {
    console.error(`[ari-labor] Navigation failed: ${err.message}`);
    return { error: `ARI navigation failed: ${err.message}` };
  }

  // --- Step 4: Take snapshot and detect page state ---
  let snapshot;
  let elements;

  try {
    snapshot = takeSnapshot();
    elements = parseSnapshot(snapshot);
    console.log(`[ari-labor] Page snapshot: ${elements.length} elements found`);
  } catch (err) {
    console.error(`[ari-labor] Snapshot failed: ${err.message}`);
    return { error: `Snapshot failed: ${err.message}` };
  }

  // --- Step 5: Select vehicle (year, make, model) ---
  try {
    // Look for the Year selector/dropdown
    const yearRef = findRef(elements, "year");
    if (!yearRef) {
      console.error("[ari-labor] Could not find Year selector on ARI page");
      return { error: "ARI lookup failed: could not find Year selector" };
    }

    // Click the year dropdown and type the year
    clickRef(yearRef);
    typeInRef(yearRef, String(year), true);
    waitForLoad("networkidle");

    // Re-snapshot after year selection (refs change after page updates)
    snapshot = takeSnapshot();
    elements = parseSnapshot(snapshot);

    // Look for the Make selector
    const makeRef = findRef(elements, "make");
    if (!makeRef) {
      console.error("[ari-labor] Could not find Make selector on ARI page");
      return { error: "ARI lookup failed: could not find Make selector" };
    }

    clickRef(makeRef);
    typeInRef(makeRef, make, true);
    waitForLoad("networkidle");

    // Re-snapshot after make selection
    snapshot = takeSnapshot();
    elements = parseSnapshot(snapshot);

    // Look for the Model selector
    const modelRef = findRef(elements, "model");
    if (!modelRef) {
      console.error("[ari-labor] Could not find Model selector on ARI page");
      return { error: "ARI lookup failed: could not find Model selector" };
    }

    clickRef(modelRef);
    typeInRef(modelRef, model, true);
    waitForLoad("networkidle");

    console.log(`[ari-labor] Vehicle selected: ${year} ${make} ${model}`);
  } catch (err) {
    console.error(`[ari-labor] Vehicle selection failed: ${err.message}`);
    return { error: `ARI vehicle selection failed: ${err.message}` };
  }

  // --- Step 6: Search for procedure ---
  try {
    // Re-snapshot after vehicle selection
    snapshot = takeSnapshot();
    elements = parseSnapshot(snapshot);

    // Look for a search input — try common labels
    let searchRef = findRef(elements, "search");
    if (!searchRef) searchRef = findRef(elements, "labor");
    if (!searchRef) searchRef = findRef(elements, "procedure");
    if (!searchRef) searchRef = findRef(elements, "find");

    if (!searchRef) {
      console.error("[ari-labor] Could not find search/procedure input on ARI page");
      return { error: "ARI lookup failed: could not find search input" };
    }

    clickRef(searchRef);
    typeInRef(searchRef, procedure, true);
    waitForLoad("networkidle");

    console.log(`[ari-labor] Searched for procedure: "${procedure}"`);
  } catch (err) {
    console.error(`[ari-labor] Procedure search failed: ${err.message}`);
    return { error: `ARI procedure search failed: ${err.message}` };
  }

  // --- Step 7: Extract labor hours from results ---
  let laborHours = null;
  let procedureName = procedure;
  let notes = null;

  try {
    // Re-snapshot to read results
    snapshot = takeSnapshot();
    elements = parseSnapshot(snapshot);

    // Look for labor hour values in the results.
    // ARI typically shows hours as decimal numbers (e.g., "1.2", "0.8").
    // We scan all elements for text that contains a decimal number pattern
    // that looks like labor hours (0.1 - 30.0 range).
    const hourPattern = /(\d{1,2}\.\d{1,2})\s*(?:hrs?|hours?)?/i;

    for (const el of elements) {
      const match = el.text.match(hourPattern);
      if (match) {
        const hours = parseFloat(match[1]);
        // Sanity check: labor hours should be between 0.1 and 30.0
        if (hours >= 0.1 && hours <= 30.0) {
          laborHours = hours;
          break;
        }
      }
    }

    // Try to extract the procedure name as shown by ARI (may differ from input)
    const procElements = findAllRefs(elements, procedure.split(" ")[0]);
    if (procElements.length > 0) {
      procedureName = procElements[0].text;
    }

    // Check if there are any notes/additional info
    const noteElements = findAllRefs(elements, "note");
    if (noteElements.length > 0) {
      notes = noteElements.map((el) => el.text).join("; ");
    }
  } catch (err) {
    console.error(`[ari-labor] Result extraction failed: ${err.message}`);
    return { error: `ARI result extraction failed: ${err.message}` };
  }

  // --- Validate extracted data ---
  if (laborHours === null) {
    console.error(`[ari-labor] Could not extract labor hours from ARI results`);
    return { error: "ARI lookup failed: could not extract labor hours from results" };
  }

  console.log(`[ari-labor] Extracted: ${laborHours}h for "${procedureName}"`);

  // --- Step 8: Cache the result ---
  await cacheResult({
    vehicle_make: make,
    vehicle_model: model,
    vehicle_year: year,
    procedure_name: procedureName,
    labor_hours: laborHours,
    notes: notes,
  });

  // --- Step 9: Return structured result ---
  return {
    labor_hours: laborHours,
    procedure_name: procedureName,
    notes: notes,
    source: "ari",
  };
}

module.exports = {
  lookupLaborTime,
  cacheResult,
  // Exported for testing and composition
  ensureBrowser,
  takeSnapshot,
  parseSnapshot,
  findRef,
  findAllRefs,
  checkCache,
};
