---
name: partstech-order
description: >
  Browser automation for PartsTech ordering — search parts, add to cart,
  and place orders via OpenClaw managed browser. Extends the existing
  partstech-search API skill with full ordering capability.
requires:
  bins:
    - node
    - openclaw
  env:
    - PARTSTECH_USERNAME
    - PARTSTECH_PASSWORD
  config:
    partstech_url: https://shop.partstech.com
---

# PartsTech Order — Browser Automation

Order parts through PartsTech using browser automation. Works alongside the existing
`partstech-search` API skill: API handles fast pricing lookups, this skill handles
cart management and order placement.

## When to Use

Use this skill when:
- Parts have been selected via API search and need to be ordered
- SA says "order those parts" after reviewing an estimate
- Need to add parts to PartsTech cart for later ordering
- Need to check current cart status
- Need to clear or modify the cart

## Inputs

- **Vehicle**: VIN (preferred) or Year/Make/Model
- **Parts**: Array of parts to order, each with:
  - `partType` — Component name (e.g., "catalytic converter")
  - `position` — Location if applicable (e.g., "bank 1")
  - `brand` — Preferred brand from API search results
  - `partNumber` — Specific part number to match
  - `supplier` — Preferred supplier from API search results
  - `qty` — Quantity needed (default: 1)

## Flow

1. **Ensure login** — Navigate to PartsTech, verify session is active
2. **Set vehicle** — Enter VIN or year/make/model for accurate fitment
3. **Search each part** — Use part type + position as search terms
4. **Match & select** — Find the specific part/supplier combo from API results
5. **Add to cart** — Add each selected part to the PartsTech shopping cart
6. **Confirm** — Return cart summary with all items and total
7. **Order** (on demand) — When SA confirms, submit the order

## Output

### Cart Summary
```json
{
  "cart_items": [
    {
      "description": "Denso Catalytic Converter",
      "part_number": "2505178",
      "brand": "Denso",
      "supplier": "AutoZone Commercial",
      "price": 289.99,
      "qty": 1,
      "in_stock": true
    }
  ],
  "total": 289.99,
  "item_count": 1,
  "all_in_stock": true,
  "ready_to_order": true
}
```

### Order Confirmation
```json
{
  "order_id": "PT-123456",
  "status": "placed",
  "total": 289.99,
  "items_ordered": 1,
  "estimated_delivery": "Today by 3:00 PM"
}
```

## Dual Mode Architecture

| Mode | Skill | Use Case |
|------|-------|----------|
| API | `partstech-search` | Fast pricing lookups, estimate building |
| Browser | `partstech-order` | Cart management, order placement |

The API skill runs in Step 5 (parts search) of the estimate pipeline.
The browser skill runs on demand when SA wants to order.

## Integration

Called from the orchestrator when SA requests ordering:
```javascript
const { addMultipleToCart, placeOrder } = require("../partstech-order/scripts/order");

// After estimate is built and SA says "order those parts"
const cartResult = await addMultipleToCart({
  vin: vehicle.vin,
  year: vehicle.year,
  make: vehicle.make,
  model: vehicle.model,
  parts: bestValueBundle.parts
});

// SA confirms -> place the order
const orderResult = await placeOrder();
```

## Notes

- Requires active PartsTech session (cookies persist via OpenClaw browser profile)
- Login is checked automatically on each operation
- If login expires, re-authenticates using PARTSTECH_USERNAME and PARTSTECH_PASSWORD env vars
- Cart state persists in the browser session between calls
- Graceful degradation: if browser automation fails, returns error without crashing
- The API skill (partstech-search) continues to work independently
