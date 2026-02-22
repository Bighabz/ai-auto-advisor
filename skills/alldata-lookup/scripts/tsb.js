/**
 * AllData TSB Fetcher — skills/alldata-lookup/scripts/tsb.js
 *
 * Fetches Technical Service Bulletins from AllData.
 * Called from search.js after AllData has already navigated to the vehicle.
 *
 * Returns array of { number, title, date, summary }.
 */

const browser = require("../../shared/browser");

const LOG = "[alldata-tsb]";
const MAX_TSBS = 8;

const TSB_LINK_RE = /\d{2}[-\s]\d{3,}|tsb|bulletin/i;
const TSB_NUMBER_RE = /(?:tsb[#\s]*|bulletin[#\s]*|no\.?\s*)([\w-]{4,20})/i;
const DATE_RE = /(\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s,]+\d{4}\b|\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b|\b\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}\b)/i;

/**
 * Fetch TSBs from AllData for the currently selected vehicle.
 *
 * Assumes the browser is already authenticated and on an AllData page
 * for the target vehicle. The caller supplies listPageUrl so we can
 * navigate back to it between individual TSB detail pages.
 *
 * @param {object} params
 * @param {string} [params.dtcCode]     - DTC code (e.g. "P0420")
 * @param {string} [params.symptom]     - Symptom description
 * @param {string} [params.listPageUrl] - URL to return to between detail pages
 * @returns {Array<{ number: string, title: string, date: string, summary: string }>}
 */
function fetchTSBs({ dtcCode, symptom, listPageUrl } = {}) {
  const results = [];

  try {
    browser.ensureBrowser();
  } catch (err) {
    console.error(`${LOG} ensureBrowser failed: ${err.message}`);
    return results;
  }

  let snap, elements;
  try {
    snap = browser.takeSnapshot();
    elements = browser.parseSnapshot(snap);
  } catch (err) {
    console.error(`${LOG} Initial snapshot failed: ${err.message}`);
    return results;
  }

  // Find TSB nav link
  let tsbNavRef =
    browser.findRef(elements, "technical service bulletin") ||
    browser.findRef(elements, "service bulletin") ||
    browser.findRef(elements, "tsb");

  if (!tsbNavRef) {
    const candidate = elements.find((el) => TSB_LINK_RE.test(el.text));
    if (candidate) tsbNavRef = candidate.ref;
  }

  if (!tsbNavRef) {
    console.log(`${LOG} No TSB navigation link found`);
    return results;
  }

  try {
    browser.clickRef(tsbNavRef);
    browser.waitForLoad();
  } catch (err) {
    console.error(`${LOG} Failed to navigate to TSB section: ${err.message}`);
    return results;
  }

  // Use caller-supplied index URL or try to extract from snapshot
  let tsbIndexUrl = listPageUrl || null;
  if (!tsbIndexUrl) {
    try {
      const indexSnap = browser.takeSnapshot();
      const urlMatch = indexSnap.match(/^URL:\s*(\S+)/m);
      tsbIndexUrl = urlMatch ? urlMatch[1] : null;
    } catch {
      tsbIndexUrl = null;
    }
  }

  try {
    snap = browser.takeSnapshot();
    elements = browser.parseSnapshot(snap);
  } catch (err) {
    console.error(`${LOG} TSB index snapshot failed: ${err.message}`);
    return results;
  }

  const tsbLinks = collectTSBLinks(elements);

  if (tsbLinks.length === 0) {
    console.log(`${LOG} No TSB links found on index page`);
    return results;
  }

  console.log(`${LOG} Found ${tsbLinks.length} TSB link(s)`);

  const limit = Math.min(tsbLinks.length, MAX_TSBS);

  for (let i = 0; i < limit; i++) {
    const link = tsbLinks[i];
    try {
      const tsb = fetchOneTSB(link, tsbIndexUrl);
      if (tsb) {
        results.push(tsb);
        console.log(`${LOG} TSB ${i + 1}/${limit}: ${tsb.number} — ${tsb.title}`);
      }
    } catch (err) {
      console.error(`${LOG} Error on TSB ${i + 1}: ${err.message}`);
    }

    // Re-snapshot index for next iteration
    if (i < limit - 1) {
      try {
        snap = browser.takeSnapshot();
        elements = browser.parseSnapshot(snap);
        // Refresh tsbLinks refs from new snapshot
        const refreshed = collectTSBLinks(elements);
        if (refreshed[i + 1]) tsbLinks[i + 1] = refreshed[i + 1];
      } catch {
        console.error(`${LOG} Could not re-snapshot TSB index — stopping early`);
        break;
      }
    }
  }

  return results;
}

function collectTSBLinks(elements) {
  const matched = elements.filter(
    (el) => el.type === "link" && TSB_LINK_RE.test(el.text)
  );
  if (matched.length > 0) {
    return matched.slice(0, MAX_TSBS).map((el) => ({ ref: el.ref, text: el.text }));
  }
  const allLinks = elements.filter(
    (el) => el.type === "link" && el.text.trim().length > 0
  );
  return allLinks.slice(0, MAX_TSBS).map((el) => ({ ref: el.ref, text: el.text }));
}

function fetchOneTSB(link, indexUrl) {
  browser.clickRef(link.ref);
  browser.waitForLoad();

  let detailElements;
  try {
    const detailSnap = browser.takeSnapshot();
    detailElements = browser.parseSnapshot(detailSnap);
  } catch (err) {
    console.error(`${LOG} Detail snapshot failed: ${err.message}`);
    navigateBackToIndex(indexUrl);
    return null;
  }

  const textBlocks = browser.extractTextContent(detailElements, 10);
  const staticTexts = detailElements
    .filter((el) => el.type === "statictext" || el.type === "text")
    .map((el) => el.text.trim())
    .filter((t) => t.length >= 10);

  const allText = mergeUnique([...textBlocks, ...staticTexts]);

  const linkText = link.text.trim();
  const number  = parseTSBNumber(linkText, allText);
  const title   = parseTSBTitle(linkText, allText, number);
  const date    = parseDate(allText);
  const summary = buildSummary(allText, number, title, 300);

  navigateBackToIndex(indexUrl);

  return { number, title, date, summary };
}

function navigateBackToIndex(indexUrl) {
  try {
    if (indexUrl) {
      browser.navigateTo(indexUrl);
      browser.waitForLoad();
    } else {
      console.log(`${LOG} No index URL — cannot navigate back`);
    }
  } catch (err) {
    console.error(`${LOG} Navigate back failed: ${err.message}`);
  }
}

function parseTSBNumber(linkText, allText) {
  const fromLink = linkText.match(/[\w-]{4,20}/);
  if (fromLink && /\d/.test(fromLink[0])) return fromLink[0];
  for (const block of allText) {
    const m = block.match(TSB_NUMBER_RE);
    if (m && m[1] && /\d/.test(m[1])) return m[1].trim();
  }
  if (allText.length > 0) {
    for (const tok of allText[0].split(/\s+/)) {
      if (/\d/.test(tok) && tok.length >= 3) return tok;
    }
  }
  return "UNKNOWN";
}

function parseTSBTitle(linkText, allText, number) {
  const cleanLink = linkText.replace(number, "").trim();
  if (cleanLink.length > 8 && !/^\W+$/.test(cleanLink)) return cleanLink;
  for (const block of allText.slice(0, 6)) {
    if (block.length > 10 && block.length < 200 &&
        !block.toLowerCase().includes("copyright")) {
      return block;
    }
  }
  return linkText || "TSB";
}

function parseDate(allText) {
  for (const block of allText) {
    const m = block.match(DATE_RE);
    if (m) return m[1].trim();
  }
  return "";
}

function buildSummary(allText, number, title, maxChars) {
  const skipREs = [/copyright/i, /all rights reserved/i, /^\s*\d+\s*$/];
  const bodyBlocks = allText.filter((block) => {
    if (block === title || block === number) return false;
    if (block.length < 15) return false;
    return !skipREs.some((re) => re.test(block));
  });
  return bodyBlocks.join(" ").replace(/\s+/g, " ").trim().slice(0, maxChars);
}

function mergeUnique(arr) {
  const seen = new Set();
  return arr.filter((s) => {
    if (seen.has(s)) return false;
    seen.add(s);
    return true;
  });
}

module.exports = { fetchTSBs };
