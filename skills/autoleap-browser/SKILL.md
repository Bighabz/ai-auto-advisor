---
name: autoleap-browser
description: >
  Full AutoLeap web UI automation — login, customer/vehicle management,
  estimate creation with MOTORS labor + embedded PartsTech parts,
  estimate delivery, and parts ordering after approval.
requires:
  bins:
    - node
    - openclaw
  env:
    - AUTOLEAP_EMAIL
    - AUTOLEAP_PASSWORD
  config:
    autoleap_url: https://app.myautoleap.com
---

# AutoLeap Browser Automation

Complete estimate pipeline through AutoLeap's web UI, replacing the API-based
`autoleap-estimate` skill with browser automation that mirrors the real service
advisor workflow.

## Why Browser Instead of API

- MOTORS labor times are embedded inside AutoLeap (not separately accessible)
- PartsTech parts ordering is embedded inside AutoLeap
- The real shop workflow goes through AutoLeap's UI
- Estimates sent from AutoLeap go directly to the customer

## Scripts

| Script | Purpose |
|--------|---------|
| `login.js` | Auth to app.myautoleap.com, session management |
| `customer.js` | Find/create customer, add vehicle |
| `estimate.js` | Create estimate with MOTORS labor + PartsTech parts |
| `send.js` | Send estimate to customer, check approval status |
| `order.js` | Place parts order after customer approval |

## Full Pipeline

```
1. ensureLoggedIn()           → authenticate to AutoLeap
2. findOrCreateCustomer()     → create or find customer by phone/name
3. addVehicleToCustomer()     → add vehicle (VIN decode or manual)
4. createEstimate()           → build estimate:
   a. Search MOTORS for labor  → auto-fills hours + description
   b. Open PartsTech           → search + select parts
   c. Parts populate estimate  → AutoLeap calculates totals
5. sendEstimate()             → send to customer email/SMS
6. checkEstimateStatus()      → poll for approval
7. placePartsOrder()          → order parts after approval
```

## Integration

Called from the orchestrator when `AUTOLEAP_EMAIL` is configured:

```javascript
const autoLeapBrowser = {
  login: require("../autoleap-browser/scripts/login"),
  customer: require("../autoleap-browser/scripts/customer"),
  estimate: require("../autoleap-browser/scripts/estimate"),
  send: require("../autoleap-browser/scripts/send"),
  order: require("../autoleap-browser/scripts/order"),
};

// In the pipeline
const loginResult = autoLeapBrowser.login.ensureLoggedIn();
const customer = autoLeapBrowser.customer.findOrCreateCustomer({ name, phone });
autoLeapBrowser.customer.addVehicleToCustomer({ year, make, model, vin });
const estimate = autoLeapBrowser.estimate.createEstimate({ diagnosis, parts });
autoLeapBrowser.send.sendEstimate({ estimateId: estimate.estimateId });

// After customer approval
autoLeapBrowser.order.placePartsOrder(estimate.estimateId);
```

## Fallback

If browser automation is unavailable (no `AUTOLEAP_EMAIL` env var or OpenClaw
not installed), the orchestrator falls back to the API-based `autoleap-estimate`
skill automatically.

## Notes

- Uses shared browser module (`skills/shared/browser.js`) for all OpenClaw operations
- Session persists via OpenClaw browser profile — login only needed once per session
- Snapshots are taken after every page change to get fresh element refs
- All functions return `{ success, error }` objects for graceful degradation
- Log prefix: `[autoleap-browser]`
