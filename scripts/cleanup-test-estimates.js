/**
 * Cleanup script — delete test estimates and test customer from AutoLeap.
 * Run on Pi: node scripts/cleanup-test-estimates.js
 */
const fs = require("fs");
const path = require("path");

// Load env
const envPath = path.join(__dirname, "..", "config", ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq > 0) {
      const key = trimmed.substring(0, eq).trim();
      const val = trimmed.substring(eq + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

const { getToken, searchCustomer } = require("../skills/autoleap-browser/scripts/autoleap-api");
const https = require("https");

function apiCall(method, apiPath, token) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: "api.myautoleap.com",
      path: "/api/v1" + apiPath,
      method,
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "authorization": token,
        "origin": "https://app.myautoleap.com",
      },
    }, (res) => {
      let data = "";
      res.on("data", (c) => data += c);
      res.on("end", () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, raw: data.substring(0, 200) }); }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

(async () => {
  console.log("=== AUTOLEAP CLEANUP ===\n");

  const token = await getToken();
  if (!token) { console.log("No token — cannot clean up"); return; }

  // Find test customer
  const cust = await searchCustomer(token, "555-0000");
  if (!cust?._id) { console.log("Test customer not found — nothing to clean"); return; }
  console.log(`Found test customer: ${cust.firstName} ${cust.lastName} (${cust._id})`);

  // Get all estimates for this customer
  const estResp = await apiCall("PUT", `/customers/${cust._id}/estimates?limit=50&page=1&sortBy=createdAt&sortDirection=-1`, token);
  const estimates = estResp.data?.response?.list || estResp.data?.list || [];
  console.log(`Found ${estimates.length} estimate(s) for this customer\n`);

  if (estimates.length === 0) {
    console.log("No estimates to delete");
    return;
  }

  // Delete each estimate
  let deleted = 0;
  for (const est of estimates) {
    const id = est._id;
    const code = est.code || est.estimateNumber || "?";
    try {
      const res = await apiCall("DELETE", `/estimates/${id}`, token);
      if (res.status >= 200 && res.status < 300) {
        console.log(`  Deleted RO#${code} (${id})`);
        deleted++;
      } else {
        console.log(`  Failed RO#${code}: ${res.status} ${JSON.stringify(res.data || res.raw || "").substring(0, 100)}`);
      }
    } catch (e) {
      console.log(`  Error RO#${code}: ${e.message}`);
    }
  }

  console.log(`\nDeleted ${deleted}/${estimates.length} estimates`);

  // Delete the test customer
  try {
    const custDel = await apiCall("DELETE", `/customers/${cust._id}`, token);
    if (custDel.status >= 200 && custDel.status < 300) {
      console.log(`Deleted test customer: ${cust.firstName} ${cust.lastName}`);
    } else {
      console.log(`Customer delete: ${custDel.status} (may have remaining linked records)`);
    }
  } catch (e) {
    console.log(`Customer delete failed: ${e.message}`);
  }

  console.log("\n=== CLEANUP DONE ===");
})();
