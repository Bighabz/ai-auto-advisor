/**
 * AutoLeap Customer & Vehicle Management
 *
 * Browser automation for creating/finding customers and
 * adding vehicles in AutoLeap's web UI.
 */

const browser = require("../../shared/browser");
const { ensureLoggedIn } = require("./login");

const LOG = "[autoleap-browser]";

/**
 * Find an existing customer or create a new one.
 *
 * @param {{ name: string, phone?: string, email?: string }} customer
 * @returns {{ success: boolean, id?: string, name?: string, error?: string }}
 */
function findOrCreateCustomer({ name, phone, email }) {
  const loginResult = ensureLoggedIn();
  if (!loginResult.success) return loginResult;

  try {
    // Navigate to Customers section
    let snapshot = browser.takeSnapshot();
    let elements = browser.parseSnapshot(snapshot);

    const customersNav = browser.findRef(elements, "customers");
    if (customersNav) {
      browser.clickRef(customersNav);
      browser.waitForLoad("networkidle");
    }

    // Search for existing customer by phone or name
    const searchTerm = phone || name;
    snapshot = browser.takeSnapshot();
    elements = browser.parseSnapshot(snapshot);

    const searchRef = browser.findRefByType(elements, "input", "search") ||
                      browser.findRef(elements, "search");
    if (searchRef) {
      browser.clickRef(searchRef);
      browser.typeInRef(searchRef, searchTerm, true);
      browser.waitForLoad("networkidle");

      // Check results
      snapshot = browser.takeSnapshot();
      elements = browser.parseSnapshot(snapshot);

      // Look for customer name in results
      const nameRef = browser.findRef(elements, name.split(" ")[0]);
      if (nameRef && phone) {
        // Verify phone match
        const phoneRef = browser.findRef(elements, phone.slice(-4));
        if (phoneRef) {
          browser.clickRef(nameRef);
          browser.waitForLoad("networkidle");
          console.log(`${LOG} Found existing customer: ${name}`);
          return { success: true, name, found: true };
        }
      }
    }

    // Customer not found — create new one
    console.log(`${LOG} Customer not found, creating new: ${name}`);
    snapshot = browser.takeSnapshot();
    elements = browser.parseSnapshot(snapshot);

    const addBtn = browser.findRef(elements, "add customer") ||
                   browser.findRef(elements, "new customer") ||
                   browser.findRefByType(elements, "button", "add") ||
                   browser.findRefByType(elements, "button", "create");

    if (!addBtn) {
      return { success: false, error: "Could not find 'Add Customer' button" };
    }

    browser.clickRef(addBtn);
    browser.waitForLoad("networkidle");

    // Fill customer form
    snapshot = browser.takeSnapshot();
    elements = browser.parseSnapshot(snapshot);

    // Name fields — try first/last split or single name field
    const nameParts = name.split(" ");
    const firstNameRef = browser.findRefByType(elements, "input", "first") ||
                         browser.findRef(elements, "first name");
    const lastNameRef = browser.findRefByType(elements, "input", "last") ||
                        browser.findRef(elements, "last name");

    if (firstNameRef && lastNameRef && nameParts.length >= 2) {
      browser.clickRef(firstNameRef);
      browser.typeInRef(firstNameRef, nameParts[0]);
      browser.clickRef(lastNameRef);
      browser.typeInRef(lastNameRef, nameParts.slice(1).join(" "));
    } else {
      // Single name field
      const nameRef = browser.findRefByType(elements, "input", "name") ||
                      browser.findRef(elements, "customer name");
      if (nameRef) {
        browser.clickRef(nameRef);
        browser.typeInRef(nameRef, name);
      }
    }

    // Phone
    if (phone) {
      const phoneRef = browser.findRefByType(elements, "input", "phone") ||
                        browser.findRef(elements, "phone");
      if (phoneRef) {
        browser.clickRef(phoneRef);
        browser.typeInRef(phoneRef, phone);
      }
    }

    // Email
    if (email) {
      const emailRef = browser.findRefByType(elements, "input", "email") ||
                        browser.findRef(elements, "email");
      if (emailRef) {
        browser.clickRef(emailRef);
        browser.typeInRef(emailRef, email);
      }
    }

    // Save
    snapshot = browser.takeSnapshot();
    elements = browser.parseSnapshot(snapshot);
    const saveBtn = browser.findRefByType(elements, "button", "save") ||
                    browser.findRefByType(elements, "button", "create") ||
                    browser.findRefByType(elements, "button", "submit");
    if (saveBtn) {
      browser.clickRef(saveBtn);
      browser.waitForLoad("networkidle");
    }

    console.log(`${LOG} Customer created: ${name}`);
    return { success: true, name, created: true };
  } catch (err) {
    return { success: false, error: `Customer flow failed: ${err.message}` };
  }
}

/**
 * Add a vehicle to the current customer's profile.
 *
 * @param {{ year: number, make: string, model: string, vin?: string, mileage?: number }} vehicle
 * @returns {{ success: boolean, error?: string }}
 */
function addVehicleToCustomer({ year, make, model, vin, mileage }) {
  try {
    let snapshot = browser.takeSnapshot();
    let elements = browser.parseSnapshot(snapshot);

    // Look for "Add Vehicle" button
    const addVehicleBtn = browser.findRef(elements, "add vehicle") ||
                          browser.findRef(elements, "new vehicle") ||
                          browser.findRefByType(elements, "button", "vehicle");

    if (!addVehicleBtn) {
      return { success: false, error: "Could not find 'Add Vehicle' button" };
    }

    browser.clickRef(addVehicleBtn);
    browser.waitForLoad("networkidle");

    snapshot = browser.takeSnapshot();
    elements = browser.parseSnapshot(snapshot);

    // Try VIN first — AutoLeap may auto-decode
    if (vin) {
      const vinRef = browser.findRefByType(elements, "input", "vin") ||
                     browser.findRef(elements, "vin");
      if (vinRef) {
        browser.clickRef(vinRef);
        browser.typeInRef(vinRef, vin, true);
        browser.waitForLoad("networkidle");

        // Check if VIN decoded successfully
        snapshot = browser.takeSnapshot();
        elements = browser.parseSnapshot(snapshot);
        const decoded = browser.findRef(elements, make) || browser.findRef(elements, model);
        if (decoded) {
          console.log(`${LOG} Vehicle added via VIN decode: ${vin}`);
        }
      }
    }

    // Fill year/make/model manually if needed
    snapshot = browser.takeSnapshot();
    elements = browser.parseSnapshot(snapshot);

    const yearRef = browser.findRefByType(elements, "input", "year") ||
                    browser.findRef(elements, "year");
    if (yearRef) {
      browser.clickRef(yearRef);
      browser.typeInRef(yearRef, String(year), true);
      browser.waitForLoad("networkidle");
    }

    snapshot = browser.takeSnapshot();
    elements = browser.parseSnapshot(snapshot);
    const makeRef = browser.findRefByType(elements, "input", "make") ||
                    browser.findRef(elements, "make");
    if (makeRef) {
      browser.clickRef(makeRef);
      browser.typeInRef(makeRef, make, true);
      browser.waitForLoad("networkidle");
    }

    snapshot = browser.takeSnapshot();
    elements = browser.parseSnapshot(snapshot);
    const modelRef = browser.findRefByType(elements, "input", "model") ||
                     browser.findRef(elements, "model");
    if (modelRef) {
      browser.clickRef(modelRef);
      browser.typeInRef(modelRef, model, true);
      browser.waitForLoad("networkidle");
    }

    // Mileage
    if (mileage) {
      snapshot = browser.takeSnapshot();
      elements = browser.parseSnapshot(snapshot);
      const mileageRef = browser.findRefByType(elements, "input", "mileage") ||
                         browser.findRef(elements, "mileage") ||
                         browser.findRef(elements, "odometer");
      if (mileageRef) {
        browser.clickRef(mileageRef);
        browser.typeInRef(mileageRef, String(mileage));
      }
    }

    // Save vehicle
    snapshot = browser.takeSnapshot();
    elements = browser.parseSnapshot(snapshot);
    const saveBtn = browser.findRefByType(elements, "button", "save") ||
                    browser.findRefByType(elements, "button", "add") ||
                    browser.findRefByType(elements, "button", "submit");
    if (saveBtn) {
      browser.clickRef(saveBtn);
      browser.waitForLoad("networkidle");
    }

    console.log(`${LOG} Vehicle added: ${year} ${make} ${model}`);
    return { success: true, year, make, model, vin: vin || null };
  } catch (err) {
    return { success: false, error: `Add vehicle failed: ${err.message}` };
  }
}

module.exports = { findOrCreateCustomer, addVehicleToCustomer };
