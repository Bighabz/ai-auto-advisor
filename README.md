# 🔧 AI Auto Mechanic Service Advisor

> AI-powered "done-for-you" package that replaces a virtual assistant for auto repair shops. One text message → complete estimate with diagnosis, best-value parts ready to order, PDF for customer, and full mechanic reference specs.

Built on [OpenClaw](https://openclaw.ai) with custom skills for automotive repair databases and shop management.

---

## What It Does

A service advisor texts the AI via WhatsApp/Telegram with a vehicle and complaint:

> "2019 Honda Civic 2.0L, VIN 1HGBH41JXMN109186, P0420 code, customer John Smith 555-0123"

**In ~30 seconds, the system returns:**

### For the Service Advisor
✅ **Diagnosis** with most likely fix and confidence level  
✅ **Best-value parts** from PartsTech with vendor comparison  
✅ **Complete estimate** created in AutoLeap, ready to send to customer  
✅ **Downloadable PDF** estimate ready to email

### For the Mechanic
✅ **Exact vehicle specs** — Year/Make/Model/Trim/Engine code (for parts accuracy)  
✅ **Sensor locations** — Bank 1 vs Bank 2, upstream vs downstream, access notes  
✅ **Fluid specs** — Oil capacity (4.4 qts), oil weight (0W-20), coolant type  
✅ **Torque specs** — Drain plug (29 ft-lb), O2 sensor (33 ft-lb), lug nuts  
✅ **Special tools** — 22mm O2 socket, penetrating oil, anti-seize  
✅ **Procedure screenshots** from AllData/ProDemand

---

## Example Response

```
═══════════════════════════════════════════════════════════════
  ESTIMATE READY — 2019 Honda Civic EX
═══════════════════════════════════════════════════════════════

📋 VEHICLE (Exact for Parts Accuracy)
   2019 Honda Civic EX
   Engine: 2.0L 4cyl K20C2
   VIN: 1HGBH41JXMN109186
   Trans: CVT | Drive: FWD

🔍 DIAGNOSIS
   Most likely: Downstream O2 sensor (78% per Identifix)
   TSB 19-071 applies

🛒 PARTS — BEST VALUE (Ready to Order)
   ✓ Denso Oxygen Sensor (downstream)
     Part #: 234-9119 | $64.50 | In Stock
     Supplier: O'Reilly Auto Parts

   OEM ALTERNATIVE: Honda 36532-5BA-A01: $189.99

💰 ESTIMATE TOTAL: $285.45
   AutoLeap: EST-ABC123 (Ready to send)

🔧 MECHANIC REFERENCE
   SENSORS: Bank 1 only (inline-4). B1S2 downstream, access from below.
   OIL: 4.4 qts with filter — 0W-20
   TORQUE: O2 sensor 33 ft-lb
   TOOLS: 22mm O2 socket, anti-seize

📄 PDF: Ready to download/email
═══════════════════════════════════════════════════════════════
```

---

## Architecture

```
Service Advisor (WhatsApp/Telegram/Slack)
         │
         ▼
   OpenClaw Gateway (DigitalOcean VPS)
         │
    ┌────┴────┐
    │ Claude  │ ← Reasoning engine
    └────┬────┘
         │
   ┌─────┴──────────────────────────────┐
   │         CUSTOM SKILLS               │
   │                                     │
   │  🔧 alldata-lookup      (browser)   │
   │  🔍 identifix-search    (browser)   │
   │  📋 prodemand-lookup    (browser)   │
   │  🛒 partstech-search    (API)       │ ← Best-value vendor comparison
   │  💰 autoleap-estimate   (API)       │ ← Create estimates, send to customer
   │  🚗 vin-decoder         (API)       │ ← Exact vehicle specs
   │  📊 vehicle-specs       (local)     │ ← Sensor locations, fluids, torque
   │  📄 estimate-pdf        (local)     │ ← Generate downloadable PDF
   │  ⚡ estimate-builder    (chain)     │ ← Orchestrates everything
   │                                     │
   └─────────────────────────────────────┘
```

---

## Skills

| Skill | Type | What It Does |
|-------|------|--------------|
| `alldata-lookup` | Browser (CDP) | OEM procedures, TSBs, wiring diagrams, screenshots |
| `identifix-search` | Browser (CDP) | Known fixes ranked by success rate |
| `prodemand-lookup` | Browser/API | Real Fixes, labor times, part numbers |
| `partstech-search` | REST API | **Best-value parts** from 225+ suppliers with vendor comparison |
| `autoleap-estimate` | REST API | Create estimates, add line items, **send to customer** |
| `vin-decoder` | REST API | Exact YMME + trim + engine code for parts accuracy |
| `vehicle-specs` | Local | **Sensor locations** (bank 1/2), **fluids**, **torque specs**, **tools** |
| `estimate-pdf` | Local | Generate professional **PDF estimate** for download/email |
| `estimate-builder` | Orchestrator | Chains all skills into one-shot complete estimate |

---

## Key Features

### 🛒 Best-Value Parts Selection
- Searches all connected PartsTech suppliers simultaneously
- Compares OEM vs aftermarket pricing
- Ranks by: price, availability (in-stock first), supplier distance
- Returns **ready-to-order** part numbers with supplier info
- Formats parts for AutoLeap line items automatically

### 📊 Full Mechanic Reference
Every estimate includes:

| Info | Example |
|------|---------|
| **Sensor locations** | "Bank 1 Sensor 2 (downstream): After catalytic converter, access from below" |
| **Bank identification** | "Inline 4-cyl: Bank 1 only. V6 transverse: Bank 1 = firewall side" |
| **Oil capacity** | "4.4 quarts with filter, 4.0 without" |
| **Oil weight** | "0W-20 (API SN or ILSAC GF-5)" |
| **Coolant** | "6.4 quarts — Honda Type 2 Blue (OAT)" |
| **Torque specs** | "Oil drain plug: 29 ft-lb, O2 sensor: 33 ft-lb" |
| **Special tools** | "22mm O2 sensor socket (slotted), anti-seize compound" |

### 📄 PDF Estimate Generation
- Professional layout with shop branding
- Itemized labor and parts breakdown
- OEM vs Aftermarket options with checkboxes
- Warranty terms and disclaimers
- Customer signature line
- **Page 2: Mechanic Reference** (internal use)

---

## Quick Start

### Prerequisites
- [OpenClaw](https://openclaw.ai) on DigitalOcean VPS (8GB/4vCPU recommended)
- [Anthropic API key](https://console.anthropic.com/) (Claude Sonnet 4.5)
- Active subscriptions: AllData, Identifix, ProDemand (Mitchell 1)
- [PartsTech account](https://partstech.com) (free) with suppliers connected
- [AutoLeap Partner API](https://developers.myautoleap.com/) credentials

### Install

```bash
# 1. Clone this repo
git clone https://github.com/YOUR_USERNAME/ai-auto-advisor.git

# 2. Copy skills to OpenClaw
cp -r ai-auto-advisor/skills/* ~/.openclaw/skills/

# 3. Install PDF generation dependency
cd ~/.openclaw/skills/estimate-pdf && npm install pdfkit

# 4. Configure credentials
cp ai-auto-advisor/config/.env.example ~/.openclaw/.env
nano ~/.openclaw/.env  # Fill in your API keys

# 5. Configure shop settings
cp ai-auto-advisor/config/shop-config.json ~/.openclaw/
nano ~/.openclaw/shop-config.json  # Set labor rate, markup, etc.

# 6. Restart OpenClaw
openclaw gateway restart
```

### Usage

Text your OpenClaw bot via WhatsApp/Telegram:

> "Build estimate — 2019 Civic 2.0L, P0420, customer John 555-0123"

Or be more specific:

> "Quote brake job front and rear pads and rotors for 2020 Camry, VIN 4T1BF1FK5LU123456"

---

## Configuration

### Environment Variables (`.env`)

```bash
ANTHROPIC_API_KEY=sk-ant-xxxxx
ALLDATA_USERNAME=your_username
ALLDATA_PASSWORD=your_password
IDENTIFIX_USERNAME=your_username
IDENTIFIX_PASSWORD=your_password
PRODEMAND_USERNAME=your_username
PRODEMAND_PASSWORD=your_password
PARTSTECH_API_KEY=your_api_key
AUTOLEAP_PARTNER_ID=your_partner_id
AUTOLEAP_AUTH_KEY=your_auth_key
```

### Shop Settings (`shop-config.json`)

```json
{
  "shop": {
    "name": "Your Shop Name",
    "laborRatePerHour": 135.00,
    "shopSuppliesPercent": 5,
    "taxRate": 0.0775
  },
  "markup": {
    "partsMarkupPercent": 40
  },
  "preferences": {
    "defaultPartsType": "aftermarket",
    "preferredSuppliers": ["O'Reilly", "AutoZone Commercial", "NAPA"]
  }
}
```

---

## Cost

| Item | Monthly |
|------|---------|
| DigitalOcean VPS (8GB/4vCPU) | $48 |
| Claude API (Sonnet, ~20 estimates/day) | $70-150 |
| OpenClaw | Free |
| PartsTech | Free |
| **Total** | **~$120-200** |

**vs. Virtual Assistant: $1,500-3,000/mo → 90%+ savings**

---

## Security

⚠️ **Important:** 341 malicious skills were found on ClawHub in February 2026. This repo contains only custom-built, audited skills.

See [docs/security.md](docs/security.md) for:
- Deployment best practices
- Credential management
- Network hardening
- What NOT to do

---

## Documentation

- [Full Architecture Plan](docs/architecture-plan.md)
- [API Integration Audit](docs/api-audit.md)
- [Security Considerations](docs/security.md)

---

## Roadmap

- [ ] CARFAX integration for vehicle history
- [ ] Appointment scheduling via AutoLeap
- [ ] Multi-shop support with Supabase backend
- [ ] Voice input via OpenClaw telephone skill
- [ ] Customer-facing chat widget

---

## License

MIT

## Author

Built by [Habib](https://github.com/YOUR_USERNAME) — AI Horizon Project @ CSUSB
