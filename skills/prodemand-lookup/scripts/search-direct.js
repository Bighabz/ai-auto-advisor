/**
 * ProDemand Direct Browser Search — Puppeteer (bypasses OpenClaw gateway)
 *
 * Connects directly to Chrome's remote debugging port to avoid
 * the 20s OpenClaw gateway timeout. Used when Chrome runs through
 * a proxy (PAC file) for ProDemand access.
 *
 * Exports: search()
 */

const LOG = "[prodemand-direct]";
const PRODEMAND_URL = process.env.PRODEMAND_URL || "https://www.prodemand.com";
const PRODEMAND_USERNAME = process.env.PRODEMAND_USERNAME;
const PRODEMAND_PASSWORD = process.env.PRODEMAND_PASSWORD;
const CHROME_DEBUG_PORT = 18800;

let puppeteer;
try {
  puppeteer = require("puppeteer-core");
} catch {
  puppeteer = null;
}

/**
 * Connect to Chrome via CDP and get a page.
 */
async function getPage() {
  if (!puppeteer) throw new Error("puppeteer-core not installed");

  const browser = await puppeteer.connect({
    browserURL: `http://127.0.0.1:${CHROME_DEBUG_PORT}`,
    defaultViewport: { width: 1280, height: 900 },
  });

  // Use existing page or create new one
  const pages = await browser.pages();
  const page = pages.length > 0 ? pages[0] : await browser.newPage();
  page.setDefaultTimeout(45000);
  page.setDefaultNavigationTimeout(45000);
  return { browser, page };
}

/**
 * Login to ProDemand.
 */
async function login(page) {
  console.log(`${LOG} Navigating to ProDemand...`);
  await page.goto(PRODEMAND_URL, { waitUntil: "domcontentloaded", timeout: 30000 });

  // Dismiss cookie consent if present
  try {
    const cookieBtn = await page.$('button[id*="cookie"], button[class*="cookie"], [aria-label*="cookie" i], [aria-label*="accept" i]');
    if (cookieBtn) {
      console.log(`${LOG} Dismissing cookie consent...`);
      await cookieBtn.click();
      await page.waitForNetworkIdle({ timeout: 5000 }).catch(() => {});
    }
  } catch {}

  // Check if already logged in
  const pageText = await page.evaluate(() => document.body.innerText.toLowerCase());
  const authKeywords = ["real fix", "labor", "vehicle", "repair", "dashboard"];
  if (authKeywords.some((k) => pageText.includes(k))) {
    console.log(`${LOG} Already logged in`);
    return true;
  }

  // Find and click Login button on landing page
  try {
    const loginLink = await page.$('a[href*="login"], a[href*="signin"], button:has-text("Login"), button:has-text("Sign In")');
    if (loginLink) {
      console.log(`${LOG} Clicking Login link...`);
      await loginLink.click();
      await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
    }
  } catch {}

  // Look for login form
  const usernameField = await page.$('input[type="text"], input[name*="user"], input[name*="login"], input[id*="user"], input[id*="login"]');
  const passwordField = await page.$('input[type="password"]');

  if (usernameField && passwordField) {
    console.log(`${LOG} Login form found — authenticating...`);
    await usernameField.click({ clickCount: 3 });
    await usernameField.type(PRODEMAND_USERNAME, { delay: 30 });
    await passwordField.click({ clickCount: 3 });
    await passwordField.type(PRODEMAND_PASSWORD, { delay: 30 });

    // Submit
    const submitBtn = await page.$('button[type="submit"], input[type="submit"], button:has-text("Login"), button:has-text("Sign In")');
    if (submitBtn) {
      await submitBtn.click();
      await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
    } else {
      await passwordField.press("Enter");
      await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
    }

    // Check login result
    const postText = await page.evaluate(() => document.body.innerText.toLowerCase());
    if (authKeywords.some((k) => postText.includes(k))) {
      console.log(`${LOG} Login successful`);
      return true;
    }
    if (postText.includes("invalid") || postText.includes("incorrect") || postText.includes("failed")) {
      console.log(`${LOG} Login failed — invalid credentials`);
      return false;
    }
    console.log(`${LOG} Login result unclear — proceeding`);
    return true;
  }

  console.log(`${LOG} No login form found — page may have changed`);
  return false;
}

/**
 * Extract Real Fixes from the page.
 */
async function extractRealFixes(page) {
  try {
    const fixes = await page.evaluate(() => {
      const results = [];
      // Look for Real Fix entries in the DOM
      const elements = document.querySelectorAll("[class*='fix'], [class*='Fix'], [data-type*='fix']");
      for (const el of elements) {
        const text = el.innerText;
        if (text.length > 20 && text.length < 2000) {
          results.push({ symptom: text.substring(0, 200), source: "prodemand" });
        }
      }
      // Also scan for structured text patterns
      const allText = document.body.innerText;
      const fixPattern = /(?:symptom|complaint|condition)[:\s]*([^\n]+)/gi;
      let match;
      while ((match = fixPattern.exec(allText)) !== null && results.length < 10) {
        results.push({ symptom: match[1].trim().substring(0, 200), source: "prodemand" });
      }
      return results;
    });
    return fixes;
  } catch {
    return [];
  }
}

/**
 * Extract labor times from the page.
 */
async function extractLaborTimes(page) {
  try {
    return await page.evaluate(() => {
      const times = [];
      const text = document.body.innerText;
      const hourPattern = /([^\n]{5,80}?)\s+(\d{1,2}\.?\d*)\s*(?:hrs?|hours?)/gi;
      let match;
      while ((match = hourPattern.exec(text)) !== null && times.length < 10) {
        const hours = parseFloat(match[2]);
        if (hours >= 0.1 && hours <= 50) {
          times.push({ procedure: match[1].trim(), hours, source: "prodemand" });
        }
      }
      return times;
    });
  } catch {
    return [];
  }
}

/**
 * Main search function.
 */
async function search(params) {
  if (!PRODEMAND_USERNAME || !PRODEMAND_PASSWORD) {
    return { error: "ProDemand not configured — set PRODEMAND_USERNAME/PRODEMAND_PASSWORD" };
  }
  if (!puppeteer) {
    return { error: "puppeteer-core not installed" };
  }

  const { vin, year, make, model, engine, query } = params;
  console.log(`${LOG} Searching: ${year} ${make} ${model} — ${query}`);

  let browser;
  try {
    const conn = await getPage();
    browser = conn.browser;
    const page = conn.page;

    // Login
    const loggedIn = await login(page);
    if (!loggedIn) {
      return {
        source: "ProDemand (direct)",
        error: "Login failed",
        realFixes: [],
        laborTimes: [],
      };
    }

    // Try to find vehicle selector and search
    // Look for a search/VIN input
    const searchInput = await page.$('input[name*="search"], input[name*="vin"], input[placeholder*="VIN"], input[placeholder*="search"], input[id*="search"]');
    if (searchInput) {
      const searchTerm = vin || `${year} ${make} ${model} ${query}`;
      console.log(`${LOG} Searching: ${searchTerm}`);
      await searchInput.click({ clickCount: 3 });
      await searchInput.type(searchTerm, { delay: 20 });
      await searchInput.press("Enter");
      await page.waitForNetworkIdle({ timeout: 10000 }).catch(() => {});
    }

    // Extract results
    const realFixes = await extractRealFixes(page);
    const laborTimes = await extractLaborTimes(page);

    // Get page title and text summary for debugging
    const title = await page.title();
    const bodySnippet = await page.evaluate(() => document.body.innerText.substring(0, 500));

    console.log(`${LOG} Page: "${title}" — ${realFixes.length} fixes, ${laborTimes.length} labor times`);

    return {
      source: "ProDemand (direct)",
      vehicle: { vin, year, make, model, engine },
      query,
      realFixes,
      laborTimes,
      partNumbers: [],
      pageTitle: title,
      pageSummary: bodySnippet.substring(0, 200),
    };
  } catch (err) {
    console.error(`${LOG} Error: ${err.message}`);
    return {
      source: "ProDemand (direct)",
      error: err.message,
      realFixes: [],
      laborTimes: [],
    };
  } finally {
    if (browser) {
      browser.disconnect(); // Don't close — Chrome is a shared service
    }
  }
}

module.exports = { search };
