/**
 * PartsTech New-Tab Flow
 *
 * Handles the PartsTech integration through AutoLeap's "Parts ordering" tab.
 * Opens PartsTech via direct API call (bypasses UI if-disabled button),
 * searches for parts, adds cheapest in-stock to cart, and submits quote
 * back to AutoLeap.
 *
 * Key insight from Angular source analysis:
 * - AutoLeap's createQoute API: GET /api/v1/partstech/create/qoute?orderId=xxx&vehicleId=yyy
 * - Returns { redirectUrl } which is the PartsTech SSO URL
 * - Angular opens it with window.open(url, "_self") — same tab, not new tab
 * - We open it in a NEW tab instead, so we can interact with both pages
 */

const { PARTS_TAB, PARTSTECH } = require("./selectors");
const { getToken, createPartsTechQuote } = require("../autoleap-api");

const LOG = "[playbook:pt-tab]";

/**
 * Open PartsTech via direct API call, bypassing the disabled UI button.
 *
 * @param {import('puppeteer-core').Page} page - AutoLeap estimate page
 * @param {import('puppeteer-core').Browser} browser - Browser instance
 * @param {string} estimateId - AutoLeap estimate ObjectId
 * @param {string} vehicleId - AutoLeap vehicle ObjectId
 * @returns {{ ptPage: import('puppeteer-core').Page|null, isIframe: boolean }}
 */
async function openPartsTechTab(page, browser, estimateId, vehicleId) {
  console.log(`${LOG} Opening PartsTech via direct API...`);

  // Strategy 1: Call the AutoLeap API directly to get the SSO redirect URL
  // This bypasses the if-disabled button entirely
  if (estimateId && vehicleId) {
    try {
      const token = await getToken();
      if (token) {
        console.log(`${LOG} Calling createPartsTechQuote API...`);
        const quoteResult = await createPartsTechQuote(token, estimateId, vehicleId);

        // API returns { status, response: { sessionId, redirectUrl }, error }
        const redirectUrl = quoteResult?.redirectUrl || quoteResult?.response?.redirectUrl;

        if (redirectUrl) {
          console.log(`${LOG} Got SSO URL: ${redirectUrl.substring(0, 100)}...`);

          // Open the SSO URL in a NEW tab (AutoLeap uses _self, but we want a separate tab)
          const ptPage = await browser.newPage();
          await ptPage.goto(redirectUrl, {
            waitUntil: "domcontentloaded",
            timeout: 30000,
          });
          // Wait for SSO redirect to complete
          await sleep(5000);

          console.log(`${LOG} PartsTech tab opened: ${ptPage.url().substring(0, 80)}`);

          // Check if we landed on an error page
          const ptUrl = ptPage.url();
          if (ptUrl.includes("chrome-error") || ptUrl === "about:blank") {
            console.log(`${LOG} PartsTech SSO failed (error page) — closing tab`);
            await ptPage.close();
            return { ptPage: null, isIframe: false };
          }

          return { ptPage, isIframe: false };
        } else {
          console.log(`${LOG} API returned no redirectUrl: ${JSON.stringify(quoteResult).substring(0, 200)}`);
        }
      }
    } catch (apiErr) {
      console.log(`${LOG} Direct API approach failed: ${apiErr.message}`);
    }
  }

  // Strategy 2: Try clicking the PartsTech button (may be disabled)
  console.log(`${LOG} Falling back to UI button click...`);
  await clickByTextFallback(page, [PARTS_TAB.TAB], "Parts ordering");
  await sleep(3000);

  // Set up new tab listener BEFORE clicking
  const newTabPromise = new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), 15000);
    browser.once("targetcreated", async (target) => {
      clearTimeout(timeout);
      await sleep(5000);
      try {
        const newPage = await target.page();
        resolve(newPage);
      } catch {
        resolve(null);
      }
    });
  });

  // Find and click the PartsTech button
  const ptBtnSelector = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll(".ro-partstech-new"))
      .filter(el => el.offsetParent !== null);

    for (const card of cards) {
      const text = card.textContent || "";
      if (!text.includes("PartsTech")) continue;
      if (text.includes("manual") || text.includes("Manual")) continue;

      const allEls = Array.from(card.querySelectorAll("*")).filter(el => el.offsetParent !== null);

      // Find the button with fa-plus icon
      for (const el of allEls) {
        if (el.tagName === "BUTTON" && el.querySelector("i.fa-plus, i[class*='fa-plus']")) {
          el.setAttribute("data-pt-plus", "true");
          return { found: true, tag: "BUTTON", strategy: "button-with-plus-icon" };
        }
      }

      // Find via plus text
      for (const el of allEls) {
        const ownText = el.childNodes.length <= 1 ? el.textContent.trim() : "";
        if (ownText === "+") {
          el.setAttribute("data-pt-plus", "true");
          return { found: true, tag: el.tagName, strategy: "plus-text" };
        }
      }
    }
    return { found: false };
  });

  if (ptBtnSelector.found) {
    // Force-enable if disabled
    await page.evaluate(() => {
      const el = document.querySelector('[data-pt-plus="true"]');
      if (el) {
        el.classList.remove("if-disabled");
        el.removeAttribute("disabled");
        el.style.pointerEvents = "auto";
        el.style.opacity = "1";
      }
    });
    await sleep(200);

    try {
      const markedEl = await page.$('[data-pt-plus="true"]');
      if (markedEl) await markedEl.click();
    } catch (clickErr) {
      console.log(`${LOG} Button click failed: ${clickErr.message}`);
    }

    await page.evaluate(() => {
      const el = document.querySelector('[data-pt-plus="true"]');
      if (el) el.removeAttribute("data-pt-plus");
    });
  }

  const ptPage = await newTabPromise;
  if (ptPage) {
    console.log(`${LOG} PartsTech tab opened via button: ${ptPage.url().substring(0, 80)}`);
    return { ptPage, isIframe: false };
  }

  // Check for iframe fallback
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
  } catch { /* check if we at least have some content */ }

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

  // Debug: take screenshot and dump DOM state before card search
  try {
    await ptPage.screenshot({ path: "/tmp/debug-pt-search-results.png" });
  } catch { /* screenshot optional */ }

  // Debug: check what's on the page
  const pageDebug = await ptPage.evaluate((cardSels) => {
    const url = location.href;
    const bodyLen = document.body.innerText.length;
    // Check each card selector
    const cardCounts = {};
    for (const sel of cardSels) {
      cardCounts[sel] = document.querySelectorAll(sel).length;
    }
    // Find any elements with "$" in text (prices)
    const priceEls = Array.from(document.querySelectorAll("*")).filter(
      el => el.children.length === 0 && el.textContent.includes("$") && el.offsetParent !== null
    ).slice(0, 10).map(el => ({
      tag: el.tagName,
      cls: (el.className || "").substring(0, 40),
      text: el.textContent.trim().substring(0, 30),
    }));
    // Find any buttons with cart-related text
    const cartBtns = Array.from(document.querySelectorAll("button")).filter(
      b => b.offsetParent !== null && /add|cart/i.test(b.textContent)
    ).slice(0, 5).map(b => ({
      text: b.textContent.trim().substring(0, 30),
      disabled: b.disabled,
      cls: (b.className || "").substring(0, 40),
    }));
    return { url, bodyLen, cardCounts, priceEls, cartBtns };
  }, PARTSTECH.PRODUCT_CARD.split(", "));
  console.log(`${LOG} Page debug: ${JSON.stringify(pageDebug)}`);

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
        const oos = card.querySelector(oosSelector);
        if (oos) continue;

        let btn = null;
        for (const text of cartBtnTexts) {
          btn = Array.from(card.querySelectorAll("button")).find(
            (b) => b.textContent.trim().includes(text) && !b.disabled
          );
          if (btn) break;
        }
        if (!btn) continue;

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

  const marked = await ptPage.$('button[data-sam-cheapest="true"]');
  if (!marked) {
    return { success: false, error: "Cheapest part button lost after evaluation" };
  }
  await marked.click();
  await sleep(3000);
  console.log(`${LOG} Part added to cart`);

  return { success: true, partDetails: found };
}

/**
 * Go to cart and submit quote back to AutoLeap.
 */
async function submitCartToAutoLeap(ptPage, alPage) {
  console.log(`${LOG} Navigating to cart review...`);

  try {
    await clickByTextFallback(ptPage, [PARTSTECH.CART_LINK], "Cart");
    await sleep(3000);
  } catch {
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
  } catch { /* sync check optional */ }

  console.log(`${LOG} Parts submitted to AutoLeap`);
  return { success: true };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

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
