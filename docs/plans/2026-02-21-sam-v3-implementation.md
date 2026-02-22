# SAM v3 Pipeline Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement hybrid parallel research + AutoLeap estimate pipeline with wiring diagrams, DTC test plans, TSBs, and AutoLeap-native parts/labor/PDF.

**Architecture:** Phase 1 runs AllData/ProDemand/Identifix research and AutoLeap session setup simultaneously. Phase 2 populates estimate using research context (MOTOR labor + PartsTech parts through AutoLeap UI). Phase 3 sends wiring diagram photos, text messages, and PDF to Telegram.

**Tech Stack:** Node.js (CommonJS), OpenClaw (browser automation via `execFileSync`), Anthropic SDK, Telegram Bot API.

---

## Context: How the codebase works

- All browser skills use `skills/shared/browser.js` — never call OpenClaw directly.
- Pattern: `takeSnapshot()` → `parseSnapshot()` → `findRef()` / `findAllRefs()` → `clickRef()` / `typeInRef()`.
- Skills live at `skills/<name>/scripts/`.
- Orchestrator is at `skills/estimate-builder/scripts/orchestrator.js` (1,316 lines).
- The orchestrator's `buildEstimate()` currently runs Steps 1→8 sequentially.
- v3 replaces Steps 3-8 with Phase 1 (parallel research + AutoLeap setup), Phase 2 (populate estimate), and assembles output.
- There are NO unit tests — verify by running `node scripts/test-e2e.js` after each task.

---

## Task 1: Create `skills/alldata-lookup/scripts/wiring.js`

**Files:**
- Create: `skills/alldata-lookup/scripts/wiring.js`

This module captures wiring diagram screenshots from AllData. It is called from `search.js` after AllData has navigated to the vehicle and the DTC/symptom search is done.

**Step 1: Create the file**

```javascript
// skills/alldata-lookup/scripts/wiring.js
"use strict";

const fs = require("fs");
const path = require("path");
const browser = require("../../shared/browser");

const LOG = "[alldata-wiring]";

/**
 * Capture wiring diagrams from AllData for a vehicle + DTC/symptom.
 * Called after AllData has already navigated to the correct vehicle.
 * Returns array of { name, screenshotPath }.
 */
function captureWiringDiagrams({ dtcCode, symptom }) {
  const diagrams = [];
  const query = dtcCode || symptom || "";

  try {
    console.log(`${LOG} Searching for wiring diagrams (${query})...`);

    // Take snapshot of current AllData page
    let snap = browser.takeSnapshot();
    let elements = browser.parseSnapshot(snap);

    // Look for a "Wiring Diagrams" link in the left nav or content area
    const wiringNavLink =
      browser.findRef(elements, "wiring diagrams") ||
      browser.findRef(elements, "wiring") ||
      browser.findRef(elements, "electrical");

    if (!wiringNavLink) {
      console.log(`${LOG} No wiring diagram section found`);
      return diagrams;
    }

    browser.clickRef(wiringNavLink);
    browser.waitForLoad();

    // Now list all diagram links on the wiring index page
    snap = browser.takeSnapshot();
    elements = browser.parseSnapshot(snap);

    const diagramLinks = browser.findAllRefs(elements.refs, (r) =>
      r.role === "link" &&
      r.name &&
      r.name.length > 3 &&
      // Filter to diagrams relevant to the DTC/symptom
      (query.length < 4 ||
        r.name.toLowerCase().includes(query.toLowerCase().slice(0, 4)) ||
        /diagram|circuit|schematic|sensor|monitor/i.test(r.name))
    );

    console.log(`${LOG} Found ${diagramLinks.length} diagram links`);

    for (const link of diagramLinks.slice(0, 6)) {
      try {
        const diagramName = link.name.trim();

        browser.clickRef(link.ref);
        browser.waitForLoad();

        // Screenshot the diagram page
        const screenshotDir = path.join(
          process.env.HOME || "/home/sam",
          ".openclaw",
          "media",
          "wiring"
        );
        fs.mkdirSync(screenshotDir, { recursive: true });
        const screenshotPath = path.join(
          screenshotDir,
          `wiring-${Date.now()}-${diagrams.length}.png`
        );

        browser.captureScreenshot(screenshotPath);

        if (fs.existsSync(screenshotPath)) {
          diagrams.push({ name: diagramName, screenshotPath });
          console.log(`${LOG} Captured: ${diagramName}`);
        }

        // Navigate back to diagram list
        browser.navigateTo("javascript:history.back()");
        browser.waitForLoad();

        // Re-parse page after back navigation
        snap = browser.takeSnapshot();
        elements = browser.parseSnapshot(snap);
      } catch (err) {
        console.log(`${LOG} Skipped diagram: ${err.message}`);
      }
    }
  } catch (err) {
    console.log(`${LOG} Wiring capture failed (non-fatal): ${err.message}`);
  }

  return diagrams;
}

module.exports = { captureWiringDiagrams };
```

**Step 2: Verify syntax**

```bash
node -e "require('./skills/alldata-lookup/scripts/wiring')"
```

Expected: no output, no error.

**Step 3: Commit**

```bash
git add skills/alldata-lookup/scripts/wiring.js
git commit -m "feat: add AllData wiring diagram screenshotter (v3)"
```

---

## Task 2: Create `skills/alldata-lookup/scripts/tsb.js`

**Files:**
- Create: `skills/alldata-lookup/scripts/tsb.js`

**Step 1: Create the file**

```javascript
// skills/alldata-lookup/scripts/tsb.js
"use strict";

const browser = require("../../shared/browser");

const LOG = "[alldata-tsb]";

/**
 * Fetch TSBs from AllData for a vehicle + DTC/symptom.
 * Called after AllData has navigated to the correct vehicle.
 * Returns array of { number, title, date, summary }.
 */
function fetchTSBs({ dtcCode, symptom }) {
  const tsbs = [];
  const query = dtcCode || symptom || "";

  try {
    console.log(`${LOG} Fetching TSBs (${query})...`);

    let snap = browser.takeSnapshot();
    let elements = browser.parseSnapshot(snap);

    // Navigate to TSB section
    const tsbNavLink =
      browser.findRef(elements, "technical service bulletins") ||
      browser.findRef(elements, "tsb") ||
      browser.findRef(elements, "service bulletins");

    if (!tsbNavLink) {
      console.log(`${LOG} No TSB section found`);
      return tsbs;
    }

    browser.clickRef(tsbNavLink);
    browser.waitForLoad();

    snap = browser.takeSnapshot();
    elements = browser.parseSnapshot(snap);

    // Find TSB list items (links or rows)
    const tsbLinks = browser.findAllRefs(elements.refs, (r) =>
      r.role === "link" &&
      r.name &&
      /\d{2}[-\s]\d{3,}|tsb|bulletin/i.test(r.name)
    );

    console.log(`${LOG} Found ${tsbLinks.length} TSB links`);

    for (const link of tsbLinks.slice(0, 8)) {
      try {
        const title = link.name.trim();

        browser.clickRef(link.ref);
        browser.waitForLoad();

        snap = browser.takeSnapshot();
        elements = browser.parseSnapshot(snap);

        // Extract page text content
        const pageText = browser.extractTextContent
          ? browser.extractTextContent()
          : elements.refs
              .filter((r) => r.role === "statictext" && r.name)
              .map((r) => r.name)
              .join("\n")
              .slice(0, 600);

        // Parse TSB number and date from title or page
        const numMatch = title.match(/\d{2}[-\s]\d{3,}|\w+-\d{4,}/);
        const dateMatch = pageText.match(/(\d{2}\/\d{4}|\d{4}-\d{2}-\d{2}|[A-Z][a-z]+ \d{4})/);

        tsbs.push({
          number: numMatch?.[0] || title.slice(0, 20),
          title,
          date: dateMatch?.[0] || "N/A",
          summary: pageText.slice(0, 300).replace(/\s+/g, " ").trim(),
        });

        // Back to list
        browser.navigateTo("javascript:history.back()");
        browser.waitForLoad();

        snap = browser.takeSnapshot();
        elements = browser.parseSnapshot(snap);
      } catch (err) {
        console.log(`${LOG} Skipped TSB: ${err.message}`);
      }
    }
  } catch (err) {
    console.log(`${LOG} TSB fetch failed (non-fatal): ${err.message}`);
  }

  return tsbs;
}

module.exports = { fetchTSBs };
```

**Step 2: Verify syntax**

```bash
node -e "require('./skills/alldata-lookup/scripts/tsb')"
```

Expected: no output, no error.

**Step 3: Commit**

```bash
git add skills/alldata-lookup/scripts/tsb.js
git commit -m "feat: add AllData TSB fetcher (v3)"
```

---

## Task 3: Edit `skills/alldata-lookup/scripts/search.js`

**Files:**
- Modify: `skills/alldata-lookup/scripts/search.js`

The existing `search()` function returns `{ procedures, torqueSpecs, laborTime, specialTools, screenshots, error }`. We need to also return `wiringDiagrams` and `tsbs` by calling the two new modules after research completes.

**Step 1: Add imports at the top of search.js**

After the existing `require` statements near the top, add:

```javascript
const { captureWiringDiagrams } = require("./wiring");
const { fetchTSBs } = require("./tsb");
```

**Step 2: In the `search()` function, after all existing data extraction is done and before the `return` statement, add wiring + TSB capture**

Find the return statement at the end of `search()`. Before it, add:

```javascript
  // Capture wiring diagrams
  const dtcCode = query.match(/[PBCU][0-9]{4}/i)?.[0];
  const wiringDiagrams = captureWiringDiagrams({ dtcCode, symptom: params.query });
  console.log(`${LOG} Wiring diagrams: ${wiringDiagrams.length}`);

  // Fetch TSBs
  const tsbs = fetchTSBs({ dtcCode, symptom: params.query });
  console.log(`${LOG} TSBs: ${tsbs.length}`);
```

**Step 3: Add `wiringDiagrams` and `tsbs` to the return object**

Find the existing `return {` in `search()` and add the new fields:

```javascript
    wiringDiagrams,
    tsbs,
```

**Step 4: Verify the module still loads**

```bash
node -e "require('./skills/alldata-lookup/scripts/search')"
```

Expected: no error.

**Step 5: Commit**

```bash
git add skills/alldata-lookup/scripts/search.js
git commit -m "feat: AllData search exports wiring diagrams + TSBs (v3)"
```

---

## Task 4: Edit `skills/prodemand-lookup/scripts/search.js`

**Files:**
- Modify: `skills/prodemand-lookup/scripts/search.js`

Add `extractDtcTestPlan()` to pull step-by-step DTC diagnostic procedures from ProDemand and include them in the `search()` return value.

**Step 1: Add `extractDtcTestPlan()` function**

Find the file's existing helper functions (like `extractRealFixes`, `extractLaborTimes`). Add the following new function before the `search()` export:

```javascript
/**
 * Extract DTC test plan / diagnostic procedure steps from ProDemand.
 * Called after navigating to a DTC-specific page.
 * Returns array of { step, action, expected }.
 */
function extractDtcTestPlan(elements) {
  const steps = [];
  try {
    // Look for "Test Plan", "Diagnostic Procedure", or numbered step sections
    const testPlanHeader = browser.findRef(elements, "test plan") ||
                           browser.findRef(elements, "diagnostic procedure") ||
                           browser.findRef(elements, "pinpoint test");

    if (testPlanHeader) {
      // Grab all text nodes that follow the header — they are the steps
      const allText = elements.refs
        .filter((r) => r.role === "statictext" && r.name && r.name.trim().length > 10)
        .map((r) => r.name.trim());

      let capture = false;
      for (const text of allText) {
        if (/test plan|diagnostic procedure|pinpoint test/i.test(text)) {
          capture = true;
          continue;
        }
        if (capture) {
          // Stop at next major section
          if (/^[A-Z\s]{8,}$/.test(text) && !steps.length) continue;
          steps.push({ step: steps.length + 1, action: text.slice(0, 200) });
          if (steps.length >= 8) break;
        }
      }
    }
  } catch (err) {
    // Non-fatal — test plan not always available
  }
  return steps;
}
```

**Step 2: Call `extractDtcTestPlan()` inside `search()` (or `searchViaBrowser()`)**

In the browser-mode search path, after extracting realFixes and laborTimes, add:

```javascript
  const dtcTestPlan = extractDtcTestPlan(elements);
  console.log(`${LOG} DTC test plan: ${dtcTestPlan.length} steps`);
```

**Step 3: Add `dtcTestPlan` to the return value of `search()`**

Find where `search()` assembles its return object and add:

```javascript
    dtcTestPlan,
```

**Step 4: Verify module loads**

```bash
node -e "require('./skills/prodemand-lookup/scripts/search')"
```

Expected: no error.

**Step 5: Commit**

```bash
git add skills/prodemand-lookup/scripts/search.js
git commit -m "feat: ProDemand search exports DTC test plan (v3)"
```

---

## Task 5: Create `skills/autoleap-browser/scripts/parts.js`

**Files:**
- Create: `skills/autoleap-browser/scripts/parts.js`

This module searches for parts using AutoLeap's embedded PartsTech integration and adds them to the current open estimate.

**Step 1: Create the file**

```javascript
// skills/autoleap-browser/scripts/parts.js
"use strict";

const browser = require("../../shared/browser");
const { ensureLoggedIn } = require("./login");

const LOG = "[autoleap-parts]";

/**
 * Search for parts via AutoLeap's built-in PartsTech integration
 * and add them to the current open estimate.
 *
 * @param {object[]} partsNeeded - Array of { partType, position, qty, oemPreferred }
 * @param {string} vehicleDesc - e.g. "2019 Honda Civic 2.0L"
 * @returns {{ success: boolean, addedParts: object[], failedParts: object[], addedCount: number }}
 */
function searchAndAddParts({ partsNeeded, vehicleDesc }) {
  const loginResult = ensureLoggedIn();
  if (!loginResult.success) {
    return { success: false, addedParts: [], failedParts: partsNeeded, error: loginResult.error };
  }

  if (!partsNeeded || partsNeeded.length === 0) {
    return { success: true, addedParts: [], failedParts: [], addedCount: 0 };
  }

  const addedParts = [];
  const failedParts = [];

  console.log(`${LOG} Adding ${partsNeeded.length} parts to estimate for ${vehicleDesc}...`);

  for (const part of partsNeeded) {
    try {
      const searchTerm = [part.partType, part.position].filter(Boolean).join(" ");

      // Navigate to the "Parts" tab within the estimate
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

      // Find parts search field
      const searchInput =
        browser.findRef(elements, "search parts") ||
        browser.findRef(elements, "part number") ||
        browser.findRefByTypeOnly(elements, "textbox");

      if (!searchInput) {
        console.log(`${LOG} No parts search field for: ${searchTerm}`);
        failedParts.push({ ...part, reason: "No search field" });
        continue;
      }

      // Clear and type search term
      browser.typeInRef(searchInput.ref, searchTerm);
      browser.pressKey("Enter");
      browser.waitForLoad();

      snap = browser.takeSnapshot();
      elements = browser.parseSnapshot(snap);

      // Select OEM if preferred, otherwise first result
      let selectBtn = null;
      if (part.oemPreferred) {
        selectBtn = browser.findAllRefs(elements.refs, (r) =>
          /oem|genuine|original/i.test(r.name || "")
        )[0];
      }

      if (!selectBtn) {
        // First "Add" or "Select" button in results
        selectBtn =
          browser.findRef(elements, "add to estimate") ||
          browser.findRef(elements, "add") ||
          browser.findRef(elements, "select");
      }

      if (!selectBtn) {
        console.log(`${LOG} No part found for: ${searchTerm}`);
        failedParts.push({ ...part, reason: "No results in PartsTech" });
        continue;
      }

      browser.clickRef(selectBtn.ref);
      browser.waitForLoad();

      addedParts.push({ ...part, searchTerm, status: "added" });
      console.log(`${LOG} Added: ${searchTerm} (${part.oemPreferred ? "OEM preferred" : "aftermarket"})`);
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
```

**Step 2: Verify syntax**

```bash
node -e "require('./skills/autoleap-browser/scripts/parts')"
```

Expected: no error.

**Step 3: Commit**

```bash
git add skills/autoleap-browser/scripts/parts.js
git commit -m "feat: add AutoLeap PartsTech parts search script (v3)"
```

---

## Task 6: Edit `skills/autoleap-browser/scripts/estimate.js`

**Files:**
- Modify: `skills/autoleap-browser/scripts/estimate.js`

Two additions:
1. `createEstimate()` should accept `researchResults` and use parts from research if no `parts` array is passed.
2. Add new `downloadPdf(estimateId)` function that downloads the PDF from AutoLeap and returns the local path.

**Step 1: Update `createEstimate()` signature to accept `researchResults`**

Change the JSDoc and destructure to add `researchResults`:

```javascript
// OLD:
function createEstimate({ diagnosis, parts, customerName, vehicleDesc }) {

// NEW:
function createEstimate({ diagnosis, parts, customerName, vehicleDesc, researchResults }) {
```

The existing body of `createEstimate()` can stay as-is — the `parts` array will now be pre-populated by `parts.js` via the orchestrator, so no internal change needed for part selection logic.

**Step 2: Add `downloadPdf()` at the bottom of estimate.js, before `module.exports`**

```javascript
/**
 * Download the estimate PDF from AutoLeap.
 * Called after createEstimate() succeeds.
 *
 * @param {string} estimateId - The estimate ID returned by createEstimate()
 * @returns {string|null} Local file path if download succeeds, null otherwise
 */
function downloadPdf(estimateId) {
  const os = require("os");
  const fs = require("fs");
  const path = require("path");

  try {
    console.log(`${LOG} Downloading PDF for estimate ${estimateId}...`);

    let snap = browser.takeSnapshot();
    let elements = browser.parseSnapshot(snap);

    // Look for "Download PDF", "Print", or "PDF" button/link
    const pdfBtn =
      browser.findRef(elements, "download pdf") ||
      browser.findRef(elements, "pdf") ||
      browser.findRef(elements, "print estimate") ||
      browser.findRef(elements, "export");

    if (!pdfBtn) {
      console.log(`${LOG} No PDF download button found`);
      return null;
    }

    const outputPath = path.join(
      os.tmpdir(),
      `autoleap-estimate-${estimateId}-${Date.now()}.pdf`
    );

    // Click the download button — AutoLeap may trigger a browser download
    browser.clickRef(pdfBtn);
    browser.waitForLoad();

    // Check if a file was downloaded to the OpenClaw media directory or tmpdir
    // AutoLeap usually triggers a browser download — check common download location
    const mediaDir = path.join(process.env.HOME || "/home/sam", ".openclaw", "media");
    if (fs.existsSync(mediaDir)) {
      const files = fs.readdirSync(mediaDir)
        .filter((f) => f.endsWith(".pdf"))
        .map((f) => ({ f, t: fs.statSync(path.join(mediaDir, f)).mtimeMs }))
        .sort((a, b) => b.t - a.t);

      if (files.length > 0 && Date.now() - files[0].t < 30_000) {
        const src = path.join(mediaDir, files[0].f);
        fs.copyFileSync(src, outputPath);
        console.log(`${LOG} PDF saved: ${outputPath}`);
        return outputPath;
      }
    }

    console.log(`${LOG} PDF download not confirmed`);
    return null;
  } catch (err) {
    console.error(`${LOG} PDF download failed: ${err.message}`);
    return null;
  }
}
```

**Step 3: Export `downloadPdf`**

Find `module.exports` at the bottom and add `downloadPdf`:

```javascript
// OLD:
module.exports = { createEstimate };

// NEW:
module.exports = { createEstimate, downloadPdf };
```

**Step 4: Verify**

```bash
node -e "const e = require('./skills/autoleap-browser/scripts/estimate'); console.log(Object.keys(e))"
```

Expected output: `[ 'createEstimate', 'downloadPdf' ]`

**Step 5: Commit**

```bash
git add skills/autoleap-browser/scripts/estimate.js
git commit -m "feat: AutoLeap estimate accepts research context + adds PDF download (v3)"
```

---

## Task 7: Rewrite `skills/estimate-builder/scripts/orchestrator.js`

**Files:**
- Modify: `skills/estimate-builder/scripts/orchestrator.js`

This is the major rewrite. The changes are surgical — keep Steps 1-2.7 intact, replace Steps 3-8 with Phase 1/2/3.

**Step 1: Update imports at the top**

Replace the parts/ARI-related imports and add the new v3 skills. Find the block starting with `const { searchParts, searchMultipleParts, formatForAutoLeap } = require("../../partstech-search/scripts/search");` and the `autoLeapBrowser` conditional block.

Replace the entire import section (lines 1-72) with:

```javascript
/**
 * Estimate Builder — Master Orchestrator v3
 *
 * Phase 1 (parallel): Research (AllData + ProDemand + Identifix) + AutoLeap session setup
 * Phase 2: Populate estimate with research context (MOTOR labor + PartsTech parts via AutoLeap)
 * Phase 3: Assemble output for Telegram delivery
 */

const { decodeVin, isValidVin } = require("../../vin-decoder/scripts/decode");
const { search: searchAllData } = require("../../alldata-lookup/scripts/search");
const { searchDirectHit } = require("../../identifix-search/scripts/search");
const { search: searchProDemand } = require("../../prodemand-lookup/scripts/search");
const { getVehicleSpecs } = require("../../vehicle-specs/scripts/specs");
const { generateEstimatePDF } = require("../../estimate-pdf/scripts/generate");
const { diagnose } = require("../../ai-diagnostics/scripts/diagnose");
const {
  getVehicleHistory,
  getShopRepairStats,
  findRelatedPriorRepairs,
} = require("../../autoleap-estimate/scripts/history");
const { getCannedJobs } = require("../../autoleap-estimate/scripts/canned-jobs");
const { getShopConfig } = require("../../shop-management/scripts/config");
const { trackEvent } = require("../../shop-management/scripts/usage");

// AutoLeap browser automation — all phases use this
let autoLeapBrowser = null;
if (process.env.AUTOLEAP_EMAIL) {
  try {
    autoLeapBrowser = {
      login: require("../../autoleap-browser/scripts/login"),
      customer: require("../../autoleap-browser/scripts/customer"),
      estimate: require("../../autoleap-browser/scripts/estimate"),
      parts: require("../../autoleap-browser/scripts/parts"),
      send: require("../../autoleap-browser/scripts/send"),
      order: require("../../autoleap-browser/scripts/order"),
    };
    console.log("[orchestrator] AutoLeap browser automation enabled");
  } catch (err) {
    console.log(`[orchestrator] AutoLeap browser not available: ${err.message}`);
  }
}
```

**Step 2: Keep `classifyRequest()`, `extractPartsNeeded()`, `formatDiagnosisSummary()`, `formatServiceAdvisorResponse()` unchanged**

These functions (lines ~77-550) stay exactly as they are. Only the bottom half of the file changes.

**Step 3: Add three new Phase functions before `buildEstimate()`**

Find `handleApprovalAndOrder()` and `handleOrderRequest()` — keep them. After `handleOrderRequest()` (around line 672) and before `buildEstimate()` (line 676), add these three functions:

```javascript
// ─────────────────────────────────────────────────────────────────────────────
// v3 Phase helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Timeout helper — rejects if promise doesn't resolve within ms */
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms)
    ),
  ]);
}

/**
 * Phase 1a — Run research on all three platforms simultaneously.
 * Returns combined research results including wiring diagrams, TSBs, test plans.
 */
async function runResearch(vehicle, requestInfo, params) {
  const researchQuery = {
    vin: vehicle.vin,
    year: vehicle.year,
    make: vehicle.make,
    model: vehicle.model,
    engine: vehicle.engine?.displacement,
    query: params.query,
  };

  const hasAllDataCreds = !!(process.env.ALLDATA_USERNAME && process.env.ALLDATA_PASSWORD);
  const hasIdentifixCreds = !!(process.env.IDENTIFIX_USERNAME && process.env.IDENTIFIX_PASSWORD);
  const hasProDemandCreds = !!(process.env.PRODEMAND_USERNAME && process.env.PRODEMAND_PASSWORD);

  const PLATFORM_TIMEOUT = 40_000;

  console.log("[Phase 1a] Research starting...");
  console.log(`  → AllData: ${hasAllDataCreds ? "configured" : "skipped"}`);
  console.log(`  → Identifix: ${hasIdentifixCreds ? "configured" : "skipped"}`);
  console.log(`  → ProDemand: ${hasProDemandCreds ? "configured" : "skipped"}`);

  const [alldataResult, identifixResult, prodemandResult] = await Promise.allSettled([
    hasAllDataCreds
      ? withTimeout(searchAllData(researchQuery), PLATFORM_TIMEOUT, "AllData")
      : Promise.resolve(null),
    hasIdentifixCreds
      ? withTimeout(searchDirectHit(researchQuery), PLATFORM_TIMEOUT, "Identifix")
      : Promise.resolve(null),
    hasProDemandCreds
      ? withTimeout(searchProDemand(researchQuery), PLATFORM_TIMEOUT, "ProDemand")
      : Promise.resolve(null),
  ]);

  const alldata = alldataResult.status === "fulfilled"
    ? alldataResult.value
    : { error: alldataResult.reason?.message || "AllData failed" };

  const identifix = identifixResult.status === "fulfilled"
    ? identifixResult.value
    : { error: identifixResult.reason?.message || "Identifix failed" };

  const prodemand = prodemandResult.status === "fulfilled"
    ? prodemandResult.value
    : { error: prodemandResult.reason?.message || "ProDemand failed" };

  if (alldata && !alldata.error) {
    console.log(`  → AllData: ${alldata.procedures?.length || 0} procedures, ${alldata.wiringDiagrams?.length || 0} diagrams, ${alldata.tsbs?.length || 0} TSBs`);
  } else {
    console.log(`  → AllData: ${alldata?.error || "skipped"}`);
  }

  if (identifix && !identifix.error) {
    console.log(`  → Identifix: ${identifix.fixCount || 0} fixes`);
  } else {
    console.log(`  → Identifix: ${identifix?.error || "skipped"}`);
  }

  if (prodemand && !prodemand.error) {
    console.log(`  → ProDemand: ${prodemand.realFixes?.length || 0} real fixes, ${prodemand.dtcTestPlan?.length || 0} test steps`);
  } else {
    console.log(`  → ProDemand: ${prodemand?.error || "skipped"}`);
  }

  return {
    alldata,
    identifix,
    prodemand,
    // Surfaced for Telegram delivery
    wiringDiagrams: alldata?.wiringDiagrams || [],
    tsbs: alldata?.tsbs || [],
    dtcTestPlan: prodemand?.dtcTestPlan || [],
  };
}

/**
 * Phase 1b — Set up AutoLeap session (login + customer + vehicle) in parallel with research.
 * Returns session context for Phase 2.
 */
async function setupAutoLeapSession(vehicle, params) {
  if (!autoLeapBrowser) {
    return { success: false, reason: "not-configured" };
  }

  try {
    console.log("[Phase 1b] AutoLeap session setup starting...");

    const loginResult = autoLeapBrowser.login.ensureLoggedIn
      ? autoLeapBrowser.login.ensureLoggedIn()
      : autoLeapBrowser.login.login();

    if (loginResult && loginResult.success === false) {
      console.log(`  → Login failed: ${loginResult.error}`);
      return { success: false, reason: "login-failed", error: loginResult.error };
    }

    let customerId = null;
    let vehicleId = null;

    if (params.customer) {
      const custResult = autoLeapBrowser.customer.findOrCreateCustomer(params.customer);
      if (custResult.success) {
        customerId = custResult.customerId || custResult.id;
        console.log(`  → Customer: ${params.customer.name} (${custResult.created ? "created" : "found"})`);

        const vehResult = autoLeapBrowser.customer.addVehicleToCustomer({
          year: vehicle.year,
          make: vehicle.make,
          model: vehicle.model,
          vin: vehicle.vin,
          mileage: vehicle.mileage,
        });
        vehicleId = vehResult.vehicleId || vehResult.id;
      } else {
        console.log(`  → Customer error: ${custResult.error}`);
      }
    }

    console.log("[Phase 1b] AutoLeap session ready");
    return { success: true, customerId, vehicleId };
  } catch (err) {
    console.error(`[Phase 1b] AutoLeap session error: ${err.message}`);
    return { success: false, reason: "error", error: err.message };
  }
}

/**
 * Phase 2 — Populate the AutoLeap estimate with research context.
 * Adds parts via PartsTech + labor via MOTOR + downloads PDF.
 * Falls back to local PDF if AutoLeap session failed.
 */
async function populateEstimate(autoLeapSession, researchResults, diagnosis, vehicle, params, shopConfig) {
  const partsNeeded = extractPartsNeeded(params.query, {
    ai: diagnosis?.ai,
    identifix: researchResults.identifix,
    prodemand: researchResults.prodemand,
  });

  console.log(`[Phase 2] Parts identified: ${partsNeeded.map((p) => p.partType).join(", ") || "none"}`);

  // If AutoLeap session failed, fall back to local PDF immediately
  if (!autoLeapSession.success) {
    console.log(`[Phase 2] AutoLeap session unavailable (${autoLeapSession.reason}) — generating local PDF`);
    const pdfPath = await generateLocalPdf(vehicle, diagnosis, partsNeeded, params, shopConfig);
    return { success: false, pdfPath, estimateSource: "local-pdf", fallbackReason: autoLeapSession.reason };
  }

  try {
    // Add parts via AutoLeap's embedded PartsTech
    const vehicleDesc = `${vehicle.year} ${vehicle.make} ${vehicle.model}`;
    let partsResult = { addedParts: [], failedParts: [] };

    if (partsNeeded.length > 0) {
      console.log("[Phase 2] Adding parts via AutoLeap PartsTech...");
      partsResult = autoLeapBrowser.parts.searchAndAddParts({ partsNeeded, vehicleDesc });
      console.log(`  → ${partsResult.addedCount || 0} added, ${partsResult.failedCount || 0} failed`);

      if (partsResult.failedParts.length > 0) {
        const failedNames = partsResult.failedParts.map((p) => p.partType).join(", ");
        console.log(`  → Sourcing required for: ${failedNames}`);
      }
    }

    // Build estimate with MOTORS labor + added parts
    console.log("[Phase 2] Creating estimate with MOTOR labor...");
    const estimateResult = autoLeapBrowser.estimate.createEstimate({
      diagnosis,
      parts: partsResult.addedParts,
      customerName: params.customer?.name,
      vehicleDesc,
      researchResults,
    });

    if (!estimateResult.success) {
      console.error(`[Phase 2] Estimate creation failed: ${estimateResult.error}`);
      const pdfPath = await generateLocalPdf(vehicle, diagnosis, partsNeeded, params, shopConfig);
      return { success: false, pdfPath, estimateSource: "local-pdf", error: estimateResult.error };
    }

    console.log(`  → Estimate created: ${estimateResult.estimateId}, total: $${estimateResult.total}`);

    // Send to customer if contact info provided
    if (params.customer?.email || params.customer?.phone) {
      const sendResult = autoLeapBrowser.send.sendEstimate({
        estimateId: estimateResult.estimateId,
        method: params.customer.email ? "email" : "sms",
      });
      if (sendResult.success) {
        console.log(`  → Estimate sent to customer via ${sendResult.sentVia}`);
      }
    }

    // Download PDF from AutoLeap
    let pdfPath = autoLeapBrowser.estimate.downloadPdf(estimateResult.estimateId);

    if (!pdfPath) {
      console.log("[Phase 2] AutoLeap PDF download failed — generating local PDF fallback");
      pdfPath = await generateLocalPdf(vehicle, diagnosis, partsNeeded, params, shopConfig);
    }

    return {
      ...estimateResult,
      pdfPath,
      estimateSource: "browser",
      addedParts: partsResult.addedParts,
      failedParts: partsResult.failedParts,
    };
  } catch (err) {
    console.error(`[Phase 2] Error: ${err.message}`);
    const pdfPath = await generateLocalPdf(vehicle, diagnosis, partsNeeded, params, shopConfig);
    return { success: false, pdfPath, estimateSource: "local-pdf", error: err.message };
  }
}

/** Generate a local PDF estimate (fallback when AutoLeap is unavailable) */
async function generateLocalPdf(vehicle, diagnosis, partsNeeded, params, shopConfig) {
  try {
    const repairPlan = diagnosis?.ai?.repair_plan;
    const laborHours = repairPlan?.labor?.hours || params.laborHours || 1.0;
    const laborRate = shopConfig.shop.laborRatePerHour || 120;

    const laborLines = [{
      description: params.query,
      hours: laborHours,
      rate: laborRate,
      total: laborHours * laborRate,
    }];

    const partLines = partsNeeded.map((p) => ({
      description: p.partType + (p.position ? ` (${p.position})` : ""),
      partNumber: "Sourcing required",
      qty: p.qty || 1,
      unitPrice: 0,
      total: 0,
    }));

    const laborTotal = laborLines.reduce((s, l) => s + l.total, 0);
    const taxTotal = laborTotal * shopConfig.shop.taxRate;
    const grandTotal = laborTotal + taxTotal;

    const outputPath = require("path").join(
      require("os").tmpdir(),
      `estimate-${vehicle.year}-${vehicle.make}-${vehicle.model}-${Date.now()}.pdf`
    );

    return await generateEstimatePDF({
      shop: shopConfig.shop,
      customer: params.customer,
      vehicle: {
        year: vehicle.year,
        make: vehicle.make,
        model: vehicle.model,
        trim: vehicle.trim,
        engine: vehicle.engine?.displacement,
        vin: vehicle.vin,
        mileage: vehicle.mileage,
      },
      diagnosis: diagnosis?.summary,
      laborLines,
      partLines,
      totals: { labor: laborTotal, parts: 0, supplies: 0, tax: taxTotal, total: grandTotal },
      outputPath,
    });
  } catch (err) {
    console.error(`[orchestrator] Local PDF failed: ${err.message}`);
    return null;
  }
}
```

**Step 4: Replace the body of `buildEstimate()` — keep Steps 1-2.7, replace Steps 3-8 with Phase 1/2/3**

Find `buildEstimate()` starting at line ~676. Keep everything through Step 2.7 (the history block, ending around line 829). Then replace the `// ─── Step 3: Sequential Research ───` block and everything after it (Steps 3-8) with:

```javascript
  // ─── Phase 1: Parallel — Research + AutoLeap Session Setup ───
  console.log("\n[Phase 1] Launching research and AutoLeap session in parallel...");

  const PHASE1_TIMEOUT = 60_000;
  const [researchResults, autoLeapSession] = await Promise.all([
    withTimeout(runResearch(vehicle, requestInfo, params), PHASE1_TIMEOUT, "Phase1-Research"),
    withTimeout(setupAutoLeapSession(vehicle, params), PHASE1_TIMEOUT, "Phase1-AutoLeap"),
  ]).catch((err) => {
    console.error(`[Phase 1] Parallel error: ${err.message}`);
    return [{ alldata: null, identifix: null, prodemand: null, wiringDiagrams: [], tsbs: [], dtcTestPlan: [] }, { success: false, reason: "error" }];
  });

  // Merge research into diagnosis object for formatServiceAdvisorResponse compatibility
  results.diagnosis = {
    ...results.diagnosis,
    alldata: researchResults.alldata,
    identifix: researchResults.identifix,
    prodemand: researchResults.prodemand,
  };
  results.wiringDiagrams = researchResults.wiringDiagrams || [];
  results.tsbs = researchResults.tsbs || [];
  results.dtcTestPlan = researchResults.dtcTestPlan || [];

  // Identifix corroboration (same logic as v2)
  if (researchResults.identifix?.topFix && results.diagnosis?.ai?.diagnoses?.length > 0) {
    const topFixDesc = researchResults.identifix.topFix.description?.toLowerCase() || "";
    for (const diag of results.diagnosis.ai.diagnoses) {
      const causeWords = diag.cause?.toLowerCase().split(/\s+/) || [];
      const overlap = causeWords.filter((w) => w.length > 3 && topFixDesc.includes(w)).length;
      if (overlap >= 2 && researchResults.identifix.topFix.successRate >= 50) {
        diag.identifix_corroborated = true;
        diag.identifix_success_rate = researchResults.identifix.topFix.successRate;
        diag.confidence = Math.min(0.95, diag.confidence + 0.05);
      }
    }
  }

  // ProDemand labor fallback (carried forward for Phase 2)
  if (researchResults.prodemand?.laborTimes?.length > 0 && !researchResults.prodemand.error) {
    results.prodemandLabor = researchResults.prodemand.laborTimes;
  }

  // ─── Step 4: Vehicle Specs (Mechanic Reference) ───
  console.log("\n[Step 4] Getting mechanic reference specs...");
  const repairType = params.query.toLowerCase().includes("o2") ? "o2-sensor" :
                     params.query.toLowerCase().includes("oil") ? "oil-change" :
                     params.query.toLowerCase().includes("brake") ? "brakes" :
                     params.query.toLowerCase().includes("spark") ? "spark-plugs" : null;

  results.mechanicSpecs = await getVehicleSpecs({ vehicle, repairType });

  // Merge AllData torque specs + tools into mechanic specs
  const alldata = researchResults.alldata;
  if (alldata && !alldata.error && results.mechanicSpecs) {
    if (alldata.torqueSpecs && Object.keys(alldata.torqueSpecs).length > 0) {
      results.mechanicSpecs.torqueSpecs = {
        ...results.mechanicSpecs.torqueSpecs,
        ...Object.fromEntries(
          Object.entries(alldata.torqueSpecs).map(([k, v]) => [k, { value: v, source: "alldata" }])
        ),
      };
    }
    if (alldata.specialTools?.length > 0) {
      const existing = new Set((results.mechanicSpecs.specialTools || []).map((t) => t.toLowerCase()));
      const newTools = alldata.specialTools.filter((t) => !existing.has(t.toLowerCase()));
      results.mechanicSpecs.specialTools = [...(results.mechanicSpecs.specialTools || []), ...newTools];
    }
  }

  // ─── Phase 2: Populate Estimate with Research Context ───
  console.log("\n[Phase 2] Populating estimate with research context...");

  const estimate = await populateEstimate(
    autoLeapSession,
    researchResults,
    results.diagnosis,
    vehicle,
    params,
    shopConfig
  );

  results.estimate = estimate;
  results.pdfPath = estimate.pdfPath;
  results.estimateSource = estimate.estimateSource;

  // Track estimate creation
  trackEvent(shopId, "estimate_created", {
    vehicle: { year: vehicle.year, make: vehicle.make, model: vehicle.model },
    total: estimate.total || 0,
    estimateId: estimate.estimateId,
    source: estimate.estimateSource,
    platformsUsed: [
      alldata && !alldata.error ? "alldata" : null,
      researchResults.identifix && !researchResults.identifix.error ? "identifix" : null,
      researchResults.prodemand && !researchResults.prodemand.error ? "prodemand" : null,
    ].filter(Boolean),
  }).catch(() => {});

  // ─── Done ───
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n═══════════════════════════════════════════════════════════════`);
  console.log(`  Pipeline complete in ${elapsed}s`);
  console.log(`  Wiring diagrams: ${results.wiringDiagrams.length}`);
  console.log(`  PDF: ${results.pdfPath || "none"}`);
  console.log(`═══════════════════════════════════════════════════════════════\n`);

  results.formattedResponse = formatServiceAdvisorResponse(results);
  return results;
}
```

**Step 5: Verify the orchestrator loads**

```bash
node -e "require('./skills/estimate-builder/scripts/orchestrator')"
```

Expected: `[orchestrator] AutoLeap browser automation enabled` (or similar), no crash.

**Step 6: Run E2E test**

```bash
node scripts/test-e2e.js
```

Expected: same pass rate as before (20 passed, 0 failed). The structural change should not break any existing test cases.

**Step 7: Commit**

```bash
git add skills/estimate-builder/scripts/orchestrator.js
git commit -m "feat: rewrite orchestrator with hybrid parallel Phase 1/2/3 (v3)"
```

---

## Task 8: Edit `skills/telegram-gateway/scripts/server.js`

**Files:**
- Modify: `skills/telegram-gateway/scripts/server.js`

Add `sendPhoto()` function and update `handleToolCall()` to deliver wiring diagram photos before text messages.

**Step 1: Add `sendPhoto()` helper**

Find the `sendDocument()` function in server.js. Add `sendPhoto()` right after it:

```javascript
/** Send a photo to a Telegram chat with an optional caption */
async function sendPhoto(chatId, imagePath, caption) {
  const fs = require("fs");
  const FormData = require("form-data");

  if (!fs.existsSync(imagePath)) {
    console.log(`${LOG} Photo not found: ${imagePath}`);
    return;
  }

  try {
    const form = new FormData();
    form.append("chat_id", String(chatId));
    form.append("photo", fs.createReadStream(imagePath));
    if (caption) form.append("caption", caption.slice(0, 1024));

    const fetch = (await import("node-fetch")).default;
    const resp = await fetch(`${API_BASE}/sendPhoto`, { method: "POST", body: form });
    const data = await resp.json();

    if (!data.ok) {
      console.log(`${LOG} sendPhoto failed: ${data.description}`);
    }
  } catch (err) {
    console.error(`${LOG} sendPhoto error: ${err.message}`);
  }
}
```

**Note:** `form-data` may need to be installed. Check if it's already in `package.json`:

```bash
node -e "require('form-data')"
```

If it errors, install it:

```bash
cd /home/sam/ai-auto-advisor && npm install form-data
```

**Step 2: Update `handleToolCall()` to send wiring diagrams**

Find the section in `handleToolCall()` where the estimate results are sent to Telegram — it currently calls `formatForWhatsApp()` and then `sendMessage()`.

After the estimate pipeline completes and before the formatted text messages are sent, add:

```javascript
  // Send wiring diagram photos first (v3)
  if (estimateResults.wiringDiagrams?.length > 0) {
    await sendMessage(chatId, `📊 *Wiring Diagrams* — ${estimateResults.wiringDiagrams.length} found`);
    for (const diagram of estimateResults.wiringDiagrams) {
      await sendPhoto(chatId, diagram.screenshotPath, `AllData: ${diagram.name}`);
    }
  }
```

**Step 3: Verify module loads**

```bash
node -e "require('./skills/telegram-gateway/scripts/server')" 2>&1 | head -5
```

Expected: no syntax error (it will fail on missing env vars, which is fine).

**Step 4: Commit**

```bash
git add skills/telegram-gateway/scripts/server.js
git commit -m "feat: Telegram gateway sends wiring diagram photos (v3)"
```

---

## Task 9: Edit `skills/whatsapp-gateway/scripts/formatter.js`

**Files:**
- Modify: `skills/whatsapp-gateway/scripts/formatter.js`

The formatter produces the text messages sent to Telegram. Add TSB section (Message 3) and DTC test plan section (Message 2).

**Step 1: Read the formatter first**

```bash
node -e "const f = require('./skills/whatsapp-gateway/scripts/formatter'); console.log(Object.keys(f))"
```

Note what functions exist (likely `formatForWhatsApp`, `formatHelp`, `formatStatus`).

**Step 2: Update `formatForWhatsApp()` to include TSBs in Message 3**

Find the section of `formatForWhatsApp()` that builds Message 3 (Mechanic Reference — AllData procedures, torque specs, tools). Add TSBs after the existing content:

```javascript
  // TSBs (v3)
  if (results.tsbs?.length > 0) {
    msg3 += `\n📋 *Technical Service Bulletins*\n`;
    for (const tsb of results.tsbs.slice(0, 3)) {
      msg3 += `• *${tsb.number}* — ${tsb.title} (${tsb.date})\n`;
      if (tsb.summary) msg3 += `  ${tsb.summary.slice(0, 120)}\n`;
    }
  }
```

**Step 3: Add DTC test plan to Message 2**

Find the section that builds Message 2 (Research Findings — ProDemand Real Fixes, Identifix). Add the test plan after the existing content:

```javascript
  // DTC Test Plan (v3)
  if (results.dtcTestPlan?.length > 0) {
    msg2 += `\n🔬 *DTC Test Plan*\n`;
    for (const step of results.dtcTestPlan.slice(0, 6)) {
      msg2 += `${step.step}. ${step.action.slice(0, 150)}\n`;
    }
  }
```

**Step 4: Verify**

```bash
node -e "require('./skills/whatsapp-gateway/scripts/formatter')"
```

Expected: no error.

**Step 5: Commit**

```bash
git add skills/whatsapp-gateway/scripts/formatter.js
git commit -m "feat: formatter includes TSBs + DTC test plan in output (v3)"
```

---

## Task 10: Integration Test

**Step 1: Push all changes to GitHub**

```bash
git push origin master
```

**Step 2: Pull on Pi**

SSH into Pi and pull:

```bash
ssh sam@192.168.1.31
cd /home/sam/ai-auto-advisor && git pull
```

**Step 3: Restart services**

```bash
sudo systemctl restart openclaw-gateway openclaw-browser sam-telegram
```

**Step 4: Check service status**

```bash
sudo systemctl status sam-telegram --no-pager
journalctl -u sam-telegram -n 20 --no-pager
```

Expected: `Active: active (running)`, no crash.

**Step 5: End-to-end test via Telegram**

Send to @hillsideautobot:
```
2019 Honda Civic 2.0L throwing P0420
```

Expected response sequence:
1. Typing indicator appears
2. If wiring diagrams found: photo messages arrive (AllData: P0420 ... diagram)
3. Message 1 — Diagnosis + confidence + estimate total
4. Message 2 — ProDemand Real Fixes + DTC test plan steps
5. Message 3 — AllData OEM procedures + TSBs + torque specs
6. Message 4 — Action prompt (APPROVED / ORDER)
7. PDF document arrives

**Step 6: Verify fallback behavior**

If AllData/ProDemand credentials aren't configured, the pipeline should still complete (no wiring photos, no TSBs, no test plan — but no crash). Check logs:

```bash
journalctl -u sam-telegram -f
```

---

## Retired Skills (no action needed — just stop importing)

After Task 7's orchestrator rewrite, these skills are no longer imported:
- `partstech-search` — replaced by AutoLeap PartsTech integration (parts.js)
- `partstech-order` — replaced by AutoLeap order workflow
- `ari-labor` — replaced by AutoLeap MOTOR labor guide

The `estimate-pdf` skill is kept as local PDF fallback.

The skill directories can be archived (moved to `skills/archived/`) in a future cleanup, but do NOT delete them yet in case rollback is needed.

---

## Success Criteria

1. Tech sends vehicle + DTC → Telegram receives response within 90 seconds
2. Wiring diagram screenshots arrive as Telegram photos before text messages
3. AutoLeap estimate created with MOTOR labor + PartsTech parts (when AUTOLEAP_EMAIL set)
4. PDF always arrives in Telegram (from AutoLeap download or local fallback)
5. If customer name + phone provided, AutoLeap sends estimate to customer
6. If AllData/ProDemand/Identifix is down, pipeline continues without crashing
7. `node -e "require('./skills/estimate-builder/scripts/orchestrator')"` loads without error

---

## Execution Options

**Subagent-Driven (this session)** — Dispatch fresh subagent per task. Fast iteration, review between tasks.

**Parallel Session (separate)** — Open new Claude session with `superpowers:executing-plans`. Batch execution with checkpoints.
