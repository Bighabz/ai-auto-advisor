---
name: autoleap-browser
description: >
  100% browser-driven AutoLeap estimate creation. Uses puppeteer-core to
  replicate the 14-step manual workflow: customer/vehicle creation, PartsTech
  parts (new tab SSO), MOTOR labor (category tree with Claude AI),
  part-to-labor linking (triggers markup matrix), save, and PDF export.
requires:
  bins:
    - node
  env:
    - AUTOLEAP_EMAIL
    - AUTOLEAP_PASSWORD
    - ANTHROPIC_API_KEY
  config:
    autoleap_url: https://app.myautoleap.com
    chrome_cdp_port: 18800
---

# AutoLeap Browser Automation

100% browser-driven estimate pipeline through AutoLeap's web UI.
No REST API for estimate creation. AutoLeap handles all pricing
through its native markup matrix.

## Architecture

```
playbook.js (master sequencer)
├── helpers/selectors.js   — CSS selectors (one place)
├── helpers/pt-tab.js      — PartsTech new-tab SSO flow
└── helpers/motor-nav.js   — MOTOR 7-level tree + Claude AI
```

## Why Browser-Only

- REST API injects parts at wholesale cost, bypassing markup matrix
- MOTOR labor times only accessible through AutoLeap's browse UI
- Part-to-labor linking (Step 12) triggers the shop's markup matrix
- Only the manual workflow produces correct retail pricing

## Scripts

| Script | Purpose |
|--------|---------|
| `playbook.js` | Master 14-step sequencer (entry point) |
| `helpers/selectors.js` | All CSS selectors in one place |
| `helpers/pt-tab.js` | PartsTech new-tab flow (SSO, search, cart, submit) |
| `helpers/motor-nav.js` | MOTOR category tree navigation with Claude AI |
| `autoleap-api.js` | Token management, customer search, PDF download |
| `partstech-search.js` | Standalone pricing lookup (orchestrator Step 5) |
| `login.js` | Auth via OpenClaw (used by send.js, order.js) |
| `send.js` | Send estimate to customer |
| `order.js` | Place parts order after approval |

## The 14-Step Playbook (6 Phases)

```
Phase 1: Authentication
  1. ensureLoggedIn()              → puppeteer login if needed

Phase 2: Customer & Vehicle
  2. Click "New" button            → open customer/vehicle drawer
  3. Fill customer info            → firstName, lastName, phone
  4. Enter vehicle                 → VIN decode or YMME dropdowns
  5. "Save & Create Estimate"      → RO# generated, estimate page loaded

Phase 3: Parts via PartsTech
  6. Click "Parts ordering" tab    → PartsTech card visible
  7. Click "+" on PartsTech card   → new browser tab (SSO)
  8. Search + select cheapest      → in-stock, lowest price
  9. Submit cart to AutoLeap       → parts sync at wholesale cost

Phase 4: Labor via MOTOR
  10. Open labor catalog           → Services tab → Browse
  11. Navigate MOTOR tree          → Claude AI picks categories (3-5 calls)
      GOLDEN RULE: NEVER modify Qty/Hrs after MOTOR populates

Phase 5: Link Parts to Labor (THE PROFIT STEP)
  12. Link each part to service    → triggers AutoLeap markup matrix
      wholesale $649 → retail $950+

Phase 6: Save + PDF
  13. Save estimate                → button click + wait
  14. Export PDF                   → page.pdf() → /tmp/estimate-*.pdf
```

## Integration

Called from the orchestrator (Step 6):

```javascript
const { runPlaybook } = require("../../autoleap-browser/scripts/playbook");
const result = await runPlaybook({
  customer: { name: "John Doe", phone: "555-1234" },
  vehicle: { year: 2002, make: "Toyota", model: "RAV4", vin: "..." },
  diagnosis: results.diagnosis,
  parts: results.parts?.bestValueBundle?.parts || [],
  progressCallback: (phase) => sendTelegramUpdate(phase),
});
// result: { success, roNumber, estimateId, total, totalLabor, totalParts,
//           laborHours, pdfPath, pricingSource, partsAdded, laborResult }
```

## Error Handling

Every phase has try/catch. Partial failures produce warnings, not hard stops:
- PartsTech tab doesn't open → parts skipped, warning added
- MOTOR nav fails → labor skipped, warning added
- Part-to-labor link fails → estimate valid but no markup
- PDF fails → result returned without pdfPath

## Notes

- Uses puppeteer-core connecting to Chrome CDP on port 18800
- Claude AI (haiku) for MOTOR category selection (~100 tokens per call)
- Expected total time: 2-4 minutes per estimate
- All functions return `{ success, error }` objects for graceful degradation
- Log prefix: `[playbook]`, `[playbook:pt-tab]`, `[playbook:motor]`
