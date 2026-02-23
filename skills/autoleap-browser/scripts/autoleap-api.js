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

const LOG = "[autoleap-api]";
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
    console.log(`${LOG} Using cached token`);
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
  console.log(`${LOG} Token acquired and cached`);
  return token;
}

// ─── Customer operations ──────────────────────────────────────────────────────

/**
 * Search for a customer by name or phone number.
 * Returns the first matching customer with { _id, fullName, phone, vehicles[] }
 * or null if not found.
 */
async function searchCustomer(token, query) {
  const res = await apiCall(
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

  const res = await apiCall("POST", "/customers", body, token);
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

  const res = await apiCall("POST", "/estimates", body, token);
  if (res.data?.response?._id) return res.data.response;
  throw new Error(`Failed to create estimate: ${JSON.stringify(res.data?.error || res.raw)}`);
}

/**
 * Get estimate by ID.
 */
async function getEstimate(token, estimateId) {
  const res = await apiCall("GET", `/estimates/${estimateId}`, null, token);
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
function buildServices(diagnosis, parts, laborHoursOverride) {
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

  // Labor source precedence: MOTOR override > AI repair_plan > default 1.5
  const motorHours = laborHoursOverride?.hours;
  const aiHours    = repairPlan?.labor?.hours;
  const laborHours = motorHours || aiHours || 1.5;
  const laborSource = motorHours ? `MOTOR(${motorHours}h)` : (aiHours ? `AI(${aiHours}h)` : "default(1.5h)");
  console.log(`${LOG} Labor source: ${laborSource}`);

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
      const partPrice = Number(sel.shopPrice || sel.price || sel.cost || 0);
      const partNum = sel.partNumber || sel.partNum || "";

      partItems.push({
        type: "part",
        title: (partDesc + (partNum ? ` — ${partNum}` : "")).substring(0, 100),
        pricingType: "flatFee",
        price: partPrice,
        count: 1,
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
  const totalPrice = allItems.reduce((sum, i) => sum + (i.price || 0), 0);

  services.push({
    title: serviceTitle.substring(0, 120),
    billableHours: laborHours,
    authorized: false,
    status: "new",
    includeInInvoice: true,
    items: allItems,
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
async function buildEstimate({ customerName, phone, vehicleYear, vehicleMake, vehicleModel, vin, diagnosis, parts, laborHoursOverride }) {
  try {
    // 1. Get auth token
    const token = await getToken();

    // 2. Find or create customer
    const searchQuery = phone || customerName;
    let customer = await searchCustomer(token, searchQuery);

    if (!customer) {
      console.log(`${LOG} Customer not found for "${searchQuery}", creating...`);
      const nameParts = (customerName || "Unknown Customer").trim().split(/\s+/);
      const firstName = nameParts[0];
      const lastName = nameParts.slice(1).join(" ") || "";
      customer = await createCustomer(token, { firstName, lastName, phone });
      console.log(`${LOG} Created customer: ${customer.fullName} (${customer._id})`);
    } else {
      console.log(`${LOG} Found customer: ${customer.fullName} (${customer._id})`);
    }

    const customerId = customer._id;

    // 3. Match vehicle (optional)
    let vehicleId = null;
    const vehicles = customer.vehicles || [];
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
    const services = buildServices(diagnosis, parts, laborHoursOverride);
    console.log(`${LOG} Built ${services.length} service(s) with ${services[0]?.items?.length || 0} item(s)`);

    // 5. Create estimate
    const estimate = await createEstimate(token, { customerId, vehicleId, services });
    console.log(`${LOG} Estimate created: ${estimate.code} (${estimate._id})`);

    // 6. Compute total from service items (API serviceTotal may be 0 initially)
    const total = services.reduce(
      (sum, svc) => sum + svc.items.reduce((s, i) => s + (i.price || 0), 0),
      0
    );

    const vehicleDesc = vehicleYear && vehicleMake && vehicleModel
      ? `${vehicleYear} ${vehicleMake} ${vehicleModel}`
      : (customer.vehicles?.[0]?.name || null);

    return {
      success: true,
      estimateCode: estimate.code,
      estimateId: estimate._id,
      customerName: customer.fullName,
      vehicleDesc,
      total: Math.round(total * 100) / 100,
    };
  } catch (err) {
    console.error(`${LOG} buildEstimate error:`, err.message);
    return { success: false, error: err.message };
  }
}

module.exports = {
  buildEstimate,
  getToken,
  searchCustomer,
  createCustomer,
  createEstimate,
  getEstimate,
  buildServices,
};
