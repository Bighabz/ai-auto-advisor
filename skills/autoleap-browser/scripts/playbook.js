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
  // Step 2: Open "Add Customer" via global "+" dropdown
  // The "+" in the header opens a dropdown with cards: Customer, Appointment, Estimate, etc.
  // We need to click "+" first, then click the "Customer" card.

  // Navigate to workboard first (dropdown works from any page)
  if (!page.url().includes("/workboard")) {
    await page.goto(`${AUTOLEAP_APP_URL}/#/workboard`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await sleep(3000);
  }

  // Step 2a: Click the global "+" button to open dropdown
  console.log(`${LOG} Clicking "+" button to open dropdown...`);
  const plusClicked = await page.evaluate(() => {
    const allClickable = Array.from(document.querySelectorAll("button, a, [role='button'], span, i"));
    for (const el of allClickable) {
      const cls = (el.className || "").toLowerCase();
      if ((cls.includes("plus-circle") || cls.includes("fa-plus")) && el.offsetParent !== null) {
        // Click the button/link ancestor, not the icon itself
        const clickTarget = el.closest("button, a, [role='button']") || el;
        clickTarget.click();
        return "plus-icon";
      }
    }
    return null;
  });

  if (!plusClicked) {
    return { success: false, error: 'Could not find "+" button in header' };
  }
  console.log(`${LOG} Dropdown opened ✓`);
  await sleep(2000);

  // Step 2b: Click the "Customer" card from the dropdown
  // Each card has: icon + heading ("Customer") + subheading ("Add a new customer")
  console.log(`${LOG} Clicking "Customer" card from dropdown...`);
  const customerClicked = await page.evaluate(() => {
    // Strategy 1: Find all visible elements, look for one whose own text content starts with "Customer"
    // but not "Customers" (nav link). The dropdown card heading should be "Customer" exactly.
    const candidates = Array.from(document.querySelectorAll("*")).filter(el => {
      if (!el.offsetParent) return false;
      // Check direct text nodes only (not nested children)
      const directText = Array.from(el.childNodes)
        .filter(n => n.nodeType === 3)
        .map(n => n.textContent.trim())
        .join(" ");
      return directText === "Customer";
    });

    if (candidates.length > 0) {
      // Click the closest clickable parent (the card container)
      const card = candidates[0].closest("a, button, [role='button'], div[class*='item'], div[class*='card'], div[class*='menu']") || candidates[0];
      card.click();
      return `card:${card.tagName}`;
    }

    // Strategy 2: Find links/buttons containing "Add a new customer"
    const links = Array.from(document.querySelectorAll("a, button, div, li"))
      .filter(el => el.offsetParent !== null);
    for (const el of links) {
      const text = (el.textContent || "").trim();
      if (text === "Customer Add a new customer" || text.startsWith("Customer\n")) {
        el.click();
        return `container:${el.tagName}`;
      }
    }

    // Strategy 3: Look for href containing "customer" in visible links
    const allLinks = Array.from(document.querySelectorAll("a[href]"))
      .filter(a => a.offsetParent !== null);
    for (const a of allLinks) {
      const href = a.getAttribute("href") || "";
      if (href.includes("customer") && !href.includes("customers")) {
        a.click();
        return `href:${href}`;
      }
    }

    return null;
  });

  if (!customerClicked) {
    await page.screenshot({ path: "/tmp/debug-dropdown-open.png", fullPage: true });
    // Dump dropdown items for debugging
    const dropdownItems = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("*"))
        .filter(el => el.offsetParent !== null && el.textContent.includes("Add a new"))
        .slice(0, 5)
        .map(el => ({
          tag: el.tagName,
          class: (el.className || "").substring(0, 60),
          text: el.textContent.trim().substring(0, 80),
          href: el.getAttribute?.("href") || null,
        }));
    });
    console.log(`${LOG} Dropdown items with "Add a new": ${JSON.stringify(dropdownItems)}`);
    return { success: false, error: 'Could not click "Customer" card from dropdown' };
  }
  console.log(`${LOG} Clicked Customer card: ${customerClicked}`);
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

  // Step 4: Investigate and fill vehicle section
  // The form may need scrolling to reveal vehicle fields
  console.log(`${LOG} Scrolling form to reveal vehicle section...`);
  await page.evaluate(() => {
    // Scroll the form panel/drawer to bottom to reveal vehicle section
    const panels = document.querySelectorAll('[class*="drawer"], [class*="sidebar"], [class*="panel"], [class*="dialog"], [class*="modal"], [class*="overlay"]');
    for (const panel of panels) {
      if (panel.scrollHeight > panel.clientHeight) {
        panel.scrollTop = panel.scrollHeight;
      }
    }
    // Also try scrolling main content
    window.scrollTo(0, document.body.scrollHeight);
  });
  await sleep(1500);

  // Screenshot after scroll to see full form
  await page.screenshot({ path: "/tmp/debug-customer-form-full.png", fullPage: true });

  // Comprehensive form dump: ALL inputs, buttons, dropdowns, labels
  const formDump = await page.evaluate(() => {
    // All inputs (visible or in DOM)
    const allInputs = Array.from(document.querySelectorAll("input"))
      .map(i => ({
        id: i.id, name: i.name, placeholder: i.placeholder, type: i.type,
        visible: i.offsetParent !== null, value: i.value,
        class: (i.className || "").substring(0, 40),
      }))
      .filter(i => i.id || i.placeholder || i.name);
    // All visible buttons
    const allButtons = Array.from(document.querySelectorAll("button"))
      .filter(b => b.offsetParent !== null)
      .map(b => ({
        text: b.textContent.trim().substring(0, 60),
        class: (b.className || "").substring(0, 40),
        disabled: b.disabled,
      }))
      .filter(b => b.text.length > 0);
    // Custom dropdowns (ng-select, mat-select, etc.)
    const customSelects = Array.from(document.querySelectorAll(
      'ng-select, mat-select, [class*="ng-select"], [class*="mat-select"], [class*="custom-select"], [role="listbox"], [role="combobox"]'
    )).map(s => ({
      tag: s.tagName,
      class: (s.className || "").substring(0, 60),
      placeholder: s.getAttribute("placeholder") || "",
      text: s.textContent.trim().substring(0, 40),
      visible: s.offsetParent !== null,
    }));
    // Labels
    const labels = Array.from(document.querySelectorAll("label"))
      .filter(l => l.offsetParent !== null)
      .map(l => l.textContent.trim().substring(0, 40))
      .filter(t => t.length > 0);
    return { allInputs: allInputs.slice(0, 25), allButtons: allButtons.slice(0, 15), customSelects: customSelects.slice(0, 10), labels: labels.slice(0, 20) };
  });
  console.log(`${LOG} === FORM DUMP ===`);
  console.log(`${LOG} Inputs (${formDump.allInputs.length}):`);
  for (const inp of formDump.allInputs) {
    console.log(`${LOG}   ${inp.visible ? "✓" : "✗"} id="${inp.id}" name="${inp.name}" placeholder="${inp.placeholder}" type="${inp.type}" val="${inp.value}"`);
  }
  console.log(`${LOG} Buttons (${formDump.allButtons.length}):`);
  for (const btn of formDump.allButtons) {
    console.log(`${LOG}   ${btn.disabled ? "⊘" : "●"} "${btn.text}"`);
  }
  console.log(`${LOG} Custom selects (${formDump.customSelects.length}):`);
  for (const sel of formDump.customSelects) {
    console.log(`${LOG}   ${sel.visible ? "✓" : "✗"} <${sel.tag}> placeholder="${sel.placeholder}" text="${sel.text}"`);
  }
  console.log(`${LOG} Labels: ${JSON.stringify(formDump.labels)}`);
  console.log(`${LOG} === END FORM DUMP ===`);

  // Look for VIN input specifically (not State/Province)
  const vinField = formDump.allInputs.find(i =>
    (i.placeholder?.toLowerCase().includes("vin") || i.id?.toLowerCase() === "vin") &&
    !i.placeholder?.toLowerCase().includes("state") &&
    !i.placeholder?.toLowerCase().includes("province")
  );

  if (vehicle.vin && vinField) {
    console.log(`${LOG} Entering VIN: ${vehicle.vin}`);
    const vinSel = vinField.id ? `#${vinField.id}` : `input[placeholder="${vinField.placeholder}"]`;
    await fillField(page, vinSel, vehicle.vin);
    await sleep(1000);
    // Click Decode button
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
  } else {
    // Try to fill Year/Make/Model using whatever fields are available
    // Look for ng-select or custom dropdowns for year/make/model
    console.log(`${LOG} No VIN field — looking for YMME dropdowns...`);

    // For custom Angular dropdowns, we need to click to open, then type to search
    for (const field of ["year", "make", "model"]) {
      const value = field === "year" ? String(vehicle.year) : field === "make" ? vehicle.make : vehicle.model;
      if (!value) continue;

      // Find dropdown by label, placeholder, or class
      const filled = await page.evaluate((fieldName, fieldValue) => {
        // Look for ng-select or similar with matching placeholder/label
        const dropdowns = Array.from(document.querySelectorAll(
          'ng-select, mat-select, [class*="ng-select"], [role="combobox"]'
        )).filter(d => d.offsetParent !== null);

        for (const dd of dropdowns) {
          const placeholder = (dd.getAttribute("placeholder") || "").toLowerCase();
          const label = dd.closest("div, label")?.textContent?.toLowerCase() || "";
          if (placeholder.includes(fieldName) || label.includes(fieldName)) {
            dd.click();
            return { found: true, tag: dd.tagName, class: (dd.className || "").substring(0, 40) };
          }
        }

        // Also check regular inputs
        const inputs = Array.from(document.querySelectorAll("input"))
          .filter(i => i.offsetParent !== null);
        for (const inp of inputs) {
          const ph = (inp.placeholder || "").toLowerCase();
          const id = (inp.id || "").toLowerCase();
          if (ph.includes(fieldName) || id.includes(fieldName)) {
            return { found: true, isInput: true, id: inp.id, placeholder: inp.placeholder };
          }
        }

        return { found: false };
      }, field, value);

      if (filled.found) {
        if (filled.isInput) {
          const sel = filled.id ? `#${filled.id}` : `input[placeholder="${filled.placeholder}"]`;
          await fillField(page, sel, value);
        } else {
          // Custom dropdown — type the value to search
          await sleep(500);
          await page.keyboard.type(value, { delay: 50 });
          await sleep(1000);
          // Press Enter or click first option
          await page.keyboard.press("Enter");
        }
        console.log(`${LOG}   ${field}: "${value}" ✓`);
        await sleep(500);
      } else {
        console.log(`${LOG}   ${field}: dropdown not found`);
      }
    }
  }

  // Step 5: Click "Save & Create Estimate" (preferred) or "Save"
  console.log(`${LOG} Looking for Save / Create Estimate button...`);

  // First screenshot before clicking
  await page.screenshot({ path: "/tmp/debug-before-save.png" });

  let saveClicked = false;
  saveClicked = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button")).filter(b => b.offsetParent !== null && !b.disabled);
    // Priority order — "Save & Create Estimate" is the ideal button
    const priorities = ["Save & Create Estimate", "Save & Create", "Create Estimate"];
    for (const text of priorities) {
      for (const btn of btns) {
        if (btn.textContent.trim().includes(text)) {
          btn.click();
          return text;
        }
      }
    }
    // Fallback to "Save" — we'll create estimate separately
    for (const btn of btns) {
      if (btn.textContent.trim() === "Save" || btn.textContent.trim().startsWith("Save")) {
        btn.click();
        return "Save";
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

  await sleep(5000);
  await page.screenshot({ path: "/tmp/debug-after-save.png" });

  // If we clicked "Save" (not "Save & Create Estimate"), we need to create estimate from customer page
  if (saveClicked === "Save") {
    console.log(`${LOG} Customer saved — now looking for "Create Estimate" option...`);

    // After saving customer, AutoLeap may redirect to customer detail page
    // Look for a "Create Estimate" button/link on that page
    const createEstClicked = await page.evaluate(() => {
      const allEls = Array.from(document.querySelectorAll("button, a, [role='button']"))
        .filter(el => el.offsetParent !== null);
      for (const el of allEls) {
        const text = (el.textContent || "").trim();
        if (text.includes("Create Estimate") || text.includes("New Estimate") || text.includes("Estimate")) {
          el.click();
          return text;
        }
      }
      return null;
    });

    if (createEstClicked) {
      console.log(`${LOG} Clicked: "${createEstClicked}"`);
      await sleep(5000);
    } else {
      console.log(`${LOG} No "Create Estimate" button found — navigating to workboard to create estimate...`);
      // Navigate back to workboard and create estimate via "Estimate" button
      await page.goto(`${AUTOLEAP_APP_URL}/#/workboard`, { waitUntil: "domcontentloaded", timeout: 30000 });
      await sleep(3000);
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll("button")).filter(b => b.offsetParent !== null);
        for (const btn of btns) {
          if (btn.textContent.trim() === "Estimate") {
            btn.click();
            return;
          }
        }
      });
      await sleep(3000);
    }
  }

  // Wait for navigation to estimate page
  console.log(`${LOG} Waiting for estimate page...`);
  await sleep(3000);

  // Extract estimate ID and RO number from URL
  const currentUrl = page.url();
  console.log(`${LOG} Current URL after save: ${currentUrl}`);
  const estimateMatch = currentUrl.match(/estimates?\/([a-f0-9-]+)/i);
  const estimateId = estimateMatch?.[1] || null;

  // Try to read RO number from page
  const roNumber = await page.evaluate(() => {
    const el = document.querySelector('[class*="ro-number"], [class*="estimate-code"], [class*="code"]');
    if (el) return el.textContent.trim();
    // Look for text pattern like "RO-12345" or "EST-12345" or #XXXXX
    const body = document.body.innerText;
    const match = body.match(/(RO-\d+|EST-\d+|#\d{4,}|\d{5})/);
    return match?.[0] || null;
  });

  // Screenshot of estimate page
  await page.screenshot({ path: "/tmp/debug-estimate-page.png" });

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
