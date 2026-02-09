/**
 * AutoLeap Browser Login
 *
 * Handles authentication to app.myautoleap.com using
 * the shared browser module (OpenClaw).
 *
 * Env vars: AUTOLEAP_EMAIL, AUTOLEAP_PASSWORD
 */

const browser = require("../../shared/browser");

const LOG = "[autoleap-browser]";
const AUTOLEAP_URL = "https://app.myautoleap.com";
const AUTOLEAP_EMAIL = process.env.AUTOLEAP_EMAIL;
const AUTOLEAP_PASSWORD = process.env.AUTOLEAP_PASSWORD;

const AUTH_KEYWORDS = ["estimates", "customers", "dashboard", "appointments", "invoice"];

/**
 * Check if we're currently logged in to AutoLeap.
 * @returns {boolean}
 */
function isLoggedIn() {
  try {
    const snapshot = browser.takeSnapshot();
    const elements = browser.parseSnapshot(snapshot);
    return browser.isAuthenticated(elements, AUTH_KEYWORDS);
  } catch {
    return false;
  }
}

/**
 * Ensure we are logged in to AutoLeap.
 * Navigates to AutoLeap, checks session, logs in if needed.
 *
 * @returns {{ success: boolean, error?: string }}
 */
function ensureLoggedIn() {
  if (!AUTOLEAP_EMAIL || !AUTOLEAP_PASSWORD) {
    return { success: false, error: "AutoLeap not configured — set AUTOLEAP_EMAIL and AUTOLEAP_PASSWORD" };
  }

  try {
    const result = browser.ensureLoggedIn(
      AUTOLEAP_URL,
      AUTOLEAP_EMAIL,
      AUTOLEAP_PASSWORD,
      LOG,
      AUTH_KEYWORDS
    );
    return result;
  } catch (err) {
    return { success: false, error: `AutoLeap login failed: ${err.message}` };
  }
}

module.exports = { ensureLoggedIn, isLoggedIn, AUTOLEAP_URL, AUTH_KEYWORDS };
