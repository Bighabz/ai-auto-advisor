/**
 * PartsTech Parts Pricing via AutoLeap's Embedded Integration
 *
 * Uses the PartsTech session that AutoLeap establishes in Chrome.
 * No separate PartsTech credentials needed — AutoLeap's account is used.
 *
 * Flow:
 * 1. Connect to Chrome (port 18800)
 * 2. Find existing PartsTech tab or open one via AutoLeap's /partstech/create/qoute
 * 3. For each part: type search term, intercept GetProducts GraphQL responses
 * 4. Return cheapest available pricing in bestValueBundle format
 *
 * Exports:
 *   searchPartsPricing({ year, make, model, vin, partsList })
 */

const https = require("https");

const LOG = "[partstech-search]";
const CHROME_CDP = process.env.CHROME_CDP_URL || "http://127.0.0.1:18800";
const SEARCH_WAIT_MS = 10000; // wait for GetProducts calls after Enter

// ─── AutoLeap API helper (minimal, avoids circular dep) ─────────────────────

function autoLeapCall(method, path, body, token, ms = 10000) {
  return new Promise((resolve) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: "api.myautoleap.com",
      path: "/api/v1" + path,
      method,
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "authorization": token,
        "origin": "https://app.myautoleap.com",
        "referer": "https://app.myautoleap.com/",
      },
      timeout: ms,
    };
    if (bodyStr) opts.headers["Content-Length"] = Buffer.byteLength(bodyStr);
    const req = https.request(opts, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, raw: data.substring(0, 500) }); }
      });
    });
    req.on("timeout", () => { req.destroy(); resolve({ status: 0, raw: "TIMEOUT" }); });
    req.on("error", (e) => resolve({ status: 0, raw: e.message }));
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ─── PartsTech tab management ────────────────────────────────────────────────

/**
 * Get the existing PartsTech tab from Chrome.
 * Returns the puppeteer Page or null.
 */
async function findPartsTechPage(browser) {
  const targets = await browser.targets();
  for (const t of targets) {
    if (t.url().includes("app.partstech.com")) {
      try {
        const pg = await t.page();
        if (pg) return pg;
      } catch { /* target closed */ }
    }
  }
  return null;
}

/**
 * Open PartsTech via AutoLeap's /partstech/create/qoute endpoint.
 * Returns the new PartsTech Page.
 */
async function openPartsTechViaAutoLeap(browser) {
  const { getToken } = require("./autoleap-api");
  const token = await getToken();

  // Try cached anchor first (avoids searching estimates every time)
  const ANCHOR_CACHE = "/tmp/partstech-anchor.json";
  let estId = null, vehId = null;
  try {
    const cached = JSON.parse(require("fs").readFileSync(ANCHOR_CACHE, "utf8"));
    if (cached.estId && cached.vehId) {
      estId = cached.estId;
      vehId = cached.vehId;
      console.log(`${LOG} Using cached anchor: est=${estId.substring(0,8)}… veh=${vehId.substring(0,8)}…`);
    }
  } catch { /* no cache yet */ }

  // If no cache, search estimates for one with a vehicle
  // AutoLeap returns vehicle as { vehicleId: { _id: "...", name: "..." } } — NOT vehicle._id
  if (!estId) {
    const ge = await autoLeapCall("GET", "/estimates?limit=50&skip=0&sort=createdAt&order=-1", null, token);
    const records = ge.data?.response?.records || [];

    for (const rec of records) {
      const full = await autoLeapCall("GET", `/estimates/${rec._id}`, null, token, 6000);
      const e = full.data?.response;
      const vehObj = e?.vehicle;
      // vehicle._id is undefined — the ID lives at vehicle.vehicleId._id
      const vid = vehObj?.vehicleId?._id || vehObj?._id || null;
      if (vid && typeof vid === "string") {
        estId = rec._id;
        vehId = vid;
        break;
      }
    }
  }

  if (!estId) {
    throw new Error("No AutoLeap estimate with vehicle found — cannot open PartsTech");
  }

  // Cache this working anchor for future runs
  try {
    require("fs").writeFileSync(ANCHOR_CACHE, JSON.stringify({ estId, vehId }));
  } catch { /* non-fatal */ }

  const qPath = `/partstech/create/qoute?orderId=${encodeURIComponent(estId)}&vehicleId=${encodeURIComponent(vehId)}&isTrigge=true`;
  const qoute = await autoLeapCall("GET", qPath, null, token);
  const redirectUrl = qoute.data?.response?.redirectUrl;
  if (!redirectUrl) {
    throw new Error(`Failed to get PartsTech redirect URL: ${JSON.stringify(qoute.data?.error || qoute.raw)}`);
  }

  console.log(`${LOG} Opening PartsTech: ${redirectUrl.substring(0, 80)}`);

  // Open redirectUrl in a NEW browser tab
  const newTabPromise = new Promise((resolve) => {
    browser.once("targetcreated", async (t) => {
      await new Promise(r => setTimeout(r, 5000)); // let PartsTech load
      try { resolve(await t.page()); } catch { resolve(null); }
    });
  });

  // Create new tab by evaluating window.open in the first available page
  const pages = await browser.pages();
  const anyPage = pages[0];
  await anyPage.evaluate((url) => window.open(url, "_blank"), redirectUrl);

  const ptPage = await Promise.race([
    newTabPromise,
    new Promise(r => setTimeout(r, 12000, null)),
  ]);

  if (!ptPage) {
    // Fallback: maybe the tab opened but we missed the event
    return await findPartsTechPage(browser);
  }

  return ptPage;
}

/**
 * Get or open the PartsTech page in Chrome.
 */
async function getPartsTechPage(browser) {
  let ptPage = await findPartsTechPage(browser);
  if (ptPage) {
    console.log(`${LOG} Reusing existing PartsTech tab`);
    return ptPage;
  }

  console.log(`${LOG} No PartsTech tab found — opening via AutoLeap...`);
  ptPage = await openPartsTechViaAutoLeap(browser);

  if (!ptPage) {
    throw new Error("Failed to open PartsTech tab");
  }

  // Wait for search input to appear
  await new Promise(r => setTimeout(r, 3000));
  return ptPage;
}

// ─── Search logic ────────────────────────────────────────────────────────────

/**
 * Search for one part by typing in PartsTech search box.
 * Intercepts GetProducts GraphQL responses via CDP.
 * Returns all products from all suppliers.
 */
async function searchOnePart(ptPage, client, searchTerm) {
  const graphqlRequests = {};
  const graphqlBodies = {};

  const reqListener = (p) => {
    if (p.request.url.includes("graphql")) {
      graphqlRequests[p.requestId] = p.request.postData || null;
    }
  };

  const finishedListener = async (p) => {
    if (!graphqlRequests[p.requestId]) return;
    try {
      const r = await client.send("Network.getResponseBody", { requestId: p.requestId });
      graphqlBodies[p.requestId] = r.body;
    } catch { /* response already gone */ }
  };

  client.on("Network.requestWillBeSent", reqListener);
  client.on("Network.loadingFinished", finishedListener);

  try {
    // Find and focus the search input
    const found = await ptPage.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll("input"));
      const s = inputs.find(i =>
        i.id === "textField70" ||
        i.name === "search" ||
        i.placeholder?.toLowerCase().includes("search") ||
        i.placeholder?.toLowerCase().includes("part")
      );
      if (!s) return false;
      s.click();
      s.focus();
      return true;
    });

    if (!found) {
      console.log(`${LOG} Search input not found — PartsTech page may not be loaded`);
      return [];
    }

    // Clear existing value and type new search term
    await ptPage.keyboard.down("Control");
    await ptPage.keyboard.press("a");
    await ptPage.keyboard.up("Control");
    await new Promise(r => setTimeout(r, 200));
    await ptPage.keyboard.type(searchTerm, { delay: 60 });
    await new Promise(r => setTimeout(r, 1200));

    // Press Enter to trigger GetProducts calls
    await ptPage.keyboard.press("Enter");

    // Wait for all GetProducts responses to arrive
    await new Promise(r => setTimeout(r, SEARCH_WAIT_MS));

  } finally {
    client.off("Network.requestWillBeSent", reqListener);
    client.off("Network.loadingFinished", finishedListener);
  }

  // Collect products from all GetProducts responses
  const products = [];
  for (const [id, respBody] of Object.entries(graphqlBodies)) {
    const reqBody = graphqlRequests[id];
    if (!reqBody) continue;

    let opName = "";
    try { opName = JSON.parse(reqBody).operationName || ""; } catch { continue; }
    if (opName !== "GetProducts") continue;

    try {
      const resp = JSON.parse(respBody);
      const prods = resp?.data?.products?.products || [];
      products.push(...prods);
    } catch { /* malformed JSON */ }
  }

  return products;
}

/**
 * Pick the best product from a pool of results.
 * Prefers: products with local availability, then cheapest price.
 */
function pickBestProduct(products) {
  if (!products || products.length === 0) return null;

  // Must have a valid price
  const withPrice = products.filter(p => p.price && p.price > 0);
  if (withPrice.length === 0) return null;

  // Prefer products available at MAIN or CLOSEST store (not just NETWORK warehouse)
  const nearby = withPrice.filter(p =>
    p.availability?.some(a => a.quantity > 0 && (a.type === "MAIN" || a.type === "CLOSEST"))
  );

  const pool = nearby.length > 0 ? nearby : withPrice;

  // Return cheapest from the preferred pool
  return pool.reduce((best, p) => (!best || p.price < best.price) ? p : best, null);
}

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * Search PartsTech for parts pricing using AutoLeap's embedded session.
 * Returns data in the same bestValueBundle format as partstech-search REST API.
 *
 * @param {object} params
 * @param {number|string} params.year
 * @param {string} params.make
 * @param {string} params.model
 * @param {string} [params.vin]
 * @param {Array} params.partsList - [{partType, position, qty, searchTerms}]
 * @returns {{ bestValueBundle, individualResults, error? }}
 */
async function searchPartsPricing({ year, make, model, vin, partsList }) {
  const empty = {
    bestValueBundle: { parts: [], totalCost: 0, allInStock: true, suppliers: [] },
    individualResults: [],
  };

  if (!partsList || partsList.length === 0) return empty;

  let puppeteer;
  try {
    puppeteer = require("puppeteer-core");
  } catch {
    console.log(`${LOG} puppeteer-core not available`);
    return { error: "puppeteer-core not installed", ...empty };
  }

  console.log(`${LOG} Pricing ${partsList.length} part(s) for ${year} ${make} ${model}...`);

  let browser = null;
  try {
    browser = await puppeteer.connect({ browserURL: CHROME_CDP, defaultViewport: null });
    const ptPage = await getPartsTechPage(browser);

    const client = await ptPage.createCDPSession();
    await client.send("Network.enable");

    // Wait for any in-flight navigation to settle
    await new Promise(r => setTimeout(r, 2000));

    const bundle = {
      parts: [],
      totalCost: 0,
      allInStock: true,
      suppliers: new Set(),
    };
    const individualResults = [];

    for (const partReq of partsList) {
      // Build search term — try primary searchTerms first, fall back to partType + position
      const searchTerm = partReq.searchTerms?.[0]
        ? (partReq.position ? `${partReq.searchTerms[0]} ${partReq.position}` : partReq.searchTerms[0])
        : (partReq.position ? `${partReq.partType} ${partReq.position}` : partReq.partType);

      console.log(`${LOG}   → "${searchTerm}"`);

      let products = [];
      try {
        products = await searchOnePart(ptPage, client, searchTerm);
      } catch (err) {
        console.error(`${LOG} Search error for "${searchTerm}":`, err.message);
      }

      // If no results with position, retry without position
      if (products.length === 0 && partReq.position) {
        console.log(`${LOG}   → No results with position, retrying without...`);
        try {
          products = await searchOnePart(ptPage, client, partReq.partType);
        } catch { /* ignore */ }
      }

      console.log(`${LOG}   → ${products.length} products found`);

      const best = pickBestProduct(products);

      if (!best) {
        bundle.parts.push({ requested: partReq, selected: null, error: "No results" });
        bundle.allInStock = false;
        individualResults.push({ partType: partReq.partType, error: "No results found", bestValue: null });
        continue;
      }

      const inStock = best.availability?.some(a => a.quantity > 0) ?? false;
      // Extract a short supplier name from the store name
      const storeStr = best.availability?.find(a => a.quantity > 0)?.name || "";
      const supplierName = storeStr.replace(/\s+\d+-.*$/, "").trim() || "PartsTech";

      const selected = {
        description: best.title || best.partType?.name || partReq.partType,
        brand: best.brand?.name || "Unknown",
        partNumber: best.partNumber || null,
        price: best.price || 0,
        listPrice: best.listPrice || best.price || 0,
        coreCharge: best.coreCharge || 0,
        totalCost: best.price || 0,
        availability: inStock ? "In Stock" : "Check Availability",
        supplier: supplierName,
        type: "Aftermarket",
      };

      const qty = partReq.qty || 1;
      bundle.parts.push({ requested: partReq, selected });
      bundle.totalCost += (best.price || 0) * qty;
      bundle.suppliers.add(supplierName);
      if (!inStock) bundle.allInStock = false;

      individualResults.push({
        partType: partReq.partType,
        bestValue: { overall: selected, aftermarket: selected, oem: null },
      });

      // Brief pause between parts
      await new Promise(r => setTimeout(r, 800));
    }

    await client.detach();
    bundle.suppliers = [...bundle.suppliers];
    bundle.supplierCount = bundle.suppliers.length;

    const found = bundle.parts.filter(p => p.selected).length;
    console.log(`${LOG} Done: ${found}/${bundle.parts.length} found, $${bundle.totalCost.toFixed(2)} total`);

    return { bestValueBundle: bundle, individualResults };

  } catch (err) {
    console.error(`${LOG} Error:`, err.message);
    return { error: err.message, ...empty };
  } finally {
    if (browser) {
      try { browser.disconnect(); } catch { /* ignore */ }
    }
  }
}

module.exports = { searchPartsPricing };
