/**
 * AutoLeap Parts Search — skills/autoleap-browser/scripts/parts.js
 *
 * Searches for parts using AutoLeap's embedded PartsTech integration
 * and adds them to the current open estimate.
 *
 * Called by the orchestrator during Phase 2 (estimate population).
 */

"use strict";

const browser = require("../../shared/browser");
const { ensureLoggedIn } = require("./login");

const LOG = "[autoleap-parts]";

/**
 * Search for parts via AutoLeap's built-in PartsTech integration
 * and add them to the currently open estimate.
 *
 * @param {object} params
 * @param {Array<{ partType: string, position?: string, qty?: number, oemPreferred?: boolean }>} params.partsNeeded
 * @param {string} params.vehicleDesc - e.g. "2019 Honda Civic 2.0L"
 * @returns {{ success: boolean, addedParts: object[], failedParts: object[], addedCount: number, failedCount: number }}
 */
function searchAndAddParts({ partsNeeded, vehicleDesc }) {
  const loginResult = ensureLoggedIn();
  if (!loginResult.success) {
    console.error(`${LOG} Not logged in: ${loginResult.error}`);
    return {
      success: false,
      addedParts: [],
      failedParts: partsNeeded || [],
      addedCount: 0,
      failedCount: (partsNeeded || []).length,
      error: loginResult.error,
    };
  }

  if (!partsNeeded || partsNeeded.length === 0) {
    return { success: true, addedParts: [], failedParts: [], addedCount: 0, failedCount: 0 };
  }

  console.log(`${LOG} Adding ${partsNeeded.length} parts to estimate (${vehicleDesc})...`);

  const addedParts = [];
  const failedParts = [];

  for (const part of partsNeeded) {
    try {
      const searchTerm = [part.partType, part.position].filter(Boolean).join(" ");

      // Navigate to parts tab within the estimate
      let snap = browser.takeSnapshot();
      let elements = browser.parseSnapshot(snap);

      const partsTab =
        browser.findRef(elements, "parts") ||
        browser.findRef(elements, "add parts") ||
        browser.findRef(elements, "partstech");

      if (partsTab) {
        browser.clickRef(partsTab);
        browser.waitForLoad();
        snap = browser.takeSnapshot();
        elements = browser.parseSnapshot(snap);
      }

      // Find the PartsTech search input
      const searchInput =
        browser.findRefByType(elements, "input", "search parts") ||
        browser.findRefByType(elements, "input", "part") ||
        browser.findRefByTypeOnly(elements, "input");

      if (!searchInput) {
        console.log(`${LOG} No search field for: ${searchTerm}`);
        failedParts.push({ ...part, reason: "No parts search field" });
        continue;
      }

      // Search for the part
      browser.typeInRef(searchInput, searchTerm);
      browser.pressKey("Enter");
      browser.waitForLoad();

      snap = browser.takeSnapshot();
      elements = browser.parseSnapshot(snap);

      // Try OEM first if preferred
      let selectBtn = null;
      if (part.oemPreferred) {
        const oemResults = browser.findAllRefs(elements, (r) =>
          /oem|genuine|original/i.test(r.text || "")
        );
        if (oemResults.length > 0) {
          selectBtn = oemResults[0].ref;
        }
      }

      // Fall back to first "Add" or "Select" button
      if (!selectBtn) {
        selectBtn =
          browser.findRef(elements, "add to estimate") ||
          browser.findRef(elements, "add") ||
          browser.findRef(elements, "select");
      }

      if (!selectBtn) {
        console.log(`${LOG} No results for: ${searchTerm}`);
        failedParts.push({ ...part, reason: "No PartsTech results" });
        continue;
      }

      browser.clickRef(selectBtn);
      browser.waitForLoad();

      addedParts.push({ ...part, searchTerm, status: "added" });
      console.log(`${LOG} Added: ${searchTerm}`);
    } catch (err) {
      console.error(`${LOG} Error adding ${part.partType}: ${err.message}`);
      failedParts.push({ ...part, reason: err.message });
    }
  }

  console.log(`${LOG} Done: ${addedParts.length} added, ${failedParts.length} failed`);

  return {
    success: true,
    addedParts,
    failedParts,
    addedCount: addedParts.length,
    failedCount: failedParts.length,
  };
}

module.exports = { searchAndAddParts };
