# PartsTech via AutoLeap — Browser Automation Playbook

Complete technical reference for automating the AutoLeap → PartsTech → MOTOR labor
workflow. Written for Puppeteer/Playwright running against Chrome on port 18800.

---

## Architecture Overview

```
AutoLeap (app.myautoleap.com)
  └─ Parts ordering tab
       └─ PartsTech card → + button
            └─ Opens app.partstech.com in new tab (SSO via encrypted token in URL)
                 └─ Search → results → cheapest in-stock → Add to cart
                      └─ Submit quote → closes tab → parts land in AutoLeap estimate
AutoLeap estimate
  └─ Services tab → Browse → MOTOR Primary → find labor → Add
  └─ Parts ordering tab → link each part to its labor line
  └─ Save → Print → PDF
```

The vehicle is passed via SSO token when PartsTech opens — **no manual vehicle
selection needed** unless `div.vehicle-info-banner` is blank (see error handling).

---

## Pre-Flight Checks

Before starting, verify:

```javascript
// AutoLeap is loaded and on an estimate page
await page.waitForSelector('div.estimate-header, [class*="estimate-view"]', { timeout: 10000 });

// No loading overlay active
await page.waitForSelector('.loading-spinner, .page-loader', { state: 'hidden', timeout: 15000 });
```

---

## Step A — Launch PartsTech

### A1. Click "Parts ordering" tab

```javascript
// Primary selector (role-based, most stable)
await page.click('button[role="tab"]:has-text("Parts ordering")');

// Fallback selectors (try in order if primary fails)
// await page.click('div.tab-header:has-text("Parts")');
// await page.click('[class*="tab"]:has-text("Parts ordering")');

// Wait for the PartsTech card to appear
await page.waitForSelector(
  'text="PartsTech\'s orders", div[data-integration*="partstech"], [class*="partstech"]',
  { state: 'visible', timeout: 8000 }
);
```

### A2. Click the + (Add) button on the PartsTech card

```javascript
// Primary: integration-name attribute
await page.click('div[data-integration-name="partstech"] button:has-text("+")');

// Fallbacks:
// await page.click('button[aria-label="Add PartsTech Order"]');
// await page.click('div[data-integration*="partstech"] button.add-btn');
// await page.click('[class*="partstech-card"] button:first-of-type');

// Wait for new tab OR iframe
// PartsTech opens as a new tab (not iframe) in most setups
const newTabPromise = new Promise(resolve => {
  browser.once('targetcreated', async (target) => {
    await new Promise(r => setTimeout(r, 4000)); // let SSO redirect complete
    resolve(await target.page());
  });
});

const ptPage = await Promise.race([
  newTabPromise,
  new Promise(r => setTimeout(r, 12000, null))
]);

// If popup blocked, check for iframe fallback
if (!ptPage) {
  const iframe = page.frameLocator('iframe[src*="partstech.com"]');
  // work within iframe context instead
}
```

---

## Step B — PartsTech Search

### B1. Wait for page to be ready

```javascript
// Confirm vehicle banner populated (SSO passed vehicle correctly)
await ptPage.waitForSelector('div.vehicle-info-banner, [class*="vehicle-header"]', { timeout: 10000 });
const vehicleText = await ptPage.textContent('div.vehicle-info-banner, [class*="vehicle-header"]');
if (!vehicleText || vehicleText.trim() === '') {
  throw new Error('PARTSTECH_NO_VEHICLE: SSO did not pass vehicle — restart PartsTech flow');
}

// Wait for search input to be ready
await ptPage.waitForSelector(
  'input[placeholder*="Search by job, product"], input[data-testid="global-search-input"], input[name="searchQuery"]',
  { state: 'visible', timeout: 10000 }
);

// Dismiss any "welcome" or "tour" modals
try {
  await ptPage.click('button:has-text("Skip"), button:has-text("Dismiss"), button[aria-label="Close"]', { timeout: 2000 });
} catch { /* no modal present */ }
```

### B2. Type search term and submit

```javascript
const SEARCH_INPUT = 'input[placeholder*="Search by job, product"], input[data-testid="global-search-input"]';

await ptPage.fill(SEARCH_INPUT, ''); // clear first
await ptPage.fill(SEARCH_INPUT, searchTerm); // e.g. "catalytic converter"
await new Promise(r => setTimeout(r, 800)); // brief pause for typeahead

await ptPage.keyboard.press('Enter');

// Wait for results — try network response first, then DOM
await Promise.race([
  ptPage.waitForResponse(r => r.url().includes('/graphql') && r.status() === 200, { timeout: 12000 }),
  ptPage.waitForSelector(
    '.product-card-container, div[data-testid="product-card"], .search-result-item, .product-card',
    { state: 'visible', timeout: 12000 }
  )
]);

// Additional settle time for all supplier results to load (PartsTech calls one per account)
await new Promise(r => setTimeout(r, 3000));
```

### B3. Check for no results

```javascript
const noResults = await ptPage.evaluate(() => {
  const text = document.body.innerText;
  return text.includes('No results found') ||
         text.includes('0 matches') ||
         text.includes('no products found');
});
if (noResults) {
  return { found: false, error: 'No results in PartsTech for: ' + searchTerm };
}
```

### B4. Find and select the cheapest in-stock part

```javascript
// Mark the cheapest available "Add to cart" button with a data attribute,
// then click it (evaluate returns selectors, not DOM nodes)
await ptPage.evaluate(() => {
  const CARD_SELECTORS = [
    '.product-card-container',
    'div[data-testid="product-card"]',
    '.search-result-item',
    '.product-card'
  ];
  const PRICE_SELECTORS = ['.price-value', '.price-amount', '.product-price', 'span[class*="price"]'];
  const CART_BTN_TEXT = ['Add to cart', 'Add to Cart', 'Add'];

  let cards = [];
  for (const sel of CARD_SELECTORS) {
    cards = Array.from(document.querySelectorAll(sel));
    if (cards.length > 0) break;
  }

  let minPrice = Infinity;
  let bestCard = null;

  cards.forEach(card => {
    // Skip out-of-stock cards
    const oos = card.querySelector('[class*="out-of-stock"], [class*="unavailable"]');
    if (oos) return;

    // Find the add-to-cart button
    let btn = null;
    for (const text of CART_BTN_TEXT) {
      btn = Array.from(card.querySelectorAll('button')).find(b => b.textContent.trim().includes(text));
      if (btn) break;
    }
    if (!btn || btn.disabled) return;

    // Find price
    let priceEl = null;
    for (const sel of PRICE_SELECTORS) {
      priceEl = card.querySelector(sel);
      if (priceEl) break;
    }
    // Fallback: any element containing a dollar sign
    if (!priceEl) {
      priceEl = Array.from(card.querySelectorAll('*')).find(
        el => el.children.length === 0 && el.textContent.includes('$')
      );
    }
    if (!priceEl) return;

    const price = parseFloat(priceEl.textContent.replace(/[^0-9.]/g, ''));
    if (!isNaN(price) && price > 0 && price < minPrice) {
      minPrice = price;
      bestCard = btn;
    }
  });

  if (bestCard) {
    bestCard.setAttribute('data-sam-cheapest', 'true');
    return true;
  }
  return false;
});

// Click the marked button
const marked = await ptPage.$('button[data-sam-cheapest="true"]');
if (!marked) throw new Error('Could not identify cheapest part button');

// Extract part details before clicking (button may disappear after click)
const partDetails = await ptPage.evaluate(() => {
  const btn = document.querySelector('button[data-sam-cheapest="true"]');
  const card = btn.closest('.product-card-container, div[data-testid="product-card"], .product-card, .search-result-item');
  if (!card) return {};

  const priceSelectors = ['.price-value', '.price-amount', '.product-price', 'span[class*="price"]'];
  let priceEl = null;
  for (const sel of priceSelectors) {
    priceEl = card.querySelector(sel);
    if (priceEl) break;
  }

  return {
    price: parseFloat((priceEl?.textContent || '0').replace(/[^0-9.]/g, '')) || 0,
    brand: card.querySelector('h3.brand-name, [class*="brand"], .manufacturer')?.textContent?.trim() || '',
    partNumber: card.querySelector('span.part-number, [class*="part-number"], [class*="partNum"]')?.textContent?.trim() || '',
    description: card.querySelector('h2, h3, [class*="title"], [class*="description"]')?.textContent?.trim() || searchTerm,
  };
});

await marked.click();

// Wait for "added to cart" confirmation
await Promise.race([
  ptPage.waitForSelector(
    '.toast-success, [class*="toast"]:has-text("added"), [class*="notification"]:has-text("added")',
    { state: 'visible', timeout: 8000 }
  ),
  ptPage.waitForSelector('[class*="cart-count"]:not(:has-text("0"))', { timeout: 8000 }),
  new Promise(r => setTimeout(r, 4000)) // fallback: just wait
]);
```

---

## Step C — Transfer Cart to AutoLeap

### C1. Go to cart review

```javascript
await ptPage.click('a[href="/review-cart"], button[aria-label="Cart"], [class*="cart-icon"]');
await ptPage.waitForURL('**/review-cart', { timeout: 8000 });

// Or navigate directly if button click is unreliable
// await ptPage.goto('https://app.partstech.com/review-cart');
```

### C2. Submit quote

```javascript
await ptPage.click(
  'button:has-text("Submit quote"), button:has-text("Transfer"), button[data-testid="submit-quote-btn"]'
);

// After submit, PartsTech tab closes and focus returns to AutoLeap
await ptPage.waitForEvent('close', { timeout: 15000 }).catch(() => {});

// Return to AutoLeap page
await page.bringToFront();

// Wait for parts to sync into AutoLeap estimate
await Promise.race([
  page.waitForResponse(
    r => (r.url().includes('/api/parts/sync') || r.url().includes('/api/parts/import')) && r.status() === 200,
    { timeout: 15000 }
  ),
  page.waitForSelector(
    'td:has-text("Catco"), td:has-text("Walker"), td:has-text("Bosch"), [class*="part-row"]',
    { state: 'visible', timeout: 12000 }
  )
]);
```

---

## Step D — Add MOTOR Labor

### D1. Open the services browse modal

```javascript
await page.click('button[role="tab"]:has-text("Services"), [class*="services-tab"]');
await page.waitForSelector('.loading-spinner', { state: 'hidden', timeout: 8000 });

await page.click('button.btn-success:has-text("Browse"), button:has-text("Browse")');
await page.waitForSelector('div[role="dialog"], [class*="modal"]', { state: 'visible', timeout: 8000 });
```

### D2. Connect to MOTOR (crucial — hidden in overflow)

```javascript
// Scroll the modal header tabs to reveal the MOTOR connection button
await page.evaluate(() => {
  const tabContainer = document.querySelector('.modal-header-tabs, [class*="modal"] [class*="tabs"]');
  if (tabContainer) tabContainer.scrollLeft += 500;
});

// Check if MOTOR Connect button is visible
const connectBtn = await page.$('button:has-text("Connect to MOTOR")');
if (connectBtn) {
  await connectBtn.click();
  await page.waitForSelector('button[role="tab"]:has-text("MOTOR Primary")', { timeout: 10000 });
}
```

### D3. Navigate to the labor line

```javascript
// Click MOTOR Primary tab
await page.click('button[role="tab"]:has-text("MOTOR Primary")');
await new Promise(r => setTimeout(r, 1000));

// Navigate category (e.g., for catalytic converter)
await page.click('div[role="button"]:has-text("Powertrain"), li:has-text("Powertrain")');
await new Promise(r => setTimeout(r, 500));

// Find the specific labor line and click Add
// The labor line text should match what ProDemand found (e.g., "Catalytic Converter R&R")
await page.click(
  'div.service-item:has-text("Catalytic Converter") button:has-text("Add"), ' +
  '[class*="service-item"]:has-text("Catalytic Converter") button:has-text("Add")'
);

// Wait for the line item to appear in the estimate
await page.waitForSelector(
  'div.estimate-line-item:has-text("Catalytic Converter"), [class*="service-line"]:has-text("Catalytic Converter")',
  { state: 'visible', timeout: 8000 }
);
```

---

## Step E — Link Part to Labor & Save

### E1. Link part to the service

```javascript
await page.click('button[role="tab"]:has-text("Parts ordering")');
await page.waitForSelector('.loading-spinner', { state: 'hidden' });

// Find the part row by part name and click its service dropdown
const partRowDropdown = page.locator(
  'tr:has-text("Catco"), tr:has-text("Walker"), tr:has-text("catalytic converter")'
).locator('div.dropdown-trigger:has-text("Select service"), select.service-dropdown').first();

await partRowDropdown.click();

// Select the labor line from the dropdown
await page.click('ul[role="listbox"] li:has-text("Catalytic Converter"), [role="option"]:has-text("Catalytic Converter")');

// Wait for link confirmation (network response or text change)
await Promise.race([
  page.waitForResponse(
    r => r.url().includes('/api/estimate/link-part') || r.url().includes('/link'),
    { timeout: 8000 }
  ),
  new Promise(r => setTimeout(r, 2000))
]);
```

### E2. Save the estimate

```javascript
// Click Save in the top header
await page.click('button.btn-primary:has-text("Save"), header button:has-text("Save")');

// Wait for save to complete (button re-enables after save)
await page.waitForSelector(
  'button.btn-primary:has-text("Save"):not([disabled])',
  { timeout: 10000 }
);
```

---

## Step F — Export to PDF

### F1. Click Print icon

```javascript
await page.click('button[aria-label="Print"], i.icon-print, button:has-text("Print")');
await page.waitForSelector('ul.dropdown-menu, [class*="dropdown"]', { state: 'visible', timeout: 5000 });
```

### F2. Capture PDF without OS dialog

```javascript
// Approach 1 (preferred): Use Puppeteer's built-in PDF export
// This generates a proper PDF without triggering the OS print dialog
const pdfBuffer = await page.pdf({ format: 'Letter', printBackground: true });
require('fs').writeFileSync('/tmp/autoleap-estimate.pdf', pdfBuffer);

// Approach 2: Stub window.print and click the button (AutoLeap may generate its own PDF)
await page.evaluate(() => { window.print = () => {}; });
await page.click('ul.dropdown-menu li:has-text("Print Estimate"), [class*="dropdown-menu"] li:has-text("Print Estimate")');
// Watch for AutoLeap's own download link if they generate a blob URL
```

---

## Error Handling Reference

| Scenario | Detection | Action |
|----------|-----------|--------|
| No results | `text.includes("No results found")` or `"0 matches"` | Return `{ found: false }`, log, skip this part |
| Session expired | Redirect to `app.partstech.com/login` | Close tab, go back to AutoLeap, click `+` again to re-auth |
| Wrong vehicle | `vehicle-info-banner` is blank or missing | Throw `PARTSTECH_NO_VEHICLE`, restart PartsTech open flow |
| "Call for availability" | Button text is "Call for Availability" or price missing | Skip this card — `addToCartBtn` will be absent or disabled |
| Cart transfer failed | PartsTech tab didn't close after 15s | Try `ptPage.close()` manually; check AutoLeap for part rows |
| Loading overlay stuck | `.loading-spinner` visible > 15s | `page.reload()`, retry the action once |
| MOTOR not connected | `button[role="tab"]:has-text("MOTOR Primary")` not found | Scroll modal header, click "Connect to MOTOR" first |

### Session expired recovery:

```javascript
const currentUrl = ptPage.url();
if (currentUrl.includes('/login') || currentUrl.includes('sso/login')) {
  console.log('[partstech] Session expired — re-authenticating via AutoLeap');
  await ptPage.close();
  // Return to AutoLeap and click + again to trigger fresh SSO
  await page.bringToFront();
  await page.click('div[data-integration-name="partstech"] button:has-text("+")');
  // Repeat waitForEvent('popup') flow
}
```

---

## Network Trigger Reference

| Event | Network Signal to Wait For |
|-------|---------------------------|
| PartsTech search results loaded | `POST /graphql` with `operationName: "GetProducts"` — fires once per supplier account |
| Part added to cart | Response 200 after cart button click + `GetCart` or cart count element updates |
| Quote submitted to AutoLeap | `POST /api/parts/sync` or `POST /api/parts/import` with status 200 |
| Part linked to labor | `PATCH /api/estimate/link-part` or equivalent with status 200 |
| Estimate saved | Header Save button transitions from `disabled` → `enabled` |

---

## CDP Interception Approach (Current — Faster)

Instead of clicking through the UI for search results, SAM intercepts `GetProducts`
GraphQL responses directly via Chrome DevTools Protocol. This is faster (no UI
interaction) and more reliable (no selector drift). See `partstech-search.js`.

**Use UI approach when:** Opening a new PartsTech tab (SSO auth) — CDP alone can't do this.
**Use CDP approach when:** Searching for parts pricing — type in box, intercept responses.

The two approaches are combined: UI to open the tab, CDP to read the results.

---

## Selector Stability Notes

AutoLeap is a React SPA with dynamically generated class names (e.g., `css-1a2b3c`).
**Never** target these — they change on every build. Use in order of preference:

1. `data-*` attributes (`data-integration`, `data-testid`, `data-target`)
2. ARIA roles + text (`button[role="tab"]:has-text("...")`)
3. Stable class names (`btn-primary`, `dropdown-trigger`, `service-item`)
4. Text content fallback (`button:has-text("Browse")`)
5. Structural position (`.modal-header-tabs button:nth-child(2)`) — last resort

Always add `{ timeout: 8000 }` minimum to all `waitForSelector` calls to avoid
hanging indefinitely on selector misses.
