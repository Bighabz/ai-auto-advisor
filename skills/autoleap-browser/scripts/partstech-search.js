/**
 * PartsTech Parts Pricing via AutoLeap SSO + OpenClaw
 *
 * Uses AutoLeap's SSO to authenticate into PartsTech with the correct
 * vehicle context, then uses OpenClaw (shared/browser.js) to search
 * for parts and read prices from page snapshots.
 *
 * Flow:
 *   1. Get AutoLeap token
 *   2. Find matching vehicle in recent AutoLeap estimates
 *   3. Get PartsTech SSO redirect URL with correct vehicleId
 *   4. Open PartsTech in OpenClaw browser
 *   5. For each part: search → snapshot → extract products → pick best
 *   6. Return bestValueBundle format
 *
 * Exports:
 *   searchPartsPricing({ year, make, model, vin, partsList })
 */

const https = require("https");
const browser = require("../../shared/browser");

const LOG = "[partstech-search]";

// ─── AutoLeap API helper ────────────────────────────────────────────────────

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

// ─── Vehicle + SSO helpers ──────────────────────────────────────────────────

/**
 * Search recent AutoLeap estimates for a vehicle matching year/make/model.
 * Returns { estId, vehId } if found, or a fallback with needsVehicleChange flag.
 */
async function findMatchingVehicle(token, year, make, model) {
  const ge = await autoLeapCall("GET", "/estimates?limit=50&skip=0&sort=createdAt&order=-1", null, token);
  const records = ge.data?.response?.records || [];

  let fallback = null;

  for (const rec of records) {
    const full = await autoLeapCall("GET", `/estimates/${rec._id}`, null, token, 6000);
    const e = full.data?.response;
    const vehObj = e?.vehicle;
    const vid = vehObj?.vehicleId?._id || vehObj?._id || null;
    if (!vid || typeof vid !== "string") continue;

    // Save first valid vehicle as fallback
    if (!fallback) {
      fallback = { estId: rec._id, vehId: vid };
    }

    // Check if vehicle matches query
    const vName = (vehObj?.vehicleId?.name || vehObj?.name || "").toLowerCase();
    if (vName.includes(String(year)) && vName.includes(make.toLowerCase())) {
      console.log(`${LOG} Found matching vehicle: "${vName}" → ${vid.substring(0, 8)}…`);
      return { estId: rec._id, vehId: vid };
    }
  }

  if (fallback) {
    console.log(`${LOG} No exact vehicle match — using fallback for SSO auth (will change vehicle in UI)`);
    return { ...fallback, needsVehicleChange: true };
  }

  return null;
}

/**
 * Get PartsTech SSO redirect URL from AutoLeap.
 */
async function getPartsTechUrl(token, estId, vehId) {
  const qPath = `/partstech/create/qoute?orderId=${encodeURIComponent(estId)}&vehicleId=${encodeURIComponent(vehId)}&isTrigge=true`;
  const resp = await autoLeapCall("GET", qPath, null, token);
  return resp.data?.response?.redirectUrl || null;
}

// ─── Snapshot product extraction ────────────────────────────────────────────

const PRICE_RE = /\$(\d{1,6}(?:,\d{3})*(?:\.\d{2})?)/;

/**
 * Extract product listings from a PartsTech search results snapshot.
 *
 * Strategy: find price elements, then gather context from nearby elements
 * to build product records (brand, description, part number, availability).
 *
 * @param {string} snapshotText - Raw snapshot from OpenClaw
 * @returns {Array<{price, brand, description, partNumber, availability, inStock}>}
 */
function parseProducts(snapshotText) {
  const elements = browser.parseSnapshot(snapshotText);
  const products = [];

  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    const priceMatch = el.text.match(PRICE_RE);
    if (!priceMatch) continue;

    const price = parseFloat(priceMatch[1].replace(",", ""));
    if (price <= 0 || price > 50000) continue;

    // Gather nearby context (before and after this price element)
    const contextBefore = [];
    const contextAfter = [];
    for (let j = Math.max(0, i - 10); j < i; j++) contextBefore.push(elements[j]);
    for (let j = i + 1; j < Math.min(elements.length, i + 6); j++) contextAfter.push(elements[j]);

    let brand = "Unknown";
    let description = "";
    let partNumber = null;
    let availability = "Check Availability";

    // Scan context — check before elements first (product info typically above price)
    const allContext = [...contextBefore.reverse(), ...contextAfter];
    for (const ctx of allContext) {
      const t = ctx.text.trim();
      if (!t || PRICE_RE.test(t)) continue;

      // Skip UI elements
      if (/^(add to cart|buy|select|view detail|cart|qty|quantity|\d+$)/i.test(t)) continue;

      // Availability keywords
      if (/in stock|available|ships|backorder|out of stock|special order/i.test(t) && availability === "Check Availability") {
        availability = t;
        continue;
      }

      // Part number: alphanumeric 4-15 chars, no spaces
      if (!partNumber && /^[A-Z0-9][A-Z0-9.\-]{3,14}$/i.test(t) && !/\s/.test(t)) {
        partNumber = t;
        continue;
      }

      // Description: longer text that describes the part
      if (!description && t.length > 12 && !/^[\d$]/i.test(t)) {
        description = t;
        continue;
      }

      // Brand: short text, appears before description
      if (brand === "Unknown" && t.length >= 2 && t.length <= 30 && !/^[\d$]/i.test(t)) {
        brand = t;
      }
    }

    products.push({
      price,
      brand,
      description: description || "Part",
      partNumber,
      availability,
      inStock: /in stock|available/i.test(availability) && !/out of stock/i.test(availability),
    });
  }

  // Deduplicate by price + part number
  const seen = new Set();
  return products.filter(p => {
    const key = `${p.price}-${p.partNumber || p.brand}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Pick the cheapest available product.
 */
function pickBestProduct(products) {
  if (!products || products.length === 0) return null;

  const available = products.filter(p => p.inStock && p.price > 0);
  if (available.length > 0) {
    return available.reduce((best, p) => (!best || p.price < best.price) ? p : best, null);
  }

  // No in-stock items — return cheapest regardless
  return products.reduce((best, p) => (!best || p.price < best.price) ? p : best, null);
}

// ─── Search one part ────────────────────────────────────────────────────────

/**
 * Search for one part in PartsTech's search box using OpenClaw.
 * Returns parsed products from the results page snapshot.
 */
async function searchOnePart(searchTerm) {
  let snap = browser.takeSnapshot();
  let elements = browser.parseSnapshot(snap);

  // Find search input
  let searchRef = browser.findRefByType(elements, "input", "search");
  if (!searchRef) searchRef = browser.findRefByType(elements, "input", "part");
  if (!searchRef) searchRef = browser.findRef(elements, "search");

  if (!searchRef) {
    console.log(`${LOG} Search input not found — page elements: ${elements.slice(0, 15).map(e => `[${e.ref}]${e.type}:"${e.text.substring(0, 30)}"`).join(" | ")}`);
    return [];
  }

  // Click input, type search term, submit with Enter
  browser.clickRef(searchRef);
  browser.typeInRef(searchRef, searchTerm, true);

  // Wait for results to load
  browser.waitForLoad("networkidle");
  await new Promise(r => setTimeout(r, 3000));

  // Take snapshot and parse products
  snap = browser.takeSnapshot();
  let products = parseProducts(snap);

  // If no products found, wait longer and retry
  if (products.length === 0) {
    console.log(`${LOG} No products on first snapshot — retrying after delay...`);
    await new Promise(r => setTimeout(r, 5000));
    snap = browser.takeSnapshot();
    products = parseProducts(snap);
  }

  // Log what we found
  console.log(`${LOG} Snapshot: ${products.length} product(s) extracted`);
  for (const p of products) {
    console.log(`${LOG}   ${p.brand} | ${p.description} | #${p.partNumber || "?"} | $${p.price} | ${p.availability}`);
  }

  return products;
}

// ─── Vehicle change via PartsTech UI ────────────────────────────────────────

/**
 * Attempt to change the vehicle in PartsTech's UI using OpenClaw.
 * Used when the SSO URL had a different vehicle than the query.
 */
async function changeVehicleInUI(year, make, model) {
  console.log(`${LOG} Changing vehicle to ${year} ${make} ${model} via PartsTech UI...`);

  let snap = browser.takeSnapshot();
  let elements = browser.parseSnapshot(snap);

  // Look for vehicle change/edit button
  let changeRef = browser.findRef(elements, "change vehicle");
  if (!changeRef) changeRef = browser.findRef(elements, "edit vehicle");
  if (!changeRef) changeRef = browser.findRef(elements, "select vehicle");
  if (!changeRef) changeRef = browser.findRefByType(elements, "button", "vehicle");
  if (!changeRef) changeRef = browser.findRefByType(elements, "link", "vehicle");
  if (!changeRef) changeRef = browser.findRef(elements, "change");

  if (!changeRef) {
    console.log(`${LOG} No vehicle change button found — proceeding with current vehicle`);
    return false;
  }

  browser.clickRef(changeRef);
  browser.waitForLoad();
  await new Promise(r => setTimeout(r, 2000));

  // Try YMME vehicle selection
  const result = browser.selectVehicleYMME({ year, make, model }, LOG);
  if (result.success) {
    console.log(`${LOG} Vehicle changed successfully`);
    browser.waitForLoad();
    await new Promise(r => setTimeout(r, 3000));
    return true;
  }

  console.log(`${LOG} Vehicle change failed: ${result.error}`);
  return false;
}

// ─── Main export ────────────────────────────────────────────────────────────

/**
 * Search PartsTech for parts pricing using AutoLeap SSO + OpenClaw.
 * Returns data in bestValueBundle format for orchestrator compatibility.
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

  console.log(`${LOG} Pricing ${partsList.length} part(s) for ${year} ${make} ${model}...`);

  try {
    // 1. Get AutoLeap token
    const { getToken } = require("./autoleap-api");
    const token = await getToken();

    // 2. Find matching vehicle in AutoLeap estimates
    const vehicleMatch = await findMatchingVehicle(token, year, make, model);
    if (!vehicleMatch) {
      console.log(`${LOG} No vehicle found in AutoLeap — cannot open PartsTech`);
      return { error: "No AutoLeap vehicle found for PartsTech SSO", ...empty };
    }

    // 3. Get SSO redirect URL with correct vehicleId
    const redirectUrl = await getPartsTechUrl(token, vehicleMatch.estId, vehicleMatch.vehId);
    if (!redirectUrl) {
      return { error: "PartsTech SSO redirect failed", ...empty };
    }

    console.log(`${LOG} SSO URL: ${redirectUrl.substring(0, 80)}…`);
    console.log(`${LOG} Vehicle: ${vehicleMatch.needsVehicleChange ? "FALLBACK — will try UI change" : "EXACT match"}`);

    // 4. Open PartsTech via OpenClaw
    browser.ensureBrowser();
    browser.browserCmd("open", redirectUrl);
    browser.waitForLoad();
    await new Promise(r => setTimeout(r, 5000)); // Let Angular app initialize

    // 5. Change vehicle if needed
    if (vehicleMatch.needsVehicleChange) {
      await changeVehicleInUI(year, make, model);
    }

    // 6. Search each part
    const bundle = {
      parts: [],
      totalCost: 0,
      allInStock: true,
      suppliers: new Set(),
    };
    const individualResults = [];

    for (const partReq of partsList) {
      const searchTerm = partReq.searchTerms?.[0]
        ? (partReq.position ? `${partReq.searchTerms[0]} ${partReq.position}` : partReq.searchTerms[0])
        : (partReq.position ? `${partReq.partType} ${partReq.position}` : partReq.partType);

      console.log(`${LOG}   → Searching "${searchTerm}"...`);

      let products = [];
      try {
        products = await searchOnePart(searchTerm);
      } catch (err) {
        console.error(`${LOG} Search error for "${searchTerm}":`, err.message);
      }

      // Retry without position if no results
      if (products.length === 0 && partReq.position) {
        console.log(`${LOG}   → No results with position — retrying "${partReq.partType}"...`);
        try {
          products = await searchOnePart(partReq.partType);
        } catch { /* ignore */ }
      }

      console.log(`${LOG}   → ${products.length} product(s) found`);

      const best = pickBestProduct(products);

      if (!best) {
        bundle.parts.push({ requested: partReq, selected: null, error: "No results" });
        bundle.allInStock = false;
        individualResults.push({ partType: partReq.partType, error: "No results found", bestValue: null });
        continue;
      }

      const selected = {
        description: best.description,
        brand: best.brand,
        partNumber: best.partNumber,
        price: best.price,
        listPrice: best.price,
        coreCharge: 0,
        totalCost: best.price,
        availability: best.availability,
        supplier: best.brand,
        type: "Aftermarket",
        position: partReq.position || null,
      };

      const qty = partReq.qty || 1;
      bundle.parts.push({ requested: partReq, selected });
      bundle.totalCost += best.price * qty;
      bundle.suppliers.add(best.brand);
      if (!best.inStock) bundle.allInStock = false;

      individualResults.push({
        partType: partReq.partType,
        bestValue: { overall: selected, aftermarket: selected, oem: null },
      });

      // Brief pause between searches
      await new Promise(r => setTimeout(r, 1000));
    }

    bundle.suppliers = [...bundle.suppliers];
    bundle.supplierCount = bundle.suppliers.length;

    const found = bundle.parts.filter(p => p.selected).length;
    console.log(`${LOG} Done: ${found}/${bundle.parts.length} found, $${bundle.totalCost.toFixed(2)} total`);

    return { bestValueBundle: bundle, individualResults };

  } catch (err) {
    console.error(`${LOG} Error:`, err.message);
    return { error: err.message, ...empty };
  }
}

module.exports = { searchPartsPricing };
