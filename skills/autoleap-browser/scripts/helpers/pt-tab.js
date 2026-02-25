/**
 * PartsTech New-Tab Flow
 *
 * Handles the PartsTech integration through AutoLeap's "Parts ordering" tab.
 * Opens PartsTech in a new browser tab (SSO), searches for parts,
 * adds cheapest in-stock to cart, and submits quote back to AutoLeap.
 */

const { PARTS_TAB, PARTSTECH } = require("./selectors");

const LOG = "[playbook:pt-tab]";

/**
 * Click the "Parts ordering" tab in AutoLeap estimate and click the + button
 * to open a PartsTech tab via SSO.
 *
 * @param {import('puppeteer-core').Page} page - AutoLeap estimate page
 * @param {import('puppeteer-core').Browser} browser - Browser instance
 * @returns {{ ptPage: import('puppeteer-core').Page|null, isIframe: boolean }}
 */
async function openPartsTechTab(page, browser) {
  console.log(`${LOG} Clicking "Parts ordering" tab...`);

  // Click the Parts ordering tab
  await clickByTextFallback(page, [
    PARTS_TAB.TAB,
  ], "Parts ordering");
  await sleep(3000);

  // Screenshot the Parts ordering tab content
  await page.screenshot({ path: "/tmp/debug-parts-ordering-tab.png" });

  // Debug: dump what's visible on the Parts ordering tab
  const partsTabDump = await page.evaluate(() => {
    const visibleButtons = Array.from(document.querySelectorAll("button, a, [role='button']"))
      .filter(b => b.offsetParent !== null)
      .map(b => ({
        text: b.textContent.trim().substring(0, 50),
        class: (b.className || "").substring(0, 50),
        tag: b.tagName,
      }))
      .filter(b => b.text.length > 0)
      .slice(0, 20);
    // Look for any PartsTech-related elements
    const ptElements = Array.from(document.querySelectorAll('[class*="partstech" i], [class*="parts-tech" i], [data-integration*="partstech" i], [class*="integration" i]'))
      .map(el => ({
        tag: el.tagName,
        class: (el.className || "").substring(0, 60),
        text: el.textContent.trim().substring(0, 50),
        visible: el.offsetParent !== null,
      }))
      .slice(0, 10);
    // Look for any + or add buttons
    const addBtns = Array.from(document.querySelectorAll("button, a"))
      .filter(b => b.offsetParent !== null && (b.textContent.trim() === "+" || b.textContent.trim().includes("Add") || b.textContent.trim().includes("Order")))
      .map(b => ({
        text: b.textContent.trim().substring(0, 30),
        class: (b.className || "").substring(0, 50),
        tag: b.tagName,
      }))
      .slice(0, 10);
    return { visibleButtons, ptElements, addBtns };
  });
  console.log(`${LOG} Parts tab buttons: ${JSON.stringify(partsTabDump.visibleButtons)}`);
  console.log(`${LOG} PartsTech elements: ${JSON.stringify(partsTabDump.ptElements)}`);
  console.log(`${LOG} Add/+ buttons: ${JSON.stringify(partsTabDump.addBtns)}`);

  // Wait for PartsTech card
  let ptCardFound = false;
  try {
    await page.waitForSelector(PARTS_TAB.PT_CARD.split(", ")[0], { timeout: 5000 });
    ptCardFound = true;
  } catch {
    // Try broader selector
    ptCardFound = await page.evaluate(() => {
      return !!document.querySelector('[class*="partstech"], [data-integration*="partstech"]');
    });
  }

  if (!ptCardFound) {
    // Try finding ANY + button on the parts tab (the PartsTech add button)
    console.log(`${LOG} PartsTech card not found by selector — trying + buttons directly...`);
  }

  console.log(`${LOG} Clicking PartsTech + button to open new tab...`);

  // Set up new tab listener BEFORE clicking
  const newTabPromise = new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), 15000);
    browser.once("targetcreated", async (target) => {
      clearTimeout(timeout);
      // Wait for SSO redirect to complete
      await sleep(5000);
      try {
        const newPage = await target.page();
        resolve(newPage);
      } catch {
        resolve(null);
      }
    });
  });

  // Debug: dump the exact PartsTech card structure to find the "+" button element
  const ptCardDebug = await page.evaluate(() => {
    // Find the PartsTech card specifically (not Manual Ordering)
    const cards = Array.from(document.querySelectorAll('.ro-partstech-new, .ro-partstech-inner'))
      .filter(el => el.offsetParent !== null && el.textContent.includes("PartsTech") && !el.textContent.includes("manual"));
    if (cards.length === 0) return { found: false };

    // Get the outermost card
    const card = cards[cards.length - 1];
    // Dump ALL children to find the "+" element
    const children = Array.from(card.querySelectorAll("*"))
      .filter(el => el.offsetParent !== null)
      .map(el => ({
        tag: el.tagName,
        class: (el.className || "").substring(0, 60),
        text: el.textContent.trim().substring(0, 20),
        hasClick: typeof el.onclick === "function",
        role: el.getAttribute("role") || "",
        cursor: window.getComputedStyle(el).cursor,
      }))
      .slice(0, 30);
    return { found: true, children };
  });
  console.log(`${LOG} PT card children: ${JSON.stringify(ptCardDebug)}`);

  // Click the PartsTech "+" button using puppeteer native click for proper event dispatch
  // The "+" button is inside a .ro-partstech-new card with "PartsTech" text
  let ptBtnClicked = { clicked: false };

  // Strategy 1: Find PartsTech card, then click the teal "+" element inside it
  const ptBtnSelector = await page.evaluate(() => {
    // Find all ro-partstech-new cards
    const cards = Array.from(document.querySelectorAll('.ro-partstech-new'))
      .filter(el => el.offsetParent !== null);

    for (const card of cards) {
      const text = card.textContent || "";
      if (!text.includes("PartsTech")) continue;
      if (text.includes("manual") || text.includes("Manual")) continue;

      // Look for ANY element that could be the "+" button
      const allEls = Array.from(card.querySelectorAll("*")).filter(el => el.offsetParent !== null);

      // Priority 1: element with "+" text
      for (const el of allEls) {
        const ownText = el.childNodes.length <= 1 ? el.textContent.trim() : "";
        if (ownText === "+" || ownText === "+") {
          el.setAttribute("data-pt-plus", "true");
          return { found: true, tag: el.tagName, text: ownText, strategy: "plus-text" };
        }
      }

      // Priority 2: element with fa-plus icon
      for (const el of allEls) {
        if (el.classList.contains("fa-plus") || el.querySelector(".fa-plus, .pi-plus")) {
          const clickTarget = el.closest("button, a, div[class*='btn'], div[class*='add']") || el;
          clickTarget.setAttribute("data-pt-plus", "true");
          return { found: true, tag: clickTarget.tagName, text: "+icon", strategy: "fa-plus" };
        }
      }

      // Priority 3: element with cursor:pointer that's small (likely a button)
      for (const el of allEls) {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        if (style.cursor === "pointer" && rect.width < 60 && rect.height < 60 && rect.width > 10) {
          el.setAttribute("data-pt-plus", "true");
          return { found: true, tag: el.tagName, text: el.textContent.trim().substring(0, 10), strategy: "cursor-pointer" };
        }
      }

      // Priority 4: last interactive-looking element in the card
      const interactives = allEls.filter(el => {
        const tag = el.tagName;
        return tag === "BUTTON" || tag === "A" || el.getAttribute("role") === "button" ||
          el.classList.contains("pointer") || el.style.cursor === "pointer";
      });
      if (interactives.length > 0) {
        const target = interactives[interactives.length - 1];
        target.setAttribute("data-pt-plus", "true");
        return { found: true, tag: target.tagName, text: target.textContent.trim().substring(0, 10), strategy: "last-interactive" };
      }
    }
    return { found: false };
  });

  console.log(`${LOG} PT button located: ${JSON.stringify(ptBtnSelector)}`);

  if (ptBtnSelector.found) {
    // Use puppeteer native click instead of JS click for proper event dispatch
    try {
      const markedEl = await page.$('[data-pt-plus="true"]');
      if (markedEl) {
        await markedEl.click();
        ptBtnClicked = { clicked: true, btnText: ptBtnSelector.text, strategy: ptBtnSelector.strategy };
      }
    } catch (clickErr) {
      console.log(`${LOG} Puppeteer click failed: ${clickErr.message} — trying JS click`);
      await page.evaluate(() => {
        const el = document.querySelector('[data-pt-plus="true"]');
        if (el) el.click();
      });
      ptBtnClicked = { clicked: true, btnText: ptBtnSelector.text, strategy: ptBtnSelector.strategy + "-js" };
    }
    // Clean up marker
    await page.evaluate(() => {
      const el = document.querySelector('[data-pt-plus="true"]');
      if (el) el.removeAttribute("data-pt-plus");
    });
  }

  console.log(`${LOG} PartsTech button click: ${JSON.stringify(ptBtnClicked)}`);

  const ptPage = await newTabPromise;

  if (ptPage) {
    console.log(`${LOG} PartsTech tab opened: ${ptPage.url().substring(0, 80)}`);
    return { ptPage, isIframe: false };
  }

  // Fallback: check for iframe
  console.log(`${LOG} No new tab detected — checking for iframe...`);
  const hasIframe = await page.$(PARTS_TAB.PT_IFRAME);
  if (hasIframe) {
    console.log(`${LOG} Found PartsTech iframe`);
    return { ptPage: null, isIframe: true };
  }

  console.log(`${LOG} PartsTech did not open (no tab, no iframe)`);
  return { ptPage: null, isIframe: false };
}

/**
 * Search for a part in PartsTech and add the cheapest in-stock to cart.
 *
 * @param {import('puppeteer-core').Page} ptPage - PartsTech tab page
 * @param {string} searchTerm - Part to search for (e.g., "catalytic converter")
 * @returns {{ success: boolean, partDetails?: object, error?: string }}
 */
async function searchAndAddToCart(ptPage, searchTerm) {
  console.log(`${LOG} Searching PartsTech for: "${searchTerm}"`);

  // Dismiss any modal/tour
  try {
    await ptPage.evaluate((sel) => {
      const btn = document.querySelector(sel);
      if (btn) btn.click();
    }, PARTSTECH.DISMISS_MODAL);
  } catch { /* no modal */ }

  // Wait for search input
  let searchInput;
  try {
    searchInput = await ptPage.waitForSelector(PARTSTECH.SEARCH_INPUT.split(", ")[0], { timeout: 10000 });
  } catch {
    // Try other selectors
    for (const sel of PARTSTECH.SEARCH_INPUT.split(", ")) {
      searchInput = await ptPage.$(sel);
      if (searchInput) break;
    }
  }

  if (!searchInput) {
    return { success: false, error: "No search input found in PartsTech" };
  }

  // Verify vehicle banner (SSO should populate it)
  try {
    const banner = await ptPage.$(PARTSTECH.VEHICLE_BANNER.split(", ")[0]);
    if (banner) {
      const bannerText = await ptPage.evaluate(el => el.textContent.trim(), banner);
      if (bannerText) {
        console.log(`${LOG} Vehicle banner: ${bannerText.substring(0, 60)}`);
      }
    }
  } catch { /* banner check optional */ }

  // Clear and type search
  await searchInput.click({ clickCount: 3 });
  await sleep(200);
  await searchInput.type(searchTerm, { delay: 40 });
  await sleep(800);
  await ptPage.keyboard.press("Enter");

  // Wait for results
  console.log(`${LOG} Waiting for search results...`);
  try {
    await Promise.race([
      ptPage.waitForResponse(
        (r) => r.url().includes("/graphql") && r.status() === 200,
        { timeout: 15000 }
      ),
      ptPage.waitForSelector(PARTSTECH.PRODUCT_CARD.split(", ")[0], { timeout: 15000 }),
    ]);
  } catch {
    // Check if we at least have some content
  }

  // Settle time for all supplier results
  await sleep(4000);

  // Check for no results
  const noResults = await ptPage.evaluate((texts) => {
    const body = document.body.innerText;
    return texts.some((t) => body.toLowerCase().includes(t.toLowerCase()));
  }, PARTSTECH.NO_RESULTS_TEXTS);

  if (noResults) {
    return { success: false, error: `No results in PartsTech for: ${searchTerm}` };
  }

  // Find cheapest in-stock and mark it
  const found = await ptPage.evaluate(
    (cardSels, priceSels, oosSelector, cartBtnTexts) => {
      let cards = [];
      for (const sel of cardSels) {
        cards = Array.from(document.querySelectorAll(sel));
        if (cards.length > 0) break;
      }
      if (cards.length === 0) return null;

      let minPrice = Infinity;
      let bestBtn = null;
      let bestDetails = null;

      for (const card of cards) {
        // Skip out-of-stock
        const oos = card.querySelector(oosSelector);
        if (oos) continue;

        // Find add-to-cart button
        let btn = null;
        for (const text of cartBtnTexts) {
          btn = Array.from(card.querySelectorAll("button")).find(
            (b) => b.textContent.trim().includes(text) && !b.disabled
          );
          if (btn) break;
        }
        if (!btn) continue;

        // Find price
        let priceEl = null;
        for (const sel of priceSels) {
          priceEl = card.querySelector(sel);
          if (priceEl) break;
        }
        if (!priceEl) {
          priceEl = Array.from(card.querySelectorAll("*")).find(
            (el) => el.children.length === 0 && el.textContent.includes("$")
          );
        }
        if (!priceEl) continue;

        const price = parseFloat(priceEl.textContent.replace(/[^0-9.]/g, ""));
        if (!isNaN(price) && price > 0 && price < minPrice) {
          minPrice = price;
          bestBtn = btn;
          bestDetails = {
            price,
            brand: (card.querySelector("h3.brand-name, [class*='brand'], .manufacturer") || {}).textContent?.trim() || "",
            partNumber: (card.querySelector("span.part-number, [class*='part-number'], [class*='partNum']") || {}).textContent?.trim() || "",
            description: (card.querySelector("h2, h3, [class*='title'], [class*='description']") || {}).textContent?.trim() || "",
          };
        }
      }

      if (bestBtn && bestDetails) {
        bestBtn.setAttribute("data-sam-cheapest", "true");
        return bestDetails;
      }
      return null;
    },
    PARTSTECH.PRODUCT_CARD.split(", "),
    PARTSTECH.PRICE.split(", "),
    PARTSTECH.OUT_OF_STOCK.split(", ")[0],
    PARTSTECH.CART_BTN_TEXTS
  );

  if (!found) {
    return { success: false, error: "No in-stock parts with price found" };
  }

  console.log(`${LOG} Cheapest in-stock: ${found.brand} $${found.price} (${found.partNumber})`);

  // Click the marked button
  const marked = await ptPage.$('button[data-sam-cheapest="true"]');
  if (!marked) {
    return { success: false, error: "Cheapest part button lost after evaluation" };
  }
  await marked.click();

  // Wait for cart confirmation
  await sleep(3000);
  console.log(`${LOG} Part added to cart`);

  return { success: true, partDetails: found };
}

/**
 * Go to cart and submit quote back to AutoLeap.
 *
 * @param {import('puppeteer-core').Page} ptPage - PartsTech tab page
 * @param {import('puppeteer-core').Page} alPage - AutoLeap estimate page
 * @returns {{ success: boolean, error?: string }}
 */
async function submitCartToAutoLeap(ptPage, alPage) {
  console.log(`${LOG} Navigating to cart review...`);

  // Click cart icon/link
  try {
    await clickByTextFallback(ptPage, [PARTSTECH.CART_LINK], "Cart");
    await sleep(3000);
  } catch {
    // Try direct navigation
    try {
      await ptPage.goto("https://app.partstech.com/review-cart", {
        waitUntil: "domcontentloaded",
        timeout: 10000,
      });
      await sleep(2000);
    } catch (navErr) {
      return { success: false, error: `Cart navigation failed: ${navErr.message}` };
    }
  }

  console.log(`${LOG} Clicking "Submit quote"...`);

  // Click submit quote
  try {
    await clickByTextFallback(ptPage, [PARTSTECH.SUBMIT_QUOTE], "Submit quote");
  } catch (e) {
    return { success: false, error: `Submit quote button not found: ${e.message}` };
  }

  // Wait for tab to close OR timeout
  console.log(`${LOG} Waiting for PartsTech tab to close...`);
  try {
    await Promise.race([
      new Promise((resolve) => {
        ptPage.once("close", resolve);
      }),
      sleep(15000),
    ]);
  } catch { /* tab may already be closed */ }

  // Return focus to AutoLeap
  try {
    await alPage.bringToFront();
  } catch { /* best effort */ }

  // Wait for parts to sync into AutoLeap
  console.log(`${LOG} Waiting for parts sync...`);
  await sleep(5000);

  // Check if parts appeared in AutoLeap
  try {
    await Promise.race([
      alPage.waitForResponse(
        (r) =>
          (r.url().includes("/parts/sync") || r.url().includes("/parts/import")) &&
          r.status() === 200,
        { timeout: 10000 }
      ),
      sleep(8000),
    ]);
  } catch { /* sync check optional — parts may already be there */ }

  console.log(`${LOG} Parts submitted to AutoLeap`);
  return { success: true };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Try clicking by CSS selector first, fall back to text search.
 */
async function clickByTextFallback(page, selectors, textHint) {
  for (const sel of selectors) {
    for (const s of sel.split(", ")) {
      try {
        const el = await page.$(s);
        if (el) {
          await el.click();
          return;
        }
      } catch { /* try next */ }
    }
  }

  // Text fallback
  if (textHint) {
    const clicked = await page.evaluate((text) => {
      const els = Array.from(document.querySelectorAll("button, a, [role='button'], [role='tab']"));
      for (const el of els) {
        if (el.textContent.trim().includes(text)) {
          el.click();
          return true;
        }
      }
      return false;
    }, textHint);
    if (clicked) return;
  }

  throw new Error(`Could not find element to click: ${textHint || selectors[0]}`);
}

module.exports = {
  openPartsTechTab,
  searchAndAddToCart,
  submitCartToAutoLeap,
};
