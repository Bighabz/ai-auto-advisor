/**
 * Master Playbook — 100% Browser-Driven AutoLeap Estimate
 *
 * Replicates the exact 14-step manual process using puppeteer-core:
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
const { openPartsTechTab, searchAndAddToCart, submitCartToAutoLeap } = require("./helpers/pt-tab");
const { navigateMotorTree } = require("./helpers/motor-nav");
const { getToken, searchCustomer, createCustomer, createVehicle, createEstimate, getEstimate } = require("./autoleap-api");

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
async function runPlaybook({ customer, vehicle, diagnosis, parts, progressCallback }) {
  let puppeteer;
  try {
    puppeteer = require("puppeteer-core");
  } catch {
    return { success: false, error: "puppeteer-core not available" };
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
    browser = await puppeteer.connect({
      browserURL: CHROME_CDP_URL,
      defaultViewport: { width: 1280, height: 900 },
      protocolTimeout: 120000,
    });

    // Find or create AutoLeap page
    let page = (await browser.pages()).find((p) => p.url().includes("myautoleap.com"));
    if (!page) {
      page = (await browser.pages())[0] || (await browser.newPage());
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PHASE 1: Authentication (Step 1)
    // ═══════════════════════════════════════════════════════════════════════════
    await progress(progressCallback, "logging_in");
    console.log(`${LOG} Phase 1: Logging into AutoLeap...`);
    await ensureLoggedIn(page);

    // ═══════════════════════════════════════════════════════════════════════════
    // PHASE 2: Customer & Vehicle (Steps 2-5)
    // ═══════════════════════════════════════════════════════════════════════════
    await progress(progressCallback, "creating_customer");
    console.log(`${LOG} Phase 2: Creating customer ${customer.name} + ${vehicle.year} ${vehicle.make} ${vehicle.model}...`);
    const createResult = await createEstimateWithCustomerVehicle(page, customer, vehicle);

    if (!createResult.success) {
      result.error = createResult.error;
      return result;
    }

    result.estimateId = createResult.estimateId;
    result.roNumber = createResult.roNumber;
    console.log(`${LOG} Phase 2: "Save & Create Estimate" → ${result.roNumber || result.estimateId}`);

    // Debug: check estimate via API to verify vehicle linkage
    try {
      const token = await getToken();
      const estData = await getEstimate(token, result.estimateId);
      const vehData = estData?.vehicle || estData?.vehicleId || "none";
      const custData = estData?.customer?.fullName || estData?.customerId || "none";
      console.log(`${LOG} API verify: customer=${typeof custData === 'string' ? custData : JSON.stringify(custData)}, vehicle=${typeof vehData === 'string' ? vehData : JSON.stringify(vehData)}`);
    } catch (verifyErr) {
      console.log(`${LOG} API verify failed: ${verifyErr.message}`);
    }

    // Wait for estimate page to settle
    await sleep(3000);

    // ═══════════════════════════════════════════════════════════════════════════
    // PHASE 2b: Select CUSTOMER then VEHICLE in Angular UI
    //
    // From screenshots: clicking #estimate-customer opens a SIDEBAR (not dropdown).
    // The sidebar triggers Angular to load customer data including vehicles.
    // The vehicle autocomplete only works AFTER the customer data is loaded.
    // Strategy: Clear customer × → re-search → re-select → vehicle populates
    // ═══════════════════════════════════════════════════════════════════════════
    const vehicleStr = `${vehicle.year || ""} ${vehicle.make || ""} ${vehicle.model || ""}`.trim();
    const vehicleAlreadyInPage = createResult.vehicleInPage;

    if (vehicleAlreadyInPage) {
      console.log(`${LOG} Vehicle "${vehicleStr}" already visible in page ✓`);
    } else if (vehicle.year || vehicle.make || vehicle.vin) {
      try {
        console.log(`${LOG} Phase 2b: Customer/vehicle not in UI — selecting via autocomplete...`);

        // ── Step A: Clear the customer × button and re-select via autocomplete ──
        // The customer shows "undefined -" (broken display). Clear it and re-search.
        console.log(`${LOG}   Step A: Clearing customer selection to trigger fresh load...`);

        // Find the × button near the customer field to clear it
        const clearResult = await page.evaluate(() => {
          const custInput = document.querySelector("#estimate-customer");
          if (!custInput) return { cleared: false, reason: "no input" };

          // Search up the DOM tree for a close/clear button
          let container = custInput;
          for (let i = 0; i < 5; i++) {
            container = container.parentElement;
            if (!container) break;

            // Look for × / close icons
            const closeEls = Array.from(container.querySelectorAll(
              "i.pi-times, i.fa-times, i[class*='close'], i[class*='times'], " +
              "span[class*='close'], span[class*='times'], span[class*='clear'], " +
              "button[class*='close'], [class*='remove-icon']"
            )).filter(el => el.offsetParent !== null || el.offsetWidth > 0);

            for (const el of closeEls) {
              // Skip elements that are far from the customer field (in sidebar, etc.)
              const inputRect = custInput.getBoundingClientRect();
              const elRect = el.getBoundingClientRect();
              const distance = Math.abs(elRect.top - inputRect.top);
              if (distance < 30) {
                el.click();
                return { cleared: true, class: (el.className || "").substring(0, 40), tag: el.tagName };
              }
            }
          }

          // Alternative: look for × text in nearby elements
          const row = custInput.closest("[class*='row'], [class*='header'], [class*='customer']") || custInput.parentElement?.parentElement?.parentElement;
          if (row) {
            const allEls = row.querySelectorAll("*");
            for (const el of allEls) {
              if (el.textContent.trim() === "×" && el.children.length === 0 && el.offsetParent !== null) {
                el.click();
                return { cleared: true, text: "×" };
              }
            }
          }

          return { cleared: false, reason: "no close button found" };
        });
        console.log(`${LOG}   Clear customer result: ${JSON.stringify(clearResult)}`);

        if (clearResult.cleared) {
          await sleep(2000);
          // Now search for the customer by name
          const custInput = await page.$("#estimate-customer");
          if (custInput) {
            const firstName = (customer.name || "").split(/\s+/)[0] || "";
            console.log(`${LOG}   Searching for customer "${firstName}"...`);
            await custInput.click();
            await sleep(300);
            await custInput.type(firstName, { delay: 100 });
            await sleep(3000);

            await page.screenshot({ path: "/tmp/debug-customer-autocomplete.png" });

            // Check for dropdown results (not sidebar)
            const NAV_TEXTS = ["Dashboard", "Work Board", "Calendar", "Customers", "Catalog", "Inventory", "CRM", "Reviews", "Reports", "User Center"];
            const custDropdown = await page.evaluate((name, phone, navTexts) => {
              const items = Array.from(document.querySelectorAll(
                ".p-autocomplete-panel li, .p-autocomplete-items li, " +
                "[class*='autocomplete'] [class*='list'] li, [role='option']"
              )).filter(li => {
                if (!li.offsetParent) return false;
                const t = li.textContent.trim();
                if (!t || t.length < 3) return false;
                if (navTexts.includes(t)) return false;
                const inNav = li.closest("nav, [class*='sidebar-nav'], [class*='nav-menu']");
                return !inNav;
              });
              const texts = items.map(li => li.textContent.trim().substring(0, 80));

              // Find best match
              let best = null;
              for (const item of items) {
                const t = item.textContent.toLowerCase();
                if (name && t.includes(name.toLowerCase())) { best = item; break; }
                if (phone && t.includes(phone)) { best = item; break; }
              }
              if (!best && items.length > 0) best = items[0];
              if (best) {
                best.click();
                return { selected: true, text: best.textContent.trim().substring(0, 80), count: items.length, all: texts };
              }
              return { selected: false, count: items.length, all: texts };
            }, customer.name, customer.phone, NAV_TEXTS);

            console.log(`${LOG}   Customer search result: ${JSON.stringify(custDropdown)}`);
            if (custDropdown.selected) {
              console.log(`${LOG}   Customer re-selected: "${custDropdown.text}"`);
              await sleep(5000); // Wait for Angular to load customer data + vehicles
            }
          }
        } else {
          // Couldn't clear via × button — try clicking customer field to trigger sidebar/data load
          console.log(`${LOG}   Could not clear via × — clicking customer to trigger data load...`);
          const custInput = await page.$("#estimate-customer");
          if (custInput) {
            await custInput.click();
            await sleep(3000);
            // Close any sidebar that opened (Escape key)
            await page.keyboard.press("Escape");
            await sleep(2000);
          }
        }

        // ── Close any sidebar/overlay that's blocking the vehicle field ──
        await page.keyboard.press("Escape");
        await sleep(1000);

        // Click somewhere neutral to close any popups
        await page.mouse.click(600, 500);
        await sleep(1000);

        await page.screenshot({ path: "/tmp/debug-before-vehicle-select.png" });

        // ── Step B: Select VEHICLE from autocomplete ──
        // After customer data is loaded, the vehicle autocomplete should have options
        console.log(`${LOG}   Step B: Selecting vehicle "${vehicleStr}"...`);

        // Check the current state of the vehicle field
        const vehState = await page.evaluate(() => {
          const v = document.querySelector("#estimate-vehicle");
          if (!v) return { exists: false };
          const wrapper = v.closest("[class*='vehicle']") || v.parentElement?.parentElement;
          const wrapperText = wrapper?.textContent?.trim()?.substring(0, 80) || "";
          return {
            exists: true,
            value: (v.value || "").substring(0, 60),
            placeholder: (v.placeholder || "").substring(0, 40),
            wrapperText,
            // Check if PT button is still disabled
            ptDisabled: !!document.querySelector('.ro-partstech-new button.if-disabled'),
          };
        });
        console.log(`${LOG}   Vehicle state: ${JSON.stringify(vehState)}`);

        // If vehicle already appears in the wrapper text (not just the input), it may be selected
        if (vehState.wrapperText.includes(String(vehicle.year)) && vehState.wrapperText.includes(vehicle.make || "")) {
          console.log(`${LOG}   Vehicle appears in wrapper text — may be auto-selected ✓`);
        }

        const vehInput = await page.$("#estimate-vehicle");
        let vehicleSelected = false;

        if (vehInput && (!vehState.value || vehState.value.includes("Select") || vehState.placeholder.includes("Select"))) {
          // Try clicking the vehicle input to see if a dropdown appears
          await vehInput.click();
          await sleep(2000);

          // Check for dropdown
          const NAV_TEXTS = ["Dashboard", "Work Board", "Calendar", "Customers", "Catalog", "Inventory", "CRM", "Reviews", "Reports", "User Center"];

          // First check what appeared after clicking
          const afterClick = await page.evaluate((navTexts) => {
            const items = Array.from(document.querySelectorAll(
              ".p-autocomplete-panel li, .p-autocomplete-items li, " +
              "[class*='autocomplete'] [class*='list'] li, [role='option']"
            )).filter(li => {
              if (!li.offsetParent) return false;
              const t = li.textContent.trim();
              return t.length > 0 && !navTexts.includes(t) &&
                !li.closest("nav, [class*='sidebar-nav'], [class*='nav-menu']");
            });
            return {
              count: items.length,
              items: items.map(li => li.textContent.trim().substring(0, 60)).slice(0, 10),
            };
          }, NAV_TEXTS);
          console.log(`${LOG}   After vehicle click: ${afterClick.count} dropdown items`);

          if (afterClick.count > 0) {
            // Dropdown appeared on click! Select matching vehicle
            const selectResult = await page.evaluate((yr, mk, navTexts) => {
              const items = Array.from(document.querySelectorAll(
                ".p-autocomplete-panel li, .p-autocomplete-items li, " +
                "[class*='autocomplete'] [class*='list'] li, [role='option']"
              )).filter(li => {
                if (!li.offsetParent) return false;
                const t = li.textContent.trim();
                return t.length > 0 && !navTexts.includes(t) &&
                  !li.closest("nav, [class*='sidebar-nav'], [class*='nav-menu']");
              });
              let best = null;
              for (const item of items) {
                const t = item.textContent.toLowerCase();
                if ((yr && t.includes(String(yr))) && (mk && t.includes(mk.toLowerCase()))) {
                  best = item; break;
                }
              }
              if (!best && items.length > 0) best = items[0];
              if (best) { best.click(); return { selected: true, text: best.textContent.trim().substring(0, 60) }; }
              return { selected: false };
            }, vehicle.year, vehicle.make, NAV_TEXTS);
            if (selectResult.selected) {
              vehicleSelected = true;
              console.log(`${LOG}   Vehicle selected from dropdown: "${selectResult.text}"`);
              await sleep(2000);
            }
          }

          if (!vehicleSelected) {
            // Type to search
            await vehInput.click({ clickCount: 3 });
            await sleep(200);
            await vehInput.type(String(vehicle.year || ""), { delay: 80 });
            await sleep(3000);

            const typed = await page.evaluate((yr, mk, navTexts) => {
              const items = Array.from(document.querySelectorAll(
                ".p-autocomplete-panel li, .p-autocomplete-items li, " +
                "[class*='autocomplete'] [class*='list'] li, [role='option']"
              )).filter(li => {
                if (!li.offsetParent) return false;
                const t = li.textContent.trim();
                return t.length > 0 && !navTexts.includes(t) &&
                  !li.closest("nav, [class*='sidebar-nav'], [class*='nav-menu']");
              });
              if (items.length === 0) return { count: 0 };
              let best = null;
              for (const item of items) {
                const t = item.textContent.toLowerCase();
                if ((yr && t.includes(String(yr))) && (mk && t.includes(mk.toLowerCase()))) {
                  best = item; break;
                }
              }
              if (!best && items.length > 0) best = items[0];
              if (best) { best.click(); return { selected: true, text: best.textContent.trim().substring(0, 60), count: items.length }; }
              return { selected: false, count: items.length };
            }, vehicle.year, vehicle.make, NAV_TEXTS);
            console.log(`${LOG}   Vehicle type search: ${JSON.stringify(typed)}`);
            if (typed.selected) {
              vehicleSelected = true;
              await sleep(2000);
            }
          }

          if (!vehicleSelected) {
            // Try ArrowDown + Enter
            await page.keyboard.press("ArrowDown");
            await sleep(500);
            await page.keyboard.press("Enter");
            await sleep(2000);
          }
        }

        // ── Verify we're still on the estimate page ──
        if (!page.url().includes("/estimate/")) {
          console.log(`${LOG}   WARNING: Navigated away — going back to estimate`);
          await page.evaluate((id) => { window.location.hash = `/estimate/${id}`; }, result.estimateId);
          await sleep(5000);
        }

        // ── Final verification using PT button disabled state (most reliable indicator) ──
        await page.screenshot({ path: "/tmp/debug-after-vehicle.png" });
        const finalCheck = await page.evaluate((yr, mk, mdl) => {
          const vInput = document.querySelector("#estimate-vehicle");
          const val = vInput?.value || "";
          // Check wrapper text (PrimeNG might show value in span, not input)
          const wrapper = vInput?.closest("[class*='vehicle']") || vInput?.parentElement?.parentElement;
          const wrapperText = wrapper?.textContent?.trim() || "";
          const vStr = `${yr} ${mk} ${mdl}`.trim();
          // Check if PT button lost its disabled class
          const ptDisabled = !!document.querySelector(".ro-partstech-new button.if-disabled");
          return {
            vehicleInWrapper: vStr ? wrapperText.includes(yr) && wrapperText.includes(mk) : false,
            inputValue: val.substring(0, 60),
            ptDisabled,
            wrapperText: wrapperText.substring(0, 80),
          };
        }, String(vehicle.year || ""), vehicle.make || "", vehicle.model || "");
        console.log(`${LOG}   Final check: ${JSON.stringify(finalCheck)}`);

        if (finalCheck.vehicleInWrapper && !finalCheck.ptDisabled) {
          console.log(`${LOG}   Vehicle selected AND PT enabled ✓`);
        } else if (finalCheck.vehicleInWrapper) {
          console.log(`${LOG}   Vehicle text visible but PT still disabled — may be typed text only`);
          result.warnings.push({ code: "VEHICLE_TEXT_ONLY", msg: "Vehicle shows in UI but may not be properly selected" });
        } else {
          console.log(`${LOG}   WARNING: Vehicle not linked in UI`);
          result.warnings.push({ code: "NO_VEHICLE_UI", msg: "Vehicle not selected in AutoLeap UI — PartsTech SSO may fail" });
        }
      } catch (vehErr) {
        console.log(`${LOG} Phase 2b error: ${vehErr.message} — continuing`);
        result.warnings.push({ code: "VEHICLE_ERROR", msg: vehErr.message });
        if (!page.url().includes("/estimate/")) {
          await page.evaluate((id) => { window.location.hash = `/estimate/${id}`; }, result.estimateId);
          await sleep(5000);
        }
      }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PHASE 3: Parts via PartsTech (Steps 6-9)
    // ═══════════════════════════════════════════════════════════════════════════
    const partsToAdd = (parts || []).filter((p) => p.selected || p.requested);
    if (partsToAdd.length > 0) {
      await progress(progressCallback, "adding_parts");
      console.log(`${LOG} Phase 3: Opening PartsTech tab...`);

      const { ptPage, isIframe } = await openPartsTechTab(page, browser);

      // Get the working page for PartsTech (either new tab or iframe content)
      let ptWorkPage = ptPage;
      if (!ptWorkPage && isIframe) {
        console.log(`${LOG} Phase 3: PartsTech opened as iframe — getting frame content...`);
        try {
          const iframeEl = await page.$('iframe[src*="partstech"]');
          if (iframeEl) {
            ptWorkPage = await iframeEl.contentFrame();
            if (ptWorkPage) {
              const iframeUrl = ptWorkPage.url() || "";
              console.log(`${LOG} Phase 3: Got iframe frame, URL: ${iframeUrl.substring(0, 80)}`);
              // Check if SSO failed (chrome-error page means PartsTech couldn't load)
              if (iframeUrl.includes("chrome-error") || iframeUrl === "about:blank") {
                console.log(`${LOG} Phase 3: PartsTech SSO failed (iframe shows error page)`);
                console.log(`${LOG}   This usually means no vehicle is linked to the estimate`);
                ptWorkPage = null;
              } else {
                await sleep(3000); // Let iframe content load
              }
            }
          }
        } catch (iframeErr) {
          console.log(`${LOG} Phase 3: Iframe access failed: ${iframeErr.message}`);
        }
      }

      if (ptWorkPage) {
        for (const partItem of partsToAdd) {
          const searchTerm = partItem.requested?.searchTerms?.[0] ||
            partItem.requested?.partType ||
            partItem.selected?.description ||
            partItem.selected?.partType || "";

          if (!searchTerm) {
            result.warnings.push({ code: "PT_NO_SEARCH_TERM", msg: `No search term for part` });
            continue;
          }

          console.log(`${LOG} Phase 3: Searching "${searchTerm}"...`);
          const searchResult = await searchAndAddToCart(ptWorkPage, searchTerm);

          if (searchResult.success) {
            console.log(`${LOG} Phase 3: Cheapest in-stock: ${searchResult.partDetails?.brand} $${searchResult.partDetails?.price}`);
            result.partsAdded.push(searchResult.partDetails);
          } else {
            console.log(`${LOG} Phase 3: Part search failed: ${searchResult.error}`);
            result.warnings.push({ code: "PT_PART_FAILED", msg: searchResult.error });
          }
        }

        // Submit cart to AutoLeap
        if (result.partsAdded.length > 0) {
          console.log(`${LOG} Phase 3: Added ${result.partsAdded.length} to cart, submitting quote...`);
          const submitResult = await submitCartToAutoLeap(ptWorkPage, page);
          if (submitResult.success) {
            console.log(`${LOG} Phase 3: Parts synced to AutoLeap`);
          } else {
            console.log(`${LOG} Phase 3: Cart submit issue: ${submitResult.error}`);
            result.warnings.push({ code: "PT_SUBMIT_FAILED", msg: submitResult.error });
          }
        }

        // Close PartsTech tab if still open (only for new tab mode)
        if (ptPage && !isIframe) {
          try {
            if (!ptPage.isClosed()) await ptPage.close();
          } catch { /* already closed */ }
          await page.bringToFront();
        }
      } else {
        console.log(`${LOG} Phase 3: PartsTech did not open (no tab, no iframe) — skipping parts`);
        result.warnings.push({ code: "PT_NO_TAB", msg: "PartsTech did not open" });
      }
    } else {
      console.log(`${LOG} Phase 3: No parts to add — skipping PartsTech`);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PHASE 4: Labor via MOTOR (Steps 10-11)
    // ═══════════════════════════════════════════════════════════════════════════
    await progress(progressCallback, "adding_labor");
    console.log(`${LOG} Phase 4: Opening MOTOR catalog...`);

    const motorResult = await navigateMotorTree(page, diagnosis, vehicle);

    if (motorResult.success) {
      result.laborResult = motorResult;
      result.laborHours = motorResult.hours || 0;
      const addOnStr = motorResult.addOns?.length > 0 ? `, add-ons: ${motorResult.addOns.join(", ")}` : "";
      console.log(`${LOG} Phase 4: MOTOR labor added: ${motorResult.hours}h (NEVER modifying Qty/Hrs)${addOnStr}`);
    } else {
      console.log(`${LOG} Phase 4: MOTOR navigation failed: ${motorResult.error}`);
      result.warnings.push({ code: "MOTOR_FAILED", msg: motorResult.error });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PHASE 5: Link Parts to Labor (Step 12) — THE PROFIT STEP
    // ═══════════════════════════════════════════════════════════════════════════
    if (result.partsAdded.length > 0 && motorResult.success) {
      await progress(progressCallback, "linking_parts");
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
    // PHASE 6: Save + PDF (Steps 13-14)
    // ═══════════════════════════════════════════════════════════════════════════
    await progress(progressCallback, "generating_pdf");
    console.log(`${LOG} Phase 6: Saving estimate...`);

    // Save
    await saveEstimate(page);

    // Read totals from page DOM
    const totals = await readEstimateTotals(page);
    result.totalLabor = totals.labor || 0;
    result.totalParts = totals.parts || 0;
    result.total = totals.grandTotal || (result.totalLabor + result.totalParts);

    // Export PDF
    console.log(`${LOG} Phase 6: Exporting PDF...`);
    const safeName = `${vehicle.year}-${vehicle.make}-${vehicle.model}`.replace(/[^a-zA-Z0-9\-]/g, "").replace(/\s+/g, "-");
    const pdfOutputPath = path.join(os.tmpdir(), `estimate-${safeName}-${Date.now()}.pdf`);

    try {
      const pdfBuffer = await page.pdf({
        format: "Letter",
        printBackground: true,
        margin: { top: "12mm", bottom: "12mm", left: "10mm", right: "10mm" },
      });
      fs.writeFileSync(pdfOutputPath, pdfBuffer);
      result.pdfPath = pdfOutputPath;
      console.log(`${LOG} Phase 6: PDF exported → ${pdfOutputPath} (${pdfBuffer.length} bytes)`);
    } catch (pdfErr) {
      console.log(`${LOG} Phase 6: PDF export failed: ${pdfErr.message}`);
      result.warnings.push({ code: "PDF_FAILED", msg: pdfErr.message });
    }

    result.success = true;
    const laborRate = Number(process.env.AUTOLEAP_LABOR_RATE) || 120;
    result.laborRate = laborRate;
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
// PHASE 2: Customer & Vehicle
// ═══════════════════════════════════════════════════════════════════════════════

async function createEstimateWithCustomerVehicle(page, customer, vehicle) {
  // Hybrid approach: REST API for customer/estimate creation (reliable, gives ObjectId),
  // then navigate browser to estimate page for PartsTech/MOTOR (native pricing).
  // The markup matrix is only bypassed when PARTS are added via API — creating the
  // estimate shell via API is fine.

  // Step 2a: Get token (should be cached from login or pre-warm)
  console.log(`${LOG} Getting AutoLeap API token...`);
  const token = await getToken();
  if (!token) {
    return { success: false, error: "Could not get AutoLeap API token" };
  }
  console.log(`${LOG} Token acquired ✓`);

  // Step 2b: Search for existing customer or create new one
  const nameParts = (customer.name || "Customer").trim().split(/\s+/);
  const firstName = nameParts[0] || "";
  const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : "";

  let customerId = null;
  let customerName = `${firstName} ${lastName}`.trim();

  // Search for existing customer by phone or name
  let existingCustomer = null;
  if (customer.phone) {
    console.log(`${LOG} Searching for existing customer: ${customer.phone}...`);
    existingCustomer = await searchCustomer(token, customer.phone);
    if (existingCustomer?._id) {
      customerId = existingCustomer._id;
      customerName = `${existingCustomer.firstName || ""} ${existingCustomer.lastName || ""}`.trim() || customerName;
      console.log(`${LOG} Found existing customer: ${customerName} (${customerId})`);
    }
  }

  if (!customerId) {
    console.log(`${LOG} Creating new customer: ${firstName} ${lastName}...`);
    try {
      const newCust = await createCustomer(token, {
        firstName,
        lastName,
        phone: customer.phone || "",
      });
      customerId = newCust._id;
      console.log(`${LOG} Customer created: ${customerId}`);
    } catch (err) {
      console.log(`${LOG} Customer creation failed: ${err.message}`);
      return { success: false, error: `Customer creation failed: ${err.message}` };
    }
  }

  // Step 2c: Match vehicle from customer's vehicles (if existing customer)
  let vehicleId = null;
  const vehicles = existingCustomer?.vehicles || [];
  if (vehicles.length > 0 && (vehicle.vin || vehicle.year || vehicle.make)) {
    // Try VIN match first
    if (vehicle.vin) {
      const vinMatch = vehicles.find(v => v.VIN === vehicle.vin || v.vin === vehicle.vin);
      if (vinMatch) vehicleId = vinMatch.vehicleId;
    }
    // Try year/make match
    if (!vehicleId && (vehicle.year || vehicle.make)) {
      const ymMatch = vehicles.find(v => {
        const name = (v.name || "").toLowerCase();
        const yearOk = !vehicle.year || name.includes(String(vehicle.year));
        const makeOk = !vehicle.make || name.includes(vehicle.make.toLowerCase());
        return yearOk && makeOk;
      });
      if (ymMatch) vehicleId = ymMatch.vehicleId;
    }
    // Fall back to first vehicle
    if (!vehicleId) vehicleId = vehicles[0]?.vehicleId || null;

    if (vehicleId) {
      const veh = vehicles.find(v => v.vehicleId === vehicleId);
      console.log(`${LOG} Using vehicle: ${veh?.name || vehicleId}`);
    }
  }

  // Step 2c2: Create vehicle via API if no match found
  if (!vehicleId && (vehicle.year || vehicle.make || vehicle.vin)) {
    console.log(`${LOG} No vehicle matched — creating via API...`);
    try {
      const newVeh = await createVehicle(token, {
        customerId,
        year: vehicle.year,
        make: vehicle.make,
        model: vehicle.model,
        vin: vehicle.vin,
      });
      vehicleId = newVeh.vehicleId || newVeh._id || null;
      if (vehicleId) {
        console.log(`${LOG} Vehicle created: ${vehicleId} (${vehicle.year} ${vehicle.make} ${vehicle.model})`);
      }
    } catch (vehErr) {
      console.log(`${LOG} Vehicle API creation failed: ${vehErr.message} — will try browser`);
    }
  }

  // Step 2d: Create estimate via REST API (links customer + vehicle)
  console.log(`${LOG} Creating estimate via API...`);
  let estimateId = null;
  let roNumber = null;

  try {
    const est = await createEstimate(token, { customerId, vehicleId });
    estimateId = est._id;
    roNumber = est.code || est.estimateNumber || null;
    console.log(`${LOG} Estimate created: ${estimateId} (RO: ${roNumber})${vehicleId ? " with vehicle" : " (no vehicle)"}`);
  } catch (err) {
    console.log(`${LOG} Estimate creation failed: ${err.message}`);
    return { success: false, error: `Estimate creation failed: ${err.message}` };
  }

  // Step 2e: Navigate browser to the estimate page
  // Strategy: go to workboard → try clicking estimate from list (natural Angular routing)
  //           → fall back to hash navigation → fall back to page.goto
  console.log(`${LOG} Navigating to workboard...`);
  await page.goto(`${AUTOLEAP_APP_URL}/#/workboard`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await sleep(4000);

  // Try to find and click the estimate from the workboard (most natural Angular flow)
  let navigatedViaWorkboard = false;
  if (roNumber) {
    const wbClick = await page.evaluate((ro, custName) => {
      // AutoLeap workboard is Kanban-style — look for cards/rows with the RO number
      const allEls = document.querySelectorAll("a, [class*='card'], [class*='estimate'], td, span, div");
      for (const el of allEls) {
        const text = (el.textContent || "").trim();
        if (text.includes(ro)) {
          // Click the closest <a> or the element itself
          const link = el.closest("a") || el.querySelector("a") || el;
          link.click();
          return { clicked: true, method: "ro", text: text.substring(0, 80) };
        }
      }
      // Try by customer name
      if (custName) {
        for (const el of allEls) {
          const text = (el.textContent || "").trim();
          if (text.includes(custName) && (el.closest("a") || el.tagName === "A")) {
            const link = el.closest("a") || el;
            link.click();
            return { clicked: true, method: "customer", text: text.substring(0, 80) };
          }
        }
      }
      return { clicked: false };
    }, roNumber, customerName);

    if (wbClick.clicked) {
      console.log(`${LOG} Clicked estimate from workboard: ${wbClick.method} — "${wbClick.text}"`);
      await sleep(5000);
      const curUrl = page.url();
      if (curUrl.includes("/estimate/") || curUrl.includes(estimateId)) {
        navigatedViaWorkboard = true;
        console.log(`${LOG} Navigation via workboard ✓ — ${curUrl.substring(0, 80)}`);
      }
    }
  }

  if (!navigatedViaWorkboard) {
    // Fall back to hash-based navigation (lighter than full page.goto, triggers Angular router)
    console.log(`${LOG} Navigating to estimate via hash: /#/estimate/${estimateId}`);
    await page.evaluate((id) => { window.location.hash = `/estimate/${id}`; }, estimateId);
    await sleep(5000);

    const curUrl = page.url();
    if (!curUrl.includes("/estimate/")) {
      // Nuclear fallback: full page.goto
      const estUrl = `${AUTOLEAP_APP_URL}/#/estimate/${estimateId}`;
      console.log(`${LOG} Hash navigation failed — trying full goto: ${estUrl}`);
      await page.goto(estUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
      await sleep(5000);
    }
  }

  let currentUrl = page.url();
  console.log(`${LOG} Current URL: ${currentUrl}`);

  // Verify we're on the estimate page (not 404)
  const is404 = await page.evaluate(() => {
    const text = document.body?.innerText || "";
    return text.includes("404") && text.includes("not found");
  });
  if (is404) {
    console.log(`${LOG} Got 404 — estimate page not accessible`);
    return { success: false, error: "Estimate page 404 — URL pattern may have changed" };
  }

  await page.screenshot({ path: "/tmp/debug-estimate-page.png" });

  // Check vehicle status on the page
  const vehiclePageCheck = await page.evaluate((year, make, model) => {
    const text = document.body?.innerText || "";
    const vStr = `${year} ${make} ${model}`.trim();
    const vInput = document.querySelector("#estimate-vehicle");
    const dropdownBtn = document.querySelector(".p-autocomplete-dropdown");
    // Check all possible overlay containers
    const overlays = document.querySelectorAll(
      ".p-autocomplete-panel, .p-autocomplete-overlay, .p-overlay, .p-connected-overlay, .cdk-overlay-pane, [class*='autocomplete']"
    );
    return {
      vehicleInText: vStr ? text.includes(vStr) : false,
      inputValue: vInput?.value?.substring(0, 60) || "",
      placeholder: (vInput?.placeholder || vInput?.getAttribute("placeholder") || "").substring(0, 40),
      hasDropdownBtn: !!dropdownBtn,
      overlayCount: overlays.length,
      inputExists: !!vInput,
    };
  }, String(vehicle.year || ""), vehicle.make || "", vehicle.model || "");
  console.log(`${LOG} Vehicle page check: ${JSON.stringify(vehiclePageCheck)}`);

  // Dump visible buttons and tabs
  const pageDump = await page.evaluate(() => {
    const visibleButtons = Array.from(document.querySelectorAll("button"))
      .filter(b => b.offsetParent !== null)
      .map(b => b.textContent.trim().substring(0, 50))
      .filter(t => t.length > 0)
      .slice(0, 20);
    const tabs = Array.from(document.querySelectorAll('[role="tab"], button[class*="tab"]'))
      .filter(t => t.offsetParent !== null)
      .map(t => t.textContent.trim().substring(0, 30))
      .filter(t => t.length > 0)
      .slice(0, 15);
    return { visibleButtons, tabs };
  });
  console.log(`${LOG} Buttons: ${JSON.stringify(pageDump.visibleButtons)}`);
  console.log(`${LOG} Tabs: ${JSON.stringify(pageDump.tabs)}`);

  return {
    success: true,
    estimateId,
    roNumber,
    vehicleInPage: vehiclePageCheck.vehicleInText || !!vehiclePageCheck.inputValue,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// PHASE 5: Link Parts to Labor
// ═══════════════════════════════════════════════════════════════════════════════

async function linkPartsToServices(page, addedParts, laborResult) {
  let linked = 0;

  // Switch to Parts ordering tab
  await page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll('button[role="tab"], [class*="tab"]'));
    for (const tab of tabs) {
      if ((tab.textContent || "").includes("Parts ordering") || (tab.textContent || "").includes("Parts")) {
        tab.click();
        return;
      }
    }
  });
  await sleep(2000);

  // Find part rows and their service dropdowns
  const serviceName = laborResult.procedure || "";

  for (const part of addedParts) {
    try {
      const linkSuccess = await page.evaluate(
        (partBrand, partNum, svcName) => {
          // Find the part row
          const rows = Array.from(document.querySelectorAll("tr, [class*='part-row'], [class*='line-item']"));
          let targetRow = null;

          for (const row of rows) {
            const text = (row.textContent || "").toLowerCase();
            if (
              (partBrand && text.includes(partBrand.toLowerCase())) ||
              (partNum && text.includes(partNum.toLowerCase()))
            ) {
              targetRow = row;
              break;
            }
          }

          if (!targetRow) return false;

          // Find the service dropdown in this row
          const dropdown = targetRow.querySelector(
            'select, [class*="dropdown"], [class*="service-select"], [class*="select"]'
          );
          if (!dropdown) return false;

          // If it's a native select
          if (dropdown.tagName === "SELECT") {
            const options = Array.from(dropdown.options);
            const match = options.find(
              (o) => o.text.toLowerCase().includes(svcName.toLowerCase())
            );
            if (match) {
              dropdown.value = match.value;
              dropdown.dispatchEvent(new Event("change", { bubbles: true }));
              return true;
            }
            // If no match, pick the first non-empty option (should be the just-added service)
            if (options.length > 1) {
              dropdown.value = options[1].value;
              dropdown.dispatchEvent(new Event("change", { bubbles: true }));
              return true;
            }
          }

          // If it's a custom dropdown, click to open
          dropdown.click();
          return "clicked_dropdown";
        },
        part.brand || "",
        part.partNumber || "",
        serviceName
      );

      if (linkSuccess === true) {
        linked++;
        console.log(`${LOG} Linked: ${part.brand || ""} ${part.partNumber || ""} → ${serviceName}`);
      } else if (linkSuccess === "clicked_dropdown") {
        // Custom dropdown opened — need to select from options
        await sleep(1000);
        const selected = await page.evaluate((svcName) => {
          const options = Array.from(
            document.querySelectorAll('[role="option"], [role="listbox"] li, [class*="dropdown-item"], [class*="menu-item"]')
          );
          for (const opt of options) {
            if ((opt.textContent || "").toLowerCase().includes(svcName.toLowerCase())) {
              opt.click();
              return true;
            }
          }
          // Pick first option
          if (options.length > 0) {
            options[0].click();
            return true;
          }
          return false;
        }, serviceName);

        if (selected) {
          linked++;
          console.log(`${LOG} Linked (dropdown): ${part.brand || ""} → ${serviceName}`);
        }
      }

      await sleep(1000);
    } catch (err) {
      console.log(`${LOG} Link failed for ${part.brand || "part"}: ${err.message}`);
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
    const result = { labor: 0, parts: 0, shopSupplies: 0, tax: 0, grandTotal: 0 };

    // Try to read from summary section
    const allText = document.body.innerText;

    // Parse totals from text patterns
    const patterns = [
      { key: "labor", regex: /labor\s*(?:total)?[:\s$]*\$?([\d,.]+)/i },
      { key: "parts", regex: /parts\s*(?:total)?[:\s$]*\$?([\d,.]+)/i },
      { key: "shopSupplies", regex: /shop\s*supplies?[:\s$]*\$?([\d,.]+)/i },
      { key: "tax", regex: /tax[:\s$]*\$?([\d,.]+)/i },
      { key: "grandTotal", regex: /(?:grand\s*total|total\s*amount|estimate\s*total)[:\s$]*\$?([\d,.]+)/i },
    ];

    for (const { key, regex } of patterns) {
      const match = allText.match(regex);
      if (match) {
        result[key] = parseFloat(match[1].replace(/,/g, "")) || 0;
      }
    }

    // If no grand total found, try the largest dollar amount in the summary area
    if (result.grandTotal === 0) {
      const summaryEls = document.querySelectorAll('[class*="total"], [class*="summary"], [class*="grand"]');
      for (const el of summaryEls) {
        const text = el.textContent || "";
        const amounts = text.match(/\$[\d,.]+/g) || [];
        for (const amt of amounts) {
          const val = parseFloat(amt.replace(/[$,]/g, ""));
          if (val > result.grandTotal) result.grandTotal = val;
        }
      }
    }

    return result;
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Shared Helpers
// ═══════════════════════════════════════════════════════════════════════════════

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

async function fillField(page, selectorStr, value) {
  // Use page.evaluate to set value directly — avoids "not clickable" errors
  for (const sel of selectorStr.split(", ")) {
    try {
      const filled = await page.evaluate((selector, val) => {
        const el = document.querySelector(selector);
        if (!el) return false;
        // Focus the element
        el.focus();
        // Clear and set value
        el.value = "";
        // Use native input setter to trigger Angular's change detection
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype, "value"
        ).set;
        nativeInputValueSetter.call(el, val);
        // Dispatch events Angular listens to
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        el.dispatchEvent(new Event("blur", { bubbles: true }));
        return true;
      }, sel, value);
      if (filled) {
        console.log(`${LOG}   Filled: ${sel.substring(0, 30)} = "${value}"`);
        return true;
      }
    } catch { /* try next selector */ }
  }
  console.log(`${LOG} Field not found: ${selectorStr.substring(0, 40)}`);
  return false;
}

async function selectDropdown(page, selectorStr, value) {
  const el = await findFirstElement(page, selectorStr);
  if (!el) {
    console.log(`${LOG} Dropdown not found: ${selectorStr.substring(0, 40)}`);
    return false;
  }

  // Try native select first
  try {
    await page.select(selectorStr.split(", ")[0], value);
    return true;
  } catch { /* not a native select */ }

  // Click and type for custom dropdowns
  await el.click();
  await sleep(500);
  await page.keyboard.type(value, { delay: 30 });
  await sleep(500);

  // Try to click matching option
  await page.evaluate((val) => {
    const opts = document.querySelectorAll('[role="option"], li, [class*="option"]');
    for (const opt of opts) {
      if ((opt.textContent || "").trim().includes(val)) {
        opt.click();
        return;
      }
    }
  }, value);

  return true;
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
