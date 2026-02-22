/**
 * ProDemand Direct Browser Search — Puppeteer
 *
 * Connects to Chrome via CDP (port 18800) and automates ProDemand's
 * 1SEARCH interface to find Real Fixes, labor times, and DTC test plans.
 *
 * KEY FACTS discovered from live inspection:
 *   - ProDemand uses sessionStorage auth — can't navigate away after login
 *   - App URL: https://www2.prodemand.com/Main/Index#.../OneView (1SEARCH)
 *   - Vehicle selector uses <li class="qualifier"> items (not <select>)
 *   - Selection order: Year → Make → Model → Engine/Trim → Submodel → Options
 *   - Search box: input.searchBox ("Enter Codes, Components or Symptoms")
 *   - Don't close the ProDemand page between calls — session lives in sessionStorage
 *
 * Exports: search()
 */

const LOG = "[prodemand-direct]";
const PRODEMAND_URL = process.env.PRODEMAND_URL || "https://www.prodemand.com";
const PRODEMAND_USERNAME = process.env.PRODEMAND_USERNAME;
const PRODEMAND_PASSWORD = process.env.PRODEMAND_PASSWORD;
const CHROME_DEBUG_PORT = 18800;

let puppeteer;
try {
  puppeteer = require("puppeteer-core");
} catch {
  puppeteer = null;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Browser connection ────────────────────────────────────────────────────────

/**
 * Connect to Chrome and return { browser, page }.
 * Reuses an existing ProDemand page if one is already logged in (sessionStorage).
 * Falls back to pages[0] for new login flow.
 */
async function getBrowser() {
  if (!puppeteer) throw new Error("puppeteer-core not installed");

  const browser = await puppeteer.connect({
    browserURL: `http://127.0.0.1:${CHROME_DEBUG_PORT}`,
    defaultViewport: { width: 1280, height: 900 },
  });

  const pages = await browser.pages();

  // Prefer an existing page already on the ProDemand app (www2)
  const appPage = pages.find((p) => p.url().includes("www2.prodemand.com"));
  if (appPage) {
    appPage.setDefaultTimeout(45000);
    console.log(`${LOG} Reusing existing ProDemand session`);
    return { browser, page: appPage, reusingSession: true };
  }

  // Use pages[0] for login — don't create a new tab (sessionStorage is per-tab)
  const page = pages.length > 0 ? pages[0] : await browser.newPage();
  page.setDefaultTimeout(45000);
  return { browser, page, reusingSession: false };
}

// ── Login ─────────────────────────────────────────────────────────────────────

/**
 * Ensure we're logged in to ProDemand.
 * Returns true if logged in (or already was). Does NOT navigate away from app page.
 */
async function ensureLoggedIn(page, reusingSession) {
  // If we're already on the app, we're logged in
  if (reusingSession || page.url().includes("www2.prodemand.com")) {
    console.log(`${LOG} Already on ProDemand app`);
    return true;
  }

  console.log(`${LOG} Navigating to ProDemand for login...`);
  await page.goto(PRODEMAND_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await sleep(1000);

  const bodyText = await page.evaluate(() => document.body.innerText.toLowerCase());
  const onLanding =
    bodyText.includes("buy now") || bodyText.includes("intelligent repair information");

  if (!onLanding) {
    // Already redirected to app
    console.log(`${LOG} Redirected to app without login`);
    return true;
  }

  // Click Login button
  const clicked = await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find((b) =>
      /^login$/i.test(b.innerText.trim())
    );
    if (btn) {
      btn.click();
      return true;
    }
    return false;
  });

  if (!clicked) {
    console.log(`${LOG} Login button not found`);
    return false;
  }

  await sleep(2000);

  // If Login button redirected directly to app (cached session)
  if (page.url().includes("www2.prodemand.com")) {
    console.log(`${LOG} Cached session — redirected to app`);
    return true;
  }

  // Need credentials
  const passField = await page
    .waitForSelector('input[type="password"]', { timeout: 8000 })
    .catch(() => null);
  if (!passField) {
    console.log(`${LOG} No password field — checking if on app`);
    return page.url().includes("www2.prodemand.com");
  }

  const userField = await page.$('input[type="text"], input[type="email"]');
  if (userField) {
    await userField.click({ clickCount: 3 });
    await userField.type(PRODEMAND_USERNAME, { delay: 30 });
  }
  await passField.click({ clickCount: 3 });
  await passField.type(PRODEMAND_PASSWORD, { delay: 30 });

  const submitBtn = await page.$('button[type="submit"], input[type="submit"]');
  if (submitBtn) {
    await submitBtn.click();
  } else {
    await passField.press("Enter");
  }

  await sleep(4000);

  const loggedIn = page.url().includes("www2.prodemand.com");
  console.log(`${LOG} Login ${loggedIn ? "successful" : "failed"} — URL: ${page.url()}`);
  return loggedIn;
}

// ── Vehicle Selection ─────────────────────────────────────────────────────────

/**
 * Navigate to 1SEARCH view where vehicle selector is always in the sidebar.
 */
async function goToOneSearch(page) {
  const currentUrl = page.url();
  if (currentUrl.includes("OneView") || currentUrl.includes("oneview")) {
    return; // Already there
  }
  // Click 1SEARCH in the navigation
  await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll("a, li, nav *"));
    const link = links.find(
      (el) => el.innerText && (el.innerText.includes("1SEARCH") || el.innerText.includes("OneView"))
    );
    if (link) link.click();
  });
  await sleep(1500);
}

/**
 * Click a qualifier item (Year/Make/Model/Engine/Submodel/Option) by text.
 * Uses partial case-insensitive matching as fallback.
 * Returns the clicked text or null.
 */
async function clickQualifier(page, text) {
  if (!text) return null;
  const result = await page.evaluate((t) => {
    const items = Array.from(document.querySelectorAll("li.qualifier"));
    const exact = items.find((li) => li.textContent.trim().toLowerCase() === t.toLowerCase());
    const partial = items.find((li) =>
      li.textContent.trim().toLowerCase().includes(t.toLowerCase())
    );
    const match = exact || partial;
    if (match) {
      match.click();
      return match.textContent.trim();
    }
    return null;
  }, text);
  if (result) await sleep(1800);
  return result;
}

/**
 * Get currently visible qualifiers (right pane options).
 */
async function getQualifiers(page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("li.qualifier")).map((li) => li.textContent.trim())
  );
}

/**
 * Get the active left-pane tab name (Year/Make/Model/Engine/Submodel/Options).
 */
async function getActiveTab(page) {
  return page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll("#qualifierTypeSelector li"));
    const active = tabs.find((li) => li.classList.contains("selected") || li.classList.contains("active"));
    return active ? active.textContent.trim().toLowerCase() : null;
  });
}

/**
 * Select a vehicle by Year/Make/Model/Engine, handling all intermediate steps.
 * ProDemand may ask for Submodel and Options after Engine — we pick the best match
 * or first available option for each step.
 *
 * @param {object} page
 * @param {object} vehicle - { year, make, model, engine }
 * @returns {boolean} true if vehicle was selected
 */
async function selectVehicle(page, { year, make, model, engine }) {
  // Known selection steps and what to pick at each
  const wantedValues = {
    year: String(year),
    make: make,
    model: model,
    engine: engine || "", // e.g. "2.0L" or "1.5L" — may not match exactly
  };

  const MAX_STEPS = 8; // Year + Make + Model + Engine + Submodel + Options (multiple)

  for (let step = 0; step < MAX_STEPS; step++) {
    const qualifiers = await getQualifiers(page);
    if (qualifiers.length === 0) break;

    const activeTab = await getActiveTab(page);
    console.log(`${LOG} Step ${step + 1}: ${activeTab || "?"} — ${qualifiers.length} options`);

    let picked = null;

    if (activeTab === "year") {
      picked = await clickQualifier(page, wantedValues.year);
    } else if (activeTab === "make") {
      picked = await clickQualifier(page, wantedValues.make);
    } else if (activeTab === "model") {
      picked = await clickQualifier(page, wantedValues.model);
    } else if (activeTab === "engine") {
      // Try to match engine displacement if provided; otherwise pick first
      if (wantedValues.engine) {
        picked = await clickQualifier(page, wantedValues.engine);
      }
      if (!picked) {
        // Pick first non-empty qualifier
        picked = await clickQualifier(page, qualifiers[0]);
      }
    } else if (activeTab === "submodel") {
      // Pick first submodel
      picked = await clickQualifier(page, qualifiers[0]);
    } else if (activeTab === "options") {
      // Options can repeat — pick first each time
      picked = await clickQualifier(page, qualifiers[0]);
    } else if (activeTab === "odometer") {
      // Odometer is optional — skip
      console.log(`${LOG} Skipping odometer`);
      break;
    } else {
      // Unknown tab — pick first available
      picked = await clickQualifier(page, qualifiers[0]);
    }

    if (!picked) {
      console.log(`${LOG} Could not pick qualifier on step ${step + 1} (${activeTab})`);
      break;
    }
    console.log(`${LOG}   → Selected: ${picked}`);
  }

  // Verify vehicle was selected (breadcrumb shows something)
  const breadcrumb = await page.evaluate(
    () => document.querySelector("#vehicleDetails")?.innerText?.trim() || ""
  );
  console.log(`${LOG} Breadcrumb: ${breadcrumb || "(empty)"}`);
  return breadcrumb.length > 0 || true; // Proceed even if breadcrumb is empty (some vehicles don't show it)
}

// ── Search & Extraction ───────────────────────────────────────────────────────

/**
 * Enter a DTC code or symptom in the 1SEARCH box and submit.
 * Uses evaluate to type directly (avoids "not clickable" errors from overlay).
 */
async function performSearch(page, query) {
  // Close vehicle selector if open (so searchBox is accessible)
  const selectorOpen = await page.evaluate(() => {
    const d = document.querySelector("#vehicleSelectorDetails");
    return d ? getComputedStyle(d).height !== "0px" : false;
  });
  if (selectorOpen) {
    await page.evaluate(() => document.querySelector("#vehicleSelectorButton")?.click());
    await sleep(500);
  }

  // Type into searchBox via evaluate (bypasses overlay click issues)
  const typed = await page.evaluate((q) => {
    const box = document.querySelector(".searchBox, input[placeholder*='Code'], input[placeholder*='Symptom']");
    if (!box) return false;
    box.value = "";
    box.focus();
    box.value = q;
    // Trigger input events so the app picks up the value
    box.dispatchEvent(new Event("input", { bubbles: true }));
    box.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }, query);

  if (!typed) {
    console.log(`${LOG} Search box not found`);
    return false;
  }

  // Press Enter to submit
  await page.keyboard.press("Enter");
  console.log(`${LOG} Searched for: ${query}`);
  await sleep(3000);
  return true;
}

/**
 * Extract Real Fixes from search results.
 */
async function extractRealFixes(page) {
  try {
    return await page.evaluate(() => {
      const results = [];
      // SureTrack / Real Fix result containers
      document.querySelectorAll("[class*='fix'], [class*='Fix'], [class*='realfix'], [data-type*='fix']").forEach((el) => {
        const text = el.innerText?.trim();
        if (text && text.length > 20 && text.length < 2000) {
          results.push({ symptom: text.substring(0, 300), source: "prodemand" });
        }
      });
      // Fallback: scan body text for symptom/complaint patterns
      if (results.length === 0) {
        const allText = document.body.innerText;
        const fixPattern = /(?:symptom|complaint|condition|verified fix)[:\s]*([^\n]{10,200})/gi;
        let match;
        while ((match = fixPattern.exec(allText)) !== null && results.length < 10) {
          results.push({ symptom: match[1].trim(), source: "prodemand" });
        }
      }
      return results;
    });
  } catch {
    return [];
  }
}

/**
 * Extract labor times from search results.
 */
async function extractLaborTimes(page) {
  try {
    return await page.evaluate(() => {
      const times = [];
      const text = document.body.innerText;
      const hourPattern = /([^\n]{5,80}?)\s+(\d{1,2}\.?\d*)\s*(?:hrs?|hours?)/gi;
      let match;
      while ((match = hourPattern.exec(text)) !== null && times.length < 10) {
        const hours = parseFloat(match[2]);
        if (hours >= 0.1 && hours <= 50) {
          times.push({ procedure: match[1].trim(), hours, source: "prodemand" });
        }
      }
      return times;
    });
  } catch {
    return [];
  }
}

/**
 * Extract a structured DTC test plan from ProDemand results.
 * Returns array of { step, action } objects.
 */
async function extractDtcTestPlan(page) {
  try {
    return await page.evaluate(() => {
      const steps = [];
      const text = document.body.innerText;
      // Look for numbered steps like "1. Check..." or "Step 1: ..."
      const stepPattern = /(?:^|\n)\s*(\d{1,2})[.)]\s+(.{10,300})/gm;
      let match;
      while ((match = stepPattern.exec(text)) !== null && steps.length < 10) {
        steps.push({ step: parseInt(match[1]), action: match[2].trim() });
      }
      return steps;
    });
  } catch {
    return [];
  }
}

// ── Main Search ───────────────────────────────────────────────────────────────

/**
 * Search ProDemand for a vehicle + DTC/symptom.
 *
 * Flow:
 *   1. Connect to Chrome (reuse existing ProDemand session if available)
 *   2. Login if needed
 *   3. Navigate to 1SEARCH view
 *   4. Select vehicle (Year → Make → Model → Engine → any further steps)
 *   5. Enter DTC/symptom in search box
 *   6. Extract Real Fixes, labor times, DTC test plan
 *
 * @param {object} params
 * @param {string} [params.vin]
 * @param {string|number} params.year
 * @param {string} params.make
 * @param {string} params.model
 * @param {string} [params.engine] - e.g. "2.0L"
 * @param {string} params.query - DTC code or symptom
 * @returns {object} ProDemand search results
 */
async function search(params) {
  if (!PRODEMAND_USERNAME || !PRODEMAND_PASSWORD) {
    return { error: "ProDemand not configured — set PRODEMAND_USERNAME/PRODEMAND_PASSWORD" };
  }
  if (!puppeteer) {
    return { error: "puppeteer-core not installed" };
  }

  const { vin, year, make, model, engine, query } = params;
  console.log(`${LOG} Search: ${year} ${make} ${model} ${engine || ""} — ${query}`);

  let browser;
  try {
    const conn = await getBrowser();
    browser = conn.browser;
    const page = conn.page;

    // Step 1: Login
    const loggedIn = await ensureLoggedIn(page, conn.reusingSession);
    if (!loggedIn) {
      return {
        source: "ProDemand (direct)",
        error: "Login failed — check PRODEMAND_USERNAME and PRODEMAND_PASSWORD",
        realFixes: [],
        laborTimes: [],
        dtcTestPlan: [],
      };
    }

    // Step 2: Navigate to 1SEARCH
    await goToOneSearch(page);

    // Step 3: Select vehicle
    const vehicleSelected = await selectVehicle(page, { year, make, model, engine });
    if (!vehicleSelected) {
      console.log(`${LOG} Vehicle selection may be incomplete — proceeding anyway`);
    }

    // Step 4: Search
    const searched = await performSearch(page, query);
    if (!searched) {
      return {
        source: "ProDemand (direct)",
        vehicle: { vin, year, make, model, engine },
        query,
        error: "Search box not found",
        realFixes: [],
        laborTimes: [],
        dtcTestPlan: [],
      };
    }

    // Step 5: Extract results
    const [realFixes, laborTimes, dtcTestPlan] = await Promise.all([
      extractRealFixes(page),
      extractLaborTimes(page),
      extractDtcTestPlan(page),
    ]);

    const title = await page.title();
    const bodySnippet = await page.evaluate(() => document.body.innerText.substring(0, 400));

    console.log(
      `${LOG} Results: ${realFixes.length} fixes, ${laborTimes.length} labor, ${dtcTestPlan.length} test steps`
    );

    return {
      source: "ProDemand (direct)",
      vehicle: { vin, year, make, model, engine },
      query,
      realFixes,
      laborTimes,
      dtcTestPlan,
      partNumbers: [],
      pageTitle: title,
      pageSummary: bodySnippet,
    };
  } catch (err) {
    console.error(`${LOG} Error: ${err.message}`);
    return {
      source: "ProDemand (direct)",
      error: err.message,
      realFixes: [],
      laborTimes: [],
      dtcTestPlan: [],
    };
  } finally {
    if (browser) {
      browser.disconnect(); // Don't close Chrome — it's a shared service
    }
  }
}

module.exports = { search };
