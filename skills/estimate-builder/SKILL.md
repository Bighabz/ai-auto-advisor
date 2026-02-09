---
emoji: ⚡
name: estimate-builder
description: >
  Master orchestrator that produces a complete estimate in one shot:
  diagnosis → best-value parts from PartsTech → estimate in AutoLeap →
  downloadable PDF → full mechanic reference (sensor locations, fluids, torque, tools).
requires:
  bins:
    - node
  env:
    - ANTHROPIC_API_KEY
    - ALLDATA_USERNAME
    - IDENTIFIX_USERNAME
    - PRODEMAND_USERNAME
    - PARTSTECH_API_KEY
    - AUTOLEAP_PARTNER_ID
install: |
  npm install pdfkit
---

# Estimate Builder — Full Pipeline Orchestrator

One command, complete estimate with everything the service advisor and mechanic need.

## What It Produces

### For the Service Advisor
- **Diagnosis summary** with confidence level
- **Parts pricing** with best-value picks from multiple vendors
- **Complete estimate** ready in AutoLeap
- **PDF download** ready to email to customer

### For the Mechanic
- **Exact vehicle specs** (Year/Make/Model/Trim/Engine code for parts accuracy)
- **Sensor locations** (Bank 1 vs Bank 2, upstream vs downstream, access notes)
- **Fluid specifications** (oil capacity with filter, oil weight, coolant type)
- **Torque specs** (drain plug, O2 sensor, lug nuts, etc.)
- **Special tools required** (22mm O2 socket, filter wrench, etc.)
- **Procedure screenshots** from AllData/ProDemand

## Input

```javascript
{
  // Vehicle (VIN preferred for exact fitment)
  vin: "1HGBH41JXMN109186",
  // OR manual entry:
  year: 2019,
  make: "Honda",
  model: "Civic",
  trim: "EX",
  engine: "2.0L",
  mileage: 45000,

  // Problem / Request
  query: "P0420 catalyst efficiency below threshold",

  // Customer (optional - required for AutoLeap estimate)
  customer: {
    name: "John Smith",
    phone: "555-123-4567",
    email: "john@email.com"
  }
}
```

## Output

### Formatted Response (sent to service advisor via WhatsApp/Telegram)

```
═══════════════════════════════════════════════════════════════
  ESTIMATE READY — 2019 Honda Civic EX
═══════════════════════════════════════════════════════════════

📋 VEHICLE (Exact for Parts Accuracy)
   2019 Honda Civic EX
   Engine: 2.0L 4cyl Gasoline
   VIN: 1HGBH41JXMN109186
   Trans: CVT | Drive: FWD

🔍 DIAGNOSIS
   Most likely: Downstream O2 sensor failure (78% success rate per Identifix)
   Secondary: Catalytic converter degradation (15%)
   TSB: 19-071 applies to this vehicle

🛒 PARTS — BEST VALUE (Ready to Order)
   ✓ Denso Oxygen Sensor (downstream)
     Part #: 234-9119 | $64.50 | In Stock
     Supplier: O'Reilly Auto Parts - Main St

   PARTS TOTAL: $64.50
   ✓ All in stock

   OEM ALTERNATIVE:
   • Honda 36532-5BA-A01: $189.99

💰 ESTIMATE TOTAL
   Labor:        $162.00 (1.2 hrs × $135/hr)
   Parts:        $90.30 (incl. 40% markup)
   Shop Supplies: $12.62
   Tax:          $20.53
   ─────────────────
   TOTAL:        $285.45

   AutoLeap Estimate: EST-ABC123 (Ready to send to customer)

🔧 MECHANIC REFERENCE

   SENSOR LOCATIONS:
   Inline 4-cylinder - Bank 1 only (no Bank 2)
   • Bank 1 Sensor 1 (B1S1): Upstream - exhaust manifold, from above
   • Bank 1 Sensor 2 (B1S2): Downstream - after cat, from below

   FLUID SPECS:
   • Oil: 4.4 quarts with filter — 0W-20
   • Coolant: 6.4 quarts — Honda Type 2 Blue (OAT)

   TORQUE SPECS:
   • Oil Drain Plug: 29 ft-lb
   • O2 Sensor: 33 ft-lb
   • Lug Nuts: 80 ft-lb

   SPECIAL TOOLS:
   • 22mm O2 sensor socket (slotted for wire)
   • Penetrating oil
   • Anti-seize compound

📄 ESTIMATE PDF: /tmp/estimate-2019-Honda-Civic-1706789012.pdf
   (Ready to download or email to customer)

═══════════════════════════════════════════════════════════════
```

### PDF Estimate

Professional PDF with:
- Shop letterhead and branding
- Customer and vehicle info
- Itemized labor and parts breakdown
- OEM vs Aftermarket options with checkboxes
- Warranty terms and disclaimers
- Customer signature line
- **Page 2: Mechanic Reference** (internal use) with all specs

## Workflow Steps

1. **VIN Decode** → Exact YMME + trim + engine code
2. **Parallel Research** → AllData + Identifix + ProDemand
3. **Vehicle Specs** → Sensor locations, fluids, torque, tools
4. **Parts Search** → PartsTech best-value from all connected suppliers
5. **Vendor Comparison** → OEM vs aftermarket with pricing
6. **AutoLeap Estimate** → Create with line items, ready to send
7. **PDF Generation** → Download/email ready
8. **Screenshots** → Procedure images from AllData/ProDemand

## Conditional Routing

| Scenario | Behavior |
|----------|----------|
| DTC code provided | Full diagnostic research across all 3 databases |
| Maintenance service | Skip diagnostic, go straight to labor + parts |
| Multiple possible repairs | Present options for service advisor selection |
| Parts unavailable | Flag alternatives and backorder options |
| No VIN provided | Warn about fitment accuracy, proceed with YMME |
| No customer info | Skip AutoLeap creation, still produce PDF |

## Example Usage

**Via WhatsApp/Telegram:**
> "Build estimate — 2019 Civic 2.0L VIN 1HGBH41JXMN109186, P0420 code, customer John Smith 555-0123"

**Response includes everything above, plus:**
> "Want me to send the estimate to John?"
