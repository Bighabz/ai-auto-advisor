/**
 * AutoLeap — Partner API Integration
 *
 * Creates and manages repair estimates in AutoLeap.
 * API Docs: https://developers.myautoleap.com/
 */

const AUTOLEAP_API_URL =
  process.env.AUTOLEAP_API_URL || "https://partnerapi.myautoleap.com/v2";
const AUTOLEAP_PARTNER_ID = process.env.AUTOLEAP_PARTNER_ID;
const AUTOLEAP_AUTH_KEY = process.env.AUTOLEAP_AUTH_KEY;

let accessToken = null;
let tokenExpiry = 0;

/**
 * Authenticate and get access token
 */
async function authenticate() {
  if (accessToken && Date.now() < tokenExpiry) {
    return accessToken;
  }

  const fetch = (await import("node-fetch")).default;
  const response = await fetch(`${AUTOLEAP_API_URL}/partners/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      partnerId: AUTOLEAP_PARTNER_ID,
      authKey: AUTOLEAP_AUTH_KEY,
    }),
  });

  if (!response.ok) {
    throw new Error(`AutoLeap auth failed: ${response.status}`);
  }

  const data = await response.json();
  accessToken = data.accessToken;
  tokenExpiry = Date.now() + 3500 * 1000; // refresh before 1hr expiry
  console.log("[autoleap] Authenticated.");
  return accessToken;
}

/**
 * Generic API request helper
 */
async function apiRequest(method, path, body = null) {
  const fetch = (await import("node-fetch")).default;
  const token = await authenticate();

  const options = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  };

  if (body) options.body = JSON.stringify(body);

  const response = await fetch(`${AUTOLEAP_API_URL}${path}`, options);

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`AutoLeap API ${method} ${path}: ${response.status} — ${errText}`);
  }

  return response.json();
}

/**
 * Find or create a customer
 */
async function findOrCreateCustomer({ name, phone, email }) {
  // Try to find existing customer by phone
  try {
    const results = await apiRequest("GET", `/partners/customers?phone=${encodeURIComponent(phone)}`);
    if (results.data && results.data.length > 0) {
      console.log(`[autoleap] Found existing customer: ${results.data[0].id}`);
      return results.data[0];
    }
  } catch {
    // Customer not found — create new
  }

  const customer = await apiRequest("POST", "/partners/customers", {
    name,
    phone,
    email,
  });
  console.log(`[autoleap] Created customer: ${customer.id}`);
  return customer;
}

/**
 * Find or create a vehicle
 */
async function findOrCreateVehicle({ customerId, vin, year, make, model, mileage }) {
  try {
    const results = await apiRequest("GET", `/partners/vehicles?vin=${vin}`);
    if (results.data && results.data.length > 0) {
      return results.data[0];
    }
  } catch {
    // Not found
  }

  const vehicle = await apiRequest("POST", "/partners/vehicles", {
    customerId,
    vin,
    year,
    make,
    model,
    mileage,
  });
  console.log(`[autoleap] Created vehicle: ${vehicle.id}`);
  return vehicle;
}

/**
 * Create an estimate with line items
 * @param {object} params
 * @param {string} params.customerId
 * @param {string} params.vehicleId
 * @param {Array} params.lineItems - [{description, laborHours, laborRate, partsCost, partsMarkup}]
 * @param {object} params.shopConfig - Shop config (rates, markup, tax)
 * @returns {object} Created estimate
 */
async function createEstimate({ customerId, vehicleId, lineItems, shopConfig }) {
  // Create the estimate shell
  const estimate = await apiRequest("POST", "/partners/estimates", {
    customerId,
    vehicleId,
    status: "draft",
  });

  const estimateId = estimate.id;
  let totalLabor = 0;
  let totalParts = 0;

  // Add line items
  for (const item of lineItems) {
    const laborCost = (item.laborHours || 0) * (shopConfig.shop.laborRatePerHour || 135);
    const partsWithMarkup =
      (item.partsCost || 0) * (1 + (shopConfig.markup.partsMarkupPercent || 40) / 100);

    await apiRequest("POST", `/partners/estimates/${estimateId}/items`, {
      description: item.description,
      laborHours: item.laborHours,
      laborCost,
      partsCost: partsWithMarkup,
      partNumber: item.partNumber || "",
    });

    totalLabor += laborCost;
    totalParts += partsWithMarkup;
  }

  // Calculate totals
  const shopSupplies = Math.min(
    (totalLabor + totalParts) * (shopConfig.shop.shopSuppliesPercent / 100),
    shopConfig.shop.shopSuppliesCap
  );
  const subtotal = totalLabor + totalParts + shopSupplies;
  const tax = subtotal * shopConfig.shop.taxRate;
  const total = subtotal + tax;

  return {
    estimateId,
    totalLabor: totalLabor.toFixed(2),
    totalParts: totalParts.toFixed(2),
    shopSupplies: shopSupplies.toFixed(2),
    tax: tax.toFixed(2),
    total: total.toFixed(2),
    status: "draft",
  };
}

module.exports = {
  authenticate,
  findOrCreateCustomer,
  findOrCreateVehicle,
  createEstimate,
};
