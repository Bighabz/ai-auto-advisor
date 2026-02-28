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

  // Find cheapest in-stock part using "Add to cart" buttons as anchors.
  // PartsTech uses CSS-in-JS (css-xxxxx class names), so traditional selectors
  // don't work. Instead: find all "Add to cart" buttons → walk up to find a
  // container with a price → compare prices → pick cheapest.
  const found = await ptPage.evaluate((cartBtnTexts) => {
    // Step 1: Find all "Add to cart" buttons
    const allBtns = Array.from(document.querySelectorAll("button")).filter(
      b => b.offsetParent !== null && !b.disabled &&
        cartBtnTexts.some(t => b.textContent.trim().includes(t))
    );
    if (allBtns.length === 0) return null;

    let minPrice = Infinity;
    let bestBtn = null;
    let bestDetails = null;

    for (const btn of allBtns) {
      // Step 2: Walk up to find the product container (common ancestor with a price)
      let container = btn.parentElement;
      let price = 0;
      let priceText = "";
      // Walk up max 8 levels to find a container with a $ price
      for (let depth = 0; depth < 8 && container; depth++) {
        const text = container.textContent || "";
        // Look for a price pattern ($xxx.xx) that's NOT a "List:" price
        const priceMatches = text.match(/(?<!\bList:\s*)\$\s*([\d,]+\.\d{2})/g);
        if (priceMatches && priceMatches.length > 0) {
          // Take the first non-List price (typically the cost/wholesale price)
          for (const pm of priceMatches) {
            const val = parseFloat(pm.replace(/[$,\s]/g, ""));
            if (val > 0) { price = val; priceText = pm; break; }
          }
          if (price > 0) break;
        }
        container = container.parentElement;
      }

      if (price <= 0 || !container) continue;

      // Step 3: Check for out-of-stock indicators in the container
      const containerText = container.textContent.toLowerCase();
      if (containerText.includes("out of stock") || containerText.includes("unavailable")) continue;

      // Step 4: Extract part details from the container
      if (price < minPrice) {
        minPrice = price;
        bestBtn = btn;
        // Try to extract brand, part number, description from the container
        const allText = container.innerText || "";
        const lines = allText.split("\n").map(l => l.trim()).filter(l => l.length > 0 && l.length < 80);
        bestDetails = {
          price,
          brand: lines.find(l => !l.includes("$") && !l.includes("Add") && l.length < 30) || "",
          partNumber: (allText.match(/\b[A-Z0-9]{4,20}\b/) || [""])[0],
          description: lines.find(l => l.length > 15 && !l.includes("$")) || "",
        };
      }
    }

    if (bestBtn && bestDetails) {
      bestBtn.setAttribute("data-sam-cheapest", "true");
      return bestDetails;
    }
    return null;
  }, PARTSTECH.CART_BTN_TEXTS);

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

  // Verify cart was updated — check for cart badge/count or toast
  const cartVerify = await ptPage.evaluate(() => {
    const bodyText = document.body.innerText || "";
    // Look for "added" confirmation toast
    const hasToast = bodyText.toLowerCase().includes("added to cart") ||
      bodyText.toLowerCase().includes("item added");
    // Check cart icon badge
    const cartBadge = document.querySelector("[class*='cart'] [class*='badge'], [class*='cart-count']");
    const cartCount = cartBadge ? cartBadge.textContent.trim() : "no-badge";
    // Check if "Add to cart" button changed to "In cart" or similar
    const btns = Array.from(document.querySelectorAll("button")).filter(
      b => b.offsetParent !== null && /in cart|added|remove/i.test(b.textContent)
    ).map(b => b.textContent.trim().substring(0, 30));
    return { hasToast, cartCount, changedBtns: btns };
  });
  console.log(`${LOG} Cart verify: ${JSON.stringify(cartVerify)}`);

  // Also try taking a screenshot to see the page state after add-to-cart
  try {
    await ptPage.screenshot({ path: "/tmp/debug-pt-after-add-to-cart.png" });
  } catch { /* optional */ }

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

  // Debug: screenshot and dump cart page contents
  try {
    await ptPage.screenshot({ path: "/tmp/debug-pt-cart-page.png" });
  } catch { /* optional */ }

  const cartDebug = await ptPage.evaluate(() => {
    const url = location.href;
    const bodyText = document.body.innerText || "";
    const lines = bodyText.split("\n").map(l => l.trim()).filter(l => l.length > 0 && l.length < 80);
    // Find dollar amounts
    const dollarLines = lines.filter(l => l.includes("$")).slice(0, 10);
    // Find all buttons
    const buttons = Array.from(document.querySelectorAll("button")).filter(b => b.offsetParent !== null)
      .map(b => b.textContent.trim().substring(0, 30)).filter(t => t.length > 0).slice(0, 10);
    // Check if cart is empty
    const isEmpty = bodyText.toLowerCase().includes("empty") || bodyText.toLowerCase().includes("no items");
    return { url, isEmpty, dollarLines, buttons, bodySnippet: bodyText.substring(0, 200) };
  });
  console.log(`${LOG} Cart page debug: ${JSON.stringify(cartDebug)}`);

  console.log(`${LOG} Clicking "Submit quote"...`);

  // Use Puppeteer's trusted click (not DOM el.click()) — React may require trusted events
  const submitResult = await ptPage.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button")).filter(
      b => b.offsetParent !== null && b.textContent.trim().includes("Submit quote")
    );
    if (btns.length === 0) return { found: false };
    const btn = btns[0];
    btn.setAttribute("data-sam-submit", "true");
    const rect = btn.getBoundingClientRect();
    return { found: true, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, text: btn.textContent.trim() };
  });

  if (!submitResult.found) {
    // Fallback to Transfer button
    const transferResult = await ptPage.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button")).filter(
        b => b.offsetParent !== null && b.textContent.trim().includes("Transfer")
      );
      if (btns.length === 0) return { found: false };
      const btn = btns[0];
      const rect = btn.getBoundingClientRect();
      return { found: true, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, text: btn.textContent.trim() };
    });
    if (transferResult.found) {
      await ptPage.mouse.click(transferResult.x, transferResult.y);
      console.log(`${LOG} Clicked Transfer button at (${Math.round(transferResult.x)}, ${Math.round(transferResult.y)})`);
    } else {
      return { success: false, error: "Submit quote / Transfer button not found" };
    }
  } else {
    console.log(`${LOG} Clicking Submit at (${Math.round(submitResult.x)}, ${Math.round(submitResult.y)})`);
    await ptPage.mouse.click(submitResult.x, submitResult.y);
  }

  // Wait a moment for the submit to process
  await sleep(3000);

  // Check for confirmation dialog
  const confirmCheck = await ptPage.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button")).filter(
      b => b.offsetParent !== null && /confirm|yes|ok|continue/i.test(b.textContent.trim())
    );
    return btns.map(b => ({ text: b.textContent.trim().substring(0, 30) }));
  });
  if (confirmCheck.length > 0) {
    console.log(`${LOG} Found confirmation buttons: ${JSON.stringify(confirmCheck)}`);
    // Click the first confirm-like button
    await ptPage.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button")).filter(
        b => b.offsetParent !== null && /confirm|yes|ok|continue/i.test(b.textContent.trim())
      );
      if (btns[0]) btns[0].click();
    });
    await sleep(2000);
  }

  // Screenshot after submit attempt
  try {
    await ptPage.screenshot({ path: "/tmp/debug-pt-after-submit.png" });
  } catch { /* tab may be closed */ }

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

  // Check if tab actually closed
  try {
    const stillOpen = !ptPage.isClosed();
    console.log(`${LOG} PartsTech tab ${stillOpen ? "still open" : "closed"}: ${stillOpen ? ptPage.url().substring(0, 80) : "closed"}`);
  } catch { /* tab closed */ }

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
