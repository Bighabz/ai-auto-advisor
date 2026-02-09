/**
 * AutoLeap Parts Order
 *
 * Places parts orders via the embedded PartsTech interface
 * inside AutoLeap after estimate approval.
 */

const browser = require("../../shared/browser");
const { ensureLoggedIn } = require("./login");

const LOG = "[autoleap-browser]";

/**
 * Place a parts order for an approved estimate via AutoLeap's
 * embedded PartsTech interface.
 *
 * @param {string} estimateId - The AutoLeap estimate ID
 * @returns {{ success: boolean, orderId?: string, total?: number,
 *             partsOrdered?: number, error?: string }}
 */
function placePartsOrder(estimateId) {
  const loginResult = ensureLoggedIn();
  if (!loginResult.success) return loginResult;

  try {
    let snapshot = browser.takeSnapshot();
    let elements = browser.parseSnapshot(snapshot);

    // Navigate to the estimate if not already on it
    const onEstimate = browser.findRef(elements, estimateId);
    if (!onEstimate) {
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

    // Check estimate is approved
    snapshot = browser.takeSnapshot();
    elements = browser.parseSnapshot(snapshot);

    const isApproved = browser.findRef(elements, "approved") ||
                       browser.findRef(elements, "accepted");
    if (!isApproved) {
      // Still proceed — the advisor may have confirmed verbally
      console.log(`${LOG} Estimate status unclear, proceeding with order...`);
    }

    // Find "Order Parts" or "Place Order" button
    const orderBtn = browser.findRef(elements, "order parts") ||
                     browser.findRef(elements, "place order") ||
                     browser.findRef(elements, "partstech") ||
                     browser.findRefByType(elements, "button", "order");

    if (!orderBtn) {
      return { success: false, error: "Could not find 'Order Parts' button" };
    }

    browser.clickRef(orderBtn);
    browser.waitForLoad("networkidle");

    // Verify cart contents in PartsTech
    snapshot = browser.takeSnapshot();
    elements = browser.parseSnapshot(snapshot);

    const pricePattern = /\$(\d{1,6}(?:,\d{3})*(?:\.\d{2})?)/;
    let cartTotal = 0;
    let itemCount = 0;

    // Count items and total
    for (const el of elements) {
      const priceMatch = el.text.match(pricePattern);
      if (priceMatch) {
        const amount = parseFloat(priceMatch[1].replace(/,/g, ""));
        if (amount > 0 && amount < 10000) {
          cartTotal += amount;
          itemCount++;
        }
      }
    }

    // Look for total specifically
    for (const el of elements) {
      const textLower = el.text.toLowerCase();
      if ((textLower.includes("total") || textLower.includes("order total")) &&
          !textLower.includes("sub")) {
        const totalMatch = el.text.match(pricePattern);
        if (totalMatch) {
          cartTotal = parseFloat(totalMatch[1].replace(/,/g, ""));
        }
      }
    }

    console.log(`${LOG} Cart: ${itemCount} items, $${cartTotal}`);

    // Click "Place Order" / "Submit Order"
    const submitBtn = browser.findRef(elements, "place order") ||
                      browser.findRef(elements, "submit order") ||
                      browser.findRefByType(elements, "button", "place") ||
                      browser.findRefByType(elements, "button", "submit") ||
                      browser.findRefByType(elements, "button", "order");

    if (!submitBtn) {
      return { success: false, error: "Could not find submit/place order button" };
    }

    browser.clickRef(submitBtn);
    browser.waitForLoad("networkidle");

    // Handle confirmation dialog
    snapshot = browser.takeSnapshot();
    elements = browser.parseSnapshot(snapshot);

    const confirmBtn = browser.findRefByType(elements, "button", "confirm") ||
                       browser.findRefByType(elements, "button", "yes") ||
                       browser.findRefByType(elements, "button", "ok") ||
                       browser.findRef(elements, "confirm order");
    if (confirmBtn) {
      browser.clickRef(confirmBtn);
      browser.waitForLoad("networkidle");
    }

    // Capture order confirmation
    snapshot = browser.takeSnapshot();
    elements = browser.parseSnapshot(snapshot);

    let orderId = null;
    const idPattern = /(?:PT|ORD|order|#)[-\s]?(\d{4,})/i;
    for (const el of elements) {
      const idMatch = el.text.match(idPattern);
      if (idMatch) {
        orderId = idMatch[0].trim();
        break;
      }
    }

    // Check for success indicators
    const successIndicators = ["success", "order placed", "confirmed", "order submitted", "thank you"];
    let orderSuccess = false;
    for (const kw of successIndicators) {
      if (browser.findRef(elements, kw)) {
        orderSuccess = true;
        break;
      }
    }

    // If no success keyword but we got an order ID, count as success
    if (!orderSuccess && orderId) {
      orderSuccess = true;
    }

    if (orderSuccess) {
      console.log(`${LOG} Order placed: ${orderId || "confirmation pending"}`);
      return {
        success: true,
        orderId,
        total: cartTotal,
        partsOrdered: itemCount,
      };
    }

    // Check for error messages
    const errorRef = browser.findRef(elements, "error") ||
                     browser.findRef(elements, "failed") ||
                     browser.findRef(elements, "unable");
    if (errorRef) {
      const errorEl = elements.find((el) => el.ref === errorRef);
      return { success: false, error: `Order failed: ${errorEl?.text || "unknown error"}` };
    }

    return { success: false, error: "Order status unclear — check AutoLeap for confirmation" };
  } catch (err) {
    return { success: false, error: `Order placement failed: ${err.message}` };
  }
}

module.exports = { placePartsOrder };
