/**
 * Shared Browser Automation Helpers for SAM Skills
 *
 * Provides a common set of OpenClaw browser automation utilities
 * used by all browser-based skills (AllData, Identifix, ProDemand,
 * ARI Labor, PartsTech Order).
 *
 * Uses execFileSync with argument arrays throughout to prevent
 * command injection. All text is passed as separate process arguments,
 * never interpolated into shell command strings.
 *
 * Usage:
 *   const browser = require("../shared/browser");
 *   browser.ensureBrowser();
 *   browser.navigateTo("https://example.com");
 *   const snap = browser.takeSnapshot();
 *   const els = browser.parseSnapshot(snap);
 *   const ref = browser.findRef(els, "Search");
 *   browser.clickRef(ref);
 */

const { execFileSync } = require("child_process");

// --- Config ---
const BROWSER_PROFILE = process.env.OPENCLAW_BROWSER_PROFILE || "openclaw";
const EXEC_TIMEOUT = parseInt(process.env.OPENCLAW_EXEC_TIMEOUT, 10) || 30000;

// ============================================================
//  Core Browser Commands
// ============================================================

/**
 * Run an OpenClaw browser CLI command with argument array (no shell).
 * Uses execFileSync to avoid command injection.
 *
 * @param {...string} args - Arguments after "openclaw browser --browser-profile <profile>"
 * @returns {string} Command stdout
 */
function browserCmd(...args) {
  return execFileSync(
    "openclaw",
    ["browser", "--browser-profile", BROWSER_PROFILE, ...args],
    { encoding: "utf-8", timeout: EXEC_TIMEOUT }
  );
}

/**
 * Ensure the OpenClaw managed browser is running.
 * Opens about:blank if no tab exists (headless Chrome starts with no tabs).
 */
function ensureBrowser() {
  try {
    const status = browserCmd("status");
    if (!status.includes("running")) {
      browserCmd("start");
    }
  } catch {
    browserCmd("start");
  }
  // Headless Chrome may start with no tabs — open one if needed
  try {
    browserCmd("snapshot");
  } catch {
    browserCmd("open", "about:blank");
  }
}

/**
 * Take a snapshot of the current browser page.
 * @returns {string} Raw snapshot text with element refs
 */
function takeSnapshot() {
  return browserCmd("snapshot");
}

/**
 * Click an element by its snapshot ref number.
 * @param {number|string} ref
 */
function clickRef(ref) {
  browserCmd("click", String(ref));
}

/**
 * Type text into an element by ref.
 * Text is passed as a separate process argument (safe from injection).
 *
 * @param {number|string} ref
 * @param {string} text
 * @param {boolean} [submit=false] - Press Enter after typing
 */
function typeInRef(ref, text, submit = false) {
  const args = ["type", String(ref), String(text)];
  if (submit) args.push("--submit");
  browserCmd(...args);
}

/**
 * Wait for the page to reach a specific load state.
 * Defaults to "load" (faster than "networkidle" which can timeout on heavy pages).
 * Non-fatal — swallows timeout errors so callers can continue.
 * @param {string} [state="load"] - Load state (networkidle, load, domcontentloaded)
 */
function waitForLoad(state = "load") {
  try {
    browserCmd("wait", "--load", state);
  } catch {
    // Timeout is non-fatal — page may still be usable
  }
}

/**
 * Navigate to a URL in the managed browser (current tab).
 * Validates URL protocol before navigating.
 * @param {string} url
 */
function navigateTo(url) {
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`Invalid URL protocol: ${parsed.protocol}`);
  }
  browserCmd("navigate", url);
}

/**
 * Capture a screenshot of the current page.
 * @param {string} outputPath - Full file path for the screenshot
 * @returns {string} The output path (or the MEDIA path if no outputPath)
 */
function captureScreenshot(outputPath) {
  const result = browserCmd("screenshot");
  return handleScreenshotResult(result, outputPath);
}

/**
 * Capture a full-page screenshot.
 * @param {string} outputPath
 * @returns {string}
 */
function captureFullPageScreenshot(outputPath) {
  const result = browserCmd("screenshot", "--full-page");
  return handleScreenshotResult(result, outputPath);
}

/**
 * Parse MEDIA:<path> from screenshot output and copy to desired location.
 * @param {string} result - stdout from screenshot command
 * @param {string} [outputPath] - desired output path
 * @returns {string} final screenshot path
 */
function handleScreenshotResult(result, outputPath) {
  const mediaMatch = result.match(/MEDIA:(.+)/);
  if (mediaMatch) {
    let srcPath = mediaMatch[1].trim();
    // Expand ~ to HOME
    if (srcPath.startsWith("~")) {
      srcPath = srcPath.replace("~", process.env.HOME || "/root");
    }
    if (outputPath && srcPath !== outputPath) {
      require("fs").copyFileSync(srcPath, outputPath);
      return outputPath;
    }
    return srcPath;
  }
  return outputPath || result.trim();
}

/**
 * Press a key (Enter, Tab, Escape, etc.)
 * @param {string} key
 */
function pressKey(key) {
  browserCmd("press", key);
}

// ============================================================
//  Snapshot Parsing
// ============================================================

/**
 * Parse OpenClaw snapshot text into element objects.
 *
 * Snapshot lines look like:
 *   [12] button "Search"
 *   [23] input "Year"
 *   [45] link "Honda"
 *   [67] "Some text without type"
 *
 * @param {string} snapshotText - Raw snapshot output from OpenClaw
 * @returns {Array<{ref: string, type: string, text: string}>} Parsed elements
 */
function parseSnapshot(snapshotText) {
  const elements = [];
  const lines = snapshotText.split("\n");

  for (const line of lines) {
    // Match: [ref] type "text" or [ref] type 'text'
    const match = line.match(/\[(\d+)\]\s+(?:(\w+)\s+)?["']([^"']*?)["']/);
    if (match) {
      elements.push({
        ref: match[1],
        type: match[2] || "unknown",
        text: match[3],
      });
      continue;
    }

    // Match: [ref] type unquotedText
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
 * Find the first element ref matching partial text (case-insensitive).
 * @param {Array} elements - Parsed snapshot elements
 * @param {string} textMatch - Partial text to search for
 * @returns {string|null} The ref number, or null if not found
 */
function findRef(elements, textMatch) {
  const needle = textMatch.toLowerCase();
  const found = elements.find((el) => el.text.toLowerCase().includes(needle));
  return found ? found.ref : null;
}

/**
 * Find all elements matching partial text (case-insensitive).
 * @param {Array} elements
 * @param {string} textMatch
 * @returns {Array<{ref: string, type: string, text: string}>}
 */
function findAllRefs(elements, textMatch) {
  const needle = textMatch.toLowerCase();
  return elements.filter((el) => el.text.toLowerCase().includes(needle));
}

/**
 * Find element by type and partial text.
 * @param {Array} elements
 * @param {string} type - Element type (button, input, link, etc.)
 * @param {string} textMatch - Partial text to match
 * @returns {string|null} The ref number, or null
 */
function findRefByType(elements, type, textMatch) {
  const needle = textMatch.toLowerCase();
  const found = elements.find(
    (el) => el.type === type && el.text.toLowerCase().includes(needle)
  );
  return found ? found.ref : null;
}

/**
 * Find element by exact type (no text filter).
 * Returns the first element of the given type.
 * @param {Array} elements
 * @param {string} type
 * @returns {string|null}
 */
function findRefByTypeOnly(elements, type) {
  const found = elements.find((el) => el.type === type);
  return found ? found.ref : null;
}

// ============================================================
//  Login Helpers
// ============================================================

/**
 * Check if the current page shows a login form.
 *
 * @param {Array} elements - Parsed snapshot elements
 * @returns {boolean} true if a login form is detected
 */
function isLoginPage(elements) {
  const passwordInput = findRefByType(elements, "input", "password");
  const loginButton = findRefByType(elements, "button", "log in") ||
                      findRefByType(elements, "button", "sign in") ||
                      findRefByType(elements, "button", "login") ||
                      findRefByType(elements, "button", "submit");
  return !!(passwordInput && loginButton);
}

/**
 * Check if we appear to be on an authenticated page.
 * Looks for common authenticated UI elements.
 *
 * @param {Array} elements - Parsed snapshot elements
 * @param {string[]} [positiveKeywords] - Additional keywords indicating logged-in state
 * @returns {boolean}
 */
function isAuthenticated(elements, positiveKeywords = []) {
  const defaults = ["search", "dashboard", "home", "account", "logout", "sign out"];
  const keywords = [...defaults, ...positiveKeywords];

  let positiveCount = 0;
  for (const kw of keywords) {
    if (findRef(elements, kw)) positiveCount++;
  }

  // Need at least 2 positive signals to confirm authenticated
  return positiveCount >= 2;
}

/**
 * Perform a generic login on a page with username/password fields.
 *
 * Steps:
 *   1. Find username/email input
 *   2. Type username
 *   3. Find password input
 *   4. Type password
 *   5. Find and click submit button
 *   6. Wait for page load
 *
 * Note: Credentials appear briefly in process argument lists (known
 * limitation of CLI-based browser automation). Mitigate by restricting
 * process visibility on the host.
 *
 * @param {Array} elements - Parsed snapshot elements from login page
 * @param {string} username - Username/email to type
 * @param {string} password - Password to type
 * @returns {{ success: boolean, error?: string }}
 */
function performLogin(elements, username, password) {
  if (!username?.trim() || !password?.trim()) {
    return { success: false, error: "Username and password are required" };
  }

  try {
    // Find username/email input
    let userRef = findRefByType(elements, "input", "email");
    if (!userRef) userRef = findRefByType(elements, "input", "username");
    if (!userRef) userRef = findRefByType(elements, "input", "user");
    if (!userRef) userRef = findRef(elements, "email");
    if (!userRef) userRef = findRef(elements, "username");

    if (!userRef) {
      return { success: false, error: "Could not find username/email input" };
    }

    clickRef(userRef);
    typeInRef(userRef, username);

    // Find password input
    let passRef = findRefByType(elements, "input", "password");
    if (!passRef) passRef = findRef(elements, "password");

    if (!passRef) {
      return { success: false, error: "Could not find password input" };
    }

    clickRef(passRef);
    typeInRef(passRef, password);

    // Find submit button
    let submitRef = findRefByType(elements, "button", "sign in");
    if (!submitRef) submitRef = findRefByType(elements, "button", "log in");
    if (!submitRef) submitRef = findRefByType(elements, "button", "login");
    if (!submitRef) submitRef = findRefByType(elements, "button", "submit");

    if (!submitRef) {
      return { success: false, error: "Could not find login/submit button" };
    }

    clickRef(submitRef);
    waitForLoad("networkidle");

    return { success: true };
  } catch (err) {
    return { success: false, error: `Login failed: ${err.message}` };
  }
}

/**
 * Full login flow: navigate to URL, check if login needed, authenticate.
 *
 * @param {string} url - Platform URL
 * @param {string} username - Username env var value
 * @param {string} password - Password env var value
 * @param {string} logPrefix - Log prefix, e.g. "[alldata]"
 * @param {string[]} [authKeywords] - Additional keywords for authenticated state
 * @returns {{ success: boolean, error?: string }}
 */
function ensureLoggedIn(url, username, password, logPrefix, authKeywords = []) {
  try {
    ensureBrowser();
    navigateTo(url);
    waitForLoad("networkidle");

    const snapshot = takeSnapshot();
    const elements = parseSnapshot(snapshot);

    // Already authenticated?
    if (isAuthenticated(elements, authKeywords)) {
      console.log(`${logPrefix} Session active — skipping login`);
      return { success: true };
    }

    // Login form visible?
    if (isLoginPage(elements)) {
      console.log(`${logPrefix} Login form detected — authenticating...`);
      const result = performLogin(elements, username, password);

      if (result.success) {
        // Verify we're now authenticated
        const postSnapshot = takeSnapshot();
        const postElements = parseSnapshot(postSnapshot);
        if (isAuthenticated(postElements, authKeywords) || !isLoginPage(postElements)) {
          console.log(`${logPrefix} Login successful`);
          return { success: true };
        }
        return { success: false, error: "Login appeared to fail — still on login page" };
      }
      return result;
    }

    // Can't determine state — proceed anyway
    console.log(`${logPrefix} Page state unclear — proceeding`);
    return { success: true };
  } catch (err) {
    return { success: false, error: `Login flow error: ${err.message}` };
  }
}

// ============================================================
//  Vehicle Selection Helpers
// ============================================================

/**
 * Select a vehicle via Year/Make/Model dropdowns.
 * Common pattern across AllData, Identifix, ProDemand.
 *
 * @param {object} vehicle
 * @param {number|string} vehicle.year
 * @param {string} vehicle.make
 * @param {string} vehicle.model
 * @param {string} [vehicle.engine]
 * @param {string} logPrefix - e.g. "[alldata]"
 * @returns {{ success: boolean, error?: string }}
 */
function selectVehicleYMME({ year, make, model, engine }, logPrefix) {
  try {
    let snapshot = takeSnapshot();
    let elements = parseSnapshot(snapshot);

    // Year
    let yearRef = findRef(elements, "year");
    if (!yearRef) yearRef = findRefByType(elements, "input", "year");
    if (!yearRef) yearRef = findRefByType(elements, "select", "year");
    if (yearRef) {
      clickRef(yearRef);
      typeInRef(yearRef, String(year), true);
      waitForLoad("networkidle");
    } else {
      return { success: false, error: "Could not find Year selector" };
    }

    // Make
    snapshot = takeSnapshot();
    elements = parseSnapshot(snapshot);
    let makeRef = findRef(elements, "make");
    if (!makeRef) makeRef = findRefByType(elements, "input", "make");
    if (!makeRef) makeRef = findRefByType(elements, "select", "make");
    if (makeRef) {
      clickRef(makeRef);
      typeInRef(makeRef, make, true);
      waitForLoad("networkidle");
    } else {
      return { success: false, error: "Could not find Make selector" };
    }

    // Model
    snapshot = takeSnapshot();
    elements = parseSnapshot(snapshot);
    let modelRef = findRef(elements, "model");
    if (!modelRef) modelRef = findRefByType(elements, "input", "model");
    if (!modelRef) modelRef = findRefByType(elements, "select", "model");
    if (modelRef) {
      clickRef(modelRef);
      typeInRef(modelRef, model, true);
      waitForLoad("networkidle");
    } else {
      return { success: false, error: "Could not find Model selector" };
    }

    // Engine (optional — some platforms require it)
    if (engine) {
      snapshot = takeSnapshot();
      elements = parseSnapshot(snapshot);
      let engineRef = findRef(elements, "engine");
      if (!engineRef) engineRef = findRefByType(elements, "input", "engine");
      if (!engineRef) engineRef = findRefByType(elements, "select", "engine");
      if (engineRef) {
        clickRef(engineRef);
        typeInRef(engineRef, engine, true);
        waitForLoad("networkidle");
      }
      // Engine not found is non-fatal — some platforms don't have it
    }

    console.log(`${logPrefix} Vehicle selected: ${year} ${make} ${model}${engine ? ` ${engine}` : ""}`);
    return { success: true };
  } catch (err) {
    return { success: false, error: `Vehicle selection failed: ${err.message}` };
  }
}

/**
 * Select a vehicle via VIN entry.
 *
 * @param {string} vin
 * @param {string} logPrefix
 * @returns {{ success: boolean, error?: string }}
 */
function selectVehicleVIN(vin, logPrefix) {
  try {
    const snapshot = takeSnapshot();
    const elements = parseSnapshot(snapshot);

    let vinRef = findRef(elements, "vin");
    if (!vinRef) vinRef = findRefByType(elements, "input", "vin");

    if (!vinRef) {
      return { success: false, error: "Could not find VIN input" };
    }

    clickRef(vinRef);
    typeInRef(vinRef, vin, true);
    waitForLoad("networkidle");

    console.log(`${logPrefix} Vehicle set via VIN: ${vin}`);
    return { success: true };
  } catch (err) {
    return { success: false, error: `VIN entry failed: ${err.message}` };
  }
}

/**
 * Select a vehicle — tries VIN first, falls back to YMME.
 *
 * @param {object} params
 * @param {string} [params.vin]
 * @param {number|string} params.year
 * @param {string} params.make
 * @param {string} params.model
 * @param {string} [params.engine]
 * @param {string} logPrefix
 * @returns {{ success: boolean, error?: string }}
 */
function selectVehicle({ vin, year, make, model, engine }, logPrefix) {
  if (vin) {
    const vinResult = selectVehicleVIN(vin, logPrefix);
    if (vinResult.success) return vinResult;
    console.log(`${logPrefix} VIN entry failed — trying YMME fallback`);
  }

  if (year && make && model) {
    return selectVehicleYMME({ year, make, model, engine }, logPrefix);
  }

  return { success: false, error: "Need VIN or Year/Make/Model to select vehicle" };
}

// ============================================================
//  Search Helpers
// ============================================================

/**
 * Find and use a search input on the current page.
 *
 * @param {string} query - Text to search for
 * @param {string[]} [searchLabels] - Labels to look for (defaults to common ones)
 * @returns {{ success: boolean, error?: string }}
 */
function performSearch(query, searchLabels) {
  const labels = searchLabels || ["search", "find", "query", "keyword", "look up"];

  try {
    const snapshot = takeSnapshot();
    const elements = parseSnapshot(snapshot);

    let searchRef = null;
    for (const label of labels) {
      searchRef = findRefByType(elements, "input", label);
      if (searchRef) break;
      searchRef = findRef(elements, label);
      if (searchRef) break;
    }

    if (!searchRef) {
      return { success: false, error: "Could not find search input" };
    }

    clickRef(searchRef);
    typeInRef(searchRef, query, true);
    waitForLoad("networkidle");

    return { success: true };
  } catch (err) {
    return { success: false, error: `Search failed: ${err.message}` };
  }
}

/**
 * Extract text content from all elements on the current page.
 * Useful for scraping result pages.
 *
 * @returns {Array<{ref: string, type: string, text: string}>}
 */
function getPageElements() {
  const snapshot = takeSnapshot();
  return parseSnapshot(snapshot);
}

/**
 * Extract text blocks from elements that look like content
 * (long text, not just labels/buttons).
 *
 * @param {Array} elements - Parsed snapshot elements
 * @param {number} [minLength=20] - Minimum text length to include
 * @returns {string[]} Array of text content
 */
function extractTextContent(elements, minLength = 20) {
  return elements
    .filter((el) => el.text.length >= minLength)
    .map((el) => el.text);
}

// ============================================================
//  Exports
// ============================================================

module.exports = {
  // Core commands
  browserCmd,
  ensureBrowser,
  takeSnapshot,
  clickRef,
  typeInRef,
  waitForLoad,
  navigateTo,
  captureScreenshot,
  captureFullPageScreenshot,
  pressKey,

  // Snapshot parsing
  parseSnapshot,
  findRef,
  findAllRefs,
  findRefByType,
  findRefByTypeOnly,

  // Login
  isLoginPage,
  isAuthenticated,
  performLogin,
  ensureLoggedIn,

  // Vehicle selection
  selectVehicleYMME,
  selectVehicleVIN,
  selectVehicle,

  // Search
  performSearch,
  getPageElements,
  extractTextContent,

  // Config (for overriding in tests)
  BROWSER_PROFILE,
  EXEC_TIMEOUT,
};
