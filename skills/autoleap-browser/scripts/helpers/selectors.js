/**
 * CSS Selectors for AutoLeap + PartsTech browser automation.
 *
 * Centralised so selector drift is fixed in one place.
 * Preference: data-* > ARIA roles > stable classes > text > position.
 */

// ─── AutoLeap Login ─────────────────────────────────────────────────────────
const LOGIN = {
  EMAIL: '#login-email, input[type="email"], input[name="email"]',
  PASSWORD: '#login-password, input[type="password"], input[name="password"]',
  SUBMIT: 'button[type="submit"], button:has-text("Sign In"), button:has-text("Log In")',
  WORKBOARD: '[class*="workboard"], [class*="dashboard"]',
};

// ─── Customer / Vehicle Drawer ──────────────────────────────────────────────
const CUSTOMER = {
  NEW_BTN: 'button:has-text("New"), button.global-add-btn, button[aria-label="Create new"]',
  DRAWER: '[class*="drawer"], [class*="sidebar-form"], [role="dialog"]',
  FIRST_NAME: 'input[name="firstName"], input[formcontrolname="firstName"]',
  LAST_NAME: 'input[name="lastName"], input[formcontrolname="lastName"]',
  PHONE: 'input[name="phoneNumber"], input[formcontrolname="phone"], input[name="phone"]',
  VIN: 'input[name="vin"], input[formcontrolname="vin"]',
  VIN_DECODE: 'button:has-text("Decode"), button:has-text("Lookup")',
  YEAR: 'select[name="year"], [formcontrolname="year"]',
  MAKE: 'select[name="make"], [formcontrolname="make"]',
  MODEL: 'select[name="model"], [formcontrolname="model"]',
  ENGINE: 'select[name="engine"], [formcontrolname="engine"]',
  SAVE_CREATE_ESTIMATE: 'button:has-text("Save & Create Estimate")',
  SAVE: 'button:has-text("Save")',
};

// ─── Estimate Page ──────────────────────────────────────────────────────────
const ESTIMATE = {
  HEADER: 'div.estimate-header, [class*="estimate-view"], [class*="estimate-detail"]',
  SAVE: 'button.btn-primary:has-text("Save"), header button:has-text("Save")',
  PRINT_BTN: 'button[aria-label="Print"], button:has-text("Print"), i.icon-print',
  PRINT_DROPDOWN: 'ul.dropdown-menu, [class*="dropdown-menu"]',
  PRINT_ESTIMATE: 'li:has-text("Print Estimate"), [class*="dropdown-menu"] li:has-text("Print Estimate")',
  LOADING: '.loading-spinner, .page-loader, [class*="spinner"]',
  RO_NUMBER: '[class*="ro-number"], [class*="estimate-code"]',
};

// ─── Parts Ordering Tab (AutoLeap) ─────────────────────────────────────────
const PARTS_TAB = {
  TAB: 'button[role="tab"]:has-text("Parts ordering"), [class*="tab"]:has-text("Parts ordering")',
  PT_CARD: '[data-integration-name="partstech"], [data-integration*="partstech"], [class*="partstech"]',
  PT_ADD_BTN: '[data-integration-name="partstech"] button:has-text("+"), [class*="partstech-card"] button:first-of-type',
  PT_IFRAME: 'iframe[src*="partstech.com"]',
  // Part rows in the estimate — each has a service dropdown
  PART_ROW: 'tr[class*="part-row"], tr:has([class*="part"]), [class*="parts-table"] tr',
  SERVICE_DROPDOWN: 'div.dropdown-trigger:has-text("Select service"), select.service-dropdown, [class*="service-select"]',
  SERVICE_OPTION: '[role="option"], ul[role="listbox"] li, [class*="dropdown-item"]',
};

// ─── PartsTech (New Tab) ────────────────────────────────────────────────────
const PARTSTECH = {
  VEHICLE_BANNER: 'div.vehicle-info-banner, [class*="vehicle-header"], [class*="vehicle-info"]',
  SEARCH_INPUT: 'input[placeholder*="Search by job"], input[data-testid="global-search-input"], input[name="searchQuery"]',
  PRODUCT_CARD: '.product-card-container, div[data-testid="product-card"], .search-result-item, .product-card',
  PRICE: '.price-value, .price-amount, .product-price, span[class*="price"]',
  OUT_OF_STOCK: '[class*="out-of-stock"], [class*="unavailable"]',
  CART_BTN_TEXTS: ["Add to cart", "Add to Cart", "Add"],
  CART_LINK: 'a[href="/review-cart"], button[aria-label="Cart"], [class*="cart-icon"]',
  CART_COUNT: '[class*="cart-count"]',
  SUBMIT_QUOTE: 'button:has-text("Submit quote"), button:has-text("Transfer"), button[data-testid="submit-quote-btn"]',
  DISMISS_MODAL: 'button:has-text("Skip"), button:has-text("Dismiss"), button[aria-label="Close"]',
  NO_RESULTS_TEXTS: ["No results found", "0 matches", "no products found"],
};

// ─── Services Tab / MOTOR ───────────────────────────────────────────────────
const SERVICES = {
  TAB: 'button[role="tab"]:has-text("Services"), [class*="services-tab"]',
  BROWSE_BTN: 'button.btn-success:has-text("Browse"), button:has-text("Browse")',
  // MOTOR Primary tab — can be button, a, li, or div depending on AutoLeap version
  MOTOR_TAB_TEXT: "MOTOR Primary",
  CONNECT_MOTOR_TEXT: "Connect to MOTOR",
  // Category items in the MOTOR tree (each level)
  CATEGORY_ITEM: 'div[role="button"], li[role="treeitem"], [class*="category-item"], [class*="tree-node"]',
  CATEGORY_TEXT: '.category-name, .item-text, span',
  ADD_BTN: 'button:has-text("Add"), button.btn-success:has-text("Add")',
  // Qualifier / add-on options
  QUALIFIER_OPTION: '[class*="qualifier"] [role="radio"], [class*="qualifier"] label, [class*="option-item"]',
  ADDON_CHECKBOX: '[class*="addon"] input[type="checkbox"], [class*="add-on"] label',
  // Labor hours field (READ ONLY — NEVER MODIFY)
  HOURS_FIELD: 'input[name="hours"], input[name="qty"], [class*="hours-input"]',
  // Customer sidebar (must be closed before MOTOR navigation)
  SIDEBAR_CLOSE: '[class*="sidebar"] button[class*="close"], [class*="drawer"] button[class*="close"]',
};

module.exports = {
  LOGIN,
  CUSTOMER,
  ESTIMATE,
  PARTS_TAB,
  PARTSTECH,
  SERVICES,
};
