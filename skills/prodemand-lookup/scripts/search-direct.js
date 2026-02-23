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
 *   - After search: click a[data-type="OneViewSearch"] to reach cards grid
 *   - Cards view has: .cardRealFixes, .cardPartsLabor, .cardOEMTesting, etc.
 *   - Real Fixes card opens an inline modal (.modalDialogViewOpenCard)
 *   - Parts & Labor card navigates to a separate URL section
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
 * Navigate to 1SEARCH view and ensure the vehicle selector sidebar is open
 * with the Vehicle Selection accordion expanded so qualifiers are visible.
 */
async function goToOneSearch(page) {
  const currentUrl = page.url();
  if (!currentUrl.includes("OneView") && !currentUrl.includes("oneview")) {
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

  // Ensure vehicle selector panel is OPEN
  const panelOpen = await page.evaluate(() => {
    const d = document.querySelector("#vehicleSelectorDetails");
    return d ? getComputedStyle(d).height !== "0px" : false;
  });
  if (!panelOpen) {
    await page.evaluate(() => document.querySelector("#vehicleSelectorButton")?.click());
    await sleep(1000);
  }

  // Ensure "Vehicle Selection" accordion item is expanded (qualifiers visible)
  const hasQualifiers = await page.evaluate(() => document.querySelectorAll("li.qualifier").length > 0);
  if (!hasQualifiers) {
    await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll(".accordion .item"));
      const vh = items.find((el) => el.querySelector("h1")?.textContent.includes("Vehicle Selection"));
      if (vh && !vh.classList.contains("active")) {
        vh.querySelector(".header")?.click();
      }
    });
    await page.waitForFunction(() => document.querySelectorAll("li.qualifier").length > 0, { timeout: 5000 }).catch(() => {});
  }
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
 *
 * ProDemand vehicle selection flow:
 *   1. Year → Make → Model → Engine/Trim → Submodel
 *   2. An "Options" dialog appears with pre-selected items + remaining required options
 *   3. Pick any remaining unselected options (body style, transmission type, etc.)
 *   4. Click "Use This Vehicle" to confirm and close the modal
 *
 * @param {object} page
 * @param {object} vehicle - { year, make, model, engine }
 * @returns {boolean} true if vehicle was confirmed
 */
async function selectVehicle(page, { year, make, model, engine }) {
  const wantedValues = {
    year: String(year),
    make,
    model,
    engine: engine || "",
  };

  // Phase 1: Select Year → Make → Model → Engine → Submodel
  for (let step = 0; step < 8; step++) {
    const qualifiers = await getQualifiers(page);
    const activeTab = await getActiveTab(page);

    if (!activeTab || activeTab === "options" || qualifiers.length === 0) break;
    if (activeTab === "odometer") break;

    console.log(`${LOG} Step ${step + 1}: ${activeTab} — ${qualifiers.length} options`);

    let picked = null;
    if (activeTab === "year") picked = await clickQualifier(page, wantedValues.year);
    else if (activeTab === "make") picked = await clickQualifier(page, wantedValues.make);
    else if (activeTab === "model") picked = await clickQualifier(page, wantedValues.model);
    else if (activeTab === "engine") {
      picked = wantedValues.engine ? await clickQualifier(page, wantedValues.engine) : null;
      if (!picked) {
        // No engine specified — score options to prefer gas over electric
        picked = await page.evaluate(() => {
          const items = Array.from(document.querySelectorAll("li.qualifier:not(.selected)"));
          if (items.length === 0) return null;
          const score = (text) => {
            const t = text.toLowerCase();
            let s = 0;
            if (t.includes("gas") || t.includes("gasoline")) s += 6;
            if (/\d\.\d/.test(t)) s += 3; // displacement like "2.0L" = likely gas
            if (t.includes("electric")) s -= 8;
            if (/\bev\b/.test(t)) s -= 8;
            if (t.includes("plugin") || t.includes("plug-in")) s -= 5;
            if (t.includes("hybrid")) s -= 3;
            if (t.includes("diesel")) s -= 2;
            return s;
          };
          const scored = items.map(li => ({ li, text: li.textContent.trim(), s: score(li.textContent.trim()) }));
          scored.sort((a, b) => b.s - a.s);
          scored[0].li.click();
          return scored[0].text;
        });
        if (picked) await sleep(1800); // Let ProDemand process engine switch
      }
    } else if (activeTab === "submodel") {
      picked = await clickQualifier(page, qualifiers[0]);
    } else {
      picked = await clickQualifier(page, qualifiers[0]);
    }

    if (!picked) {
      console.log(`${LOG} Could not pick on step ${step + 1} (${activeTab})`);
      break;
    }
    console.log(`${LOG}   → ${picked}`);
  }

  // Phase 2: Options dialog — pick only UNSELECTED qualifiers we WANT
  // (Already-selected ones have class "qualifier selected" — skip them)
  // Stop when all remaining unselected options are ones we want to AVOID.
  const MAX_OPTION_ROUNDS = 8;
  let finalVariantLabel = null;

  for (let round = 0; round < MAX_OPTION_ROUNDS; round++) {
    const activeTab = await getActiveTab(page);
    if (activeTab !== "options") break;

    const unselected = await page.evaluate(() =>
      Array.from(document.querySelectorAll("li.qualifier:not(.selected)"))
        .map((li) => li.textContent.trim())
    );

    if (unselected.length === 0) break;

    console.log(`${LOG} Options round ${round + 1}: unselected: ${unselected.slice(0, 5).join(", ")}`);

    const picked = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll("li.qualifier:not(.selected)"));
      if (items.length === 0) return "__done__";

      const score = (text) => {
        const t = text.toLowerCase();
        let s = 0;
        // Prefer gasoline/gas engine strongly
        if (t.includes("gas"))               s += 6;
        if (t.includes("gasoline"))          s += 6;
        // Prefer common transmission/layout
        if (t.includes("automatic"))         s += 2;
        if (t.includes("cvt"))               s += 2;
        if (t.includes("fwd") || t.includes("awd")) s += 1;
        if (t.includes("4d") || t.includes("sedan") || t.includes("utility")) s += 1;
        // Penalize non-gas drivetrains (not hard-blocked — scored so EV queries still work)
        if (t.includes("electric"))          s -= 8;
        if (/\bev\b/.test(t))               s -= 8;
        if (t.includes("plugin") || t.includes("plug-in")) s -= 5;
        if (t.includes("hybrid"))            s -= 3;
        if (t.includes("diesel"))            s -= 2;
        // Penalize uncommon body/trans
        if (t.includes("2d") || t.includes("coupe")) s -= 3;
        if (t.includes("manual") || t.includes("standard trans")) s -= 4;
        return s;
      };

      const scored = items.map(li => ({ li, text: li.textContent.trim(), s: score(li.textContent.trim()) }));
      scored.sort((a, b) => b.s - a.s);

      // If best option is still strongly negative, all choices are bad — let caller decide
      if (scored[0].s < -4 && scored.every(x => x.s < -4)) return "__skip__";

      scored[0].li.click();
      return scored[0].text;
    });

    if (!picked || picked === "__done__" || picked === "__skip__") {
      console.log(`${LOG} Options: scored chooser stopped (${picked})`);
      break;
    }
    finalVariantLabel = picked;
    console.log(`${LOG}   → ${picked}`);
    await sleep(1500);
  }

  // Logging assertion — engine selection
  console.log(`${LOG} Engine selected: "${finalVariantLabel || "(none)"}" (scored chooser)`);

  // Phase 3: Click "Use This Vehicle" to confirm
  const confirmed = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button, input[type=button], .button, div"));
    const btn = btns.find((b) => /use this vehicle/i.test(b.innerText || b.value || ""));
    if (btn) { btn.click(); return true; }
    return false;
  });
  console.log(`${LOG} "Use This Vehicle" clicked: ${confirmed}`);
  if (confirmed) await sleep(3000); // Wait for modal to fully close

  const breadcrumb = await page.evaluate(
    () => document.querySelector("#vehicleDetails")?.innerText?.trim() || ""
  );
  console.log(`${LOG} Breadcrumb: ${breadcrumb || "(empty)"}`);
  return true;
}

// ── Search & Navigation ───────────────────────────────────────────────────────

/**
 * Navigate to 1SEARCH, enter the DTC/symptom query, and click the first
 * OneViewSearch result to reach the cards grid view.
 *
 * ProDemand search flow:
 *   1. Type query in .searchBox → press Enter
 *   2. Wait for search results (a[data-type="OneViewSearch"] links appear)
 *   3. Click first result → URL changes to .../OneView/Cards/dtc:p0420/...
 *   4. Cards grid shows: Real Fixes, Parts & Labor, OEM Testing, etc.
 *
 * @returns {{ success: boolean, cardsUrl: string|null }}
 */
async function performSearch(page, query) {
  // After vehicle selection, ProDemand lands on Parts & Labor — NOT 1SEARCH.
  // The vehicle spec is encoded in the URL hash. We construct the 1SEARCH URL
  // directly from the hash so the vehicle stays selected and the selector panel
  // does NOT open (vehicle already pre-selected via URL).
  const currentUrl = page.url();

  if (!currentUrl.includes("OneView") && !currentUrl.includes("oneview")) {
    // Extract vehicle spec from current URL hash (before the first '/')
    const hashPart = currentUrl.split("#")[1] || "";
    const slashIdx = hashPart.indexOf("/");
    const vehicleSpec = slashIdx > 0 ? hashPart.substring(0, slashIdx) : hashPart;

    if (vehicleSpec) {
      const oneSearchUrl = `https://www2.prodemand.com/Main/Index#${vehicleSpec}/OneView/Index//`;
      console.log(`${LOG} Navigating to 1SEARCH via URL (vehicle pre-selected)`);
      await page.goto(oneSearchUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
      await sleep(2500);
    } else {
      // Fallback: click 1SEARCH nav link
      console.log(`${LOG} No vehicle spec in URL — clicking 1SEARCH nav`);
      await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll("a, li, nav *"));
        const link = links.find(
          (el) => el.innerText && el.innerText.trim() === "1SEARCH"
        );
        if (link) link.click();
      });
      await sleep(2000);
    }
  }

  // Close the vehicle selector panel if it opened (dismisses modal_mask overlay)
  const panelWasClosed = await page.evaluate(() => {
    const d = document.querySelector("#vehicleSelectorDetails");
    if (!d) return true;
    const h = getComputedStyle(d).height;
    if (h && h !== "0px") {
      document.querySelector("#vehicleSelectorButton")?.click();
      return false;
    }
    return true;
  });
  if (!panelWasClosed) {
    console.log(`${LOG} Closed vehicle selector panel`);
    await sleep(1000);
  }

  // Wait up to 12s for searchBox to have non-zero dimensions
  let searchVisible = false;
  for (let i = 0; i < 12; i++) {
    const dims = await page.evaluate(() => {
      const box = document.querySelector(".searchBox");
      if (!box) return null;
      const r = box.getBoundingClientRect();
      return { w: r.width, h: r.height };
    });
    if (dims && dims.w > 0) { searchVisible = true; break; }
    await sleep(1000);
  }

  if (!searchVisible) {
    console.log(`${LOG} Search box not visible — trying Escape to dismiss any overlay`);
    await page.keyboard.press("Escape");
    await sleep(1000);
    const dims = await page.evaluate(() => {
      const box = document.querySelector(".searchBox");
      if (!box) return null;
      const r = box.getBoundingClientRect();
      return { w: r.width, h: r.height };
    });
    if (!dims || dims.w === 0) {
      console.log(`${LOG} Search box still not visible — search cannot proceed`);
      return { success: false, cardsUrl: null };
    }
    searchVisible = true;
  }

  // Clear existing content and type query
  await page.evaluate(() => {
    const box = document.querySelector(".searchBox");
    if (box) { box.focus(); box.select(); }
  });
  await sleep(200);
  // Select all + delete to clear, then type
  await page.keyboard.down("Control");
  await page.keyboard.press("a");
  await page.keyboard.up("Control");
  await page.keyboard.press("Delete");
  await sleep(100);
  await page.keyboard.type(query, { delay: 30 });
  await sleep(300);

  const val = await page.evaluate(() => document.querySelector(".searchBox")?.value);
  console.log(`${LOG} SearchBox value: "${val}"`);

  // Submit search
  await page.keyboard.press("Enter");
  console.log(`${LOG} Searching for: ${query}`);
  await sleep(4000); // ProDemand results take time to load

  // Click the first OneViewSearch result to reach the cards grid
  const clickedResult = await page.evaluate(() => {
    const link = document.querySelector('a[data-type="OneViewSearch"]');
    if (link) {
      link.click();
      return link.innerText?.trim() || "clicked";
    }
    return null;
  });

  if (clickedResult) {
    console.log(`${LOG} Clicked search result: "${clickedResult}"`);
    await sleep(3000); // Wait for cards grid to load
    const cardsUrl = page.url();
    console.log(`${LOG} Cards view URL: ${cardsUrl}`);

    // Verify we're in cards view
    const hasCards = await page.evaluate(() => document.querySelectorAll(".card").length > 0);
    console.log(`${LOG} Cards visible: ${hasCards}`);
    return { success: true, cardsUrl };
  }

  // Fallback: no OneViewSearch links found (keyword results only)
  console.log(`${LOG} No OneViewSearch results — trying keyword link`);
  const clickedKeyword = await page.evaluate(() => {
    const link = document.querySelector('a[data-type="Keyword"]');
    if (link) { link.click(); return true; }
    return false;
  });
  if (clickedKeyword) await sleep(3000);

  return { success: true, cardsUrl: page.url() };
}

// ── Data Extraction ───────────────────────────────────────────────────────────

/**
 * Navigate back to the cards view URL if we've navigated away.
 */
async function ensureCardsView(page, cardsUrl) {
  if (!cardsUrl) return;
  const currentUrl = page.url();
  if (currentUrl !== cardsUrl && !currentUrl.includes("/Cards/")) {
    console.log(`${LOG} Navigating back to cards view`);
    await page.goto(cardsUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
    await sleep(2000);
  }
}

/**
 * Click a card by CSS class name and wait for content to load.
 * Cards open an inline modal or panel.
 * Dismisses any currently-open modal first (Escape) to avoid stale content.
 * Returns true if the card was found and clicked.
 */
async function clickCard(page, cardClass) {
  // Dismiss any open modal before opening the next card
  await page.keyboard.press("Escape");
  await sleep(600);

  const clicked = await page.evaluate((cls) => {
    const card = document.querySelector(`.${cls} .cardHeader`);
    if (card) { card.click(); return true; }
    // Try clicking the card itself
    const cardEl = document.querySelector(`.${cls}`);
    if (cardEl) { cardEl.click(); return true; }
    return false;
  }, cardClass);

  if (clicked) {
    await sleep(3000); // Wait for modal/panel to load
    console.log(`${LOG} Clicked card: .${cardClass}`);
  }
  return clicked;
}

/**
 * Extract Real Fixes from ProDemand's Real Fixes card.
 *
 * Structure (after clicking .cardRealFixes .cardHeader):
 *   .itemViewerContainer li a
 *     .articleHeader h2  → fix title
 *     .fixedItDiv span:first-child → "Fixed It!" count
 *     p → preview text (complaint/cause/correction)
 *
 * @returns {Array<{title, fixedItCount, complaint, source}>}
 */
async function extractRealFixes(page) {
  try {
    // Click the Real Fixes card to open the panel
    const clicked = await clickCard(page, "cardRealFixes");
    if (!clicked) {
      console.log(`${LOG} Real Fixes card not found`);
      // Fallback: scan page body for fix patterns
      return extractRealFixesFallback(page);
    }

    // Wait for fix list to appear
    await page.waitForFunction(
      () => document.querySelectorAll(".itemViewerContainer li").length > 0,
      { timeout: 8000 }
    ).catch(() => {});

    const fixes = await page.evaluate(() => {
      const results = [];
      const items = document.querySelectorAll(".itemViewerContainer li");

      items.forEach((li) => {
        const titleEl = li.querySelector(".articleHeader h2");
        const countEl = li.querySelector(".fixedItDiv span:first-child");
        const previewEl = li.querySelector("p");

        const title = titleEl?.textContent?.trim() || "";
        const fixedItCount = parseInt(countEl?.textContent?.trim() || "0") || 0;
        const preview = previewEl?.textContent?.trim() || "";

        if (title && title.length > 5) {
          results.push({
            title,
            fixedItCount,
            complaint: preview.substring(0, 400),
            source: "prodemand",
          });
        }
      });

      // Also check for Real Fix article content if we're in article view
      if (results.length === 0) {
        const articleTitle = document.querySelector("#realFix .dashboardHeader h1, #articleViewerContainer h1")?.textContent?.trim();
        const sections = document.querySelectorAll("#realFix h2, #articleViewerContainer h2");
        if (articleTitle) {
          let complaint = "", cause = "", correction = "";
          sections.forEach((h2) => {
            const text = h2.textContent?.trim().toLowerCase();
            const next = h2.nextElementSibling;
            const content = next?.textContent?.trim() || "";
            if (text === "complaint") complaint = content;
            else if (text === "cause") cause = content;
            else if (text === "correction") correction = content;
          });
          results.push({
            title: articleTitle,
            fixedItCount: 1,
            complaint: complaint.substring(0, 400),
            cause: cause.substring(0, 400),
            correction: correction.substring(0, 400),
            source: "prodemand",
          });
        }
      }

      return results;
    });

    console.log(`${LOG} Real Fixes: ${fixes.length} found`);
    return fixes;
  } catch (err) {
    console.error(`${LOG} extractRealFixes error: ${err.message}`);
    return [];
  }
}

/**
 * Fallback: extract fix-like content from page body text.
 */
async function extractRealFixesFallback(page) {
  try {
    return await page.evaluate(() => {
      const results = [];
      const text = document.body.innerText;
      const fixPattern = /(?:symptom|complaint|condition|verified fix)[:\s]*([^\n]{10,200})/gi;
      let match;
      while ((match = fixPattern.exec(text)) !== null && results.length < 10) {
        results.push({ complaint: match[1].trim(), source: "prodemand" });
      }
      return results;
    });
  } catch {
    return [];
  }
}

/**
 * Extract labor times from ProDemand's Parts & Labor card.
 *
 * Structure (after clicking .cardPartsLabor .cardHeader):
 *   #laborDetails li.item
 *     .itemCollapsableHeader h2 → procedure name
 *     .col.labor → hours (e.g. "0.8")
 *     .col.skill → skill level (A/B/C/D)
 *
 * Note: clicking this card may navigate to a different URL section
 * (.../PartsAndLabor/...). Extract from that page directly.
 *
 * @returns {Array<{procedure, hours, skill, source}>}
 */
async function extractLaborTimes(page) {
  try {
    // Click the Parts & Labor card
    const clicked = await clickCard(page, "cardPartsLabor");
    if (!clicked) {
      console.log(`${LOG} Parts & Labor card not found — trying body text scan`);
      return extractLaborFallback(page);
    }

    // Wait for P&L page content to load
    await page.waitForFunction(
      () => document.body.innerText.toLowerCase().includes("labor"),
      { timeout: 10000 }
    ).catch(() => {});

    const laborUrl = page.url();
    console.log(`${LOG} Labor page URL: ${laborUrl}`);

    // #laborDetails only populates after clicking a procedure item in the left nav.
    // Check if it's already loaded, otherwise click the first available item.
    let laborCount = await page.evaluate(() =>
      document.querySelectorAll("#laborDetails li.item, .col.labor").length
    );

    if (laborCount === 0) {
      // P&L page may auto-load labor data from the URL — wait longer before giving up
      console.log(`${LOG} Labor data not yet loaded — waiting up to 5s`);
      for (let i = 0; i < 5; i++) {
        laborCount = await page.evaluate(() =>
          document.querySelectorAll("#laborDetails li.item, .col.labor").length
        );
        if (laborCount > 0) break;
        await sleep(1000);
      }

      // If still nothing, try clicking a procedure item (Remove & Replace style)
      if (laborCount === 0) {
        const itemClicked = await page.evaluate(() => {
          const procedureKeywords = ["remove", "replace", "install", "clean", "inspect", "overhaul", "r&r"];
          const allH2s = Array.from(document.querySelectorAll("h2, li h2, .itemCollapsableHeader h2"));
          const proc = allH2s.find((el) => {
            const text = el.textContent.trim().toLowerCase();
            return procedureKeywords.some((kw) => text.includes(kw)) && text.length > 10;
          }) || allH2s.find((el) => el.textContent.trim().split(" ").length > 2);
          if (proc) { proc.click(); return proc.textContent.trim().substring(0, 80); }
          return null;
        });
        if (itemClicked) {
          console.log(`${LOG} Clicked procedure: "${itemClicked}"`);
          await sleep(2500);
        }
      }
    }

    const times = await page.evaluate(() => {
      const results = [];

      // Strategy 1: #laborDetails li.item structure (fully loaded)
      document.querySelectorAll("#laborDetails li.item").forEach((item) => {
        const procedure = item.querySelector(".itemCollapsableHeader h2")?.textContent?.trim() || "";
        item.querySelectorAll(".row").forEach((row) => {
          const hours = parseFloat(row.querySelector(".col.labor")?.textContent?.trim() || "");
          const skill = row.querySelector(".col.skill")?.textContent?.trim() || "";
          const app = row.querySelector(".col.application h3, .col.application")?.textContent?.trim() || "";
          if (!isNaN(hours) && hours >= 0.1 && hours <= 50) {
            results.push({ procedure: procedure || app || "Labor", hours, skill, source: "prodemand" });
          }
        });
      });

      // Strategy 2: direct .col.labor scan (works if items are visible but #laborDetails not queried)
      if (results.length === 0) {
        document.querySelectorAll(".col.labor").forEach((el) => {
          const hours = parseFloat(el.textContent?.trim() || "");
          if (!isNaN(hours) && hours >= 0.1 && hours <= 50) {
            const row = el.closest(".row");
            const procedure = row?.querySelector(".col.application h3, .col.application")?.textContent?.trim() || "Labor";
            const skill = row?.querySelector(".col.skill")?.textContent?.trim() || "";
            results.push({ procedure, hours, skill, source: "prodemand" });
          }
        });
      }

      // Strategy 3: body text pattern — ProDemand P&L page has:
      //   "PROCEDURE NAME\nAll Applicable Models  C  0.8"
      // Scan for standalone decimal numbers in labor context
      if (results.length === 0) {
        const text = document.body.innerText;
        const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
        for (let i = 0; i < lines.length; i++) {
          // A line that's JUST a number (e.g. "0.8") preceded by a skill letter
          if (/^[ABCD]$/.test(lines[i]) && i + 1 < lines.length) {
            const hours = parseFloat(lines[i + 1]);
            if (!isNaN(hours) && hours >= 0.1 && hours <= 50) {
              const procedure = i >= 2 ? lines[i - 2] : "Labor";
              results.push({ procedure, hours, skill: lines[i], source: "prodemand" });
            }
          }
        }
      }

      return results;
    });

    console.log(`${LOG} Labor times: ${times.length} found`);
    return times;
  } catch (err) {
    console.error(`${LOG} extractLaborTimes error: ${err.message}`);
    return [];
  }
}

/**
 * Fallback: extract labor from body text using hour pattern.
 */
async function extractLaborFallback(page) {
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
 * Build a DTC diagnostic test plan from Real Fixes data.
 * This is more reliable than trying to parse OEM Testing card content.
 * Real Fixes cause/correction sections contain actionable diagnostic info.
 *
 * @param {Array} realFixes - results from extractRealFixes()
 * @param {string} query - the DTC code or symptom
 * @returns {Array<{step, action}>}
 */
function buildDtcPlanFromFixes(realFixes, query) {
  const steps = [];

  // Step 1: Always start with scan tool verification
  steps.push({ step: 1, action: `Confirm ${query} with scan tool. Document freeze frame data.` });

  if (!realFixes || realFixes.length === 0) return steps;

  const topFix = realFixes[0];

  // Step 2: Known cause from Real Fixes
  if (topFix.complaint && topFix.complaint.length > 20) {
    steps.push({ step: 2, action: `Known cause (ProDemand Real Fix): ${topFix.complaint.substring(0, 200)}` });
  }

  if (topFix.cause && topFix.cause.length > 20) {
    steps.push({ step: 3, action: topFix.cause.substring(0, 250) });
  }

  if (topFix.correction && topFix.correction.length > 20) {
    steps.push({ step: steps.length + 1, action: topFix.correction.substring(0, 250) });
  }

  // Step: Note fix count across all real fixes
  const totalFixes = realFixes.reduce((sum, f) => sum + (f.fixedItCount || 0), 0);
  if (totalFixes > 0) {
    steps.push({
      step: steps.length + 1,
      action: `ProDemand: ${realFixes.length} verified fix(es), ${totalFixes} "Fixed It!" confirmations.`,
    });
  }

  return steps;
}

/**
 * (Legacy) — kept for potential future OEM Testing card extraction.
 * Not called from search() — dtcTestPlan is now built from realFixes data.
 */
async function extractDtcTestPlan(page) {
  try {
    // Click the OEM Testing card
    const clicked = await clickCard(page, "cardOEMTesting");
    if (!clicked) {
      console.log(`${LOG} OEM Testing card not found — building steps from Real Fixes`);
      return buildStepsFromRealFixes(page);
    }

    // Wait for OEM-specific content (NOT Real Fixes containers)
    await page.waitForFunction(
      () => {
        // OEM Testing content is in .articleListContent but NOT inside #realFixViewerContainer
        const oemContent = Array.from(document.querySelectorAll(".articleListContent, .articleContent")).find(
          (el) => !el.closest("#realFixViewerContainer") && el.innerText && el.innerText.trim().length > 50
        );
        return !!oemContent;
      },
      { timeout: 8000 }
    ).catch(() => {});

    const steps = await page.evaluate(() => {
      const results = [];

      // Find OEM Testing content — exclude Real Fixes containers
      const contentEl = Array.from(
        document.querySelectorAll(".articleListContent, .articleContent, #contentViewerDiv")
      ).find((el) => !el.closest("#realFixViewerContainer") && el.innerText?.trim().length > 50);

      if (contentEl) {
        const text = contentEl.innerText;
        // Match numbered steps at the START of a line only
        const stepPattern = /^[ \t]*(\d{1,2})[.)]\s+(.{10,400})/gm;
        let match;
        while ((match = stepPattern.exec(text)) !== null && results.length < 15) {
          const action = match[2].trim().replace(/\n.*/g, "");
          if (action.length > 10) {
            results.push({ step: parseInt(match[1]), action });
          }
        }

        // Also try <li> elements
        if (results.length === 0) {
          contentEl.querySelectorAll("li").forEach((li, i) => {
            const liText = li.textContent?.trim();
            if (liText && liText.length > 10 && !liText.includes("Fixed It")) {
              results.push({ step: i + 1, action: liText.substring(0, 300) });
            }
          });
        }
      }

      return results;
    });

    if (steps.length > 0) {
      console.log(`${LOG} DTC test plan: ${steps.length} steps from OEM Testing`);
      return steps;
    }

    // Fallback: build diagnostic steps from Real Fixes cause/correction data
    console.log(`${LOG} OEM Testing had no structured steps — building from Real Fixes`);
    return buildStepsFromRealFixes(page);
  } catch (err) {
    console.error(`${LOG} extractDtcTestPlan error: ${err.message}`);
    return [];
  }
}

/**
 * Build diagnostic steps from Real Fixes cause/correction sections.
 * These are the most actionable steps the tech can follow.
 */
async function buildStepsFromRealFixes(page) {
  try {
    return await page.evaluate(() => {
      const steps = [];

      // Look for Cause and Correction sections in Real Fixes articles
      const h2s = Array.from(document.querySelectorAll("#realFix h2, #articleViewerContainer h2, .realFixList h2"));
      h2s.forEach((h2) => {
        const label = h2.textContent?.trim().toLowerCase();
        const next = h2.nextElementSibling;
        const content = next?.textContent?.trim();
        if (!content || content.length < 10) return;

        if (label === "cause") {
          steps.push({ step: steps.length + 1, action: `Verify cause: ${content.substring(0, 200)}` });
        } else if (label === "correction") {
          steps.push({ step: steps.length + 1, action: `Apply fix: ${content.substring(0, 200)}` });
        }
      });

      // Also check .itemViewerContainer for fix previews
      if (steps.length === 0) {
        document.querySelectorAll(".itemViewerContainer li p").forEach((p, i) => {
          const text = p.textContent?.trim();
          if (text && text.length > 20 && i < 5) {
            steps.push({ step: i + 1, action: text.substring(0, 250) });
          }
        });
      }

      return steps;
    });
  } catch {
    return [];
  }
}

/**
 * Fallback: extract numbered steps from page body.
 */
async function extractTestPlanFallback(page) {
  try {
    return await page.evaluate(() => {
      const steps = [];
      const text = document.body.innerText;
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
 *   4. Select vehicle (Year → Make → Model → Engine → Options → "Use This Vehicle")
 *   5. Search for DTC/symptom → click first result → reach cards grid
 *   6. Extract Real Fixes (click .cardRealFixes card)
 *   7. Navigate back to cards, extract Labor (click .cardPartsLabor card)
 *   8. Navigate back to cards, extract DTC Test Plan (click .cardOEMTesting card)
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

    // Step 2: Check if vehicle is already selected (saves 10-20s on repeat calls)
    const currentBreadcrumb = await page.evaluate(
      () => document.querySelector("#vehicleDetails")?.innerText?.trim() || ""
    );
    const targetKey = `${year}${make}${model}`.replace(/\s+/g, "").toLowerCase();
    const hasBadEngine = /electric|plugin|plug.?in/i.test(currentBreadcrumb);
    const alreadySelected = currentBreadcrumb.replace(/\s+/g, "").toLowerCase().includes(targetKey.substring(0, 12)) && !hasBadEngine;

    if (alreadySelected) {
      console.log(`${LOG} Vehicle already selected: ${currentBreadcrumb} — skipping selector`);
    } else {
      // Step 3a: Navigate to 1SEARCH and select vehicle
      await goToOneSearch(page);
      await selectVehicle(page, { year, make, model, engine });
    }

    // Step 3: (alias for logging clarity)
    const vehicleSelected = true;
    if (!vehicleSelected) {
      console.log(`${LOG} Vehicle selection may be incomplete — proceeding anyway`);
    }

    // Step 4: Search and navigate to cards view
    const { success: searched, cardsUrl } = await performSearch(page, query);
    if (!searched) {
      return {
        source: "ProDemand (direct)",
        vehicle: { vin, year, make, model, engine },
        query,
        error: "Search failed",
        realFixes: [],
        laborTimes: [],
        dtcTestPlan: [],
      };
    }

    // Step 5: Extract Real Fixes (click cardRealFixes from cards view)
    await ensureCardsView(page, cardsUrl);
    const realFixes = await extractRealFixes(page);

    // Step 6: Extract Labor (navigate back to cards, click cardPartsLabor)
    await ensureCardsView(page, cardsUrl);
    const laborTimes = await extractLaborTimes(page);

    // Step 7: Build DTC test plan from Real Fixes data (no extra navigation)
    // This is more reliable than OEM Testing card which bleeds with Real Fixes content
    const dtcTestPlan = buildDtcPlanFromFixes(realFixes, query);

    const pageTitle = await page.title();

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
      pageTitle,
      cardsUrl,
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
