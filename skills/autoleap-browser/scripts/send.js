/**
 * AutoLeap Estimate Delivery
 *
 * Send estimates to customers and check approval status
 * via AutoLeap's web UI.
 */

const browser = require("../../shared/browser");
const { ensureLoggedIn } = require("./login");

const LOG = "[autoleap-browser]";

/**
 * Send an estimate to the customer via AutoLeap.
 *
 * @param {{ estimateId?: string, method?: "email"|"sms"|"both" }} params
 * @returns {{ success: boolean, sentVia?: string, error?: string }}
 */
function sendEstimate({ estimateId, method }) {
  const loginResult = ensureLoggedIn();
  if (!loginResult.success) return loginResult;

  try {
    let snapshot = browser.takeSnapshot();
    let elements = browser.parseSnapshot(snapshot);

    // If we have an estimate ID and we're not already on it, navigate
    if (estimateId) {
      const onEstimate = browser.findRef(elements, estimateId);
      if (!onEstimate) {
        // Navigate to estimates list
        const estimatesNav = browser.findRef(elements, "estimates");
        if (estimatesNav) {
          browser.clickRef(estimatesNav);
          browser.waitForLoad("networkidle");

          // Search for the estimate
          snapshot = browser.takeSnapshot();
          elements = browser.parseSnapshot(snapshot);
          const searchRef = browser.findRefByType(elements, "input", "search") ||
                            browser.findRef(elements, "search");
          if (searchRef) {
            browser.clickRef(searchRef);
            browser.typeInRef(searchRef, estimateId, true);
            browser.waitForLoad("networkidle");

            snapshot = browser.takeSnapshot();
            elements = browser.parseSnapshot(snapshot);
            const estRef = browser.findRef(elements, estimateId);
            if (estRef) {
              browser.clickRef(estRef);
              browser.waitForLoad("networkidle");
            }
          }
        }
      }
    }

    // Find and click "Send" button
    snapshot = browser.takeSnapshot();
    elements = browser.parseSnapshot(snapshot);

    const sendBtn = browser.findRef(elements, "send estimate") ||
                    browser.findRef(elements, "send to customer") ||
                    browser.findRefByType(elements, "button", "send");

    if (!sendBtn) {
      return { success: false, error: "Could not find 'Send Estimate' button" };
    }

    browser.clickRef(sendBtn);
    browser.waitForLoad("networkidle");

    // Handle delivery method selection
    snapshot = browser.takeSnapshot();
    elements = browser.parseSnapshot(snapshot);

    const sendMethod = method || "both";
    let sentVia = "unknown";

    if (sendMethod === "email" || sendMethod === "both") {
      const emailOpt = browser.findRef(elements, "email");
      if (emailOpt) {
        browser.clickRef(emailOpt);
        sentVia = "email";
      }
    }

    if (sendMethod === "sms" || sendMethod === "both") {
      const smsOpt = browser.findRef(elements, "sms") ||
                     browser.findRef(elements, "text");
      if (smsOpt) {
        browser.clickRef(smsOpt);
        sentVia = sendMethod === "both" ? "email+sms" : "sms";
      }
    }

    // Confirm send
    snapshot = browser.takeSnapshot();
    elements = browser.parseSnapshot(snapshot);

    const confirmBtn = browser.findRefByType(elements, "button", "send") ||
                       browser.findRefByType(elements, "button", "confirm") ||
                       browser.findRefByType(elements, "button", "yes");
    if (confirmBtn) {
      browser.clickRef(confirmBtn);
      browser.waitForLoad("networkidle");
    }

    console.log(`${LOG} Estimate sent via ${sentVia}`);
    return { success: true, sentVia, estimateId };
  } catch (err) {
    return { success: false, error: `Send estimate failed: ${err.message}` };
  }
}

/**
 * Check the status of an estimate (draft/sent/viewed/approved/declined).
 *
 * @param {string} estimateId
 * @returns {{ success: boolean, status?: string, error?: string }}
 */
function checkEstimateStatus(estimateId) {
  const loginResult = ensureLoggedIn();
  if (!loginResult.success) return loginResult;

  try {
    // Navigate to the estimate
    let snapshot = browser.takeSnapshot();
    let elements = browser.parseSnapshot(snapshot);

    const estimatesNav = browser.findRef(elements, "estimates");
    if (estimatesNav) {
      browser.clickRef(estimatesNav);
      browser.waitForLoad("networkidle");

      snapshot = browser.takeSnapshot();
      elements = browser.parseSnapshot(snapshot);
      const searchRef = browser.findRefByType(elements, "input", "search") ||
                        browser.findRef(elements, "search");
      if (searchRef) {
        browser.clickRef(searchRef);
        browser.typeInRef(searchRef, estimateId, true);
        browser.waitForLoad("networkidle");
      }
    }

    // Read status
    snapshot = browser.takeSnapshot();
    elements = browser.parseSnapshot(snapshot);

    const statusKeywords = ["draft", "sent", "viewed", "approved", "declined", "accepted", "rejected"];
    let status = "unknown";

    for (const kw of statusKeywords) {
      if (browser.findRef(elements, kw)) {
        status = kw;
        break;
      }
    }

    console.log(`${LOG} Estimate ${estimateId} status: ${status}`);
    return { success: true, status, estimateId };
  } catch (err) {
    return { success: false, error: `Status check failed: ${err.message}` };
  }
}

module.exports = { sendEstimate, checkEstimateStatus };
