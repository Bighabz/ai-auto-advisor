/**
 * AutoLeap REST API Client
 *
 * Provides token management and lightweight API helpers.
 * Estimate creation is now handled by playbook.js (100% browser-driven).
 *
 * Retained endpoints:
 *   PUT  /customers/list          - Search customers
 *   POST /customers               - Create customer
 *   POST /estimates               - Create estimate shell (used by other flows)
 *   GET  /estimates/{id}          - Get estimate
 *   GET  /estimates/{id}/pdf      - Download estimate PDF
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

module.exports = {
  getToken,
  searchCustomer,
  createCustomer,
  createEstimate,
  getEstimate,
  downloadEstimatePDF,
};
