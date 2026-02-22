/**
 * PartsTech Order — Browser Automation via OpenClaw CDP
 *
 * Automates PartsTech (shop.partstech.com) for:
 *   - Setting vehicle context (VIN or Y/M/M)
 *   - Searching and selecting parts
 *   - Adding parts to cart
 *   - Viewing cart summary
 *   - Placing orders
 *
 * Uses OpenClaw's managed browser (Chrome DevTools Protocol) with
 * the snapshot system for AI-driven page navigation.
 *
 * Works alongside partstech-search (REST API) — API handles fast
 * pricing, this skill handles cart/ordering via browser.
 *
 * Main exports:
 *   addMultipleToCart({ vin, year, make, model, parts })
 *   getCartSummary()
 *   placeOrder()
 *   clearCart()
 */

const { execFileSync } = require("child_process");

// --- Config ---
const PARTSTECH_URL = process.env.PARTSTECH_URL || "https://shop.partstech.com";
const PARTSTECH_USERNAME = process.env.PARTSTECH_USERNAME;
const PARTSTECH_PASSWORD = process.env.PARTSTECH_PASSWORD;
const BROWSER_PROFILE = "openclaw";
const EXEC_TIMEOUT = 30000; // 30s timeout for browser commands

// --- Browser Helpers ---

/**
 * Run an OpenClaw browser CLI command with argument array (no shell).
 * Uses execFileSync to avoid command injection — arguments are passed
 * directly to the process, never interpolated into a shell string.
 *
 * @param {...string} args - Arguments after "openclaw browser --browser-profile <profile>"
 * @returns {string} Command stdout
 */
function browserCmd(...args) {
  return execFileSync(
    "openclaw",
    ["browser", "--browser-profile", BROWSER_PROFILE, ...args],
    { encoding: "utf-8", timeout: EXEC_TIMEOUT }
  );
}

/**
 * Ensure the OpenClaw managed browser is running.
 * Waits briefly after starting to let the browser initialize.
 */
function ensureBrowser() {
  try {
    const status = browserCmd("status");
    if (!status.includes("running")) {
      browserCmd("start");
      browserCmd("wait", "--load", "networkidle");
    }
  } catch {
    browserCmd("start");
    browserCmd("wait", "--load", "networkidle");
  }
}

/**
 * Take a snapshot of the current browser page.
 * @returns {string} Snapshot text
 */
function takeSnapshot() {
  return browserCmd("snapshot");
}

/**
 * Click an element by its snapshot ref number.
 * @param {number|string} ref
 */
function clickRef(ref) {
  browserCmd("click", String(ref));
}

/**
 * Type text into an element by ref.
 * Uses execFileSync argument array — text is passed as a separate
 * argument, never interpolated into a shell command string.
 *
 * @param {number|string} ref
 * @param {string} text
 * @param {boolean} [submit=false] - Press Enter after typing
 */
function typeInRef(ref, text, submit = false) {
  const args = ["type", String(ref), String(text)];
  if (submit) args.push("--submit");
  browserCmd(...args);
}

/**
 * Wait for the page to reach a specific load state.
 * @param {string} [state="networkidle"]
 */
function waitForLoad(state = "networkidle") {
  browserCmd("wait", "--load", state);
}

/**
 * Navigate to a URL in the managed browser.
 * Validates URL protocol before navigating.
 * @param {string} url
 */
function navigateTo(url) {
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`Invalid URL protocol: ${parsed.protocol}`);
  }
  browserCmd("navigate", url);
}

// --- Snapshot Parsing ---

/**
 * Parse OpenClaw snapshot text into element objects.
 *
 * Lines look like:
 *   [12] button "Search"
 *   [23] input "Year"
 *   [45] link "Honda"
 *
 * @param {string} snapshotText
 * @returns {Array<{ref: string, type: string, text: string}>}
 */
function parseSnapshot(snapshotText) {
  const elements = [];
  const lines = snapshotText.split("\n");

  for (const line of lines) {
    // Match: [ref] type "text"
    const match = line.match(/\[(\d+)\]\s+(?:(\w+)\s+)?["']([^"']*?)["']/);
    if (match) {
      elements.push({
        ref: match[1],
        type: match[2] || "unknown",
        text: match[3],
      });
      continue;
    }

    // Match: [ref] type unquotedText
    const matchUnquoted = line.match(/\[(\d+)\]\s+(\w+)\s+(.+)/);
    if (matchUnquoted) {
      elements.push({
        ref: matchUnquoted[1],
        type: matchUnquoted[2],
        text: matchUnquoted[3].trim(),
      });
    }
  }

  return elements;
}

/**
 * Find the first element ref matching partial text (case-insensitive).
 * @param {Array} elements
 * @param {string} textMatch
 * @returns {string|null}
 */
function findRef(elements, textMatch) {
  const needle = textMatch.toLowerCase();
  const found = elements.find((el) => el.text.toLowerCase().includes(needle));
  return found ? found.ref : null;
}

/**
 * Find all elements matching partial text (case-insensitive).
 * @param {Array} elements
 * @param {string} textMatch
 * @returns {Array}
 */
function findAllRefs(elements, textMatch) {
  const needle = textMatch.toLowerCase();
  return elements.filter((el) => el.text.toLowerCase().includes(needle));
}

/**
 * Find element by type and partial text.
 * @param {Array} elements
 * @param {string} type - Element type (button, input, link, etc.)
 * @param {string} textMatch
 * @returns {string|null}
 */
function findRefByType(elements, type, textMatch) {
  const needle = textMatch.toLowerCase();
  const found = elements.find(
    (el) => el.type === type && el.text.toLowerCase().includes(needle)
  );
  return found ? found.ref : null;
}

// --- Login ---

/**
 * Check if currently logged in to PartsTech.
 * Navigates to PartsTech if not already there, checks page state.
 *
 * @returns {boolean} true if logged in
 */
function checkLoginState() {
  try {
    const snapshot = takeSnapshot();
    const elements = parseSnapshot(snapshot);

    // If we see login/sign-in elements with a password field, we're not logged in
    const passwordRef = findRefByType(elements, "input", "password");
    const loginButton = findRefByType(elements, "button", "log in") ||
                        findRefByType(elements, "button", "sign in");

    if (passwordRef && loginButton) {
      return false;
    }

    // If we see authenticated-only elements (cart + search together), we're logged in
    const searchRef = findRef(elements, "search");
    const cartRef = findRef(elements, "cart");
    const dashRef = findRef(elements, "dashboard");

    // Require at least 2 positive signals to confirm logged-in state
    const positiveSignals = [searchRef, cartRef, dashRef].filter(Boolean).length;
    return positiveSignals >= 2;
  } catch {
    return false;
  }
}

/**
 * Perform login to PartsTech using stored credentials.
 * @returns {{ success: boolean, error?: string }}
 */
function performLogin() {
  if (!PARTSTECH_USERNAME?.trim() || !PARTSTECH_PASSWORD?.trim()) {
    return { success: false, error: "PARTSTECH_USERNAME and PARTSTECH_PASSWORD env vars required" };
  }

  try {
    const snapshot = takeSnapshot();
    const elements = parseSnapshot(snapshot);

    // Find username/email input
    let usernameRef = findRefByType(elements, "input", "email");
    if (!usernameRef) usernameRef = findRefByType(elements, "input", "username");
    if (!usernameRef) usernameRef = findRef(elements, "email");
    if (!usernameRef) usernameRef = findRef(elements, "username");

    if (!usernameRef) {
      return { success: false, error: "Could not find username/email input on login page" };
    }

    // Type username
    // Note: credentials appear briefly in the process argument list since
    // execFileSync passes them as CLI args. This is a known limitation of
    // CLI-based browser automation. Mitigate by restricting process visibility
    // on the host (e.g., hidepid on /proc, restricted Task Manager access).
    clickRef(usernameRef);
    typeInRef(usernameRef, PARTSTECH_USERNAME);

    // Find password input
    let passwordRef = findRefByType(elements, "input", "password");
    if (!passwordRef) passwordRef = findRef(elements, "password");

    if (!passwordRef) {
      return { success: false, error: "Could not find password input on login page" };
    }

    // Type password
    clickRef(passwordRef);
    typeInRef(passwordRef, PARTSTECH_PASSWORD);

    // Find and click login/submit button
    let submitRef = findRefByType(elements, "button", "sign in");
    if (!submitRef) submitRef = findRefByType(elements, "button", "log in");
    if (!submitRef) submitRef = findRefByType(elements, "button", "login");
    if (!submitRef) submitRef = findRefByType(elements, "button", "submit");

    if (!submitRef) {
      return { success: false, error: "Could not find login button" };
    }

    clickRef(submitRef);
    waitForLoad("networkidle");

    // Verify login succeeded
    const loggedIn = checkLoginState();
    if (!loggedIn) {
      return { success: false, error: "Login appeared to fail — still seeing login page" };
    }

    console.log("[partstech-order] Login successful");
    return { success: true };
  } catch (err) {
    return { success: false, error: `Login failed: ${err.message}` };
  }
}

/**
 * Ensure browser is running, on PartsTech, and logged in.
 * @returns {{ success: boolean, error?: string }}
 */
function ensureLoggedIn() {
  try {
    ensureBrowser();
    navigateTo(PARTSTECH_URL);
    waitForLoad("networkidle");

    if (checkLoginState()) {
      console.log("[partstech-order] Already logged in");
      return { success: true };
    }

    console.log("[partstech-order] Not logged in — authenticating...");
    return performLogin();
  } catch (err) {
    return { success: false, error: `Browser/navigation error: ${err.message}` };
  }
}

// --- Vehicle Selection ---

/**
 * Set the vehicle context in PartsTech.
 * Tries VIN first (most accurate), falls back to Year/Make/Model.
 *
 * @param {object} params
 * @param {string} [params.vin]
 * @param {number|string} [params.year]
 * @param {string} [params.make]
 * @param {string} [params.model]
 * @returns {{ success: boolean, error?: string }}
 */
function selectVehicle({ vin, year, make, model }) {
  try {
    let snapshot = takeSnapshot();
    let elements = parseSnapshot(snapshot);

    // Look for VIN input first (most accurate)
    if (vin) {
      let vinRef = findRef(elements, "vin");
      if (!vinRef) vinRef = findRef(elements, "vehicle");

      if (vinRef) {
        clickRef(vinRef);
        typeInRef(vinRef, vin, true);
        waitForLoad("networkidle");

        // Verify vehicle was accepted
        snapshot = takeSnapshot();
        if (snapshot.toLowerCase().includes(make?.toLowerCase() || "") ||
            snapshot.toLowerCase().includes(model?.toLowerCase() || "")) {
          console.log(`[partstech-order] Vehicle set via VIN: ${vin}`);
          return { success: true };
        }
      }
    }

    // Fallback: Year/Make/Model selection
    if (year && make && model) {
      // Re-snapshot after VIN attempt
      snapshot = takeSnapshot();
      elements = parseSnapshot(snapshot);

      // Look for year input/dropdown
      let yearRef = findRef(elements, "year");
      if (yearRef) {
        clickRef(yearRef);
        typeInRef(yearRef, String(year), true);
        waitForLoad("networkidle");

        // Re-snapshot for make
        snapshot = takeSnapshot();
        elements = parseSnapshot(snapshot);

        let makeRef = findRef(elements, "make");
        if (makeRef) {
          clickRef(makeRef);
          typeInRef(makeRef, make, true);
          waitForLoad("networkidle");

          // Re-snapshot for model
          snapshot = takeSnapshot();
          elements = parseSnapshot(snapshot);

          let modelRef = findRef(elements, "model");
          if (modelRef) {
            clickRef(modelRef);
            typeInRef(modelRef, model, true);
            waitForLoad("networkidle");

            console.log(`[partstech-order] Vehicle set: ${year} ${make} ${model}`);
            return { success: true };
          }
        }
      }
    }

    return { success: false, error: "Could not set vehicle — selectors not found" };
  } catch (err) {
    return { success: false, error: `Vehicle selection failed: ${err.message}` };
  }
}

// --- Part Search & Selection ---

/**
 * Search for a single part in the PartsTech browser UI.
 *
 * @param {string} searchTerm - Part name/type to search
 * @returns {Array<{ref: string, description: string, brand: string, price: string, supplier: string, inStock: boolean}>}
 */
function searchPartInBrowser(searchTerm) {
  try {
    let snapshot = takeSnapshot();
    let elements = parseSnapshot(snapshot);

    // Find search input
    let searchRef = findRef(elements, "search");
    if (!searchRef) searchRef = findRef(elements, "part");
    if (!searchRef) searchRef = findRef(elements, "find");
    if (!searchRef) searchRef = findRefByType(elements, "input", "");

    if (!searchRef) {
      console.error("[partstech-order] Could not find search input");
      return [];
    }

    // Clear existing search and type new term
    clickRef(searchRef);
    typeInRef(searchRef, searchTerm, true);
    waitForLoad("networkidle");

    // Parse results
    snapshot = takeSnapshot();
    elements = parseSnapshot(snapshot);

    // Extract part results — PartsTech typically shows parts as cards/rows
    // with brand, description, price, supplier info
    const results = [];
    const pricePattern = /\$(\d{1,6}(?:,\d{3})*(?:\.\d{2})?)/;

    for (const el of elements) {
      const priceMatch = el.text.match(pricePattern);
      if (priceMatch) {
        results.push({
          ref: el.ref,
          text: el.text,
          price: priceMatch[1],
        });
      }
    }

    console.log(`[partstech-order] Search "${searchTerm}": ${results.length} results with prices`);
    return results;
  } catch (err) {
    console.error(`[partstech-order] Search failed: ${err.message}`);
    return [];
  }
}

/**
 * Find the best matching result from browser search results.
 * Tries to match by part number first, then brand, then cheapest.
 *
 * @param {Array} searchResults - Results from searchPartInBrowser
 * @param {object} criteria - What to match
 * @param {string} [criteria.partNumber]
 * @param {string} [criteria.brand]
 * @param {string} [criteria.supplier]
 * @returns {object|null} Best matching result with ref
 */
function findBestMatch(searchResults, criteria) {
  if (!searchResults || searchResults.length === 0) return null;

  // Try exact part number match
  if (criteria.partNumber) {
    const byPartNum = searchResults.find((r) =>
      r.text.includes(criteria.partNumber)
    );
    if (byPartNum) return byPartNum;
  }

  // Try brand match
  if (criteria.brand) {
    const byBrand = searchResults.filter((r) =>
      r.text.toLowerCase().includes(criteria.brand.toLowerCase())
    );
    if (byBrand.length > 0) {
      // Among brand matches, pick cheapest (spread to avoid mutating input)
      return [...byBrand].sort((a, b) => parseFloat(a.price) - parseFloat(b.price))[0];
    }
  }

  // Try supplier match
  if (criteria.supplier) {
    const bySupplier = searchResults.find((r) =>
      r.text.toLowerCase().includes(criteria.supplier.toLowerCase())
    );
    if (bySupplier) return bySupplier;
  }

  // Default: cheapest (spread to avoid mutating input)
  return [...searchResults].sort((a, b) => parseFloat(a.price) - parseFloat(b.price))[0];
}

/**
 * Click "Add to Cart" for a specific part result.
 * After finding the part row, looks for a nearby add/cart button.
 *
 * @param {object} matchedResult - Result from findBestMatch with ref
 * @returns {boolean} true if add succeeded
 */
function clickAddToCart(matchedResult) {
  try {
    // Click the result row to expand/select it
    clickRef(matchedResult.ref);
    waitForLoad("networkidle");

    // Re-snapshot to find "Add to Cart" button
    const snapshot = takeSnapshot();
    const elements = parseSnapshot(snapshot);

    let addRef = findRefByType(elements, "button", "add to cart");
    if (!addRef) addRef = findRefByType(elements, "button", "add");
    if (!addRef) addRef = findRef(elements, "add to cart");
    if (!addRef) addRef = findRef(elements, "add to order");

    if (!addRef) {
      console.error("[partstech-order] Could not find 'Add to Cart' button");
      return false;
    }

    clickRef(addRef);
    waitForLoad("networkidle");

    console.log("[partstech-order] Part added to cart");
    return true;
  } catch (err) {
    console.error(`[partstech-order] Add to cart failed: ${err.message}`);
    return false;
  }
}

// --- Cart Management ---

/**
 * Navigate to the cart page and extract cart contents.
 *
 * @returns {object} Cart summary: { cart_items, total, item_count, all_in_stock, ready_to_order }
 */
async function getCartSummary() {
  const login = ensureLoggedIn();
  if (!login.success) {
    return { error: login.error, cart_items: [], total: 0 };
  }

  try {
    // Navigate to cart
    let snapshot = takeSnapshot();
    let elements = parseSnapshot(snapshot);

    let cartRef = findRef(elements, "cart");
    if (!cartRef) cartRef = findRef(elements, "basket");
    if (!cartRef) cartRef = findRef(elements, "order");

    if (cartRef) {
      clickRef(cartRef);
      waitForLoad("networkidle");
    }

    // Parse cart contents
    snapshot = takeSnapshot();
    elements = parseSnapshot(snapshot);

    const cartItems = [];
    const pricePattern = /\$(\d{1,6}(?:,\d{3})*(?:\.\d{2})?)/;

    // Look for cart item rows
    for (const el of elements) {
      const priceMatch = el.text.match(pricePattern);
      if (priceMatch && parseFloat(priceMatch[1]) > 0) {
        cartItems.push({
          description: el.text,
          price: parseFloat(priceMatch[1]),
          ref: el.ref,
        });
      }
    }

    // Look for total
    let total = 0;
    const totalElements = findAllRefs(elements, "total");
    for (const el of totalElements) {
      const totalMatch = el.text.match(pricePattern);
      if (totalMatch) {
        const val = parseFloat(totalMatch[1]);
        if (val > total) total = val;
      }
    }

    // If no explicit total, sum items
    if (total === 0) {
      total = cartItems.reduce((sum, item) => sum + item.price, 0);
    }

    // Check for out-of-stock warnings
    const outOfStock = findRef(elements, "out of stock") ||
                       findRef(elements, "unavailable") ||
                       findRef(elements, "backorder");

    const summary = {
      cart_items: cartItems.map(({ ref, ...item }) => item),
      total: Math.round(total * 100) / 100,
      item_count: cartItems.length,
      all_in_stock: !outOfStock,
      ready_to_order: cartItems.length > 0 && !outOfStock,
    };

    console.log(`[partstech-order] Cart: ${summary.item_count} items, $${summary.total}`);
    return summary;
  } catch (err) {
    console.error(`[partstech-order] Cart summary failed: ${err.message}`);
    return { error: `Cart summary failed: ${err.message}`, cart_items: [], total: 0 };
  }
}

/**
 * Clear all items from the PartsTech cart.
 *
 * @returns {{ success: boolean, error?: string }}
 */
async function clearCart() {
  const login = ensureLoggedIn();
  if (!login.success) {
    return { success: false, error: login.error };
  }

  try {
    // Navigate to cart
    let snapshot = takeSnapshot();
    let elements = parseSnapshot(snapshot);

    let cartRef = findRef(elements, "cart");
    if (cartRef) {
      clickRef(cartRef);
      waitForLoad("networkidle");
    }

    // Look for "clear cart" or "remove all" button
    snapshot = takeSnapshot();
    elements = parseSnapshot(snapshot);

    let clearRef = findRef(elements, "clear");
    if (!clearRef) clearRef = findRef(elements, "remove all");
    if (!clearRef) clearRef = findRef(elements, "empty cart");

    if (clearRef) {
      clickRef(clearRef);
      waitForLoad("networkidle");

      // Confirm if there's a confirmation dialog
      snapshot = takeSnapshot();
      elements = parseSnapshot(snapshot);
      const confirmRef = findRefByType(elements, "button", "confirm");
      if (!confirmRef) {
        const yesRef = findRefByType(elements, "button", "yes");
        if (yesRef) clickRef(yesRef);
      } else {
        clickRef(confirmRef);
      }
      waitForLoad("networkidle");

      console.log("[partstech-order] Cart cleared");
      return { success: true };
    }

    // Fallback: remove items one at a time
    let removeRef = findRef(elements, "remove");
    let removed = 0;
    while (removeRef) {
      clickRef(removeRef);
      waitForLoad("networkidle");
      removed++;

      snapshot = takeSnapshot();
      elements = parseSnapshot(snapshot);
      removeRef = findRef(elements, "remove");
    }

    if (removed > 0) {
      console.log(`[partstech-order] Removed ${removed} items from cart`);
      return { success: true };
    }

    return { success: false, error: "Could not find clear/remove buttons" };
  } catch (err) {
    return { success: false, error: `Clear cart failed: ${err.message}` };
  }
}

// --- Main Operations ---

/**
 * Add a single part to the PartsTech cart via browser.
 *
 * @param {object} params
 * @param {string} params.partType - Part name to search
 * @param {string} [params.position] - Position (e.g., "front", "bank 1")
 * @param {string} [params.partNumber] - Specific part number to match
 * @param {string} [params.brand] - Preferred brand
 * @param {string} [params.supplier] - Preferred supplier
 * @param {number} [params.qty=1] - Quantity
 * @returns {{ success: boolean, matched?: object, error?: string }}
 */
function addPartToCart({ partType, position, partNumber, brand, supplier, qty = 1 }) {
  // Build search term
  const searchTerm = position ? `${partType} ${position}` : partType;

  console.log(`[partstech-order] Adding to cart: ${searchTerm} (qty: ${qty})`);

  // Search
  const results = searchPartInBrowser(searchTerm);
  if (results.length === 0) {
    return { success: false, error: `No results found for "${searchTerm}"` };
  }

  // Match
  const match = findBestMatch(results, { partNumber, brand, supplier });
  if (!match) {
    return { success: false, error: `Could not match part criteria for "${searchTerm}"` };
  }

  // Set quantity before adding to cart (most UIs expect qty first)
  if (qty > 1) {
    try {
      // Click the result to expand it and look for quantity input
      clickRef(match.ref);
      waitForLoad("networkidle");

      const snapshot = takeSnapshot();
      const elements = parseSnapshot(snapshot);
      const qtyRef = findRef(elements, "qty") || findRef(elements, "quantity");
      if (qtyRef) {
        // Triple-click to select existing value, then type new qty
        clickRef(qtyRef);
        clickRef(qtyRef);
        clickRef(qtyRef);
        typeInRef(qtyRef, String(qty));
        waitForLoad("networkidle");
      }
    } catch {
      console.log(`[partstech-order] Could not set qty to ${qty} — may need manual adjustment`);
    }
  }

  // Add to cart
  const added = clickAddToCart(match);
  if (!added) {
    return { success: false, error: `Failed to add "${searchTerm}" to cart` };
  }

  return {
    success: true,
    matched: {
      description: match.text,
      price: match.price,
      partNumber: partNumber || null,
      brand: brand || null,
    },
  };
}

/**
 * Add multiple parts to the PartsTech cart for a complete repair job.
 *
 * Handles the full flow: login, set vehicle, search each part,
 * match to API results, add to cart.
 *
 * @param {object} params
 * @param {string} [params.vin] - Vehicle VIN
 * @param {number|string} [params.year] - Vehicle year
 * @param {string} [params.make] - Vehicle make
 * @param {string} [params.model] - Vehicle model
 * @param {Array} params.parts - Parts to add, each with:
 *   { partType, position, partNumber, brand, supplier, qty }
 *   These typically come from the API search bestValueBundle
 * @returns {object} { added, failed, cart_summary }
 */
async function addMultipleToCart({ vin, year, make, model, parts }) {
  if (!parts || parts.length === 0) {
    return { error: "No parts provided", added: [], failed: [] };
  }

  console.log(`[partstech-order] Adding ${parts.length} parts to cart for ${year} ${make} ${model}`);

  // Step 1: Login
  const login = ensureLoggedIn();
  if (!login.success) {
    return { error: login.error, added: [], failed: [] };
  }

  // Step 2: Set vehicle
  const vehicleResult = selectVehicle({ vin, year, make, model });
  if (!vehicleResult.success) {
    console.error(`[partstech-order] Vehicle selection failed: ${vehicleResult.error}`);
    // Continue anyway — PartsTech may still work without explicit vehicle
  }

  // Step 3: Add each part
  const added = [];
  const failed = [];

  for (const part of parts) {
    // Skip conditional parts unless explicitly included
    if (part.conditional && !part.includeConditional) {
      console.log(`[partstech-order] Skipping conditional part: ${part.partType}`);
      continue;
    }

    // Build search criteria from either API bestValue format or repair plan format
    const criteria = {
      partType: part.partType || part.searchTerms?.[0] || part.name,
      position: part.position || null,
      partNumber: part.selected?.partNumber || part.partNumber || null,
      brand: part.selected?.brand || part.brand || null,
      supplier: part.selected?.supplier || part.supplier || null,
      qty: part.qty || 1,
    };

    const result = addPartToCart(criteria);

    if (result.success) {
      added.push({
        partType: criteria.partType,
        position: criteria.position,
        ...result.matched,
      });
    } else {
      failed.push({
        partType: criteria.partType,
        position: criteria.position,
        error: result.error,
      });
    }
  }

  // Step 4: Get cart summary
  const cartSummary = await getCartSummary();

  console.log(`[partstech-order] Done: ${added.length} added, ${failed.length} failed`);

  return {
    added,
    failed,
    cart_summary: cartSummary,
  };
}

/**
 * Place an order for all items currently in the PartsTech cart.
 *
 * This is the final step — only call when SA explicitly confirms "order those parts."
 *
 * @returns {{ success: boolean, order_id?: string, total?: number, error?: string }}
 */
async function placeOrder() {
  const login = ensureLoggedIn();
  if (!login.success) {
    return { success: false, error: login.error };
  }

  try {
    // Navigate to cart first
    let snapshot = takeSnapshot();
    let elements = parseSnapshot(snapshot);

    let cartRef = findRef(elements, "cart");
    if (cartRef) {
      clickRef(cartRef);
      waitForLoad("networkidle");
    }

    // Verify cart has items
    snapshot = takeSnapshot();
    elements = parseSnapshot(snapshot);

    const emptyRef = findRef(elements, "empty");
    const noItemsRef = findRef(elements, "no items");
    if (emptyRef || noItemsRef) {
      return { success: false, error: "Cart is empty — nothing to order" };
    }

    // Extract total before ordering
    let total = 0;
    const pricePattern = /\$(\d{1,6}(?:,\d{3})*(?:\.\d{2})?)/;
    const totalElements = findAllRefs(elements, "total");
    for (const el of totalElements) {
      const match = el.text.match(pricePattern);
      if (match) {
        const val = parseFloat(match[1]);
        if (val > total) total = val;
      }
    }

    // Find and click "Place Order" / "Submit Order" / "Checkout" button
    let orderRef = findRefByType(elements, "button", "place order");
    if (!orderRef) orderRef = findRefByType(elements, "button", "submit order");
    if (!orderRef) orderRef = findRefByType(elements, "button", "checkout");
    if (!orderRef) orderRef = findRefByType(elements, "button", "order");
    if (!orderRef) orderRef = findRef(elements, "place order");
    if (!orderRef) orderRef = findRef(elements, "submit order");

    if (!orderRef) {
      return { success: false, error: "Could not find 'Place Order' button" };
    }

    clickRef(orderRef);
    waitForLoad("networkidle");

    // Handle confirmation dialog if present
    snapshot = takeSnapshot();
    elements = parseSnapshot(snapshot);

    let confirmRef = findRefByType(elements, "button", "confirm");
    if (!confirmRef) confirmRef = findRefByType(elements, "button", "yes");
    if (!confirmRef) confirmRef = findRefByType(elements, "button", "place order");

    if (confirmRef) {
      clickRef(confirmRef);
      waitForLoad("networkidle");
    }

    // Try to extract order confirmation details
    snapshot = takeSnapshot();
    elements = parseSnapshot(snapshot);

    let orderId = null;
    const orderIdElements = findAllRefs(elements, "order");
    for (const el of orderIdElements) {
      // Look for order ID patterns like "PT-123456", "ORD-123456", "#123456"
      const idMatch = el.text.match(/(?:PT|ORD|#)[-\s]?(\d{4,})/i);
      if (idMatch) {
        orderId = idMatch[0];
        break;
      }
    }

    // Look for delivery estimate
    let delivery = null;
    const deliveryElements = findAllRefs(elements, "deliver");
    if (deliveryElements.length === 0) {
      const etaElements = findAllRefs(elements, "eta");
      if (etaElements.length > 0) delivery = etaElements[0].text;
    } else {
      delivery = deliveryElements[0].text;
    }

    const result = {
      success: true,
      order_id: orderId,
      total: Math.round(total * 100) / 100,
      estimated_delivery: delivery,
    };

    console.log(`[partstech-order] Order placed! ID: ${orderId || "pending"}, Total: $${total}`);
    return result;
  } catch (err) {
    return { success: false, error: `Order placement failed: ${err.message}` };
  }
}

/**
 * Search for parts pricing without adding to cart.
 * Uses Year/Make/Model — no VIN required.
 * Returns data in the same bestValueBundle format as partstech-search REST API.
 *
 * @param {object} params
 * @param {string|number} params.year
 * @param {string} params.make
 * @param {string} params.model
 * @param {string} [params.vin]
 * @param {Array} params.partsList - [{partType, position, qty}]
 * @returns {object} { bestValueBundle, individualResults }
 */
async function searchPartsPricing({ year, make, model, vin, partsList }) {
  const empty = { bestValueBundle: { parts: [], totalCost: 0, allInStock: true, suppliers: [] }, individualResults: [] };

  if (!partsList || partsList.length === 0) return empty;

  console.log(`[partstech-order] Searching pricing for ${year} ${make} ${model}, ${partsList.length} parts...`);

  const login = ensureLoggedIn();
  if (!login.success) {
    console.error(`[partstech-order] Login failed: ${login.error}`);
    return { error: login.error, ...empty };
  }

  const vehicleResult = selectVehicle({ vin, year, make, model });
  if (!vehicleResult.success) {
    console.log(`[partstech-order] Vehicle warning: ${vehicleResult.error} — continuing`);
  }

  const bundle = {
    parts: [],
    totalCost: 0,
    allInStock: true,
    suppliers: new Set(),
  };
  const individualResults = [];

  for (const partReq of partsList) {
    const searchTerm = partReq.position
      ? `${partReq.partType} ${partReq.position}`
      : partReq.partType;

    const rawResults = searchPartInBrowser(searchTerm);

    if (rawResults.length === 0) {
      bundle.parts.push({ requested: partReq, selected: null, error: "No results found" });
      bundle.allInStock = false;
      individualResults.push({ partType: partReq.partType, error: "No results", bestValue: null });
      continue;
    }

    // Pick cheapest result
    const best = findBestMatch(rawResults, {});
    if (!best) {
      bundle.parts.push({ requested: partReq, selected: null, error: "No match" });
      individualResults.push({ partType: partReq.partType, error: "No match", bestValue: null });
      continue;
    }

    const price = parseFloat(best.price) || 0;

    // Parse brand + description from result text
    const descMatch = best.text.match(/^(.+?)\s+\$[\d,.]+/);
    const fullDesc = descMatch ? descMatch[1].trim() : best.text.trim();
    const words = fullDesc.split(/\s+/);
    const brand = words[0] || "Unknown";
    const description = words.length > 1 ? words.slice(1).join(" ") : fullDesc;

    const selected = {
      description,
      brand,
      partNumber: null,
      price,
      coreCharge: 0,
      totalCost: price,
      availability: "In Stock",
      supplier: "PartsTech",
      type: "Aftermarket",
    };

    bundle.parts.push({ requested: partReq, selected });
    bundle.totalCost += price * (partReq.qty || 1);
    bundle.suppliers.add("PartsTech");
    individualResults.push({
      partType: partReq.partType,
      bestValue: { overall: selected, aftermarket: selected, oem: null },
    });
  }

  bundle.suppliers = [...bundle.suppliers];
  bundle.supplierCount = bundle.suppliers.length;

  console.log(`[partstech-order] Pricing search done: $${bundle.totalCost.toFixed(2)} total, ${bundle.parts.filter(p => p.selected).length}/${bundle.parts.length} found`);
  return { bestValueBundle: bundle, individualResults };
}

module.exports = {
  // Main operations
  addMultipleToCart,
  addPartToCart,
  getCartSummary,
  placeOrder,
  clearCart,
  searchPartsPricing,
  // Vehicle
  selectVehicle,
  ensureLoggedIn,
  // Helpers (exported for testing and composition)
  ensureBrowser,
  takeSnapshot,
  parseSnapshot,
  findRef,
  findAllRefs,
  findRefByType,
  searchPartInBrowser,
  findBestMatch,
  clickAddToCart,
};
