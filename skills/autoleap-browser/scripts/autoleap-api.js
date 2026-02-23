/**
 * AutoLeap REST API Client
 *
 * Replaces OpenClaw browser automation with direct REST API calls.
 * Token is acquired once via puppeteer CDP (captures JWT from live Chrome session),
 * then cached to disk and reused until expired.
 *
 * Confirmed working endpoints (via inspect-autoleap series):
 *   PUT  /customers/list          - Search customers
 *   POST /customers               - Create customer
 *   POST /estimates               - Create estimate (with customer/vehicle/services)
 *   GET  /estimates/{id}          - Get estimate
 *   DELETE /estimates/{id}        - Delete estimate
 */

const https = require("https");
const os = require("os");
const fs = require("fs");
const path = require("path");
const { createLogger } = require("../../shared/logger");
const { withRetry } = require("../../shared/retry");

const LOG = "[autoleap-api]";
const log = createLogger("autoleap-api");
const API_HOST = "api.myautoleap.com";
const AUTOLEAP_APP_URL = "https://app.myautoleap.com";
const TOKEN_CACHE = path.join(os.tmpdir(), "autoleap-token.json");
const CHROME_CDP_URL = "http://127.0.0.1:18800";

// ─── HTTP helper ─────────────────────────────────────────────────────────────

function apiCall(method, apiPath, body, token) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const options = {
      hostname: API_HOST,
      path: "/api/v1" + apiPath,
      method,
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/plain, */*",
        "authorization": token,
        "origin": AUTOLEAP_APP_URL,
        "referer": AUTOLEAP_APP_URL + "/",
      },
    };
    if (bodyStr) options.headers["Content-Length"] = Buffer.byteLength(bodyStr);

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data.substring(0, 2000) });
        }
      });
    });
    req.on("error", reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ─── Retry wrapper ───────────────────────────────────────────────────────────

async function apiCallWithRetry(method, apiPath, body, token) {
  if (process.env.SAM_RETRY_ENABLED !== "true") {
    return apiCall(method, apiPath, body, token);
  }
  return withRetry(
    () => apiCall(method, apiPath, body, token),
    { maxRetries: 2, baseDelay: 1000 }
  );
}

// ─── Service validation ─────────────────────────────────────────────────────

function validateServices(services) {
  if (!services || !Array.isArray(services) || services.length === 0) {
    return { valid: false, reason: "empty services array" };
  }
  for (const svc of services) {
    if (!svc.title) return { valid: false, reason: "service missing title" };
    if (!svc.items || svc.items.length === 0) return { valid: false, reason: "service has no items" };
  }
  return { valid: true };
}

function resolvePartsMarkupPercent(partsMarkupPercent) {
  const fromArg = Number(partsMarkupPercent);
  if (Number.isFinite(fromArg) && fromArg >= 0) return fromArg;

  const fromEnvPercent = Number(process.env.AUTOLEAP_PARTS_MARKUP_PERCENT);
  if (Number.isFinite(fromEnvPercent) && fromEnvPercent >= 0) return fromEnvPercent;

  const fromEnvMultiplier = Number(process.env.AUTOLEAP_PARTS_MARKUP_MULTIPLIER);
  if (Number.isFinite(fromEnvMultiplier) && fromEnvMultiplier > 0) {
    return Math.max(0, (fromEnvMultiplier - 1) * 100);
  }

  return 40;
}

function resolveRetailPartPrice(sel, markupPercent) {
  const explicitRetail = Number(sel?.retailPrice ?? sel?.customerPrice ?? sel?.priceRetail ?? 0);
  if (Number.isFinite(explicitRetail) && explicitRetail > 0) return explicitRetail;

  // Some pipelines may populate shopPrice as an already-calculated customer price.
  const shopPrice = Number(sel?.shopPrice ?? 0);
  const cost = Number(sel?.cost ?? sel?.price ?? sel?.totalCost ?? 0);
  if (Number.isFinite(shopPrice) && shopPrice > 0 && (!Number.isFinite(cost) || cost <= 0 || shopPrice > cost)) {
    return shopPrice;
  }

  const baseCost = Number.isFinite(cost) && cost > 0 ? cost : shopPrice;
  if (!Number.isFinite(baseCost) || baseCost <= 0) return 0;

  return Math.round(baseCost * (1 + markupPercent / 100) * 100) / 100;
}

// ─── Token management ────────────────────────────────────────────────────────

function loadCachedToken() {
  try {
    const cached = JSON.parse(fs.readFileSync(TOKEN_CACHE, "utf8"));
    if (!cached.token || !cached.expiresAt) return null;
    // Refresh 5 minutes before expiry
    if (Date.now() < cached.expiresAt - 300_000) return cached.token;
    console.log(`${LOG} Cached token expired, refreshing`);
    return null;
  } catch (e) {
    return null;
  }
}

function saveToken(token) {
  try {
    // Decode JWT to get expiry (middle base64 segment)
    const parts = token.split(".");
    let expiresAt = Date.now() + 2 * 60 * 60 * 1000; // default 2h
    if (parts.length === 3) {
      try {
        const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
        if (payload.exp) expiresAt = payload.exp * 1000;
      } catch (_) {}
    }
    fs.writeFileSync(TOKEN_CACHE, JSON.stringify({ token, expiresAt }));
  } catch (e) {
    console.log(`${LOG} Warning: could not cache token: ${e.message}`);
  }
}

/**
 * Acquire JWT from the running Chrome session via puppeteer CDP.
 * If AutoLeap is on the login page, logs in automatically using env vars.
 */
async function getToken() {
  const cached = loadCachedToken();
  if (cached) {
    log.info("token acquired", { token_source: "cache" });
    return cached;
  }

  let puppeteer;
  try {
    puppeteer = require("puppeteer-core");
  } catch (e) {
    throw new Error("puppeteer-core not available — install it");
  }

  console.log(`${LOG} Acquiring token from Chrome session...`);
  const browser = await puppeteer.connect({ browserURL: CHROME_CDP_URL, defaultViewport: null });

  // Find AutoLeap tab, or open a new one
  let page = (await browser.pages()).find(p => p.url().includes("myautoleap.com"));
  if (!page) {
    page = (await browser.pages())[0];
    await page.goto(AUTOLEAP_APP_URL, { waitUntil: "domcontentloaded", timeout: 15000 });
    await new Promise(r => setTimeout(r, 2000));
  }

  const client = await page.createCDPSession();
  await client.send("Network.enable");

  let token = null;
  const onRequest = (params) => {
    if (params.request.url.includes("api.myautoleap.com") && !token) {
      token = params.request.headers["authorization"] ||
              params.request.headers["Authorization"] || null;
    }
  };
  client.on("Network.requestWillBeSent", onRequest);

  // If on the login page, log in automatically
  const currentUrl = page.url();
  const onLoginPage = currentUrl.includes("/login") ||
                      currentUrl === AUTOLEAP_APP_URL ||
                      currentUrl === AUTOLEAP_APP_URL + "/";

  if (onLoginPage) {
    console.log(`${LOG} AutoLeap session expired — logging in automatically...`);
    const email = process.env.AUTOLEAP_EMAIL;
    const password = process.env.AUTOLEAP_PASSWORD;
    if (!email || !password) {
      client.off("Network.requestWillBeSent", onRequest);
      await client.detach();
      browser.disconnect();
      throw new Error("AUTOLEAP_EMAIL / AUTOLEAP_PASSWORD not set — cannot auto-login");
    }

    // Navigate to app root (redirects to login form)
    await page.goto(AUTOLEAP_APP_URL, { waitUntil: "domcontentloaded", timeout: 15000 });
    await new Promise(r => setTimeout(r, 1500));

    // Fill login form (AutoLeap uses id="login-email" / id="login-password", type="text")
    await page.waitForSelector('#login-email, input[type="email"], input[name="email"]', { timeout: 10000 });
    const emailSel = await page.$('#login-email') ? '#login-email' : 'input[type="email"], input[name="email"]';
    const passSel  = await page.$('#login-password') ? '#login-password' : 'input[type="password"], input[name="password"]';
    await page.focus(emailSel);
    await page.keyboard.type(email, { delay: 60 });
    await page.focus(passSel);
    await page.keyboard.type(password, { delay: 60 });
    await page.keyboard.press('Enter');

    // Wait for redirect away from login page (Angular app can be slow — 40s timeout)
    await page.waitForFunction(
      () => !window.location.href.includes("/login"),
      { timeout: 40000 }
    );
    // Let the app boot and fire its initial API calls
    await new Promise(r => setTimeout(r, 5000));
  } else {
    // Already authenticated — reload to trigger API calls and capture token
    await page.reload({ waitUntil: "networkidle0", timeout: 30000 });
  }

  client.off("Network.requestWillBeSent", onRequest);
  await client.detach();
  browser.disconnect();

  if (!token) throw new Error("Failed to capture AutoLeap auth token from Chrome session");

  saveToken(token);
  // Log token metadata (never the actual token value)
  let tokenExpiresInMin = 120; // default assumption
  try {
    const parts = token.split(".");
    if (parts.length === 3) {
      const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
      if (payload.exp) tokenExpiresInMin = Math.round((payload.exp * 1000 - Date.now()) / 60000);
    }
  } catch (_) {}
  log.info("token acquired", { token_source: "fresh", token_expires_in_min: tokenExpiresInMin });
  return token;
}

// ─── Customer operations ──────────────────────────────────────────────────────

/**
 * Search for a customer by name or phone number.
 * Returns the first matching customer with { _id, fullName, phone, vehicles[] }
 * or null if not found.
 */
async function searchCustomer(token, query) {
  const res = await apiCallWithRetry(
    "PUT",
    "/customers/list?limit=10&skip=0&sort=fullName&order=1&activeStatus=true",
    { multiInvoiceDateRange: [], multiRoDateRange: [], language: [], search: query },
    token
  );
  const records = res.data?.response?.records || [];
  return records[0] || null;
}

/**
 * Create a new customer. Returns the created customer object.
 */
async function createCustomer(token, { firstName, lastName, phone, email }) {
  const body = { firstName, lastName };
  if (phone) body.phone = phone;
  if (email) body.email = email;

  const res = await apiCallWithRetry("POST", "/customers", body, token);
  if (res.data?.response?._id) return res.data.response;
  throw new Error(`Failed to create customer: ${JSON.stringify(res.data?.error || res.raw)}`);
}

// ─── Estimate operations ──────────────────────────────────────────────────────

/**
 * Create an estimate. Pass customer/vehicle/services to link them at creation.
 * Returns the created estimate object with { _id, code }.
 */
async function createEstimate(token, { customerId, vehicleId, services }) {
  const body = {};
  if (customerId) body.customer = { customerId };
  if (vehicleId) body.vehicle = { vehicleId };
  if (services?.length) body.services = services;

  const res = await apiCallWithRetry("POST", "/estimates", body, token);
  if (res.data?.response?._id) return res.data.response;
  throw new Error(`Failed to create estimate: ${JSON.stringify(res.data?.error || res.raw)}`);
}

/**
 * Get estimate by ID.
 */
async function getEstimate(token, estimateId) {
  const res = await apiCallWithRetry("GET", `/estimates/${estimateId}`, null, token);
  return res.data?.response || null;
}

// ─── Service builder ──────────────────────────────────────────────────────────

/**
 * Build AutoLeap service objects from diagnosis result and parts list.
 *
 * @param {object} diagnosis - Output from diagnose.js (ai.repair_plan etc.)
 * @param {object[]} [parts] - Parts from partstech search
 * @returns {object[]} AutoLeap services array
 */
function buildServices(diagnosis, parts, laborHoursOverride, partsMarkupPercent) {
  const services = [];
  const repairPlan = diagnosis?.ai?.repair_plan || diagnosis?.repair_plan;
  const diagnoses = diagnosis?.ai?.diagnoses || diagnosis?.diagnoses || [];
  const codes = diagnosis?.codes || [];

  // Determine service title from diagnosis
  const primaryCause = diagnoses[0]?.cause || diagnoses[0]?.description || "Vehicle Repair";
  const codeStr = codes.join(", ");
  const serviceTitle = codeStr ? `${codeStr} — ${primaryCause}` : primaryCause;

  // Gather labor items
  const laborItems = [];
  const effectivePartsMarkup = resolvePartsMarkupPercent(partsMarkupPercent);

  // Labor source precedence: MOTOR override > AI repair_plan > default 1.5
  const motorHours = laborHoursOverride?.hours;
  const aiHours    = repairPlan?.labor?.hours;
  const laborHours = motorHours || aiHours || 1.5;
  const laborSource = motorHours ? `MOTOR(${motorHours}h)` : (aiHours ? `AI(${aiHours}h)` : "default(1.5h)");
  log.info("labor source resolved", { laborSource, laborHours });

  const laborRate  = Number(process.env.AUTOLEAP_LABOR_RATE) || 120;
  const laborTotal = Math.round(laborHours * laborRate * 100) / 100;
  const laborDesc  = laborHoursOverride?.description || repairPlan?.labor?.description || serviceTitle;

  laborItems.push({
    type: "labor",
    title: laborDesc.substring(0, 100),
    pricingType: "flatFee",
    price: laborTotal,
    count: 1,
    isTaxable: false,
    billableHours: laborHours,
  });

  // Parts items
  const partItems = [];
  if (parts?.length) {
    for (const part of parts) {
      const sel = part.selected || part;
      if (!sel) continue;

      const partDesc = sel.description || sel.name || sel.partType || "Part";
      const partPrice = resolveRetailPartPrice(sel, effectivePartsMarkup);
      const partNum = sel.partNumber || sel.partNum || "";

      partItems.push({
        type: "part",
        title: (partDesc + (partNum ? ` — ${partNum}` : "")).substring(0, 100),
        pricingType: "flatFee",
        price: partPrice,
        count: Number(part?.requested?.qty || sel?.qty || 1) || 1,
        isTaxable: true,
        partNumber: partNum || undefined,
        brand: sel.brand || sel.manufacturer || undefined,
      });
    }
  }

  // Also add parts from repair plan if no partstech parts
  if (partItems.length === 0 && repairPlan?.parts?.length) {
    for (const p of repairPlan.parts) {
      const estimated = Number(p.estimatedCost || p.cost || p.price || 0);
      if (estimated <= 0) continue;
      partItems.push({
        type: "part",
        title: (p.name || p.description || "Part").substring(0, 100),
        pricingType: "flatFee",
        price: estimated,
        count: 1,
        isTaxable: true,
      });
    }
  }

  // Build a single service combining labor + parts
  const allItems = [...laborItems, ...partItems];

  // Compute breakdown totals for caller (needed for consistent display)
  const laborItemsTotal = laborItems.reduce((s, i) => s + (i.price || 0), 0);
  const partItemsTotal  = partItems.reduce((s, i) => s + (i.price || 0), 0);

  services.push({
    title: serviceTitle.substring(0, 120),
    billableHours: laborHours,
    authorized: false,
    status: "new",
    includeInInvoice: true,
    items: allItems,
    _laborTotal: laborItemsTotal,
    _partsTotal: partItemsTotal,
    _laborHours: laborHours,
    _laborRate:  laborRate,
  });

  return services;
}

// ─── Main exported function ───────────────────────────────────────────────────

/**
 * Build an AutoLeap estimate from diagnosis results.
 *
 * @param {object} params
 * @param {string} params.customerName  - Full name (e.g. "John Smith")
 * @param {string} [params.phone]       - Customer phone for lookup
 * @param {string} [params.vehicleYear]
 * @param {string} [params.vehicleMake]
 * @param {string} [params.vehicleModel]
 * @param {string} [params.vin]
 * @param {object} params.diagnosis     - Diagnosis result from diagnose.js
 * @param {object[]} [params.parts]     - Parts from partstech search
 * @returns {Promise<{ success, estimateCode, estimateId, customerName, vehicleDesc, total, error }>}
 */
async function buildEstimate({ customerName, phone, vehicleYear, vehicleMake, vehicleModel, vin, diagnosis, parts, laborHoursOverride, partsMarkupPercent }) {
  try {
    // 1. Get auth token
    const token = await getToken();

    // 2. Find or create customer
    const searchQuery = phone || customerName;
    let customer = await searchCustomer(token, searchQuery);

    if (!customer) {
      console.log(`${LOG} Customer not found for "${searchQuery}", creating...`);
      const nameParts = (customerName || "Unknown Customer").trim().split(/\s+/);
      const firstName = nameParts.length > 1 ? nameParts[0] : "";
      const lastName  = nameParts.length > 1 ? nameParts.slice(1).join(" ") : nameParts[0];
      try {
        customer = await createCustomer(token, { firstName, lastName, phone });
        console.log(`${LOG} Created customer: ${customer.fullName} (${customer._id})`);
      } catch (custErr) {
        console.log(`${LOG} Customer creation failed (${custErr.message}) — proceeding without customer`);
        customer = null;
      }
    } else {
      console.log(`${LOG} Found customer: ${customer.fullName} (${customer._id})`);
    }

    const customerId = customer?._id || null;

    // 3. Match vehicle (optional)
    let vehicleId = null;
    const vehicles = customer?.vehicles || [];
    if (vehicles.length > 0 && (vehicleYear || vehicleMake || vehicleModel || vin)) {
      // Try to match by VIN first
      if (vin) {
        const match = vehicles.find((v) => v.VIN === vin || v.vin === vin);
        if (match) vehicleId = match.vehicleId;
      }
      // Fall back to year/make/model match
      if (!vehicleId && (vehicleYear || vehicleMake)) {
        const match = vehicles.find((v) => {
          const name = (v.name || "").toLowerCase();
          const yearMatch = !vehicleYear || name.includes(String(vehicleYear));
          const makeMatch = !vehicleMake || name.toLowerCase().includes(vehicleMake.toLowerCase());
          return yearMatch && makeMatch;
        });
        if (match) vehicleId = match.vehicleId;
      }
      // Fall back to first vehicle
      if (!vehicleId) vehicleId = vehicles[0]?.vehicleId || null;
    } else if (vehicles.length === 1) {
      vehicleId = vehicles[0].vehicleId;
    }

    if (vehicleId) {
      const veh = vehicles.find((v) => v.vehicleId === vehicleId);
      console.log(`${LOG} Using vehicle: ${veh?.name || vehicleId}`);
    } else {
      console.log(`${LOG} No vehicle matched — creating estimate without vehicle`);
    }

    // 4. Build services from diagnosis + parts
    const services = buildServices(diagnosis, parts, laborHoursOverride, partsMarkupPercent);
    log.info("services built", { count: services.length, items: services[0]?.items?.length || 0 });

    // Strip internal metadata before sending to AutoLeap API
    const apiServices = services.map(({ _laborTotal, _partsTotal, _laborHours, _laborRate, ...rest }) => rest);

    // Validate services before sending to API
    const validation = validateServices(apiServices);
    if (!validation.valid) {
      log.warn("services validation failed", { reason: validation.reason });
      return { success: false, error: `Service validation failed: ${validation.reason}` };
    }

    // 5. Create estimate
    const estimate = await createEstimate(token, { customerId, vehicleId, services: apiServices });
    log.info("estimate created", { code: estimate.code, id: estimate._id });

    // 6. Compute total from service items (API serviceTotal may be 0 initially)
    const total = services.reduce(
      (sum, svc) => sum + svc.items.reduce((s, i) => s + (i.price || 0), 0),
      0
    );
    const totalLabor    = services.reduce((s, svc) => s + (svc._laborTotal || 0), 0);
    const totalParts    = services.reduce((s, svc) => s + (svc._partsTotal || 0), 0);
    const laborHoursUsed = services[0]?._laborHours || 0;
    const laborRateUsed  = services[0]?._laborRate  || (Number(process.env.AUTOLEAP_LABOR_RATE) || 120);

    const vehicleDesc = vehicleYear && vehicleMake && vehicleModel
      ? `${vehicleYear} ${vehicleMake} ${vehicleModel}`
      : (customer?.vehicles?.[0]?.name || null);

    return {
      success: true,
      estimateCode: estimate.code,
      estimateId: estimate._id,
      customerName: customer?.fullName || customerName || null,
      vehicleDesc,
      total:      Math.round(total * 100) / 100,
      totalLabor: Math.round(totalLabor * 100) / 100,
      totalParts: Math.round(totalParts * 100) / 100,
      laborHours: laborHoursUsed,
      laborRate:  laborRateUsed,
    };
  } catch (err) {
    log.error("buildEstimate failed", { error: err.message });
    return { success: false, error: err.message };
  }
}

/**
 * Download the AutoLeap estimate as a PDF.
 *
 * Strategy:
 *   1. Try REST: GET /estimates/{id}/pdf — returns binary application/pdf
 *   2. If REST fails/404, use puppeteer: navigate to estimate page + page.pdf()
 *
 * @param {string} token - AutoLeap auth token
 * @param {string} estimateId - AutoLeap estimate _id
 * @param {string} outputPath - local file path to write PDF to
 * @returns {string|null} outputPath on success, null on failure
 */
async function downloadEstimatePDF(token, estimateId, outputPath) {
  // ── Attempt 1: REST API ────────────────────────────────────────────────────
  try {
    const pdf = await new Promise((resolve) => {
      const opts = {
        hostname: API_HOST,
        path: `/api/v1/estimates/${estimateId}/pdf`,
        method: "GET",
        headers: {
          "Accept": "application/pdf, */*",
          "authorization": token,
          "origin": AUTOLEAP_APP_URL,
          "referer": AUTOLEAP_APP_URL + "/",
        },
        timeout: 15000,
      };
      let settled = false;
      const settle = (v) => { if (!settled) { settled = true; resolve(v); } };
      const req = https.request(opts, (res) => {
        const contentType = res.headers["content-type"] || "";
        if (res.statusCode !== 200 || !contentType.includes("pdf")) {
          res.resume();
          settle(null);
          return;
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => settle(Buffer.concat(chunks)));
      });
      req.on("timeout", () => { req.destroy(); settle(null); });
      req.on("error", () => settle(null));
      req.end();
    });

    if (pdf && pdf.length > 1000) {
      fs.writeFileSync(outputPath, pdf);
      console.log(`${LOG} AutoLeap PDF downloaded via REST (${pdf.length} bytes)`);
      return outputPath;
    }
    console.log(`${LOG} REST PDF endpoint returned no PDF — trying puppeteer fallback`);
  } catch (err) {
    console.log(`${LOG} REST PDF attempt failed: ${err.message} — trying puppeteer`);
  }

  // ── Attempt 2: Puppeteer print-to-PDF ─────────────────────────────────────
  let puppeteer;
  try { puppeteer = require("puppeteer-core"); } catch { return null; }

  let browser;
  try {
    browser = await puppeteer.connect({ browserURL: CHROME_CDP_URL, defaultViewport: null });

    // Find or open AutoLeap tab
    let page = (await browser.pages()).find(p => p.url().includes("myautoleap.com"));
    if (!page) {
      page = await browser.newPage();
    }

    const estimateUrl = `${AUTOLEAP_APP_URL}/estimates/${estimateId}`;
    console.log(`${LOG} Puppeteer: navigating to ${estimateUrl}`);
    await page.goto(estimateUrl, { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise(r => setTimeout(r, 4000));

    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "12mm", bottom: "12mm", left: "10mm", right: "10mm" },
    });

    fs.writeFileSync(outputPath, pdfBuffer);
    console.log(`${LOG} AutoLeap PDF captured via puppeteer (${pdfBuffer.length} bytes)`);
    return outputPath;
  } catch (err) {
    console.error(`${LOG} Puppeteer PDF failed: ${err.message}`);
    return null;
  } finally {
    if (browser) browser.disconnect();
  }
}

// ─── Native PartsTech integration (browser-based) ─────────────────────────────

/**
 * Add parts to an AutoLeap estimate through the embedded PartsTech UI.
 *
 * Uses puppeteer-core (same Chrome CDP session used for token capture)
 * to navigate to the estimate, open PartsTech iframe, search for each part,
 * and add it — letting AutoLeap apply its markup matrix for retail pricing.
 *
 * @param {string} estimateId - AutoLeap estimate _id
 * @param {object[]} parts - Parts array from partstech search (each has .selected and .requested)
 * @returns {{ addedCount: number, failedCount: number, addedParts: object[], failedParts: object[] }}
 */
async function addPartsThroughAutoLeap(estimateId, parts) {
  let puppeteer;
  try { puppeteer = require("puppeteer-core"); } catch {
    console.log(`${LOG} puppeteer-core not available — skipping browser parts`);
    return { addedCount: 0, failedCount: parts.length, addedParts: [], failedParts: parts.map(p => ({ part: p, reason: "puppeteer-core not available" })) };
  }

  const addedParts = [];
  const failedParts = [];
  let browser;

  try {
    browser = await puppeteer.connect({ browserURL: CHROME_CDP_URL, defaultViewport: null });

    // Find or open AutoLeap tab
    let page = (await browser.pages()).find(p => p.url().includes("myautoleap.com"));
    if (!page) {
      page = (await browser.pages())[0] || await browser.newPage();
    }

    // Navigate to the estimate
    const estimateUrl = `${AUTOLEAP_APP_URL}/#/estimates/${estimateId}`;
    console.log(`${LOG} Navigating to estimate: ${estimateUrl}`);
    await page.goto(estimateUrl, { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise(r => setTimeout(r, 3000));

    // Find and click the PartsTech button/tab within the estimate
    const ptButtonClicked = await page.evaluate(() => {
      // Look for PartsTech button by common patterns in AutoLeap estimate UI
      const candidates = Array.from(document.querySelectorAll("button, a, [role='tab'], [role='button'], span"));
      for (const el of candidates) {
        const txt = (el.textContent || "").toLowerCase().trim();
        if (txt.includes("partstech") || txt.includes("parts tech") || txt.includes("order parts") || txt.includes("parts ordering")) {
          el.click();
          return true;
        }
      }
      // Try mat-tab or Angular material tab labels
      const tabs = document.querySelectorAll(".mat-tab-label, .mat-mdc-tab");
      for (const tab of tabs) {
        if ((tab.textContent || "").toLowerCase().includes("part")) {
          tab.click();
          return true;
        }
      }
      return false;
    });

    if (!ptButtonClicked) {
      console.log(`${LOG} Could not find PartsTech button in estimate — trying direct icon click`);
      // Try clicking any element with a parts-related icon
      await page.evaluate(() => {
        const icons = document.querySelectorAll("[class*='parts'], [class*='partstech'], img[alt*='parts']");
        if (icons.length > 0) icons[0].click();
      });
    }

    await new Promise(r => setTimeout(r, 3000));

    // Wait for PartsTech iframe to appear
    let ptFrame = null;
    for (let attempt = 0; attempt < 10; attempt++) {
      const frames = page.frames();
      ptFrame = frames.find(f => {
        const url = f.url();
        return url.includes("partstech") || url.includes("parts-tech") || url.includes("pt-embed");
      });
      if (ptFrame) break;
      await new Promise(r => setTimeout(r, 1500));
    }

    if (!ptFrame) {
      console.log(`${LOG} PartsTech iframe not found — falling back to page-level search`);
      // Some AutoLeap setups embed PartsTech directly (no iframe)
      ptFrame = page;
    } else {
      console.log(`${LOG} Found PartsTech iframe: ${ptFrame.url().substring(0, 80)}`);
    }

    // Process each part
    for (const partItem of parts) {
      const sel = partItem.selected || partItem;
      if (!sel) {
        failedParts.push({ part: partItem, reason: "no selected part data" });
        continue;
      }

      const searchTerms = partItem.requested?.searchTerms || [];
      const partType = partItem.requested?.partType || sel.description || sel.partType || "";
      const searchQuery = searchTerms[0] || partType;

      if (!searchQuery) {
        failedParts.push({ part: partItem, reason: "no search term" });
        continue;
      }

      try {
        console.log(`${LOG} Searching PartsTech for: "${searchQuery}"`);

        // Find search input in the PartsTech context (iframe or page)
        const searchInput = await ptFrame.$('input[type="search"], input[placeholder*="search" i], input[placeholder*="part" i], input[name*="search" i], .search-input input, input.search-box');
        if (!searchInput) {
          console.log(`${LOG} No search input found for: ${searchQuery}`);
          failedParts.push({ part: partItem, reason: "no search input in PartsTech" });
          continue;
        }

        // Clear and type search
        await searchInput.click({ clickCount: 3 });
        await searchInput.type(searchQuery, { delay: 50 });
        await searchInput.press("Enter");

        // Wait for results to load
        await new Promise(r => setTimeout(r, 5000));

        // Try to find and click the best matching result, then "Add to Estimate"
        const added = await ptFrame.evaluate((partNumber, brand) => {
          // Look for results list items
          const items = document.querySelectorAll("[class*='result'], [class*='product'], [class*='item'], tr, li");
          let bestMatch = null;

          for (const item of items) {
            const text = (item.textContent || "").toLowerCase();
            // Match by part number if available
            if (partNumber && text.includes(partNumber.toLowerCase())) {
              bestMatch = item;
              break;
            }
            // Match by brand
            if (brand && text.includes(brand.toLowerCase()) && text.includes("$")) {
              bestMatch = item;
              break;
            }
          }

          // If no specific match, take first item with a price
          if (!bestMatch) {
            for (const item of items) {
              if ((item.textContent || "").includes("$") && item.querySelector("button, [role='button'], a")) {
                bestMatch = item;
                break;
              }
            }
          }

          if (!bestMatch) return false;

          // Click the item or its "Add" button
          const addBtn = bestMatch.querySelector("button, [role='button']");
          if (addBtn) {
            const btnText = (addBtn.textContent || "").toLowerCase();
            if (btnText.includes("add") || btnText.includes("select") || btnText.includes("cart")) {
              addBtn.click();
              return true;
            }
          }

          // Click the item itself to expand it
          bestMatch.click();
          return "clicked_item";
        }, sel.partNumber || "", sel.brand || "");

        if (added === true) {
          addedParts.push({ partType, partNumber: sel.partNumber, brand: sel.brand });
          console.log(`${LOG} Part added: ${searchQuery}`);
          await new Promise(r => setTimeout(r, 2000));
          continue;
        }

        if (added === "clicked_item") {
          // Item was clicked, now look for "Add to Estimate" button
          await new Promise(r => setTimeout(r, 2000));
          const addResult = await ptFrame.evaluate(() => {
            const buttons = document.querySelectorAll("button, [role='button']");
            for (const btn of buttons) {
              const txt = (btn.textContent || "").toLowerCase();
              if (txt.includes("add to estimate") || txt.includes("add to order") || txt.includes("select") || txt.includes("add part")) {
                btn.click();
                return true;
              }
            }
            return false;
          });

          if (addResult) {
            addedParts.push({ partType, partNumber: sel.partNumber, brand: sel.brand });
            console.log(`${LOG} Part added (2-step): ${searchQuery}`);
            await new Promise(r => setTimeout(r, 2000));
            continue;
          }
        }

        console.log(`${LOG} Could not add part: ${searchQuery}`);
        failedParts.push({ part: partItem, reason: "no add button found" });
      } catch (partErr) {
        console.log(`${LOG} Error adding part "${searchQuery}": ${partErr.message}`);
        failedParts.push({ part: partItem, reason: partErr.message });
      }
    }
  } catch (err) {
    console.error(`${LOG} addPartsThroughAutoLeap error: ${err.message}`);
    // Mark remaining parts as failed
    const alreadyProcessed = addedParts.length + failedParts.length;
    for (let i = alreadyProcessed; i < parts.length; i++) {
      failedParts.push({ part: parts[i], reason: err.message });
    }
  } finally {
    if (browser) browser.disconnect();
  }

  console.log(`${LOG} PartsTech browser: ${addedParts.length} added, ${failedParts.length} failed`);
  return { addedCount: addedParts.length, failedCount: failedParts.length, addedParts, failedParts };
}

/**
 * Build an AutoLeap estimate using the native PartsTech workflow.
 *
 * Hybrid approach:
 *   1. Create estimate shell via REST API (labor only — fast, reliable)
 *   2. Open estimate in browser, add parts through AutoLeap's embedded PartsTech
 *      (AutoLeap applies its markup matrix → retail pricing)
 *   3. Re-fetch estimate via REST to get final totals with markup applied
 *
 * Returns same shape as buildEstimate() so orchestrator interface doesn't change.
 */
async function buildEstimateNative({ customerName, phone, vehicleYear, vehicleMake, vehicleModel, vin, diagnosis, parts, laborHoursOverride }) {
  try {
    // 1. Create estimate via REST with labor only (no parts)
    console.log(`${LOG} buildEstimateNative: creating labor-only estimate shell...`);
    const apiResult = await buildEstimate({
      customerName, phone, vehicleYear, vehicleMake, vehicleModel, vin,
      diagnosis,
      parts: [],                    // No parts via API — they go through browser
      laborHoursOverride,
      partsMarkupPercent: 0,        // irrelevant since no parts
    });

    if (!apiResult.success) {
      log.error("buildEstimateNative: shell estimate failed", { error: apiResult.error });
      return apiResult;
    }

    console.log(`${LOG} Shell estimate created: ${apiResult.estimateCode} (${apiResult.estimateId})`);

    // 2. Filter to parts that have selections (actual products found)
    const partsToAdd = (parts || []).filter(p => p.selected);
    if (partsToAdd.length === 0) {
      console.log(`${LOG} No parts to add via browser — returning labor-only estimate`);
      return { ...apiResult, partsAddedViaUI: 0, partsFailedViaUI: 0, pricingSource: "autoleap-native" };
    }

    // 3. Open estimate in browser and add parts via PartsTech
    console.log(`${LOG} Adding ${partsToAdd.length} parts via AutoLeap PartsTech browser...`);
    const partsResult = await addPartsThroughAutoLeap(apiResult.estimateId, partsToAdd);

    // 4. Re-fetch estimate from API to get final totals (with AutoLeap markup)
    console.log(`${LOG} Re-fetching estimate for final totals...`);
    const token = await getToken();
    const finalData = await getEstimate(token, apiResult.estimateId);

    // Extract totals from the re-fetched estimate
    const grandTotal = finalData?.grandTotal ?? finalData?.total ?? null;
    const totalParts = finalData?.totalParts ?? finalData?.partsTotal ?? null;
    const totalLabor = finalData?.totalLabor ?? finalData?.laborTotal ?? apiResult.totalLabor;

    // Use AutoLeap totals if they're > 0, otherwise fall back to original
    const useAutoLeapTotals = (grandTotal != null && grandTotal > 0);

    const result = {
      ...apiResult,
      total:       useAutoLeapTotals ? grandTotal : apiResult.total,
      totalParts:  (totalParts != null && totalParts > 0) ? totalParts : 0,
      totalLabor:  (totalLabor != null && totalLabor > 0) ? totalLabor : apiResult.totalLabor,
      partsAddedViaUI:  partsResult.addedCount,
      partsFailedViaUI: partsResult.failedCount,
      pricingSource:    "autoleap-native",   // markup applied by AutoLeap, not code
    };

    console.log(`${LOG} buildEstimateNative complete: total=$${result.total}, parts=$${result.totalParts}, labor=$${result.totalLabor}`);
    console.log(`${LOG}   Parts via UI: ${partsResult.addedCount} added, ${partsResult.failedCount} failed`);

    return result;
  } catch (err) {
    log.error("buildEstimateNative failed", { error: err.message });
    return { success: false, error: err.message };
  }
}

module.exports = {
  buildEstimate,
  buildEstimateNative,
  getToken,
  searchCustomer,
  createCustomer,
  createEstimate,
  getEstimate,
  buildServices,
  downloadEstimatePDF,
  addPartsThroughAutoLeap,
};
