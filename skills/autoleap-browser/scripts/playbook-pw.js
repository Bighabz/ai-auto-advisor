/**
 * Master Playbook — 100% Browser-Driven AutoLeap Estimate
 *
 * Replicates the exact 14-step manual process using Playwright (via pw-shim):
 *   Phase 1: Authentication (Step 1)
 *   Phase 2: Customer & Vehicle (Steps 2-5)
 *   Phase 3: Parts via PartsTech (Steps 6-9)
 *   Phase 4: Labor via MOTOR (Steps 10-11)
 *   Phase 5: Link Parts to Labor (Step 12) — THE PROFIT STEP
 *   Phase 6: Save + PDF (Steps 13-14)
 *
 * No REST API fallback. No code-calculated prices.
 * AutoLeap handles all pricing through its markup matrix.
 */

const os = require("os");
const fs = require("fs");
const path = require("path");
const { LOGIN, CUSTOMER, ESTIMATE, PARTS_TAB, SERVICES } = require("./helpers/selectors");
const { openPartsTechTab, clearCart, searchAndAddToCart, submitCartToAutoLeap } = require("./helpers/pt-tab");
const { navigateMotorTree } = require("./helpers/motor-nav");
const { getToken, invalidateTokenCache, getEstimate, addServiceToEstimate, searchCustomer, createCustomer, createEstimate } = require("./autoleap-api");

const LOG = "[playbook]";
const CHROME_CDP_URL = "http://127.0.0.1:18800";
const AUTOLEAP_APP_URL = "https://app.myautoleap.com";

/**
 * Run the full 14-step browser playbook.
 *
 * @param {object} params
 * @param {object} params.customer - { name, phone }
 * @param {object} params.vehicle - { year, make, model, vin, engine }
 * @param {object} params.diagnosis - Diagnosis result from diagnose.js
 * @param {object[]} params.parts - Parts from PartsTech search (each has .selected and .requested)
 * @param {function} [params.progressCallback] - Called with phase name for Telegram updates
 * @returns {Promise<object>} - { success, roNumber, estimateId, total, totalLabor, totalParts, laborHours, pdfPath, pricingSource, partsAdded, laborResult }
 */
async function runPlaybook({ customer, vehicle, diagnosis, query, parts, progressCallback }) {
  let pwShim;
  try {
    pwShim = require("./helpers/pw-shim");
  } catch (e) {
    return { success: false, error: "playwright-core not available: " + e.message };
  }

  let browser;
  const result = {
    success: false,
    roNumber: null,
    estimateId: null,
    total: 0,
    totalLabor: 0,
    totalParts: 0,
    laborHours: 0,
    pdfPath: null,
    pricingSource: "autoleap-native",
    partsAdded: [],
    laborResult: null,
    warnings: [],
  };

  try {
    browser = await pwShim.connect({
      browserURL: CHROME_CDP_URL,
      defaultViewport: { width: 1280, height: 900 },
    });

    // Find or create AutoLeap page
    let page = browser.pages().find((p) => p.url().includes("myautoleap.com"));
    if (!page) {
      page = browser.pages()[0] || (await browser.newPage());
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PHASE 1: Authentication (Step 1)
    // ═══════════════════════════════════════════════════════════════════════════
    await progress(progressCallback, "logging_in");
    console.log(`${LOG} Phase 1: Logging into AutoLeap...`);
    await ensureLoggedIn(page);
    // After login, invalidate stale token cache so getToken() captures fresh session
    invalidateTokenCache();

    // ═══════════════════════════════════════════════════════════════════════════
    // PHASE 2: Customer & Vehicle — HYBRID (API create + Sidebar bind)
    //
    // API: searchCustomer/createCustomer/createEstimate (reliable IDs)
    // Browser: Navigate to estimate → customer sidebar auto-opens →
    //          click Vehicles tab → select/add vehicle → Save
    // No createVehicle API (maps "Versa" to "GT-R").
    // ═══════════════════════════════════════════════════════════════════════════
    await progress(progressCallback, "creating_customer");
    console.log(`${LOG} Phase 2: Hybrid+Sidebar — ${customer.name} + ${vehicle.year} ${vehicle.make} ${vehicle.model}...`);
    const createResult = await createEstimateViaUI(page, customer, vehicle);

    if (!createResult.success) {
      result.error = createResult.error;
      return result;
    }

    result.estimateId = createResult.estimateId;
    result.roNumber = createResult.roNumber;
    result.customerId = createResult.customerId;
    result.vehicleId = createResult.vehicleId;
    console.log(`${LOG} Phase 2 complete: RO ${result.roNumber || result.estimateId} — vehicle bound in Angular ✓`);

    // Wait for estimate page to fully settle
    await sleep(3000);

    // ═══════════════════════════════════════════════════════════════════════════
    // PHASE 3 (formerly 4): Labor via MOTOR (Steps 10-11)
    // Run MOTOR BEFORE PartsTech — MOTOR connection enables the PT button
    // ═══════════════════════════════════════════════════════════════════════════
    await progress(progressCallback, "adding_labor");
    console.log(`${LOG} Phase 3: Opening MOTOR catalog (runs before PartsTech to connect vehicle)...`);

    // AutoLeap estimate may load in VIEW mode with "Click 'Edit' to update RO" banner.
    // Must click "Edit" to enter edit mode before Browse/MOTOR will work.
    const editBtnClicked = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button"));
      const editBtn = btns.find(b =>
        b.offsetParent !== null &&
        b.textContent.trim() === "Edit" &&
        (b.className || "").includes("btn-brown")
      );
      if (editBtn) {
        const rect = editBtn.getBoundingClientRect();
        return { found: true, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      }
      return { found: false };
    });
    if (editBtnClicked.found) {
      console.log(`${LOG} Phase 3: Clicking "Edit" to enter edit mode...`);
      await page.mouse.click(editBtnClicked.x, editBtnClicked.y);
      await sleep(3000);
    }

    let motorResult = await navigateMotorTree(page, diagnosis, vehicle, query);

    if (motorResult.success) {
      result.laborResult = motorResult;
      result.laborHours = motorResult.hours || 0;
      const addOnStr = motorResult.addOns?.length > 0 ? `, add-ons: ${motorResult.addOns.join(", ")}` : "";
      console.log(`${LOG} Phase 3: MOTOR labor added: ${motorResult.hours}h (NEVER modifying Qty/Hrs)${addOnStr}`);

      // Surface any procedures Claude requested that MOTOR didn't have
      if (motorResult.skippedProcedures && motorResult.skippedProcedures.length > 0) {
        result.warnings.push({
          code: "NO_MOTOR_MATCH",
          msg: `MOTOR has no procedure for: ${motorResult.skippedProcedures.join(", ")} — labor may be AI-estimated`,
        });
      }

      // After MOTOR dialog closes, navigate tabs to force Angular to update state.
      // DO NOT reload the page — reload resets Angular state and breaks PT button.
      console.log(`${LOG} Phase 3b: Saving estimate + verifying MOTOR service...`);

      // Save first — commits the MOTOR labor addition
      await saveEstimate(page);
      await sleep(3000);

      // Click "Services" tab to force Angular to render the services panel
      await clickTab(page, "Services");
      await sleep(2000);

      // Verify MOTOR service appears in the services panel
      const procShort = (motorResult.procedure || "").substring(0, 15);
      const serviceCheck = await page.evaluate((procName, procShort) => {
        const allText = document.body.innerText || "";
        const hasService = allText.includes(procName) || allText.includes(procShort);
        // Look for MOTOR tag badges
        const allBadges = Array.from(document.querySelectorAll("span, div")).filter(el =>
          el.offsetParent !== null && el.textContent.trim() === "MOTOR"
        );
        return { hasService, motorBadges: allBadges.length };
      }, motorResult.procedure, procShort);
      console.log(`${LOG} Phase 3b: Service in estimate: ${serviceCheck.hasService}, MOTOR badges: ${serviceCheck.motorBadges}`);

      // Now click "Parts ordering" tab for Phase 4
      await clickTab(page, "Parts ordering");
      await sleep(2000);

      // Check PT button state after tab navigation
      const ptCheck = await page.evaluate(() => {
        const ptBtns = Array.from(document.querySelectorAll(".ro-partstech-new button, [class*='partstech'] button"));
        return ptBtns.map(b => ({
          classes: (b.className || "").substring(0, 80),
          disabled: b.disabled,
          hasIfDisabled: b.className.includes("if-disabled"),
          visible: b.offsetParent !== null,
          text: b.textContent.trim().substring(0, 20),
        }));
      });
      console.log(`${LOG} Phase 3b: PT buttons after tab nav: ${JSON.stringify(ptCheck)}`);

      try { await page.screenshot({ path: "/tmp/debug-after-motor-save.png" }); } catch { /* optional */ }
    } else {
      console.log(`${LOG} Phase 3: MOTOR navigation failed: ${motorResult.error}`);
      result.warnings.push({ code: "MOTOR_FAILED", msg: motorResult.error });

      // ── Fallback: Add manual service line when MOTOR fails ──
      // Extract labor hours from ProDemand (research phase) or use default
      const fallbackHours = diagnosis?.prodemand?.laborTimes?.[0]?.hours || 1.5;
      const repairName = getRepairName(diagnosis, query);
      const laborRate = Number(process.env.AUTOLEAP_LABOR_RATE) || 120;
      console.log(`${LOG} Phase 3: Attempting manual service: "${repairName}" (${fallbackHours}h @ $${laborRate}/h)...`);

      const manualResult = await addManualServiceLine(page, result.estimateId, repairName, fallbackHours, laborRate);
      if (manualResult.success) {
        motorResult = { success: true, procedure: repairName, hours: fallbackHours, manual: true };
        result.laborResult = motorResult;
        result.laborHours = fallbackHours;
        result.warnings.push({ code: "MANUAL_SERVICE", msg: `Manual: ${repairName} (${fallbackHours}h) — ProDemand/AI labor` });
        console.log(`${LOG} Phase 3: Manual service added via ${manualResult.method} ✓`);

        // Save and prepare for PartsTech
        await saveEstimate(page);
        await sleep(3000);
        await clickTab(page, "Services");
        await sleep(2000);
        await clickTab(page, "Parts ordering");
        await sleep(2000);
      } else {
        console.log(`${LOG} Phase 3: Manual service also failed: ${manualResult.error}`);
        result.warnings.push({ code: "NO_SERVICE", msg: "Neither MOTOR nor manual service could be added" });
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PHASE 4 (formerly 3): Parts via PartsTech (Steps 6-9)
    // Runs after MOTOR so vehicle is MOTOR-connected → PT button enabled
    // ═══════════════════════════════════════════════════════════════════════════
    const partsToAdd = (parts || []).filter((p) => p.selected || p.requested);
    if (partsToAdd.length > 0) {
      await progress(progressCallback, "adding_parts");
      console.log(`${LOG} Phase 4: Opening PartsTech tab...`);

      const { ptPage, isIframe } = await openPartsTechTab(page, browser, result.estimateId, result.vehicleId);

      // Get the working page for PartsTech (either new tab or iframe content)
      let ptWorkPage = ptPage;
      if (!ptWorkPage && isIframe) {
        console.log(`${LOG} Phase 4: PartsTech opened as iframe — getting frame content...`);
        try {
          const iframeSrcs = await page.evaluate(() => {
            return Array.from(document.querySelectorAll("iframe")).map(f => ({
              src: (f.src || "").substring(0, 120),
              id: f.id || "",
              cls: (f.className || "").substring(0, 40),
            }));
          });
          console.log(`${LOG} Phase 4: All iframes: ${JSON.stringify(iframeSrcs)}`);

          const iframeEl = await page.$('iframe[src*="partstech"]') || await page.$('iframe:not([src=""])');
          if (iframeEl) {
            const iframeSrc = await page.evaluate(el => el.src || el.getAttribute("src") || "no-src", iframeEl);
            console.log(`${LOG} Phase 4: iframe src: ${iframeSrc.substring(0, 120)}`);

            ptWorkPage = await iframeEl.contentFrame();
            if (ptWorkPage) {
              const iframeUrl = ptWorkPage.url() || "";
              console.log(`${LOG} Phase 4: iframe URL: ${iframeUrl.substring(0, 120)}`);
              if (iframeUrl.includes("chrome-error") || iframeUrl === "about:blank") {
                console.log(`${LOG} Phase 4: PartsTech SSO failed (iframe error page)`);
                ptWorkPage = null;
              } else {
                await sleep(3000);
              }
            }
          }
        } catch (iframeErr) {
          console.log(`${LOG} Phase 4: Iframe access failed: ${iframeErr.message}`);
        }
      }

      if (ptWorkPage) {
        // Clear any leftover cart items from previous runs to prevent duplicates
        console.log(`${LOG} Phase 4: Clearing PartsTech cart before adding new parts...`);
        await clearCart(ptWorkPage);

        for (const partItem of partsToAdd) {
          const searchTerm = partItem.requested?.searchTerms?.[0] ||
            partItem.requested?.partType ||
            partItem.selected?.description ||
            partItem.selected?.partType || "";

          if (!searchTerm) {
            result.warnings.push({ code: "PT_NO_SEARCH_TERM", msg: `No search term for part` });
            continue;
          }

          console.log(`${LOG} Phase 4: Searching "${searchTerm}"...`);
          const searchResult = await searchAndAddToCart(ptWorkPage, searchTerm);

          if (searchResult.success) {
            console.log(`${LOG} Phase 4: Cheapest in-stock: ${searchResult.partDetails?.brand} $${searchResult.partDetails?.price}`);
            result.partsAdded.push(searchResult.partDetails);
          } else {
            console.log(`${LOG} Phase 4: Part search failed: ${searchResult.error}`);
            result.warnings.push({ code: "PT_PART_FAILED", msg: searchResult.error });
          }
        }

        // Submit cart to AutoLeap
        if (result.partsAdded.length > 0) {
          console.log(`${LOG} Phase 4: Added ${result.partsAdded.length} to cart, submitting quote...`);
          const submitResult = await submitCartToAutoLeap(ptWorkPage, page);
          if (submitResult.success) {
            console.log(`${LOG} Phase 4: Parts synced to AutoLeap`);
            // After submit, PartsTech redirects the PT tab to AutoLeap estimate page.
            // That redirected page has the fresh parts data. Use it as our working page
            // and close the stale original page.
            if (submitResult.redirectedPage) {
              console.log(`${LOG} Phase 4: Using redirected PT→AutoLeap page (has fresh parts)`);
              const oldPage = page;
              page = submitResult.redirectedPage;
              try { await oldPage.close(); } catch { /* already closed or same page */ }
              await page.bringToFront();
            }
          } else {
            console.log(`${LOG} Phase 4: Cart submit issue: ${submitResult.error}`);
            result.warnings.push({ code: "PT_SUBMIT_FAILED", msg: submitResult.error });
          }
        } else {
          // Close PartsTech tab if still open (only for new tab mode, no parts added)
          if (ptPage && !isIframe) {
            try {
              if (!ptPage.isClosed()) await ptPage.close();
            } catch { /* already closed */ }
            await page.bringToFront();
          }
        }
      } else {
        console.log(`${LOG} Phase 4: PartsTech did not open (no tab, no iframe) — skipping parts`);
        result.warnings.push({ code: "PT_NO_TAB", msg: "PartsTech did not open" });
      }
    } else {
      console.log(`${LOG} Phase 4: No parts to add — skipping PartsTech`);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PHASE 5: Link Parts to Labor (Step 12) — THE PROFIT STEP
    //
    // After PartsTech quote submit, AutoLeap needs a page reload to show the
    // imported parts. We opened PT in a new tab, so Angular doesn't auto-refresh.
    // ═══════════════════════════════════════════════════════════════════════════
    if (result.partsAdded.length > 0 && motorResult.success) {
      await progress(progressCallback, "linking_parts");

      // Ensure we're on the estimate page with parts visible
      // If we swapped to the redirected PT→AutoLeap page, parts should already be here.
      // Otherwise, reload to pick them up.
      const currentUrl = page.url();
      if (!currentUrl.includes(result.estimateId)) {
        console.log(`${LOG} Phase 5: Navigating to estimate...`);
        const estUrl = `${AUTOLEAP_APP_URL}/#/estimate/${result.estimateId}`;
        await page.goto(estUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
        await sleep(5000);
      } else {
        console.log(`${LOG} Phase 5: Already on estimate page (parts should be visible)`);
        await sleep(2000);
      }

      console.log(`${LOG} Phase 5: Linking parts to labor service...`);
      const linkResult = await linkPartsToServices(page, result.partsAdded, motorResult);
      if (linkResult.linked > 0) {
        console.log(`${LOG} Phase 5: Markup matrix triggered (${linkResult.linked} parts linked)`);
      } else {
        console.log(`${LOG} Phase 5: No parts linked — markup may not apply`);
        result.warnings.push({ code: "LINK_FAILED", msg: "Parts not linked to labor — shop markup may not apply" });
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // QUALITY CHECK — validate estimate before finalizing
    // ═══════════════════════════════════════════════════════════════════════════
    console.log(`${LOG} Quality check: Validating estimate...`);
    try {
      await saveEstimate(page);
      await sleep(2000);

      const token = await getToken();
      if (token && result.estimateId) {
        const estData = await getEstimate(token, result.estimateId);
        if (estData) {
          const t = estData.total || {};
          const grandTotal = (typeof t === "object") ? (t.grand || t.total || 0) : (typeof t === "number" ? t : 0);
          const laborTotal = (typeof t === "object") ? (t.labor || 0) : 0;
          const partsTotal = (typeof t === "object") ? (t.parts || 0) : 0;
          const serviceCount = (estData.services || []).length;
          const serviceNames = (estData.services || []).map(s => s.name || s.title || "unnamed");

          console.log(`${LOG} QC: Services(${serviceCount}): ${serviceNames.join(", ")}`);
          console.log(`${LOG} QC: Labor=$${laborTotal}, Parts=$${partsTotal}, Grand=$${grandTotal}`);

          // Flag issues
          if (grandTotal === 0) {
            console.log(`${LOG} QC WARNING: Grand total is $0 — estimate may be empty`);
            result.warnings.push({ code: "QC_ZERO_TOTAL", msg: "Estimate total is $0" });
          }
          if (serviceCount === 0) {
            console.log(`${LOG} QC WARNING: No services on estimate`);
            result.warnings.push({ code: "QC_NO_SERVICES", msg: "No services on estimate" });
          }
          if (partsTotal > 0 && laborTotal === 0) {
            console.log(`${LOG} QC WARNING: Parts but no labor — check service line`);
            result.warnings.push({ code: "QC_NO_LABOR", msg: "Parts added but labor is $0" });
          }

          // Store for Phase 6 (avoid re-fetching)
          result._qcTotals = { labor: laborTotal, parts: partsTotal, grandTotal, source: "api" };
          result._qcEstData = estData;
        }
      }
    } catch (qcErr) {
      console.log(`${LOG} Quality check failed (non-fatal): ${qcErr.message}`);
    }

    // Take QC screenshot — show the estimate Services view
    try {
      const estUrl = `${AUTOLEAP_APP_URL}/#/estimate/${result.estimateId}`;
      const currentUrl = page.url();
      if (!currentUrl.includes(result.estimateId)) {
        await page.goto(estUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
        await sleep(4000);
      }
      await clickTab(page, "Services");
      await sleep(2000);
      await page.screenshot({ path: "/tmp/debug-qc-estimate.png" });
      console.log(`${LOG} QC screenshot saved`);
    } catch (ssErr) {
      console.log(`${LOG} QC screenshot failed: ${ssErr.message}`);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PHASE 6: Save + PDF (Steps 13-14)
    // ═══════════════════════════════════════════════════════════════════════════
    await progress(progressCallback, "generating_pdf");
    console.log(`${LOG} Phase 6: Saving estimate...`);

    // Save the estimate
    await saveEstimate(page);
    await sleep(3000);

    // Strategy 1: Use QC totals if already fetched, otherwise read from API
    let totals = { labor: 0, parts: 0, shopSupplies: 0, tax: 0, grandTotal: 0, source: "none" };
    if (result._qcTotals && result._qcTotals.grandTotal > 0) {
      totals = { ...result._qcTotals, shopSupplies: 0, tax: 0 };
      // Fill in shop supplies and tax from the full estimate data
      try {
        const estData = result._qcEstData;
        if (estData) {
          const t = estData.total || {};
          if (typeof t === "object") {
            totals.shopSupplies = t.shopFee || t.shopSupplyFee?.value || 0;
            totals.tax = (typeof t.tax === "object") ? 0 : (t.tax || 0);
            if (t.taxedAmount) totals.tax = t.taxedAmount;
          }
          if (estData.billableHours) result.laborHours = estData.billableHours;
        }
      } catch { /* use QC totals as-is */ }
      console.log(`${LOG} Phase 6: Using QC totals — labor: $${totals.labor}, parts: $${totals.parts}, grand: $${totals.grandTotal}`);
    } else {
      try {
        const token = await getToken();
        if (token && result.estimateId) {
          const estData = await getEstimate(token, result.estimateId);
          if (estData) {
            const t = estData.total || {};
            if (typeof t === "object" && t !== null) {
              totals.labor = t.labor || 0;
              totals.parts = t.parts || 0;
              totals.shopSupplies = t.shopFee || t.shopSupplyFee?.value || 0;
              totals.tax = (typeof t.tax === "object") ? 0 : (t.tax || 0);
              totals.grandTotal = t.grand || t.total || t.afterTax || 0;
              if (t.taxedAmount) totals.tax = t.taxedAmount;
            } else if (typeof t === "number") {
              totals.grandTotal = t;
            }
            if (estData.billableHours) result.laborHours = estData.billableHours;
            totals.source = "api";
            console.log(`${LOG} Phase 6: API totals — labor: $${totals.labor}, parts: $${totals.parts}, grand: $${totals.grandTotal}`);
          }
        }
      } catch (apiErr) {
        console.log(`${LOG} Phase 6: API totals failed: ${apiErr.message}`);
      }
    }

    // Strategy 2: DOM scraping fallback — click Labor summary tab and parse
    if (totals.grandTotal === 0) {
      console.log(`${LOG} Phase 6: Falling back to DOM totals...`);
      // Click Services tab, then Labor summary tab
      await clickTab(page, "Services");
      await sleep(1500);
      await clickTab(page, "Labor summary");
      await sleep(2000);

      const domTotals = await readEstimateTotals(page);
      console.log(`${LOG} Phase 6: DOM totals: ${JSON.stringify(domTotals)}`);
      if (domTotals.grandTotal > 0 || domTotals.labor > 0) {
        totals = { ...domTotals, source: "dom" };
      }
    }

    result.totalLabor = totals.labor || 0;
    result.totalParts = totals.parts || 0;
    result.total = totals.grandTotal || (result.totalLabor + result.totalParts);

    // Export PDF — use AutoLeap's "Print estimate" button for customer-facing PDF
    console.log(`${LOG} Phase 6: Exporting PDF...`);
    const safeName = `${vehicle.year}-${vehicle.make}-${vehicle.model}`.replace(/[^a-zA-Z0-9\-]/g, "").replace(/\s+/g, "-");
    const pdfOutputPath = path.join(os.tmpdir(), `estimate-${safeName}-${Date.now()}.pdf`);
    let pdfDone = false;

    // Ensure we're on the estimate page
    const estUrl = `${AUTOLEAP_APP_URL}/#/estimate/${result.estimateId}`;
    if (!page.url().includes(result.estimateId)) {
      await page.goto(estUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      await sleep(5000);
    }

    // Strategy 1: Click "Print estimate" — opens customer-facing PDF in new tab
    try {
      // Click the print dropdown icon (fa-print)
      const printIcon = await page.evaluate(() => {
        const icon = document.querySelector("i.fa-print");
        if (icon) {
          const clickTarget = icon.closest("div.pointer, div[class*='selected-view']") || icon.parentElement;
          if (clickTarget) {
            const r = clickTarget.getBoundingClientRect();
            return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
          }
        }
        return null;
      });

      if (printIcon) {
        console.log(`${LOG} Phase 6: Clicking print dropdown...`);
        await page.mouse.click(printIcon.x, printIcon.y);
        await sleep(1500);

        // Click "Print estimate" from dropdown
        const printEstBtn = await page.evaluate(() => {
          const items = Array.from(document.querySelectorAll("li, a, div, span, button"));
          for (const el of items) {
            if (!el.offsetParent) continue;
            const text = el.textContent.trim();
            if (text === "Print estimate" || text === "Print Estimate") {
              const r = el.getBoundingClientRect();
              return { x: r.x + r.width / 2, y: r.y + r.height / 2, text };
            }
          }
          return null;
        });

        if (printEstBtn) {
          console.log(`${LOG} Phase 6: Clicking "${printEstBtn.text}"...`);

          // Listen for new tab (print estimate opens in a new tab)
          const newTabPromise = new Promise((resolve) => {
            const timer = setTimeout(() => resolve(null), 15000);
            browser.once("targetcreated", async (target) => {
              clearTimeout(timer);
              await sleep(3000);
              try { resolve(await target.page()); } catch { resolve(null); }
            });
          });

          await page.mouse.click(printEstBtn.x, printEstBtn.y);
          const printPage = await newTabPromise;

          if (printPage) {
            await sleep(3000);
            console.log(`${LOG} Phase 6: Print estimate tab opened: ${printPage.url().substring(0, 80)}`);

            const pdfBuffer = await printPage.pdf({
              format: "Letter",
              printBackground: true,
              margin: { top: "10mm", bottom: "10mm", left: "8mm", right: "8mm" },
            });

            if (pdfBuffer.length > 5000) {
              fs.writeFileSync(pdfOutputPath, pdfBuffer);
              result.pdfPath = pdfOutputPath;
              console.log(`${LOG} Phase 6: Customer-facing PDF → ${pdfOutputPath} (${pdfBuffer.length} bytes)`);
              pdfDone = true;
            }

            try { await printPage.close(); } catch { /* ok */ }
          } else {
            console.log(`${LOG} Phase 6: Print estimate did not open new tab`);
          }
        }
      }
    } catch (printErr) {
      console.log(`${LOG} Phase 6: Print estimate approach failed: ${printErr.message}`);
    }

    // Strategy 2: REST API PDF download
    if (!pdfDone) {
      try {
        const { downloadEstimatePDF } = require("./autoleap-api");
        const token = await getToken();
        if (token && result.estimateId) {
          const dlPath = await downloadEstimatePDF(token, result.estimateId, pdfOutputPath);
          if (dlPath && fs.existsSync(dlPath)) {
            result.pdfPath = dlPath;
            const stat = fs.statSync(dlPath);
            console.log(`${LOG} Phase 6: PDF via REST API → ${dlPath} (${stat.size} bytes)`);
            pdfDone = true;
          }
        }
      } catch (apiPdfErr) {
        console.log(`${LOG} Phase 6: REST PDF failed: ${apiPdfErr.message}`);
      }
    }

    // Strategy 3: Raw puppeteer page.pdf() (last resort — shows editor UI)
    if (!pdfDone) {
      try {
        const pdfBuffer = await page.pdf({
          format: "Letter",
          printBackground: true,
          margin: { top: "12mm", bottom: "12mm", left: "10mm", right: "10mm" },
        });
        fs.writeFileSync(pdfOutputPath, pdfBuffer);
        result.pdfPath = pdfOutputPath;
        console.log(`${LOG} Phase 6: PDF via puppeteer fallback → ${pdfOutputPath} (${pdfBuffer.length} bytes)`);
      } catch (pdfErr) {
        console.log(`${LOG} Phase 6: PDF export failed: ${pdfErr.message}`);
        result.warnings.push({ code: "PDF_FAILED", msg: pdfErr.message });
      }
    }

    result.success = true;
    const laborRate = Number(process.env.AUTOLEAP_LABOR_RATE) || 120;
    result.laborRate = laborRate;
    // Clean up internal QC fields
    delete result._qcTotals;
    delete result._qcEstData;
    console.log(`${LOG} Complete: ${result.roNumber || result.estimateId}, Labor $${result.totalLabor}, Parts $${result.totalParts}, Total $${result.total}`);

  } catch (err) {
    console.error(`${LOG} Playbook error: ${err.message}`);
    result.error = err.message;
    result.partialResult = { ...result };
  } finally {
    if (browser) browser.disconnect();
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Helper: Click "Confirm" on "Update vehicle for this Order" modal
// AutoLeap shows this modal when changing the vehicle on an existing estimate.
// ═══════════════════════════════════════════════════════════════════════════════

async function clickVehicleConfirmModal(page) {
  const confirmResult = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const confirm = btns.find(b => b.textContent.trim() === "Confirm" && b.offsetParent !== null);
    if (confirm) {
      const rect = confirm.getBoundingClientRect();
      return { found: true, rect: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } };
    }
    return { found: false };
  });
  if (confirmResult.found) {
    await page.mouse.click(confirmResult.rect.x, confirmResult.rect.y);
    console.log(`${LOG}   Clicked "Confirm" on vehicle update modal ✓`);
    await sleep(3000);
    return true;
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 1: Authentication
// ═══════════════════════════════════════════════════════════════════════════════

async function ensureLoggedIn(page) {
  const currentUrl = page.url();

  // Already on a workboard or estimate page
  if (
    currentUrl.includes("/workboard") ||
    currentUrl.includes("/estimates") ||
    currentUrl.includes("/dashboard")
  ) {
    console.log(`${LOG} Already logged in: ${currentUrl.substring(0, 60)}`);
    return;
  }

  // Navigate to login page
  await page.goto(AUTOLEAP_APP_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await sleep(2000);

  // Check if redirected to dashboard (already logged in)
  if (!page.url().includes("/login") && !page.url().endsWith(".com/")) {
    console.log(`${LOG} Session active — redirected to ${page.url().substring(0, 60)}`);
    return;
  }

  // Need to log in
  const email = process.env.AUTOLEAP_EMAIL;
  const password = process.env.AUTOLEAP_PASSWORD;
  if (!email || !password) {
    throw new Error("AUTOLEAP_EMAIL / AUTOLEAP_PASSWORD not set");
  }

  console.log(`${LOG} Logging in as ${email}...`);

  // Wait for login form
  await page.waitForSelector(LOGIN.EMAIL.split(", ")[0], { timeout: 10000 }).catch(() => {});

  // Fill email
  const emailEl = await findFirstElement(page, LOGIN.EMAIL);
  if (!emailEl) throw new Error("Login email field not found");
  await emailEl.click({ clickCount: 3 });
  await emailEl.type(email, { delay: 60 });

  // Fill password
  const passEl = await findFirstElement(page, LOGIN.PASSWORD);
  if (!passEl) throw new Error("Login password field not found");
  await passEl.click({ clickCount: 3 });
  await passEl.type(password, { delay: 60 });

  // Submit
  await page.keyboard.press("Enter");

  // Wait for redirect away from login page
  await page.waitForFunction(
    () => !window.location.href.includes("/login"),
    { timeout: 40000 }
  );
  await sleep(5000);
  console.log(`${LOG} Login successful — ${page.url().substring(0, 60)}`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 2: Customer & Vehicle — HYBRID (API create + Browser fill)
//
// Strategy:
//   1. API: Search for existing customer by phone (reliable, gives us IDs)
//   2. API: If not found, create customer via REST (gives us an _id)
//   3. API: Match vehicle from customer's vehicle list (never createVehicle
//      via API — it maps "Versa" to "GT-R")
//   4. API: createEstimate(token, { customerId, vehicleId }) — reliable,
//      gives us estimateId + roNumber instantly
//   5. Browser: page.goto(/#/estimate/{id}) — always works
//   6. Browser: Type into #estimate-customer autocomplete → select match
//      (Angular binds the customer to its reactive forms)
//   7. Browser: Click #estimate-vehicle autocomplete → select vehicle
//      (Angular binds the vehicle — MOTOR/PartsTech connect)
//   8. Browser: If vehicle not in dropdown (new vehicle), look for
//      "Add vehicle" option in the UI and use it
//   9. Browser: Save
//
// Key insight: API handles entity creation (reliable IDs), browser handles
// Angular state binding (PrimeNG autocomplete selection). No createVehicle
// API call (unreliable). Vehicle selection is always via browser autocomplete.
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Navigation text items that should be EXCLUDED from autocomplete results.
 * AutoLeap's sidebar nav items can appear as visible LI elements.
 */
const NAV_TEXTS = [
  "Dashboard", "Work Board", "Calendar", "Customers", "Catalog",
  "Inventory", "CRM", "Reviews", "Reports", "User Center",
];

async function createEstimateViaUI(page, customer, vehicle) {
  const nameParts = (customer.name || "Customer").trim().split(/\s+/);
  const firstName = nameParts[0] || "";
  const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : "";
  const phoneDigits = (customer.phone || "").replace(/\D/g, "");

  // ══════════════════════════════════════════════════════════════════════════
  // PART A: API — Create customer + estimate (reliable IDs, fast)
  // ══════════════════════════════════════════════════════════════════════════
  console.log(`${LOG} A1: Acquiring API token...`);
  const token = await getToken();
  if (!token) return { success: false, error: "Could not get AutoLeap API token" };

  // ── A2: Search for existing customer ──
  let customerId = null;
  let existingCustomer = null;
  if (customer.phone) {
    console.log(`${LOG} A2: Searching for customer by phone "${customer.phone}"...`);
    const found = await searchCustomer(token, customer.phone);
    if (found?._id) {
      const foundName = `${found.firstName || ""} ${found.lastName || ""}`.trim().toLowerCase();
      const requestedFirst = firstName.toLowerCase();
      // Accept if first name appears in found name (case-insensitive)
      const nameMatches = foundName.includes(requestedFirst) ||
        requestedFirst.includes(foundName.split(" ")[0]);
      if (nameMatches) {
        existingCustomer = found;
        customerId = found._id;
        console.log(`${LOG} A2: Found existing customer: "${found.firstName} ${found.lastName}" (${customerId})`);
      } else {
        console.log(`${LOG} A2: Phone matched "${foundName}" but name "${firstName}" doesn't match — will create new`);
      }
    }
  }

  // ── A3: Create customer if not found ──
  if (!customerId) {
    console.log(`${LOG} A3: Creating customer "${firstName} ${lastName}" via API...`);
    try {
      const newCust = await createCustomer(token, { firstName, lastName, phone: customer.phone || "" });
      customerId = newCust._id;
      console.log(`${LOG} A3: Customer created: ${customerId}`);
    } catch (err) {
      console.log(`${LOG} A3: Customer creation failed: ${err.message} — will continue without`);
    }
  }

  // ── A4: Match vehicle from customer's existing vehicles (no API creation!) ──
  let vehicleId = null;
  const vehicles = existingCustomer?.vehicles || [];
  if (vehicles.length > 0) {
    // VIN match first
    if (vehicle.vin) {
      const vinMatch = vehicles.find(v => v.VIN === vehicle.vin || v.vin === vehicle.vin);
      if (vinMatch) vehicleId = vinMatch.vehicleId;
    }
    // Year/make match
    if (!vehicleId && (vehicle.year || vehicle.make)) {
      const ymMatch = vehicles.find(v => {
        const name = (v.name || "").toLowerCase();
        return (!vehicle.year || name.includes(String(vehicle.year))) &&
               (!vehicle.make || name.includes(vehicle.make.toLowerCase()));
      });
      if (ymMatch) vehicleId = ymMatch.vehicleId;
    }
    if (vehicleId) {
      const veh = vehicles.find(v => v.vehicleId === vehicleId);
      console.log(`${LOG} A4: Matched existing vehicle: "${veh?.name || vehicleId}"`);
    }
  }
  if (!vehicleId) {
    console.log(`${LOG} A4: No matching vehicle in API — will select/add via browser`);
  }

  // ── A5: Create estimate via API ──
  console.log(`${LOG} A5: Creating estimate via API...`);
  let estimateId = null;
  let roNumber = null;
  try {
    const est = await createEstimate(token, { customerId, vehicleId });
    estimateId = est._id;
    roNumber = est.code || est.estimateNumber || null;
    console.log(`${LOG} A5: Estimate created: ${estimateId} (RO: ${roNumber})`);
  } catch (err) {
    return { success: false, error: `API estimate creation failed: ${err.message}` };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PART B: Browser — Navigate + use customer sidebar for vehicle binding
  //
  // When we navigate to the API-created estimate, AutoLeap opens the
  // customer sidebar (.p-sidebar) with the customer already loaded:
  //   - #customer-update-firstname, #customer-update-lastname, #customer-update-phone
  //   - Tabs: Contact | Vehicles | Deferred | Repair order | ...
  //   - Buttons: Save, Estimate, Appointment, etc.
  //
  // Strategy: Navigate → verify sidebar is open with correct customer →
  //           click "Vehicles" tab → select or add vehicle → close sidebar
  // ══════════════════════════════════════════════════════════════════════════

  // ── B1: Navigate to estimate page ──
  const estUrl = `${AUTOLEAP_APP_URL}/#/estimate/${estimateId}`;
  console.log(`${LOG} B1: Navigating to ${estUrl}...`);

  // Go to workboard first to reset Angular router state, then to estimate
  await page.goto(`${AUTOLEAP_APP_URL}/#/workboard`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await sleep(3000);
  await page.goto(estUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  await sleep(5000);

  await safeScreenshot(page, "/tmp/debug-phase2-estimate-page.png");

  // ── B2: Wait for customer sidebar to appear ──
  console.log(`${LOG} B2: Checking customer sidebar...`);

  let sidebarOpen = false;
  for (let attempt = 0; attempt < 5; attempt++) {
    const sidebarCheck = await page.evaluate(() => {
      const sidebar = document.querySelector(".p-sidebar, [class*='p-sidebar']");
      if (!sidebar || sidebar.offsetWidth === 0) return { open: false };
      const fnInput = sidebar.querySelector("#customer-update-firstname, input[id*='firstname']");
      const lnInput = sidebar.querySelector("#customer-update-lastname, input[id*='lastname']");
      const phoneInput = sidebar.querySelector("#customer-update-phone, input[id*='phone']");
      // Check for tabs: "Vehicles", "Contact", etc.
      const tabs = Array.from(sidebar.querySelectorAll("[role='tab'], a, li, span, div"))
        .filter(el => el.offsetParent && /^(Vehicles|Contact|Deferred|Repair order)/i.test(el.textContent.trim()))
        .map(el => el.textContent.trim().substring(0, 20));
      return {
        open: true,
        hasFirstName: !!fnInput,
        firstName: fnInput?.value || "",
        lastName: lnInput?.value || "",
        phone: phoneInput?.value || "",
        tabs,
      };
    });
    console.log(`${LOG}   Sidebar check (attempt ${attempt + 1}): ${JSON.stringify(sidebarCheck)}`);

    if (sidebarCheck.open && sidebarCheck.hasFirstName) {
      sidebarOpen = true;
      console.log(`${LOG}   Customer sidebar open: "${sidebarCheck.firstName} ${sidebarCheck.lastName}" (${sidebarCheck.phone})`);
      console.log(`${LOG}   Sidebar tabs: ${JSON.stringify(sidebarCheck.tabs)}`);
      break;
    }
    await sleep(2000);
  }

  if (!sidebarOpen) {
    // Sidebar didn't auto-open — try clicking on the customer area to trigger it
    console.log(`${LOG}   Sidebar not auto-opened — clicking customer area...`);
    const custClickTarget = await page.evaluate(() => {
      // Try clicking the customer chip or customer field area
      const chip = document.querySelector(".p-autocomplete-token-label, #estimate-customer");
      if (chip && chip.offsetParent) {
        const rect = chip.getBoundingClientRect();
        return { found: true, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      }
      // Try any element containing the customer name
      const custArea = document.querySelector("[class*='customer-name'], [class*='customer-info']");
      if (custArea && custArea.offsetParent) {
        const rect = custArea.getBoundingClientRect();
        return { found: true, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      }
      return { found: false };
    });

    if (custClickTarget.found) {
      await page.mouse.click(custClickTarget.x, custClickTarget.y);
      await sleep(4000);

      // Re-check sidebar
      const recheck = await page.evaluate(() => {
        const sidebar = document.querySelector(".p-sidebar, [class*='p-sidebar']");
        return !!(sidebar && sidebar.offsetWidth > 0);
      });
      sidebarOpen = recheck;
      console.log(`${LOG}   Sidebar after click: ${sidebarOpen ? "OPEN" : "still closed"}`);
    }

    await safeScreenshot(page, "/tmp/debug-phase2-sidebar-retry.png");
  }

  // ── B3: Select vehicle via sidebar Vehicles tab ──
  console.log(`${LOG} B3: Selecting vehicle via sidebar...`);
  let vehicleSelected = false;

  if (sidebarOpen) {
    // Click "Vehicles" tab in the sidebar — MUST use page.mouse.click (PrimeNG ignores DOM .click())
    const vehiclesTabPos = await page.evaluate(() => {
      const sidebar = document.querySelector(".p-sidebar, [class*='p-sidebar']");
      if (!sidebar) return null;
      const tabs = sidebar.querySelectorAll(".p-tabview-nav-link, a[class*='tabview']");
      for (const tab of tabs) {
        if (tab.offsetParent && tab.textContent.trim() === "Vehicles") {
          const rect = tab.getBoundingClientRect();
          return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
        }
      }
      return null;
    });
    let vehiclesTabClicked = false;
    if (vehiclesTabPos) {
      await page.mouse.click(vehiclesTabPos.x, vehiclesTabPos.y);
      vehiclesTabClicked = true;
    }

    if (vehiclesTabClicked) {
      console.log(`${LOG}   Clicked "Vehicles" tab`);
      await sleep(3000);
      await safeScreenshot(page, "/tmp/debug-phase2-vehicles-tab.png");

      // Check if our vehicle is listed
      const vehicleStr = `${vehicle.year} ${vehicle.make} ${vehicle.model}`.toLowerCase();
      const yr = String(vehicle.year || "");
      const mk = (vehicle.make || "").toLowerCase();

      const vehicleListResult = await page.evaluate((yearStr, makeStr, vehicleFullStr) => {
        const sidebar = document.querySelector(".p-sidebar, [class*='p-sidebar']");
        if (!sidebar) return { found: false, error: "no sidebar" };

        // Look for vehicle rows/cards in the sidebar
        const allText = sidebar.innerText || "";
        const hasVehicle = allText.toLowerCase().includes(yearStr) &&
                           allText.toLowerCase().includes(makeStr);

        // Find clickable vehicle items
        const items = Array.from(sidebar.querySelectorAll(
          "[class*='vehicle'], tr, li, [class*='card'], [class*='row'], div"
        )).filter(el => {
          if (!el.offsetParent) return false;
          const t = (el.textContent || "").toLowerCase();
          return t.includes(yearStr) && t.includes(makeStr) && t.length < 200;
        });

        // Find "Add vehicle" button — AutoLeap uses button.btn-add-vehicle
        // Priority 1: exact class match
        let addBtn = sidebar.querySelector("button.btn-add-vehicle");
        // Priority 2: class contains add-vehicle
        if (!addBtn || !addBtn.offsetParent) {
          addBtn = Array.from(sidebar.querySelectorAll("button[class*='add-vehicle']")).find(el => el.offsetParent);
        }
        // Priority 3: button with text "Vehicle" in the vehicles tab area (AutoLeap labels the add button just "Vehicle")
        if (!addBtn || !addBtn.offsetParent) {
          const vehicleBtns = Array.from(sidebar.querySelectorAll("button")).filter(el => {
            if (!el.offsetParent) return false;
            const t = el.textContent.trim();
            return t === "Vehicle" || t === "+ Vehicle" || t === "Add Vehicle" || t === "Add vehicle";
          });
          addBtn = vehicleBtns[0] || null;
        }

        if (items.length > 0) {
          // Vehicle found — click it to select
          const target = items[0];
          // Look for a radio/checkbox or clickable element inside
          const clickable = target.querySelector("input[type='radio'], input[type='checkbox'], a, button") || target;
          const rect = clickable.getBoundingClientRect();
          return {
            found: true,
            x: rect.x + rect.width / 2,
            y: rect.y + rect.height / 2,
            text: items[0].textContent.trim().substring(0, 60),
            hasAddBtn: !!addBtn,
          };
        }

        if (addBtn) {
          const rect = addBtn.getBoundingClientRect();
          return {
            found: false,
            hasAddBtn: true,
            addBtnX: rect.x + rect.width / 2,
            addBtnY: rect.y + rect.height / 2,
            addBtnText: addBtn.textContent.trim().substring(0, 40),
            allText: allText.substring(0, 200),
          };
        }

        return { found: false, hasAddBtn: false, allText: allText.substring(0, 200) };
      }, yr, mk, vehicleStr);

      console.log(`${LOG}   Vehicle list: ${JSON.stringify(vehicleListResult)}`);

      if (vehicleListResult.found) {
        // Click the vehicle to select it
        await page.mouse.click(vehicleListResult.x, vehicleListResult.y);
        console.log(`${LOG}   Clicked vehicle: "${vehicleListResult.text}"`);
        vehicleSelected = true;
        await sleep(2000);
      } else if (vehicleListResult.hasAddBtn) {
        // Click "Add vehicle" button
        console.log(`${LOG}   Vehicle not listed — clicking "Add Vehicle" at (${vehicleListResult.addBtnX}, ${vehicleListResult.addBtnY})...`);
        await page.mouse.click(vehicleListResult.addBtnX, vehicleListResult.addBtnY);
        await sleep(4000);

        // Wait for the "Create new vehicle" dialog (.add-dialog) with #ac-vehicle
        for (let wait = 0; wait < 5; wait++) {
          const hasDialog = await page.evaluate(() => !!document.querySelector("#ac-vehicle"));
          if (hasDialog) {
            console.log(`${LOG}   "Create new vehicle" dialog opened ✓`);
            break;
          }
          console.log(`${LOG}   Waiting for vehicle dialog... (attempt ${wait + 1})`);
          await sleep(2000);
        }

        await safeScreenshot(page, "/tmp/debug-phase2-add-vehicle-form.png");

        // Fill vehicle form via #ac-vehicle autocomplete
        const dialogResult = await fillAddVehicleForm(page, vehicle);

        // After dialog creates vehicle, it appears in the sidebar Vehicles list
        // but is NOT yet assigned to the estimate. Must click the vehicle row.
        if (dialogResult) {
          console.log(`${LOG}   Vehicle created — now clicking it in sidebar to assign to estimate...`);
          await sleep(3000);
          await safeScreenshot(page, "/tmp/debug-phase2-after-dialog-save.png");

          // Re-read sidebar vehicles and click the one matching our year+make
          const assignResult = await page.evaluate((yearStr, makeStr) => {
            const sidebar = document.querySelector(".p-sidebar, [class*='p-sidebar']");
            if (!sidebar) return { assigned: false, error: "no sidebar" };

            const items = Array.from(sidebar.querySelectorAll(
              "[class*='vehicle'], tr, li, [class*='card'], [class*='row'], div"
            )).filter(el => {
              if (!el.offsetParent) return false;
              const t = (el.textContent || "").toLowerCase();
              return t.includes(yearStr) && t.includes(makeStr) && t.length < 200;
            });

            if (items.length > 0) {
              const target = items[0];
              const clickable = target.querySelector("input[type='radio'], input[type='checkbox'], a, button") || target;
              const rect = clickable.getBoundingClientRect();
              return {
                assigned: true,
                x: rect.x + rect.width / 2,
                y: rect.y + rect.height / 2,
                text: target.textContent.trim().substring(0, 60),
              };
            }
            return { assigned: false, sidebarText: (sidebar.innerText || "").substring(0, 300) };
          }, String(vehicle.year || ""), (vehicle.make || "").toLowerCase());

          if (assignResult.assigned) {
            await page.mouse.click(assignResult.x, assignResult.y);
            console.log(`${LOG}   Clicked vehicle in sidebar: "${assignResult.text}" ✓`);
            vehicleSelected = true;
            await sleep(3000);
          } else {
            console.log(`${LOG}   Vehicle not found in sidebar after creation: ${JSON.stringify(assignResult)}`);
            vehicleSelected = false;
          }
        }
      } else {
        console.log(`${LOG}   No vehicles listed and no "Add" button found`);
        // Dump sidebar content for debugging
        await safeScreenshot(page, "/tmp/debug-phase2-no-vehicles.png");
      }
    } else {
      console.log(`${LOG}   "Vehicles" tab not found in sidebar`);
    }
  } else {
    console.log(`${LOG}   Sidebar not open — trying #estimate-vehicle autocomplete fallback...`);
    // Fallback: try the autocomplete on the main estimate page
    const vehResult = await selectVehicleFromAutocomplete(page, vehicle);
    if (vehResult.found) {
      vehicleSelected = true;
      console.log(`${LOG}   Vehicle via autocomplete fallback: "${vehResult.text}"`);
      await sleep(2000);
      await clickVehicleConfirmModal(page);
    }
  }

  // ── B4: Close sidebar and save ──
  console.log(`${LOG} B4: Closing sidebar and saving...`);

  if (sidebarOpen) {
    // Click "Save" button in the sidebar (saves customer + vehicle changes)
    const sidebarSaveClicked = await page.evaluate(() => {
      const sidebar = document.querySelector(".p-sidebar, [class*='p-sidebar']");
      if (!sidebar) return false;
      const btns = Array.from(sidebar.querySelectorAll("button")).filter(b =>
        b.offsetParent && /^save$/i.test(b.textContent.trim()) && !b.disabled
      );
      if (btns.length > 0) { btns[0].click(); return true; }
      return false;
    });

    if (sidebarSaveClicked) {
      console.log(`${LOG}   Sidebar "Save" clicked`);
      await sleep(4000);
    } else {
      // Close sidebar with X button or Escape
      const closeClicked = await page.evaluate(() => {
        const sidebar = document.querySelector(".p-sidebar, [class*='p-sidebar']");
        if (!sidebar) return false;
        const closeBtn = sidebar.querySelector(".p-sidebar-close, [class*='close'], button[aria-label='Close']");
        if (closeBtn) { closeBtn.click(); return true; }
        return false;
      });
      if (closeClicked) {
        console.log(`${LOG}   Sidebar closed via X button`);
      } else {
        await page.keyboard.press("Escape");
        console.log(`${LOG}   Sidebar closed via Escape`);
      }
      await sleep(2000);
    }
  }

  // Handle "Update vehicle for this Order" confirm modal
  await clickVehicleConfirmModal(page);
  await sleep(1000);

  // Save the main estimate
  await saveEstimate(page);
  await sleep(4000);

  // Force Angular to reload estimate with newly-created vehicle
  // Navigate to workboard and back — this resets the component lifecycle
  // After sidebar vehicle creation, also ASSIGN the vehicle to the estimate via API
  // The sidebar creates the vehicle on the CUSTOMER but doesn't assign it to the ESTIMATE
  if (vehicleSelected && estimateId && customerId) {
    console.log(`${LOG}   Assigning vehicle to estimate via API...`);
    try {
      const token = await getToken();
      // Get customer's vehicles to find the one we just created
      const estData = await getEstimate(token, estimateId);
      // Also get customer details to find vehicle IDs
      const custResp = await new Promise((resolve, reject) => {
        const https = require("https");
        const req = https.request({
          hostname: "api.myautoleap.com",
          path: `/api/v1/customers/${customerId}`,
          method: "GET",
          headers: { "authorization": token, "Accept": "application/json", "origin": "https://app.myautoleap.com" },
        }, res => {
          let data = "";
          res.on("data", c => data += c);
          res.on("end", () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
        });
        req.on("error", reject);
        req.end();
      });

      const vehicles = custResp?.response?.vehicles || custResp?.vehicles || [];
      const yr = String(vehicle.year || "");
      const mk = (vehicle.make || "").toLowerCase();
      const matched = vehicles.find(v => {
        const name = (v.name || v.vehicleName || "").toLowerCase();
        return name.includes(yr) && name.includes(mk);
      });

      if (matched) {
        const vehId = matched._id;
        console.log(`${LOG}   Found vehicle on customer: ${matched.name || matched.vehicleName} (${vehId})`);

        // PATCH estimate to assign the vehicle
        const patchResp = await new Promise((resolve, reject) => {
          const https = require("https");
          const body = JSON.stringify({ vehicleId: vehId });
          const req = https.request({
            hostname: "api.myautoleap.com",
            path: `/api/v1/estimates/${estimateId}`,
            method: "PATCH",
            headers: { "Content-Type": "application/json", "authorization": token, "Accept": "application/json", "origin": "https://app.myautoleap.com", "Content-Length": Buffer.byteLength(body) },
          }, res => {
            let data = "";
            res.on("data", c => data += c);
            res.on("end", () => { try { resolve({ status: res.statusCode, data: JSON.parse(data) }); } catch { resolve({ status: res.statusCode }); } });
          });
          req.on("error", reject);
          req.write(body);
          req.end();
        });
        console.log(`${LOG}   PATCH estimate vehicle: ${patchResp.status}`);
        vehicleId = vehId;
      } else {
        console.log(`${LOG}   No matching vehicle found on customer (${vehicles.length} vehicles)`);
      }
    } catch (e) {
      console.log(`${LOG}   Vehicle assignment failed: ${e.message}`);
    }

    // Now refresh the page so Angular picks up the API-assigned vehicle
    console.log(`${LOG}   Refreshing estimate page...`);
    await page.goto(`${AUTOLEAP_APP_URL}/#/workboard`, { waitUntil: "domcontentloaded", timeout: 15000 });
    await sleep(3000);
    await page.goto(`${AUTOLEAP_APP_URL}/#/estimate/${estimateId}`, { waitUntil: "domcontentloaded", timeout: 15000 });
    await sleep(6000);
  }

  await safeScreenshot(page, "/tmp/debug-phase2-saved.png");

  // ── B5: Verify final state ──
  console.log(`${LOG} B5: Verifying estimate state...`);

  // Re-read IDs from API
  try {
    const estData = await getEstimate(token, estimateId);
    if (estData) {
      customerId = estData.customer?.customerId || estData.customer?._id || estData.customerId || customerId;
      vehicleId = estData.vehicle?.vehicleId || estData.vehicle?._id || estData.vehicleId || vehicleId;
      roNumber = estData.code || estData.estimateNumber || roNumber;
      const cn = estData.customer?.fullName || "unknown";
      const vn = estData.vehicle?.name || "unknown";
      console.log(`${LOG}   API verify: customer="${cn}" (${customerId}), vehicle="${vn}" (${vehicleId})`);
    }
  } catch (err) {
    console.log(`${LOG}   API verify failed (non-fatal): ${err.message}`);
  }

  // Verify vehicle in UI
  const vehicleCheck = await page.evaluate((yr, mk) => {
    const chips = Array.from(document.querySelectorAll(
      ".p-autocomplete-token-label, [class*='autocomplete'] [class*='token-label']"
    ));
    const chipText = chips.map(el => el.textContent.trim()).join(" ");
    const body = (document.body?.innerText || "").substring(0, 3000);
    const hasVehicle = (chipText.includes(yr) && chipText.includes(mk)) ||
      (body.includes(yr) && body.includes(mk));
    return { hasVehicle, chipText: chipText.substring(0, 80) };
  }, String(vehicle.year || ""), vehicle.make || "");
  console.log(`${LOG}   Vehicle in UI: ${vehicleCheck.hasVehicle} (chip: "${vehicleCheck.chipText}")`);

  await safeScreenshot(page, "/tmp/debug-phase2-complete.png");

  return {
    success: true,
    estimateId,
    roNumber,
    customerId,
    vehicleId,
  };
}

/**
 * Fill the "Create new vehicle" dialog in the customer sidebar.
 *
 * AutoLeap's dialog (class .add-dialog) contains:
 *   - #ac-customer — pre-filled, disabled (customer name)
 *   - #ac-vehicle  — autocomplete: "Search license plate, VIN, or year, make, model"
 *
 * Strategy:
 *   1. PRIMARY: Type "YEAR MAKE MODEL" into #ac-vehicle, wait for autocomplete, pick match
 *   2. FALLBACK: Try year/make/model <select> dropdowns (older AutoLeap versions)
 *   3. FALLBACK: Try VIN input + decode
 *
 * Returns true if vehicle was added successfully.
 */
async function fillAddVehicleForm(page, vehicle) {
  const vehicleSearchStr = `${vehicle.year || ""} ${vehicle.make || ""} ${vehicle.model || ""}`.trim();
  console.log(`${LOG}   fillAddVehicleForm: searching for "${vehicleSearchStr}"...`);

  // ── Strategy 1: #ac-vehicle autocomplete (the "Create new vehicle" dialog) ──
  const acVehicle = await page.$("#ac-vehicle");
  if (acVehicle) {
    console.log(`${LOG}   Found #ac-vehicle — typing "${vehicleSearchStr}"...`);

    // Clear and type
    await acVehicle.click({ clickCount: 3 });
    await sleep(200);
    await page.keyboard.press("Backspace");
    await sleep(300);
    await acVehicle.type(vehicleSearchStr, { delay: 60 });
    await sleep(4000); // Wait for autocomplete results (Pi is slow)

    await safeScreenshot(page, "/tmp/debug-phase2-ac-vehicle-typed.png");

    // Pick the best match from autocomplete dropdown
    const yr = String(vehicle.year || "");
    const mk = (vehicle.make || "").toLowerCase();
    const mdl = (vehicle.model || "").toLowerCase();

    const picked = await page.evaluate((year, make, model, navTexts) => {
      // Look for autocomplete dropdown items — could be PrimeNG or custom
      const items = Array.from(document.querySelectorAll(
        ".p-autocomplete-panel li, .p-autocomplete-items li, " +
        "[class*='autocomplete'] [class*='list'] li, [role='option'], " +
        ".add-dialog li, .add-dialog [class*='item'], .add-dialog [class*='option']"
      )).filter(li => {
        if (!li.offsetParent) return false;
        const t = li.textContent.trim();
        return t.length > 2 && !navTexts.includes(t) &&
          !li.closest("nav, [class*='sidebar-nav']");
      });

      const texts = items.map(li => li.textContent.trim().substring(0, 80));

      // Scored engine chooser — prefer GAS over EV/BEV (same logic as ProDemand)
      let bestIdx = -1;
      let bestScore = -999;

      for (let i = 0; i < items.length; i++) {
        const t = items[i].textContent.toLowerCase();
        if (t.includes("create manually")) continue; // skip manual option

        let score = 0;
        if (year && t.includes(year)) score += 3;
        if (make && t.includes(make)) score += 3;
        if (model && t.includes(model)) score += 5;

        // Engine scoring — strongly prefer GAS, penalize EV/BATTERY
        if (t.includes("gas") || t.includes("gasoline") || t.includes("gas fi")) score += 6;
        if (t.includes("ev") || t.includes("bev") || t.includes("battery") || t.includes("electric") || t.includes("ev/bev")) score -= 8;
        if (t.includes("hybrid")) score -= 2;

        // Must at least match year + make
        if (!(year && t.includes(year) && make && t.includes(make))) continue;

        if (score > bestScore) {
          bestScore = score;
          bestIdx = i;
        }
      }

      // Fallback: single result or first of few
      if (bestIdx === -1 && items.length > 0 && items.length <= 3) {
        // Still avoid "create manually"
        for (let i = 0; i < items.length; i++) {
          if (!items[i].textContent.toLowerCase().includes("create manually")) {
            bestIdx = i; break;
          }
        }
      }

      if (bestIdx >= 0) {
        // Return coordinates for mouse.click (Angular needs real mouse events)
        const rect = items[bestIdx].getBoundingClientRect();
        return {
          found: true,
          text: items[bestIdx].textContent.trim().substring(0, 80),
          count: items.length,
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2,
          engine: items[bestIdx].textContent.includes("GAS") ? "gas" : items[bestIdx].textContent.includes("EV") ? "ev" : "unknown",
        };
      }

      return { found: false, count: items.length, texts };
    }, yr, mk, mdl, NAV_TEXTS);

    console.log(`${LOG}   #ac-vehicle autocomplete: ${JSON.stringify(picked)}`);

    if (picked.found) {
      // Click the autocomplete item via mouse (Angular needs real events)
      console.log(`${LOG}   Vehicle matched: "${picked.text}" (engine: ${picked.engine}) — clicking via mouse...`);
      await page.mouse.click(picked.x, picked.y);
      await sleep(3000);

      // Click Save in the dialog via mouse.click (DOM .click() doesn't trigger Angular)
      const dialogSavePos = await page.evaluate(() => {
        const dialog = document.querySelector(".add-dialog, [class*='add-dialog']");
        if (dialog && (dialog.offsetParent !== null || dialog.offsetHeight > 0)) {
          const btns = Array.from(dialog.querySelectorAll("button")).filter(b =>
            b.offsetParent !== null && b.textContent.trim().toLowerCase() === "save"
          );
          if (btns.length > 0) {
            const btn = btns[btns.length - 1];
            const rect = btn.getBoundingClientRect();
            return { found: true, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
          }
        }
        return { found: false };
      });

      if (dialogSavePos.found) {
        console.log(`${LOG}   Dialog Save at (${Math.round(dialogSavePos.x)}, ${Math.round(dialogSavePos.y)}) — mouse clicking...`);
        await page.mouse.click(dialogSavePos.x, dialogSavePos.y);
        await sleep(5000);
      } else {
        // Fallback: try mouse click at known position
        console.log(`${LOG}   Dialog Save not found — trying fallback position...`);
        await page.mouse.click(1187, 605);
        await sleep(5000);
      }

      await safeScreenshot(page, "/tmp/debug-phase2-ac-vehicle-selected.png");

      // Handle "Update vehicle for this Order" confirmation if it appears
      const confirmModal = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll("button")).filter(b =>
          b.offsetParent !== null && /yes|confirm|update|ok/i.test(b.textContent.trim()) && b.textContent.trim().length < 20
        );
        if (btns.length > 0) {
          const r = btns[0].getBoundingClientRect();
          return { found: true, x: r.x + r.width / 2, y: r.y + r.height / 2, text: btns[0].textContent.trim() };
        }
        return { found: false };
      });
      if (confirmModal.found) {
        console.log(`${LOG}   Clicking "${confirmModal.text}" to confirm...`);
        await page.mouse.click(confirmModal.x, confirmModal.y);
        await sleep(3000);
      }

      console.log(`${LOG}   Vehicle creation complete ✓`);
      return true;
    }

    // OLD SAVE LOGIC BELOW — kept only as dead code reference, should not execute
    // because picked.found returns true above
    if (false) {
      // ALWAYS click Save in the "Create new vehicle" dialog to persist the vehicle.
      // The dialog (.add-dialog or [role='dialog']) has its own Save button — distinct from the sidebar's Save.
      const saveBtn = await page.evaluate(() => {
        // Priority 1: Save button INSIDE the .add-dialog container
        const dialog = document.querySelector(".add-dialog, [class*='add-dialog']");
        if (dialog) {
          const dialogBtns = Array.from(dialog.querySelectorAll("button")).filter(b => {
            return b.offsetParent !== null && /^save$/i.test(b.textContent.trim());
          });
          if (dialogBtns.length > 0) {
            const btn = dialogBtns[dialogBtns.length - 1]; // last Save in dialog
            const rect = btn.getBoundingClientRect();
            return { found: true, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, text: btn.textContent.trim(), source: "dialog" };
          }
        }
        // Priority 2: Save inside any [role='dialog']
        const roleDialogs = document.querySelectorAll("[role='dialog']");
        for (const rd of roleDialogs) {
          if (!rd.offsetParent && rd.offsetHeight === 0) continue;
          const rdBtns = Array.from(rd.querySelectorAll("button")).filter(b =>
            b.offsetParent !== null && /^save$/i.test(b.textContent.trim())
          );
          if (rdBtns.length > 0) {
            const btn = rdBtns[rdBtns.length - 1];
            const rect = btn.getBoundingClientRect();
            return { found: true, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, text: btn.textContent.trim(), source: "role-dialog" };
          }
        }
        // Priority 3: Save with btn-submit class that's NOT the sidebar's customer-btn
        const allSaves = Array.from(document.querySelectorAll("button")).filter(b => {
          if (!b.offsetParent) return false;
          const t = b.textContent.trim().toLowerCase();
          const cls = (b.className || "").toLowerCase();
          return t === "save" && cls.includes("btn-submit") && !cls.includes("customer-btn") && !cls.includes("send-btn");
        });
        // Pick the one with highest Y (most likely the dialog's Save at page bottom)
        if (allSaves.length > 0) {
          allSaves.sort((a, b) => b.getBoundingClientRect().y - a.getBoundingClientRect().y);
          const btn = allSaves[0];
          const rect = btn.getBoundingClientRect();
          return { found: true, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, text: btn.textContent.trim(), source: "btn-submit-highest" };
        }
        return { found: false };
      });

      if (saveBtn.found) {
        console.log(`${LOG}   Clicking "${saveBtn.text}" at (${Math.round(saveBtn.x)}, ${Math.round(saveBtn.y)}) to save vehicle...`);
        await page.mouse.click(saveBtn.x, saveBtn.y);
        await sleep(5000);

        // Check for "Update vehicle for this Order" confirmation modal
        const confirmModal = await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll("button")).filter(b =>
            b.offsetParent !== null && /yes|confirm|update|ok/i.test(b.textContent.trim())
          );
          if (btns.length > 0) {
            const r = btns[0].getBoundingClientRect();
            return { found: true, x: r.x + r.width / 2, y: r.y + r.height / 2, text: btns[0].textContent.trim() };
          }
          return { found: false };
        });
        if (confirmModal.found) {
          console.log(`${LOG}   Clicking "${confirmModal.text}" to confirm vehicle update...`);
          await page.mouse.click(confirmModal.x, confirmModal.y);
          await sleep(3000);
        }

        console.log(`${LOG}   Vehicle saved ✓`);
        return true;
      }

      // Fallback: try Enter
      console.log(`${LOG}   No Save button found — trying Enter...`);
      await page.keyboard.press("Enter");
      await sleep(3000);
      return true;
    }

    // Autocomplete didn't find match — try typing just year to narrow results
    if (!picked.found && yr) {
      console.log(`${LOG}   Full search miss — trying year-only "${yr}"...`);
      await acVehicle.click({ clickCount: 3 });
      await sleep(200);
      await page.keyboard.press("Backspace");
      await sleep(300);
      await acVehicle.type(yr, { delay: 60 });
      await sleep(4000);

      const retryPicked = await page.evaluate((year, make, model) => {
        const items = Array.from(document.querySelectorAll(
          ".p-autocomplete-panel li, .p-autocomplete-items li, " +
          "[class*='autocomplete'] [class*='list'] li, [role='option'], " +
          ".add-dialog li, .add-dialog [class*='item']"
        )).filter(li => li.offsetParent && li.textContent.trim().length > 2);

        for (let i = 0; i < items.length; i++) {
          const t = items[i].textContent.toLowerCase();
          if (t.includes(year) && make && t.includes(make)) {
            items[i].click();
            return { found: true, text: items[i].textContent.trim().substring(0, 80) };
          }
        }
        // Accept first result that has the year
        for (let i = 0; i < items.length; i++) {
          const t = items[i].textContent.toLowerCase();
          if (t.includes(year)) {
            items[i].click();
            return { found: true, text: items[i].textContent.trim().substring(0, 80) };
          }
        }
        return { found: false, count: items.length };
      }, yr, mk, mdl);

      if (retryPicked.found) {
        console.log(`${LOG}   Vehicle selected (year-only retry): "${retryPicked.text}"`);
        await sleep(3000);
        // Click Save/Add if dialog still open
        await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll("button")).filter(b =>
            b.offsetParent && /^(save|add|create)$/i.test(b.textContent.trim())
          );
          if (btns.length > 0) btns[btns.length - 1].click();
        });
        await sleep(3000);
        return true;
      }
    }
  }

  // ── Strategy 2: Year/make/model <select> dropdowns (older layout) ──
  const formCheck = await page.evaluate(() => {
    const yearSel = document.querySelector('select[name="year"], [formcontrolname="year"], select[id*="year"]');
    const vinInput = document.querySelector('input[name="vin"], input[formcontrolname="vin"], input[id*="vin"]');
    return { hasYear: !!yearSel, hasVin: !!vinInput };
  });

  if (formCheck.hasYear) {
    console.log(`${LOG}   Fallback: filling year/make/model <select> dropdowns...`);
    if (vehicle.year) {
      await selectNativeDropdown(page, 'select[name="year"], [formcontrolname="year"], select[id*="year"]', String(vehicle.year));
      await sleep(2000);
    }
    if (vehicle.make) {
      await selectNativeDropdown(page, 'select[name="make"], [formcontrolname="make"], select[id*="make"]', vehicle.make);
      await sleep(2000);
    }
    if (vehicle.model) {
      await selectNativeDropdown(page, 'select[name="model"], [formcontrolname="model"], select[id*="model"]', vehicle.model);
      await sleep(1000);
    }
    await safeScreenshot(page, "/tmp/debug-phase2-vehicle-form-filled.png");

    // Click Save
    const saved = await clickSaveInDialog(page);
    return saved;
  }

  // ── Strategy 3: VIN decode ──
  if (formCheck.hasVin && vehicle.vin) {
    console.log(`${LOG}   Fallback: VIN decode...`);
    const vinField = await page.$('input[name="vin"], input[formcontrolname="vin"], input[id*="vin"]');
    if (vinField) {
      await vinField.click({ clickCount: 3 });
      await vinField.type(vehicle.vin, { delay: 40 });
      await sleep(1000);
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll("button")).filter(b =>
          b.offsetParent && /decode|lookup/i.test(b.textContent.trim()));
        if (btns.length > 0) btns[0].click();
      });
      await sleep(5000);
      const saved = await clickSaveInDialog(page);
      return saved;
    }
  }

  console.log(`${LOG}   No #ac-vehicle, no year <select>, no VIN — cannot add vehicle`);
  return false;
}

/**
 * Click Save/Add button inside the currently open dialog or sidebar.
 */
async function clickSaveInDialog(page) {
  const saveClicked = await page.evaluate(() => {
    // Prefer buttons inside dialog/modal/sidebar
    const containers = document.querySelectorAll(
      ".add-dialog, [class*='add-dia'], [role='dialog'], .p-dialog, .p-sidebar, [class*='modal']"
    );
    for (const container of containers) {
      if (!container.offsetParent && container.offsetWidth === 0) continue;
      const btns = Array.from(container.querySelectorAll("button")).filter(b =>
        b.offsetParent && /^(save|add|create)$/i.test(b.textContent.trim()) && !b.disabled
      );
      if (btns.length > 0) { btns[btns.length - 1].click(); return { clicked: true, context: "dialog" }; }
    }
    // Fallback: any visible Save button
    const btns = Array.from(document.querySelectorAll("button")).filter(b =>
      b.offsetParent && /^save$/i.test(b.textContent.trim()) && !b.disabled
    );
    if (btns.length > 0) { btns[btns.length - 1].click(); return { clicked: true, context: "fallback" }; }
    return { clicked: false };
  });
  if (saveClicked.clicked) {
    console.log(`${LOG}   Save clicked (${saveClicked.context})`);
    await sleep(4000);
    return true;
  }
  console.log(`${LOG}   No Save button found`);
  return false;
}

/**
 * Select an option from a native <select> dropdown by value or text match.
 */
async function selectNativeDropdown(page, selectorStr, value) {
  for (const sel of selectorStr.split(", ").map(s => s.trim())) {
    try {
      const selected = await page.evaluate((selector, val) => {
        const select = document.querySelector(selector);
        if (!select || select.tagName.toLowerCase() !== "select") return false;
        for (const opt of select.options) {
          if (opt.value === val || opt.textContent.trim() === val ||
              opt.textContent.trim().includes(val)) {
            select.value = opt.value;
            select.dispatchEvent(new Event("change", { bubbles: true }));
            return true;
          }
        }
        return false;
      }, sel, value);
      if (selected) return true;
    } catch { /* try next selector */ }
  }
  console.log(`${LOG}   selectNativeDropdown: "${value}" not found in ${selectorStr.substring(0, 40)}`);
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Autocomplete Helpers
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Type a search term into a PrimeNG autocomplete field and pick a matching item
 * from the dropdown. Returns { found, text, matchType } or { found: false }.
 *
 * Matching logic:
 *   1. Phone match: item text contains same digits as customer phone
 *   2. Full name match: all name parts appear in item text
 *   3. Single result: if only one non-nav item, use it
 */
async function searchAndSelectAutocomplete(page, selector, searchTerm, fullName, phoneDigits) {
  const field = await page.$(selector);
  if (!field) return { found: false, error: `${selector} not found` };

  // Focus and type search term
  await field.click({ clickCount: 3 });
  await sleep(200);
  await page.keyboard.press("Backspace");
  await sleep(300);
  await field.type(searchTerm, { delay: 80 });
  await sleep(4000); // Wait for autocomplete to fetch results (Pi is slow)

  await safeScreenshot(page, `/tmp/debug-autocomplete-${selector.replace("#", "")}.png`);

  // Pick matching item from dropdown
  const result = await page.evaluate((fullNameStr, phoneDigitsStr, navTexts) => {
    const items = Array.from(document.querySelectorAll(
      ".p-autocomplete-panel li, .p-autocomplete-items li, " +
      "[class*='autocomplete'] [class*='list'] li, [role='option']"
    )).filter(li => {
      if (!li.offsetParent) return false;
      const t = li.textContent.trim();
      return t.length >= 2 && !navTexts.includes(t) &&
        !li.closest("nav, [class*='sidebar-nav'], [class*='nav-menu']");
    });

    const texts = items.map(li => li.textContent.trim().substring(0, 60));
    const stripDigits = (s) => (s || "").replace(/\D/g, "");

    let bestIdx = -1, matchType = "";

    for (let i = 0; i < items.length; i++) {
      const t = items[i].textContent;
      const tLower = t.toLowerCase();
      const tDigits = stripDigits(t);

      // Phone match (at least 4 shared digits)
      if (phoneDigitsStr && phoneDigitsStr.length >= 4) {
        const phoneEnd = phoneDigitsStr.slice(-7);
        if (tDigits.includes(phoneEnd) || phoneEnd.includes(tDigits.slice(-7))) {
          // Verify name also matches loosely to avoid wrong-customer match
          if (fullNameStr) {
            const parts = fullNameStr.toLowerCase().split(/\s+/).filter(p => p.length > 1);
            const nameOk = parts.length === 0 || parts.some(p => tLower.includes(p));
            if (nameOk) { bestIdx = i; matchType = "phone+name"; break; }
          } else {
            bestIdx = i; matchType = "phone"; break;
          }
        }
      }

      // Full name match
      if (fullNameStr) {
        const parts = fullNameStr.toLowerCase().split(/\s+/).filter(p => p.length > 1);
        if (parts.length >= 2 && parts.every(p => tLower.includes(p))) {
          bestIdx = i; matchType = "fullName"; break;
        }
        // First name match (for single-word names)
        if (parts.length === 1 && tLower.includes(parts[0])) {
          bestIdx = i; matchType = "firstName"; break;
        }
      }
    }

    // Single result fallback
    if (bestIdx === -1 && items.length === 1) {
      bestIdx = 0; matchType = "onlyResult";
    }

    if (bestIdx >= 0) {
      const rect = items[bestIdx].getBoundingClientRect();
      return {
        found: true,
        matchType,
        x: rect.x + rect.width / 2,
        y: rect.y + rect.height / 2,
        text: items[bestIdx].textContent.trim().substring(0, 80),
        count: items.length,
      };
    }

    return { found: false, count: items.length, texts };
  }, fullName || "", phoneDigits || "", NAV_TEXTS);

  if (result.found) {
    await page.mouse.click(result.x, result.y);
    await sleep(1000);
    return result;
  }

  console.log(`${LOG}   Autocomplete: no match in ${result.count} items: ${JSON.stringify(result.texts || [])}`);
  return result;
}

/**
 * Click #estimate-vehicle and select the matching vehicle from the dropdown.
 * Also tries typing the year to trigger search if initial click shows no items.
 */
async function selectVehicleFromAutocomplete(page, vehicle) {
  const vehField = await page.$("#estimate-vehicle");
  if (!vehField) return { found: false, error: "#estimate-vehicle not found" };

  const yr = String(vehicle.year || "");
  const mk = (vehicle.make || "").toLowerCase();
  const mdl = (vehicle.model || "").toLowerCase();

  // Click to open dropdown
  await vehField.click();
  await sleep(3000); // PrimeNG autocomplete may need time to load vehicle list

  let picked = await pickVehicleFromDropdown(page, yr, mk, mdl);

  if (!picked.found && picked.count === 0) {
    // No items on click — try typing the year to search
    console.log(`${LOG}   No vehicle dropdown items — typing "${yr}" to search...`);
    await vehField.click({ clickCount: 3 });
    await sleep(200);
    await page.keyboard.press("Backspace");
    await sleep(300);
    await vehField.type(yr, { delay: 80 });
    await sleep(3000);

    picked = await pickVehicleFromDropdown(page, yr, mk, mdl);
  }

  if (!picked.found && picked.count === 0) {
    // Try typing make
    console.log(`${LOG}   Still no items — typing "${vehicle.make}" to search...`);
    await vehField.click({ clickCount: 3 });
    await sleep(200);
    await page.keyboard.press("Backspace");
    await sleep(300);
    await vehField.type(vehicle.make || "", { delay: 80 });
    await sleep(3000);

    picked = await pickVehicleFromDropdown(page, yr, mk, mdl);
  }

  if (!picked.found) {
    // Last resort: keyboard selection (ArrowDown + Enter)
    console.log(`${LOG}   Trying keyboard selection (ArrowDown + Enter)...`);
    await vehField.click();
    await sleep(1500);
    await page.keyboard.press("ArrowDown");
    await sleep(500);
    await page.keyboard.press("Enter");
    await sleep(2000);

    // Check if something got selected
    const checkChip = await page.evaluate(() => {
      const chips = document.querySelectorAll(".p-autocomplete-token-label");
      return chips.length > 0 ? chips[0].textContent.trim() : "";
    });
    if (checkChip) {
      return { found: true, text: checkChip, matchType: "keyboard" };
    }
  }

  return picked;
}

/**
 * Read the current PrimeNG autocomplete dropdown items and click the best
 * match for the given vehicle year/make/model.
 */
async function pickVehicleFromDropdown(page, yr, mk, mdl) {
  return page.evaluate((year, make, model, navTexts) => {
    const items = Array.from(document.querySelectorAll(
      ".p-autocomplete-panel li, .p-autocomplete-items li, " +
      "[class*='autocomplete'] [class*='list'] li, [role='option']"
    )).filter(li => {
      if (!li.offsetParent) return false;
      const t = li.textContent.trim();
      return t.length > 0 && !navTexts.includes(t) &&
        !li.closest("nav, [class*='sidebar-nav'], [class*='nav-menu']");
    });

    const texts = items.map(li => li.textContent.trim().substring(0, 60));
    let bestIdx = -1;

    // Try year + make + model match
    for (let i = 0; i < items.length; i++) {
      const t = items[i].textContent.toLowerCase();
      if (year && t.includes(year) && make && t.includes(make) && model && t.includes(model)) {
        bestIdx = i; break;
      }
    }
    // Try year + make match
    if (bestIdx === -1) {
      for (let i = 0; i < items.length; i++) {
        const t = items[i].textContent.toLowerCase();
        if (year && t.includes(year) && make && t.includes(make)) {
          bestIdx = i; break;
        }
      }
    }
    // Try year match only
    if (bestIdx === -1) {
      for (let i = 0; i < items.length; i++) {
        const t = items[i].textContent.toLowerCase();
        if (year && t.includes(year)) {
          bestIdx = i; break;
        }
      }
    }
    // Single result or first of <= 2
    if (bestIdx === -1 && items.length > 0 && items.length <= 2) {
      bestIdx = 0;
    }

    if (bestIdx >= 0) {
      items[bestIdx].click();
      return {
        found: true,
        text: items[bestIdx].textContent.trim().substring(0, 60),
        matchType: "dropdown",
        count: items.length,
      };
    }

    return { found: false, count: items.length, texts };
  }, yr, mk, mdl, NAV_TEXTS);
}

// ── Helper: Non-fatal screenshot ──
async function safeScreenshot(page, filePath) {
  try { await page.screenshot({ path: filePath }); } catch { /* non-fatal */ }
}

// ═══════════════════════════════════════════════════════════════════════════════
// MOTOR Fallback: Manual Service Line
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Extract a clean repair name from diagnosis or query.
 */
function getRepairName(diagnosis, query) {
  const repairPlan = diagnosis?.ai?.repair_plan?.labor?.description;
  if (repairPlan && repairPlan.length > 3) return repairPlan;

  const firstDiagnosis = diagnosis?.ai?.diagnoses?.[0]?.cause;
  if (firstDiagnosis && firstDiagnosis.length > 3) return firstDiagnosis;

  if (query) {
    const cleaned = query
      .replace(/\b(needs|needed|requires|customer|wants|vehicle|car|truck)\b/gi, "")
      .replace(/\d{4}\s+\w+\s+\w+/g, "") // strip "2002 Toyota RAV4"
      .replace(/\s+/g, " ")
      .trim();
    if (cleaned.length > 3) return cleaned;
  }

  return "Labor Service";
}

/**
 * Fallback: add a manual service line when MOTOR navigation fails.
 *
 * Uses the AutoLeap REST API to add a properly named service line,
 * then reloads the browser page to show it. This avoids the Browse dialog
 * approach which always uses a canned service name (e.g., "A/C Recharge").
 */
async function addManualServiceLine(page, estimateId, serviceName, hours, laborRate) {
  console.log(`${LOG} Adding manual service via API: "${serviceName}" (${hours}h @ $${laborRate}/h)...`);

  try {
    const token = await getToken();
    if (!token) {
      console.log(`${LOG} No API token — falling back to browser method`);
      return addManualServiceViaBrowser(page, estimateId, serviceName, hours, laborRate);
    }

    const service = {
      name: serviceName,
      serviceType: "general",
      hours: hours,
      rate: laborRate,
      quantity: hours,
      laborRate: laborRate,
      total: hours * laborRate,
    };

    const apiResult = await addServiceToEstimate(token, estimateId, service);

    if (apiResult.success) {
      console.log(`${LOG} Service added via API (${apiResult.method}) ✓`);

      // Reload browser page to show the new service
      await page.goto(`${AUTOLEAP_APP_URL}/#/workboard`, { waitUntil: "domcontentloaded", timeout: 30000 });
      await sleep(2000);
      await page.goto(`${AUTOLEAP_APP_URL}/#/estimate/${estimateId}`, { waitUntil: "domcontentloaded", timeout: 30000 });
      await sleep(5000);

      return { success: true, method: "api-" + apiResult.method };
    }

    console.log(`${LOG} API service add failed — falling back to browser method`);
  } catch (apiErr) {
    console.log(`${LOG} API service add error: ${apiErr.message} — falling back to browser`);
  }

  // Fallback: browser-based approach using Browse dialog
  return addManualServiceViaBrowser(page, estimateId, serviceName, hours, laborRate);
}

/**
 * Browser fallback: add a canned service via Browse dialog, then edit its name.
 */
async function addManualServiceViaBrowser(page, estimateId, serviceName, hours, laborRate) {
  console.log(`${LOG} Adding service via Browse dialog...`);

  await page.goto(`${AUTOLEAP_APP_URL}/#/workboard`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await sleep(3000);
  await page.goto(`${AUTOLEAP_APP_URL}/#/estimate/${estimateId}`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await sleep(5000);

  await clickTab(page, "Services");
  await sleep(2000);

  // Open Browse dialog
  const browseBtn = await page.evaluate(() => {
    for (const btn of document.querySelectorAll("button")) {
      if (btn.offsetParent && btn.textContent.trim() === "Browse") {
        const r = btn.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }
    }
    return null;
  });

  if (!browseBtn) {
    return { success: false, error: "Browse button not found" };
  }

  await page.mouse.click(browseBtn.x, browseBtn.y);
  await sleep(3000);

  // Click AutoLeap tab
  await page.evaluate(() => {
    for (const el of document.querySelectorAll("p, span, div")) {
      if (!el.offsetParent) continue;
      if (el.textContent.trim() === "AutoLeap" && el.className.includes("service-tab")) {
        el.click(); return;
      }
    }
  });
  await sleep(2000);

  // Click "Add" on first canned service (DIV.add-est-btn, NOT <button>)
  const addResult = await page.evaluate(() => {
    const addBtns = Array.from(document.querySelectorAll("div.add-est-btn, div[class*='add-est-btn']"))
      .filter(b => b.offsetParent !== null && b.textContent.trim() === "Add");
    if (addBtns.length === 0) {
      const fallback = Array.from(document.querySelectorAll("div, span, a, button"))
        .filter(el => el.offsetParent !== null && el.textContent.trim() === "Add" && el.children.length === 0);
      if (fallback.length > 0) addBtns.push(...fallback);
    }
    if (addBtns.length === 0) return { found: false };
    const btn = addBtns[0];
    const r = btn.getBoundingClientRect();
    return { found: true, x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });

  if (!addResult.found) {
    return { success: false, error: "No Add buttons in Browse dialog" };
  }

  await page.mouse.click(addResult.x, addResult.y);
  await sleep(3000);

  // Close Browse dialog
  const doneBtn = await page.evaluate(() => {
    for (const btn of document.querySelectorAll("button")) {
      if (btn.textContent.trim() === "Done" && btn.offsetParent !== null) {
        const r = btn.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }
    }
    return null;
  });
  if (doneBtn) {
    await page.mouse.click(doneBtn.x, doneBtn.y);
    await sleep(2000);
  }

  // Now rename via API (overwrite the canned service name in the DB)
  // Pass only the modified service object — addServiceToEstimate wraps it in [service]
  // for the PATCH call, so we pass the single updated service, not the full array.
  try {
    const token = await getToken();
    if (token) {
      const est = await getEstimate(token, estimateId);
      if (est?.services?.length > 0) {
        const lastService = est.services[est.services.length - 1];
        lastService.name = serviceName;
        lastService.hours = hours;
        lastService.quantity = hours;
        lastService.rate = laborRate;
        lastService.laborRate = laborRate;
        lastService.total = hours * laborRate;
        // Pass the single modified service — addServiceToEstimate wraps it as [service]
        const patchRes = await addServiceToEstimate(token, estimateId, lastService);
        console.log(`${LOG} Renamed service via API: ${patchRes.success} (method: ${patchRes.method})`);
      }
    }
  } catch (renameErr) {
    console.log(`${LOG} Service rename via API failed (non-fatal): ${renameErr.message}`);
  }

  return { success: true, method: "browse-add-canned" };
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 5: Link Parts to Labor
// ═══════════════════════════════════════════════════════════════════════════════

async function linkPartsToServices(page, addedParts, laborResult) {
  let linked = 0;
  const serviceName = laborResult.procedure || "";

  // Parts appear in the "Parts ordering" tab under "PartsTech's orders" section.
  // Each imported part row has a custom APP-DROPDOWN with class "dropdown-wrapper dropdown-light".
  // Structure: APP-DROPDOWN > DIV.dropdown > DIV.dropdown-wrapper > DIV.selected-view (click target)
  //   + DIV.dropdown-list-wrapper (options panel, display:none → show on click)
  //     > UL.dropdown-list > LI.dropdown-list-item (each option)
  await clickTab(page, "Parts ordering");
  await sleep(3000);

  try {
    await page.screenshot({ path: "/tmp/debug-phase5-parts.png" });
  } catch { /* optional */ }

  // Count APP-DROPDOWN components with "Select service" text
  const dropdownCount = await page.evaluate(() => {
    const appDropdowns = Array.from(document.querySelectorAll("app-dropdown, APP-DROPDOWN"));
    return appDropdowns.filter(dd => dd.textContent.includes("Select service")).length;
  });
  console.log(`${LOG} Phase 5: Found ${dropdownCount} "Select service" APP-DROPDOWNs`);

  if (dropdownCount === 0) {
    console.log(`${LOG} Phase 5: No "Select service" dropdowns found`);
    return { linked: 0 };
  }

  // Click each "Select service" dropdown and pick the MOTOR service
  const maxLinks = Math.min(dropdownCount, Math.max(addedParts.length, 1));
  for (let i = 0; i < maxLinks; i++) {
    try {
      // Find the i-th APP-DROPDOWN with "Select service" and get its selected-view click target
      const dropdownInfo = await page.evaluate(() => {
        const appDropdowns = Array.from(document.querySelectorAll("app-dropdown, APP-DROPDOWN"));
        const svcDropdowns = appDropdowns.filter(dd => dd.textContent.includes("Select service"));
        if (svcDropdowns.length === 0) return { found: false };
        // Always click the first remaining "Select service" (once linked, text changes)
        const dd = svcDropdowns[0];
        const selectedView = dd.querySelector(".selected-view");
        if (!selectedView) return { found: false };
        const rect = selectedView.getBoundingClientRect();
        return {
          found: true,
          x: rect.x + rect.width / 2,
          y: rect.y + rect.height / 2,
        };
      });

      if (!dropdownInfo.found) {
        console.log(`${LOG} Phase 5: No more "Select service" dropdowns`);
        break;
      }

      console.log(`${LOG} Phase 5: Clicking "Select service" at (${Math.round(dropdownInfo.x)}, ${Math.round(dropdownInfo.y)})`);
      await page.mouse.click(dropdownInfo.x, dropdownInfo.y);
      await sleep(2000);

      // Select the MOTOR service from the dropdown-list-wrapper overlay.
      // Options are LI.dropdown-list-item inside UL.dropdown-list inside the now-visible
      // DIV.dropdown-list-wrapper.show within the same APP-DROPDOWN.
      const selected = await page.evaluate((svcName) => {
        // Primary: AutoLeap custom APP-DROPDOWN list items
        let options = Array.from(document.querySelectorAll(
          "li.dropdown-list-item"
        )).filter(el => {
          // Must be visible (not the hidden "Loading" item)
          if (el.hidden || getComputedStyle(el).display === "none") return false;
          // Must be inside a .show wrapper (i.e., an open dropdown)
          const wrapper = el.closest(".dropdown-list-wrapper");
          return wrapper && wrapper.classList.contains("show");
        });

        // Fallback: PrimeNG or generic dropdown items
        if (options.length === 0) {
          options = Array.from(document.querySelectorAll(
            ".p-dropdown-item, .ui-dropdown-item, li[role='option']"
          )).filter(el => el.offsetParent !== null);
        }

        const texts = options.map(o => (o.textContent || "").trim().substring(0, 60));

        // Try partial match (service name)
        for (const opt of options) {
          const text = (opt.textContent || "").trim();
          if (svcName && text.toLowerCase().includes(svcName.toLowerCase())) {
            opt.click();
            return { matched: true, text, count: options.length };
          }
        }
        // Fallback: first non-loading, non-placeholder option
        for (const opt of options) {
          const text = (opt.textContent || "").trim();
          if (text.length > 0 && !/select service/i.test(text) && !/^loading$/i.test(text)) {
            opt.click();
            return { matched: true, text, fallback: true, count: options.length };
          }
        }
        return { matched: false, count: options.length, texts };
      }, serviceName);

      if (selected.matched) {
        linked++;
        console.log(`${LOG} Phase 5: Linked part ${i + 1} → "${selected.text}"${selected.fallback ? " (fallback)" : ""} (${selected.count} options)`);
      } else {
        console.log(`${LOG} Phase 5: No matching option: ${JSON.stringify(selected)}`);
        await page.keyboard.press("Escape");
      }

      await sleep(2000);
    } catch (err) {
      console.log(`${LOG} Phase 5: Link attempt ${i + 1} failed: ${err.message}`);
    }
  }

  return { linked };
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 6: Save + Read Totals
// ═══════════════════════════════════════════════════════════════════════════════

async function saveEstimate(page) {
  // Click Save
  const saveClicked = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    for (const btn of btns) {
      const text = btn.textContent.trim().toLowerCase();
      if (text === "save" && !btn.disabled) {
        btn.click();
        return true;
      }
    }
    return false;
  });

  if (saveClicked) {
    // Wait for save to complete
    await sleep(3000);
    console.log(`${LOG} Estimate saved`);
  } else {
    console.log(`${LOG} Save button not found or disabled — estimate may auto-save`);
  }
}

async function readEstimateTotals(page) {
  return page.evaluate(() => {
    const result = { labor: 0, parts: 0, shopSupplies: 0, tax: 0, grandTotal: 0, debug: {} };
    const allText = document.body.innerText || "";

    // Strategy 1: Parse "Service net total" and "Subtotal" from the Labor summary tab
    // AutoLeap shows these as text labels followed by dollar amounts on subsequent lines.
    // The innerText has line breaks, so parse line-by-line.
    const lines = allText.split("\n").map(l => l.trim()).filter(l => l.length > 0);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // "Service net total" — followed by the labor+service total on a nearby line
      if (line === "Service net total" || line.toLowerCase().includes("service net total")) {
        // Next dollar amount is the service total
        for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
          const match = lines[j].match(/^\$?([\d,.]+)$/);
          if (match) {
            const val = parseFloat(match[1].replace(/,/g, ""));
            if (val > 0) { result.labor = val; result.debug.laborSource = "service-net-total"; break; }
          }
        }
      }
      // "Subtotal" — the estimate subtotal before tax
      if (line === "Subtotal" || line.toLowerCase() === "subtotal") {
        for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
          const match = lines[j].match(/^\$?([\d,.]+)$/);
          if (match) {
            const val = parseFloat(match[1].replace(/,/g, ""));
            if (val > 0 && result.grandTotal === 0) { result.grandTotal = val; result.debug.grandTotalSource = "subtotal"; break; }
          }
        }
      }
    }

    // Fallback: regex match on full text
    if (result.labor === 0) {
      const serviceTotalMatch = allText.match(/Service\s+(?:net\s+)?total[\s\S]{0,30}?\$([\d,.]+)/i);
      if (serviceTotalMatch) {
        result.labor = parseFloat(serviceTotalMatch[1].replace(/,/g, "")) || 0;
        result.debug.laborSource = "regex-fallback";
      }
    }

    // Strategy 2: Look for individual service line amounts in the DOM
    // AutoLeap service rows have: name, type, cost, qty/hrs, amount
    // The amount column shows the line total (hrs × rate)
    if (result.labor === 0) {
      const serviceRows = document.querySelectorAll(
        "[class*='service-line'], [class*='estimate-service'], tr[class*='service'], " +
        "[class*='labor-line'], [class*='service-item']"
      );
      let laborSum = 0;
      for (const row of serviceRows) {
        if (!row.offsetParent) continue;
        const text = row.textContent || "";
        // Look for MOTOR tag to confirm this is a labor service
        if (text.includes("MOTOR") || text.match(/\d+\.\d+\s*hrs?/i)) {
          const amounts = text.match(/\$\s*([\d,.]+)/g) || [];
          // Last dollar amount in the row is typically the line total
          if (amounts.length > 0) {
            const lastAmt = parseFloat(amounts[amounts.length - 1].replace(/[$,\s]/g, "")) || 0;
            if (lastAmt > 0) laborSum += lastAmt;
          }
        }
      }
      if (laborSum > 0) {
        result.labor = laborSum;
        result.debug.laborSource = "service-rows";
      }
    }

    // Strategy 3: Parse specific text patterns from page content
    // AutoLeap estimate page text patterns (not navigation tabs)
    const textPatterns = [
      { key: "parts", regex: /Parts?\s+(?:total|amount)[:\s]*\$?([\d,.]+)/i },
      { key: "shopSupplies", regex: /Shop\s+suppl(?:y|ies)[:\s]*\$?([\d,.]+)/i },
      { key: "tax", regex: /(?:Sales?\s+)?Tax[:\s]*\$?([\d,.]+)/i },
      { key: "grandTotal", regex: /(?:Grand\s+total|Estimate\s+total|Total\s+amount|Net\s+total)[:\s]*\$?([\d,.]+)/i },
    ];
    for (const { key, regex } of textPatterns) {
      const match = allText.match(regex);
      if (match && result[key] === 0) {
        result[key] = parseFloat(match[1].replace(/,/g, "")) || 0;
      }
    }

    // Strategy 4: Look for footer/summary section with dollar amounts
    // AutoLeap estimate footer typically has the grand total as the largest $ value
    // in a dedicated footer/summary area (not navigation)
    if (result.grandTotal === 0) {
      // Find elements that look like total displays (not nav tabs, not buttons)
      const candidates = document.querySelectorAll(
        "[class*='estimate-footer'], [class*='summary-row'], [class*='total-row'], " +
        "[class*='grand-total'], [class*='net-total'], [class*='footer-total']"
      );
      for (const el of candidates) {
        if (!el.offsetParent) continue;
        // Skip nav elements
        if (el.closest("nav, [role='tablist'], [class*='sidebar']")) continue;
        const text = el.textContent || "";
        const match = text.match(/\$\s*([\d,.]+)/);
        if (match) {
          const val = parseFloat(match[1].replace(/,/g, ""));
          if (val > result.grandTotal) {
            result.grandTotal = val;
            result.debug.grandTotalSource = text.substring(0, 60);
          }
        }
      }
    }

    // Strategy 5: Sum labor + parts as fallback grand total
    if (result.grandTotal === 0 && (result.labor > 0 || result.parts > 0)) {
      result.grandTotal = result.labor + result.parts + result.shopSupplies + result.tax;
      result.debug.grandTotalSource = "calculated";
    }

    // Debug: capture a snippet of the estimate area text for troubleshooting
    // Look for the area around "Service total" or dollar amounts, not the full body
    const dollarLines = allText.split("\n").filter(l => l.includes("$") || l.toLowerCase().includes("total"));
    result.debug.dollarLines = dollarLines.slice(0, 10).map(l => l.trim().substring(0, 80));

    return result;
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Shared Helpers
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Click an AutoLeap tab by text (using includes, not exact match).
 * PrimeNG tabs may have badge text appended (e.g. "Services 1").
 */
async function clickTab(page, tabText) {
  const clicked = await page.evaluate((text) => {
    // Try all tab-like elements
    const selectors = "a[role='tab'], [class*='tabview-nav-link'], li[role='presentation'] a, [role='tab']";
    const tabs = Array.from(document.querySelectorAll(selectors));
    for (const tab of tabs) {
      if (!tab.offsetParent) continue; // skip hidden
      const t = tab.textContent.trim();
      if (t.includes(text) || t.toLowerCase().includes(text.toLowerCase())) {
        tab.click();
        return { clicked: true, text: t };
      }
    }
    // Fallback: try clicking parent li
    for (const tab of tabs) {
      const t = tab.textContent.trim();
      if (t.includes(text) || t.toLowerCase().includes(text.toLowerCase())) {
        const li = tab.closest("li");
        if (li) { li.click(); return { clicked: true, text: t, via: "li" }; }
      }
    }
    return { clicked: false, available: tabs.map(t => t.textContent.trim()).slice(0, 10) };
  }, tabText);
  if (!clicked.clicked) {
    console.log(`${LOG} clickTab("${tabText}"): not found. Available: ${JSON.stringify(clicked.available)}`);
  }
  return clicked.clicked;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function findFirstElement(page, selectorStr) {
  for (const sel of selectorStr.split(", ")) {
    try {
      const el = await page.$(sel);
      if (el) return el;
    } catch { /* try next */ }
  }
  return null;
}

async function progress(cb, phase) {
  if (cb) {
    try {
      await cb(phase);
    } catch { /* non-fatal */ }
  }
}

module.exports = {
  runPlaybook,
};
