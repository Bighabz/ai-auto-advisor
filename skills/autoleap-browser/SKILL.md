---
name: autoleap-browser
description: >
  AutoLeap REST API integration for estimate creation with code-calculated
  retail pricing (cost × markup%). Token acquired via puppeteer CDP from
  live Chrome session. Also includes browser scripts for sending estimates
  and placing parts orders.
requires:
  bins:
    - node
  env:
    - AUTOLEAP_EMAIL
    - AUTOLEAP_PASSWORD
  config:
    autoleap_url: https://app.myautoleap.com
    chrome_cdp_port: 18800
---

# AutoLeap Integration

REST API for estimate creation + browser automation for post-estimate flows.

## Architecture

```
autoleap-api.js (REST client — estimate creation, token, customer, PDF)
├── Token: puppeteer CDP captures JWT from live Chrome session
├── Pricing: code-calculated retail = cost × (1 + markup%)
└── Markup: AUTOLEAP_PARTS_MARKUP_PERCENT env var (default 40%)

login.js        → OpenClaw auth (used by send.js, order.js)
send.js         → Send estimate to customer (browser)
order.js        → Place parts order after approval (browser)
partstech-search.js → Standalone PartsTech pricing lookup
```

## How Pricing Works

PartsTech returns wholesale/cost prices. The `resolveRetailPartPrice()` function
applies the shop's markup percentage in code:

1. Check for explicit retail/customer price fields (none exist in PartsTech data)
2. Check for shopPrice > cost (not present)
3. Fall back to: `retail = cost × (1 + markupPercent / 100)`

This produces correct retail pricing without needing AutoLeap's native markup matrix.

## Scripts

| Script | Purpose |
|--------|---------|
| `autoleap-api.js` | REST client: token, customer, estimate, PDF |
| `partstech-search.js` | Standalone PartsTech pricing lookup (orchestrator Step 5) |
| `login.js` | Auth via OpenClaw (used by send.js, order.js) |
| `send.js` | Send estimate to customer (browser) |
| `order.js` | Place parts order after approval (browser) |

## Key Functions (autoleap-api.js)

| Function | Purpose |
|----------|---------|
| `getToken()` | Puppeteer CDP token capture, cached to /tmp |
| `searchCustomer(query)` | PUT /customers/list |
| `createCustomer(data)` | POST /customers |
| `buildEstimate(args)` | Full estimate: customer + vehicle + services + parts (retail) |
| `buildServices(diagnosis, parts, opts)` | Build AutoLeap service objects with markup |
| `getEstimate(id)` | GET /estimates/{id} |
| `downloadEstimatePDF(id, path)` | GET /estimates/{id}/pdf |
| `resolveRetailPartPrice(sel, markup%)` | Cost → retail pricing |

## Integration

Called from orchestrator Step 6:

```javascript
const autoLeapApi = require("../../autoleap-browser/scripts/autoleap-api");
const result = await autoLeapApi.buildEstimate({
  customerName: "John Doe",
  phone: "555-1234",
  vehicleYear: 2002, vehicleMake: "Toyota", vehicleModel: "RAV4",
  vin: "...",
  diagnosis: results.diagnosis,
  parts: estParts,
  laborHoursOverride: { hours: 1.7, source: "MOTOR" },
});
// result: { success, estimateId, estimateCode, total, totalLabor, totalParts,
//           laborHours, laborRate, customerName, vehicleDesc }
```

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `AUTOLEAP_EMAIL` | required | Login email |
| `AUTOLEAP_PASSWORD` | required | Login password |
| `AUTOLEAP_LABOR_RATE` | 120 | $/hour for labor |
| `AUTOLEAP_PARTS_MARKUP_PERCENT` | 40 | Cost → retail markup % |

## Notes

- Token cached to `/tmp/autoleap-token.json`, expires after ~24h
- All functions return `{ success, error }` objects for graceful degradation
- Log prefix: `[autoleap-api]`
- Playbook files (playbook.js, helpers/) exist but are unused — kept for future reference
