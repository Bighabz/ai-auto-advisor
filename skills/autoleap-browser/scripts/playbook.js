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
      protocolTimeout: 60000,
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

    // Wait for estimate page to settle
    await sleep(3000);

    // ═══════════════════════════════════════════════════════════════════════════
    // PHASE 3: Parts via PartsTech (Steps 6-9)
    // ═══════════════════════════════════════════════════════════════════════════
    const partsToAdd = (parts || []).filter((p) => p.selected || p.requested);
    if (partsToAdd.length > 0) {
      await progress(progressCallback, "adding_parts");
      console.log(`${LOG} Phase 3: Opening PartsTech tab...`);

      const { ptPage } = await openPartsTechTab(page, browser);

      if (ptPage) {
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
          const searchResult = await searchAndAddToCart(ptPage, searchTerm);

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
          const submitResult = await submitCartToAutoLeap(ptPage, page);
          if (submitResult.success) {
            console.log(`${LOG} Phase 3: Parts synced to AutoLeap`);
          } else {
            console.log(`${LOG} Phase 3: Cart submit issue: ${submitResult.error}`);
            result.warnings.push({ code: "PT_SUBMIT_FAILED", msg: submitResult.error });
          }
        }

        // Close PartsTech tab if still open
        try {
          if (!ptPage.isClosed()) await ptPage.close();
        } catch { /* already closed */ }

        await page.bringToFront();
      } else {
        console.log(`${LOG} Phase 3: PartsTech tab did not open — skipping parts`);
        result.warnings.push({ code: "PT_NO_TAB", msg: "PartsTech tab did not open" });
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
  // Step 2: Navigate to Customers page and open "Add Customer" form
  console.log(`${LOG} Navigating to Customers page...`);
  await page.goto(`${AUTOLEAP_APP_URL}/#/customers`, {
    waitUntil: "domcontentloaded",
    timeout: 30000,
  });
  await sleep(3000);

  // Screenshot to see the Customers page
  await page.screenshot({ path: "/tmp/debug-customers-page.png" });

  // Look for "Add Customer" or "+" button on the Customers page
  console.log(`${LOG} Looking for Add Customer button...`);
  const addClicked = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button, a, [role='button']"))
      .filter(b => b.offsetParent !== null);
    // Try: "Add Customer", "Add", "New Customer", "Create Customer"
    const targets = ["Add Customer", "New Customer", "Create Customer", "Add New"];
    for (const target of targets) {
      for (const btn of btns) {
        if ((btn.textContent || "").trim().includes(target)) {
          btn.click();
          return target;
        }
      }
    }
    // Try "+" button or icon
    for (const btn of btns) {
      const text = (btn.textContent || "").trim();
      if (text === "+" || text === "Add") {
        btn.click();
        return `"${text}"`;
      }
    }
    // Try icon-based buttons (fa-plus, fa-plus-circle)
    for (const btn of btns) {
      const icons = btn.querySelectorAll("i.fa-plus, i.fa-plus-circle, i.fas.fa-plus");
      if (icons.length > 0) {
        btn.click();
        return "icon:fa-plus";
      }
    }
    // Log what buttons exist
    const allBtnTexts = btns.map(b => b.textContent.trim().substring(0, 40)).filter(t => t.length > 0);
    return { buttons: allBtnTexts.slice(0, 15) };
  });

  console.log(`${LOG} Add Customer result: ${JSON.stringify(addClicked)}`);

  if (typeof addClicked === "object") {
    // Failed — log the available buttons for debugging
    console.log(`${LOG} Available buttons: ${JSON.stringify(addClicked.buttons)}`);
    await page.screenshot({ path: "/tmp/debug-no-add-customer.png", fullPage: true });
    return { success: false, error: `Could not find "Add Customer" button. Available: ${(addClicked.buttons || []).join(", ")}` };
  }

  console.log(`${LOG} Clicked: "${addClicked}"`);
  await sleep(3000);

  // Wait for the customer form to appear (drawer/modal with personal-card-fname)
  console.log(`${LOG} Waiting for customer form...`);
  let formVisible = false;
  for (let attempt = 0; attempt < 8; attempt++) {
    formVisible = await page.evaluate(() => {
      const fname = document.querySelector('#personal-card-fname');
      if (fname && fname.offsetParent !== null) return true;
      // Also check for any First Name input that's visible
      const inputs = Array.from(document.querySelectorAll("input"));
      for (const inp of inputs) {
        if (inp.offsetParent !== null &&
            (inp.placeholder?.includes("First") || inp.id?.includes("fname"))) {
          return true;
        }
      }
      return false;
    });
    if (formVisible) break;
    await sleep(1500);
  }

  if (!formVisible) {
    await page.screenshot({ path: "/tmp/debug-no-customer-form.png", fullPage: true });
    const debugInfo = await page.evaluate(() => {
      const url = window.location.href;
      const visibleInputs = Array.from(document.querySelectorAll("input"))
        .filter(i => i.offsetParent !== null)
        .slice(0, 10)
        .map(i => ({ id: i.id, placeholder: i.placeholder, type: i.type }));
      const visibleButtons = Array.from(document.querySelectorAll("button"))
        .filter(b => b.offsetParent !== null)
        .map(b => b.textContent.trim().substring(0, 40))
        .filter(t => t.length > 0)
        .slice(0, 10);
      return { url, visibleInputs, visibleButtons };
    });
    console.log(`${LOG} Form NOT visible. URL: ${debugInfo.url}`);
    console.log(`${LOG} Visible inputs: ${JSON.stringify(debugInfo.visibleInputs)}`);
    console.log(`${LOG} Buttons: ${JSON.stringify(debugInfo.visibleButtons)}`);
    return { success: false, error: 'Customer form did not appear' };
  }
  console.log(`${LOG} Customer form visible ✓`);

  // Step 3: Fill customer info using AutoLeap's actual IDs
  const nameParts = (customer.name || "Customer").trim().split(/\s+/);
  const firstName = nameParts[0] || "";
  const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : "";

  console.log(`${LOG} Filling customer: ${firstName} ${lastName}`);

  // AutoLeap uses id-based selectors, not name/formcontrolname
  await fillField(page, '#personal-card-fname, input[placeholder="First Name*"]', firstName);
  await fillField(page, '#personal-card-lname, input[placeholder="Last Name*"]', lastName);
  if (customer.phone) {
    await fillField(page, '#personal-card-mobile, input[placeholder="Mobile*"]', customer.phone);
  }

  // Step 4: Vehicle — check if there's a vehicle section visible
  // AutoLeap has no native <select> elements — YMME uses custom dropdowns
  console.log(`${LOG} Looking for vehicle section...`);
  const vehicleDebug = await page.evaluate(() => {
    // Look for VIN field
    const vinInputs = Array.from(document.querySelectorAll("input")).filter(i =>
      i.offsetParent !== null && (
        i.placeholder?.toLowerCase().includes("vin") ||
        i.id?.toLowerCase().includes("vin") ||
        i.name?.toLowerCase().includes("vin")
      )
    );
    // Look for Year/Make/Model inputs or dropdowns
    const ymmeInputs = Array.from(document.querySelectorAll("input")).filter(i =>
      i.offsetParent !== null && (
        i.placeholder?.toLowerCase().includes("year") ||
        i.placeholder?.toLowerCase().includes("make") ||
        i.placeholder?.toLowerCase().includes("model") ||
        i.id?.toLowerCase().includes("year") ||
        i.id?.toLowerCase().includes("make") ||
        i.id?.toLowerCase().includes("model")
      )
    );
    return {
      vinFields: vinInputs.map(i => ({ id: i.id, placeholder: i.placeholder, class: i.className.substring(0, 60) })),
      ymmeFields: ymmeInputs.map(i => ({ id: i.id, placeholder: i.placeholder, class: i.className.substring(0, 60) })),
    };
  });
  console.log(`${LOG} VIN fields: ${JSON.stringify(vehicleDebug.vinFields)}`);
  console.log(`${LOG} YMME fields: ${JSON.stringify(vehicleDebug.ymmeFields)}`);

  // Try filling vehicle if fields are visible
  if (vehicle.vin && vehicleDebug.vinFields.length > 0) {
    console.log(`${LOG} Entering VIN: ${vehicle.vin}`);
    const vinSel = vehicleDebug.vinFields[0].id ? `#${vehicleDebug.vinFields[0].id}` : `input[placeholder*="VIN" i]`;
    await fillField(page, vinSel, vehicle.vin);
    await sleep(1000);
    // Try to click Decode button
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button")).filter(b => b.offsetParent !== null);
      for (const btn of btns) {
        if (btn.textContent.trim().toLowerCase().includes("decode")) {
          btn.click();
          return true;
        }
      }
      return false;
    });
    await sleep(5000);
  } else if (vehicleDebug.ymmeFields.length > 0) {
    console.log(`${LOG} YMME fields found — filling year/make/model`);
    // Fill whatever YMME fields are visible
    for (const field of vehicleDebug.ymmeFields) {
      const sel = field.id ? `#${field.id}` : `input[placeholder="${field.placeholder}"]`;
      const placeholder = (field.placeholder || "").toLowerCase();
      if (placeholder.includes("year")) {
        await fillField(page, sel, String(vehicle.year));
      } else if (placeholder.includes("make")) {
        await fillField(page, sel, vehicle.make);
      } else if (placeholder.includes("model")) {
        await fillField(page, sel, vehicle.model);
      }
      await sleep(500);
    }
  } else {
    console.log(`${LOG} No vehicle fields visible — will skip vehicle entry`);
  }

  // Step 5: Click "Save" then create estimate
  console.log(`${LOG} Looking for Save / Create Estimate button...`);
  let saveClicked = false;

  // Try text-based button search (visible buttons only)
  saveClicked = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button")).filter(b => b.offsetParent !== null && !b.disabled);
    // Priority order
    const priorities = ["Save & Create Estimate", "Save & Create", "Create Estimate", "Save"];
    for (const text of priorities) {
      for (const btn of btns) {
        if (btn.textContent.trim().includes(text)) {
          btn.click();
          return text;
        }
      }
    }
    return null;
  });

  if (saveClicked) {
    console.log(`${LOG} Clicked: "${saveClicked}"`);
  } else {
    await page.screenshot({ path: "/tmp/debug-no-save-btn.png", fullPage: true });
    return { success: false, error: '"Save" button not found' };
  }

  // Wait for navigation to estimate page
  console.log(`${LOG} Waiting for estimate page...`);
  try {
    await page.waitForFunction(
      () => window.location.href.includes("/estimate") || window.location.href.includes("/workboard"),
      { timeout: 20000 }
    );
  } catch {
    // May already be on estimate page
  }
  await sleep(3000);

  // Extract estimate ID and RO number from URL
  const currentUrl = page.url();
  const estimateMatch = currentUrl.match(/estimates?\/([a-f0-9]+)/i);
  const estimateId = estimateMatch?.[1] || null;

  // Try to read RO number from page
  const roNumber = await page.evaluate(() => {
    const el = document.querySelector('[class*="ro-number"], [class*="estimate-code"], [class*="code"]');
    if (el) return el.textContent.trim();
    // Look for text pattern like "RO-12345" or "EST-12345"
    const body = document.body.innerText;
    const match = body.match(/(RO-\d+|EST-\d+|#\d{4,})/);
    return match?.[0] || null;
  });

  return {
    success: true,
    estimateId,
    roNumber,
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
  const el = await findFirstElement(page, selectorStr);
  if (!el) {
    console.log(`${LOG} Field not found: ${selectorStr.substring(0, 40)}`);
    return false;
  }
  await el.click({ clickCount: 3 });
  await sleep(100);
  await el.type(value, { delay: 40 });
  return true;
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
