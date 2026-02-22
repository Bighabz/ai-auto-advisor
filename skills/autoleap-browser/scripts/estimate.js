/**
 * AutoLeap Estimate Builder
 *
 * Creates estimates in AutoLeap's web UI with:
 * - Labor from MOTORS (embedded in AutoLeap)
 * - Parts from PartsTech (embedded in AutoLeap)
 */

const browser = require("../../shared/browser");
const { ensureLoggedIn } = require("./login");

const LOG = "[autoleap-browser]";

/**
 * Create an estimate in AutoLeap with MOTORS labor and PartsTech parts.
 *
 * @param {object} params
 * @param {object} params.diagnosis - AI diagnosis results (repair_plan, etc.)
 * @param {object[]} [params.parts] - Parts from partstech-search best value bundle
 * @param {string} [params.customerName] - Customer name (for context)
 * @param {string} [params.vehicleDesc] - Vehicle description (for context)
 * @returns {{ success: boolean, estimateId?: string, totalLabor?: number,
 *             totalParts?: number, shopSupplies?: number, tax?: number,
 *             total?: number, error?: string }}
 */
function createEstimate({ diagnosis, parts, customerName, vehicleDesc }) {
  const loginResult = ensureLoggedIn();
  if (!loginResult.success) return loginResult;

  try {
    let snapshot = browser.takeSnapshot();
    let elements = browser.parseSnapshot(snapshot);

    // Navigate to create new estimate
    const newEstBtn = browser.findRef(elements, "create estimate") ||
                      browser.findRef(elements, "new estimate") ||
                      browser.findRefByType(elements, "button", "estimate");

    if (newEstBtn) {
      browser.clickRef(newEstBtn);
      browser.waitForLoad("networkidle");
    } else {
      // Try navigating via estimates list
      const estimatesNav = browser.findRef(elements, "estimates");
      if (estimatesNav) {
        browser.clickRef(estimatesNav);
        browser.waitForLoad("networkidle");

        snapshot = browser.takeSnapshot();
        elements = browser.parseSnapshot(snapshot);
        const createBtn = browser.findRef(elements, "create") ||
                          browser.findRefByType(elements, "button", "new");
        if (createBtn) {
          browser.clickRef(createBtn);
          browser.waitForLoad("networkidle");
        }
      }
    }

    // === ADD LABOR FROM MOTORS ===
    const repairPlan = diagnosis?.ai?.repair_plan;
    const laborAdded = [];

    if (repairPlan) {
      console.log(`${LOG} Adding labor from MOTORS...`);
      snapshot = browser.takeSnapshot();
      elements = browser.parseSnapshot(snapshot);

      // Find "Add Service" or "Services" tab
      const servicesTab = browser.findRef(elements, "services") ||
                          browser.findRef(elements, "service");
      if (servicesTab) {
        browser.clickRef(servicesTab);
        browser.waitForLoad("networkidle");
      }

      snapshot = browser.takeSnapshot();
      elements = browser.parseSnapshot(snapshot);

      const addServiceBtn = browser.findRef(elements, "add service") ||
                            browser.findRef(elements, "add labor") ||
                            browser.findRefByType(elements, "button", "add");
      if (addServiceBtn) {
        browser.clickRef(addServiceBtn);
        browser.waitForLoad("networkidle");
      }

      // Search MOTORS for the repair description
      const repairDesc = repairPlan.labor?.description ||
                         diagnosis?.ai?.diagnoses?.[0]?.cause ||
                         "general repair";

      snapshot = browser.takeSnapshot();
      elements = browser.parseSnapshot(snapshot);

      // Look for MOTORS search or labor search
      const motorsSearch = browser.findRefByType(elements, "input", "search") ||
                           browser.findRef(elements, "motors") ||
                           browser.findRef(elements, "labor search") ||
                           browser.findRef(elements, "search");
      if (motorsSearch) {
        browser.clickRef(motorsSearch);
        browser.typeInRef(motorsSearch, repairDesc, true);
        browser.waitForLoad("networkidle");

        // Select first matching result
        snapshot = browser.takeSnapshot();
        elements = browser.parseSnapshot(snapshot);

        // Look for result that matches our repair
        const resultRef = browser.findRef(elements, repairDesc.split(" ")[0]);
        if (resultRef) {
          browser.clickRef(resultRef);
          browser.waitForLoad("networkidle");
          laborAdded.push({
            description: repairDesc,
            hours: repairPlan.labor?.hours || null,
            source: "motors",
          });
          console.log(`${LOG} Labor added from MOTORS: ${repairDesc}`);
        } else {
          console.log(`${LOG} MOTORS search returned no match for: ${repairDesc}`);
        }
      }

      // If MOTORS didn't work, try manual labor entry
      if (laborAdded.length === 0 && repairPlan.labor?.hours) {
        snapshot = browser.takeSnapshot();
        elements = browser.parseSnapshot(snapshot);

        const manualBtn = browser.findRef(elements, "manual") ||
                          browser.findRef(elements, "custom") ||
                          browser.findRef(elements, "add manually");
        if (manualBtn) {
          browser.clickRef(manualBtn);
          browser.waitForLoad("networkidle");

          snapshot = browser.takeSnapshot();
          elements = browser.parseSnapshot(snapshot);

          // Fill description
          const descRef = browser.findRefByType(elements, "input", "description") ||
                          browser.findRefByType(elements, "input", "service") ||
                          browser.findRef(elements, "description");
          if (descRef) {
            browser.clickRef(descRef);
            browser.typeInRef(descRef, repairDesc);
          }

          // Fill hours
          const hoursRef = browser.findRefByType(elements, "input", "hours") ||
                           browser.findRef(elements, "labor hours") ||
                           browser.findRef(elements, "hours");
          if (hoursRef) {
            browser.clickRef(hoursRef);
            browser.typeInRef(hoursRef, String(repairPlan.labor.hours));
          }

          // Save
          snapshot = browser.takeSnapshot();
          elements = browser.parseSnapshot(snapshot);
          const saveBtn = browser.findRefByType(elements, "button", "save") ||
                          browser.findRefByType(elements, "button", "add");
          if (saveBtn) {
            browser.clickRef(saveBtn);
            browser.waitForLoad("networkidle");
          }

          laborAdded.push({
            description: repairDesc,
            hours: repairPlan.labor.hours,
            source: "manual",
          });
          console.log(`${LOG} Labor added manually: ${repairPlan.labor.hours}h`);
        }
      }
    }

    // === ADD PARTS FROM PARTSTECH ===
    const partsAdded = [];

    if (parts?.length > 0) {
      console.log(`${LOG} Adding parts via PartsTech...`);
      snapshot = browser.takeSnapshot();
      elements = browser.parseSnapshot(snapshot);

      // Navigate to Parts tab or PartsTech
      const partsTab = browser.findRef(elements, "parts") ||
                       browser.findRef(elements, "parts ordering") ||
                       browser.findRef(elements, "partstech");
      if (partsTab) {
        browser.clickRef(partsTab);
        browser.waitForLoad("networkidle");
      }

      // Open embedded PartsTech
      snapshot = browser.takeSnapshot();
      elements = browser.parseSnapshot(snapshot);
      const ptBtn = browser.findRef(elements, "partstech") ||
                    browser.findRef(elements, "order parts") ||
                    browser.findRef(elements, "search parts");
      if (ptBtn) {
        browser.clickRef(ptBtn);
        browser.waitForLoad("networkidle");
      }

      for (const part of parts) {
        const partDesc = part.selected?.description || part.partType || part.name;
        if (!partDesc) continue;

        try {
          snapshot = browser.takeSnapshot();
          elements = browser.parseSnapshot(snapshot);

          const searchRef = browser.findRefByType(elements, "input", "search") ||
                            browser.findRef(elements, "search");
          if (searchRef) {
            // Clear previous search
            browser.clickRef(searchRef);
            browser.clickRef(searchRef);
            browser.clickRef(searchRef);
            browser.typeInRef(searchRef, partDesc, true);
            browser.waitForLoad("networkidle");

            // Select best match
            snapshot = browser.takeSnapshot();
            elements = browser.parseSnapshot(snapshot);

            // Try to match by part number first
            let matchRef = null;
            if (part.selected?.partNumber) {
              matchRef = browser.findRef(elements, part.selected.partNumber);
            }
            // Fall back to brand match
            if (!matchRef && part.selected?.brand) {
              matchRef = browser.findRef(elements, part.selected.brand);
            }
            // Fall back to first result
            if (!matchRef) {
              const pricePattern = /\$\d+/;
              const priceEls = elements.filter((el) => pricePattern.test(el.text));
              if (priceEls.length > 0) {
                matchRef = priceEls[0].ref;
              }
            }

            if (matchRef) {
              browser.clickRef(matchRef);
              browser.waitForLoad("networkidle");

              // Click "Add to Estimate" or "Select"
              snapshot = browser.takeSnapshot();
              elements = browser.parseSnapshot(snapshot);
              const addToEst = browser.findRef(elements, "add to estimate") ||
                               browser.findRef(elements, "select") ||
                               browser.findRefByType(elements, "button", "add");
              if (addToEst) {
                browser.clickRef(addToEst);
                browser.waitForLoad("networkidle");
              }

              partsAdded.push({
                description: partDesc,
                partNumber: part.selected?.partNumber || null,
                brand: part.selected?.brand || null,
              });
              console.log(`${LOG} Part added: ${partDesc}`);
            } else {
              console.log(`${LOG} No match found for part: ${partDesc}`);
            }
          }
        } catch (partErr) {
          console.error(`${LOG} Failed to add part ${partDesc}: ${partErr.message}`);
        }
      }
    }

    // === READ ESTIMATE TOTALS ===
    console.log(`${LOG} Reading estimate totals...`);
    snapshot = browser.takeSnapshot();
    elements = browser.parseSnapshot(snapshot);

    const pricePattern = /\$(\d{1,6}(?:,\d{3})*(?:\.\d{2})?)/;
    let totalLabor = 0;
    let totalParts = 0;
    let shopSupplies = 0;
    let tax = 0;
    let total = 0;
    let estimateId = null;

    // Extract estimate number
    const estNumPattern = /(?:EST|#|estimate)\s*[-:]?\s*(\d{4,})/i;
    for (const el of elements) {
      const estMatch = el.text.match(estNumPattern);
      if (estMatch) {
        estimateId = estMatch[0].trim();
        break;
      }
    }

    // Extract pricing from page
    for (const el of elements) {
      const textLower = el.text.toLowerCase();
      const priceMatch = el.text.match(pricePattern);
      if (!priceMatch) continue;

      const amount = parseFloat(priceMatch[1].replace(/,/g, ""));

      if (textLower.includes("labor") && textLower.includes("total")) {
        totalLabor = amount;
      } else if (textLower.includes("parts") && textLower.includes("total")) {
        totalParts = amount;
      } else if (textLower.includes("shop supplies") || textLower.includes("supplies")) {
        shopSupplies = amount;
      } else if (textLower.includes("tax")) {
        tax = amount;
      } else if (textLower.includes("grand total") || textLower.includes("estimate total")) {
        total = amount;
      }
    }

    // If we didn't find a structured total, sum up
    if (total === 0 && (totalLabor > 0 || totalParts > 0)) {
      total = totalLabor + totalParts + shopSupplies + tax;
    }

    console.log(`${LOG} Estimate built: ${estimateId || "unknown"} — $${total}`);

    return {
      success: true,
      estimateId,
      totalLabor,
      totalParts,
      shopSupplies,
      tax,
      total,
      laborAdded,
      partsAdded,
    };
  } catch (err) {
    return { success: false, error: `Estimate creation failed: ${err.message}` };
  }
}

/**
 * Download the PDF for a completed estimate from AutoLeap.
 *
 * Navigates to the estimate, finds the PDF download/print action,
 * captures the downloaded file path, and returns it.
 *
 * @param {string} estimateId - Estimate ID or number to download
 * @returns {{ success: boolean, pdfPath?: string, error?: string }}
 */
function downloadPdf(estimateId) {
  const loginResult = ensureLoggedIn();
  if (!loginResult.success) return loginResult;

  try {
    let snapshot = browser.takeSnapshot();
    let elements = browser.parseSnapshot(snapshot);

    // Navigate to the specific estimate if we have an ID
    if (estimateId) {
      const estRef = browser.findRef(elements, estimateId);
      if (estRef) {
        browser.clickRef(estRef);
        browser.waitForLoad();
        snapshot = browser.takeSnapshot();
        elements = browser.parseSnapshot(snapshot);
      }
    }

    // Find PDF download / print action
    const pdfBtn =
      browser.findRef(elements, "download pdf") ||
      browser.findRef(elements, "save as pdf") ||
      browser.findRef(elements, "print estimate") ||
      browser.findRef(elements, "export pdf") ||
      browser.findRef(elements, "pdf");

    if (!pdfBtn) {
      console.log(`${LOG} No PDF button found for estimate: ${estimateId}`);
      return { success: false, error: "No PDF download button found" };
    }

    browser.clickRef(pdfBtn);
    browser.waitForLoad();

    // AutoLeap may open a print dialog — look for a download path in snapshot
    snapshot = browser.takeSnapshot();
    const mediaMatch = snapshot.match(/MEDIA:(\S+\.pdf)/i);
    if (mediaMatch) {
      const pdfPath = mediaMatch[1];
      console.log(`${LOG} PDF downloaded: ${pdfPath}`);
      return { success: true, pdfPath };
    }

    // If no PDF path captured, return partial success — estimate is visible
    console.log(`${LOG} PDF action triggered but path not captured`);
    return { success: true, pdfPath: null };
  } catch (err) {
    return { success: false, error: `PDF download failed: ${err.message}` };
  }
}

module.exports = { createEstimate, downloadPdf };
