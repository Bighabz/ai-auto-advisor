// skills/alldata-lookup/scripts/wiring.js
// Capture wiring diagrams from AllData.
// Called from search.js after AllData has already navigated to the vehicle.
// Returns array of { name, screenshotPath }.

const path = require("path");
const fs = require("fs");
const browser = require("../../shared/browser");

const LOG = "[alldata-wiring]";
const MAX_DIAGRAMS = 6;

/**
 * Capture wiring diagrams from the current AllData vehicle page.
 *
 * @param {object} opts
 * @param {string} opts.dtcCode     - DTC code to filter relevant diagrams (e.g. "P0420")
 * @param {string} opts.symptom     - Symptom text for relevance filtering
 * @param {string} opts.listPageUrl - URL of the current AllData page to return to after each diagram
 * @returns {Promise<Array<{ name: string, screenshotPath: string }>>}
 */
async function captureWiringDiagrams({ dtcCode, symptom, listPageUrl }) {
  const results = [];

  // Ensure output directory exists
  const outputDir = path.join(
    process.env.HOME || process.env.USERPROFILE || "",
    ".openclaw",
    "media",
    "wiring"
  );
  try {
    fs.mkdirSync(outputDir, { recursive: true });
  } catch (err) {
    console.error(LOG + " Failed to create output dir " + outputDir + ":", err.message);
  }

  try {
    await browser.ensureBrowser();

    // Step 1: Snapshot the current AllData vehicle page
    console.log(LOG + " Taking snapshot of current AllData page");
    let snap = await browser.takeSnapshot();
    let elements = browser.parseSnapshot(snap);

    // Step 2: Find the wiring/electrical nav link
    let wiringRef =
      browser.findRef(elements, "wiring diagrams") ||
      browser.findRef(elements, "wiring") ||
      browser.findRef(elements, "electrical");

    if (!wiringRef) {
      console.log(LOG + " No wiring/electrical nav link found on page");
      return results;
    }

    // Step 3: Click wiring nav link and wait for load
    console.log(LOG + " Clicking wiring nav link (ref=" + wiringRef + ")");
    await browser.clickRef(wiringRef);
    await browser.waitForLoad();

    // Step 4: Snapshot the wiring index page and collect diagram links up front.
    // After each diagram we navigate back to listPageUrl, re-click the wiring nav
    // to restore the index, then continue with the next link.
    snap = await browser.takeSnapshot();
    elements = browser.parseSnapshot(snap);

    // Step 5: Find all diagram links on the wiring index page
    const codeStr = dtcCode ? String(dtcCode) : null;
    const symptomWords = symptom
      ? symptom.toLowerCase().split(/\s+/).filter(function (w) { return w.length > 3; })
      : [];

    // Collect candidate diagram links (role=link, non-empty name)
    const refList = elements.refs || elements;
    const allLinks = browser.findAllRefs(refList, function (r) {
      const name = (r.name || r.text || "").toLowerCase();
      return r.role === "link" && name.length > 0;
    });

    // Score links for relevance to the DTC / symptom
    function scoreLink(linkObj) {
      const text = (linkObj.name || linkObj.text || "").toLowerCase();
      let score = 0;
      if (codeStr && text.indexOf(codeStr.toLowerCase()) !== -1) score += 10;
      for (let wi = 0; wi < symptomWords.length; wi++) {
        if (text.indexOf(symptomWords[wi]) !== -1) score += 3;
      }
      // Baseline score for any link that looks like a wiring/diagram entry
      if (/wiring|circuit|schematic|diagram|electrical/i.test(text)) score += 1;
      return score;
    }

    // Sort by relevance, keep only scored links, cap at MAX_DIAGRAMS
    const scoredLinks = allLinks
      .map(function (linkObj) { return { linkObj: linkObj, score: scoreLink(linkObj) }; })
      .filter(function (item) { return item.score > 0; })
      .sort(function (a, b) { return b.score - a.score; })
      .slice(0, MAX_DIAGRAMS)
      .map(function (item) { return item.linkObj; });

    if (scoredLinks.length === 0) {
      console.log(LOG + " No relevant diagram links found on wiring index page");
      return results;
    }

    console.log(LOG + " Found " + scoredLinks.length + " diagram link(s) to capture");

    // Step 6: Capture each diagram
    for (let i = 0; i < scoredLinks.length; i++) {
      const link = scoredLinks[i];
      const linkName = link.name || link.text || ("diagram-" + i);
      const linkRef = link.ref;

      try {
        console.log(
          LOG + " [" + (i + 1) + "/" + scoredLinks.length + "] Clicking diagram: " + linkName
        );

        await browser.clickRef(linkRef);
        await browser.waitForLoad();

        // Screenshot to ~/.openclaw/media/wiring/wiring-<timestamp>-<index>.png
        const timestamp = Date.now();
        const screenshotFilename = "wiring-" + timestamp + "-" + i + ".png";
        const screenshotPath = path.join(outputDir, screenshotFilename);

        const finalPath = await browser.captureScreenshot(screenshotPath);
        console.log(LOG + " Screenshot saved: " + finalPath);

        results.push({ name: linkName, screenshotPath: finalPath });

        // Navigate back to the wiring index for the next iteration
        if (i < scoredLinks.length - 1) {
          console.log(LOG + " Navigating back to wiring index via listPageUrl");
          await browser.navigateTo(listPageUrl);
          await browser.waitForLoad();

          // Re-click the wiring nav to restore the index page
          snap = await browser.takeSnapshot();
          elements = browser.parseSnapshot(snap);

          const wiringNavRef =
            browser.findRef(elements, "wiring diagrams") ||
            browser.findRef(elements, "wiring") ||
            browser.findRef(elements, "electrical");

          if (!wiringNavRef) {
            console.log(LOG + " Could not re-find wiring nav after navigating back - stopping");
            break;
          }

          await browser.clickRef(wiringNavRef);
          await browser.waitForLoad();

          snap = await browser.takeSnapshot();
          elements = browser.parseSnapshot(snap);
        }
      } catch (err) {
        console.error(LOG + " Error capturing diagram " + linkName + ": " + err.message);
        // Non-fatal: attempt to recover to wiring index and continue
        try {
          await browser.navigateTo(listPageUrl);
          await browser.waitForLoad();

          snap = await browser.takeSnapshot();
          elements = browser.parseSnapshot(snap);

          const wiringNavRef =
            browser.findRef(elements, "wiring diagrams") ||
            browser.findRef(elements, "wiring") ||
            browser.findRef(elements, "electrical");

          if (wiringNavRef) {
            await browser.clickRef(wiringNavRef);
            await browser.waitForLoad();
            snap = await browser.takeSnapshot();
            elements = browser.parseSnapshot(snap);
          }
        } catch (recoveryErr) {
          console.error(LOG + " Recovery failed: " + recoveryErr.message);
        }
      }
    }
  } catch (err) {
    console.error(LOG + " Fatal error in captureWiringDiagrams: " + err.message);
  }

  console.log(LOG + " Completed. Captured " + results.length + " diagram(s).");
  return results;
}

module.exports = { captureWiringDiagrams };
