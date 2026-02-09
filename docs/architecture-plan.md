# AI Auto Mechanic Service Advisor — OpenClaw Architecture Plan

**Project:** Done-For-You AI Package for Auto Repair Shops  
**Agent Framework:** OpenClaw (formerly MoltBot / ClawdBot)  
**Goal:** Replace VA — AI looks up repair info, builds estimates, guides service advisors  
**Author:** Habib — AI Horizon Project  
**Date:** February 3, 2026

---

## 1. Why OpenClaw Is a Great Fit for This

OpenClaw is Peter Steinberger's open-source autonomous AI agent (145k+ GitHub stars) that runs on your own hardware and connects to messaging platforms. Here's why it works for a shop:

- **Built-in browser automation** via Chrome DevTools Protocol (CDP) — perfect for AllData, Identifix, and ProDemand which have no APIs
- **Custom Skills system** — you'll build skills for AutoLeap API, PartsTech API, and the browser scraping workflows
- **Messaging-native** — service advisors text the AI through WhatsApp, Telegram, or Slack, just like texting a colleague
- **Web Dashboard (Control UI)** — browser-based GUI for configuration and interaction
- **Persistent memory** — remembers vehicles, customers, past estimates across sessions
- **Cron scheduling** — proactive daily briefings, pending estimate reminders, parts order follow-ups
- **DigitalOcean 1-Click Deploy** — matches your existing infra at hjworkflows.com
- **Model-agnostic** — works with Claude (recommended), GPT, Gemini, or local models

---

## 2. API & Integration Audit (Unchanged from Research)

### Has API — Direct Integration via OpenClaw Custom Skills

| Platform | API Status | Integration Method |
|----------|-----------|-------------------|
| **AutoLeap** | ✅ Partner API (`developers.myautoleap.com`) | Custom OpenClaw skill wrapping REST API |
| **PartsTech** | ✅ Parts Ordering API (`api-docs.partstech.com`) | Custom OpenClaw skill wrapping REST API |
| **Mitchell 1 ProDemand** | ⚠️ TAPE Partner Integration (requires approval) | Apply now; browser automation fallback |

### No API — Use OpenClaw's Built-In Browser Automation

| Platform | Workaround |
|----------|------------|
| **AllData Repair** | OpenClaw browser skill → CDP automation → login, VIN search, extract procedures |
| **Identifix Direct-Hit** | OpenClaw browser skill → CDP automation → search known fixes, extract data |
| **ProDemand** (fallback) | OpenClaw browser skill → CDP automation until TAPE API approved |

---

## 3. System Architecture with OpenClaw

```
┌──────────────────────────────────────────────────────────┐
│               SERVICE ADVISOR INTERFACE                   │
│                                                          │
│  ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐ │
│  │WhatsApp │  │ Telegram │  │  Slack   │  │ Web UI  │ │
│  │(phone)  │  │  (phone) │  │ (desktop)│  │(browser)│ │
│  └────┬────┘  └────┬─────┘  └────┬─────┘  └────┬────┘ │
│       └─────────────┴─────────────┴──────────────┘      │
└──────────────────────┬───────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────┐
│            OPENCLAW GATEWAY (DigitalOcean VPS)            │
│           Session management, memory, routing             │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │              CLAUDE API (Anthropic)                │   │
│  │     Reasoning engine — plans, decides, responds   │   │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│  ┌──────────── CUSTOM SKILLS ──────────────────────┐    │
│  │                                                  │    │
│  │  🔧 alldata-lookup                              │    │
│  │     Browser automation → search by VIN/YMME     │    │
│  │     Extract: procedures, TSBs, diagrams, specs  │    │
│  │     Screenshot teardown/install steps            │    │
│  │                                                  │    │
│  │  🔧 identifix-search                            │    │
│  │     Browser automation → Direct-Hit search      │    │
│  │     Extract: known fixes, common failures       │    │
│  │     Ranked by frequency/confidence              │    │
│  │                                                  │    │
│  │  🔧 prodemand-lookup                            │    │
│  │     Browser automation (or TAPE API if approved) │    │
│  │     Extract: Real Fixes, labor times, parts     │    │
│  │                                                  │    │
│  │  🔧 partstech-search                            │    │
│  │     REST API → search parts by VIN + part #     │    │
│  │     Returns: live pricing, inventory, suppliers  │    │
│  │                                                  │    │
│  │  🔧 autoleap-estimate                           │    │
│  │     REST API → create/update estimates           │    │
│  │     Add line items, labor, parts, markup         │    │
│  │     Send estimate to customer                    │    │
│  │                                                  │    │
│  │  🔧 vin-decoder                                 │    │
│  │     NHTSA API (free) → decode VIN               │    │
│  │     Returns: year, make, model, engine, trim    │    │
│  │                                                  │    │
│  │  🔧 estimate-builder                            │    │
│  │     Orchestrates: research → parts → quote      │    │
│  │     Applies shop markup rules                   │    │
│  │     Formats for service advisor review          │    │
│  │                                                  │    │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│  ┌──────────── BROWSER AUTOMATION ─────────────────┐    │
│  │  OpenClaw Managed Browser (CDP)                  │    │
│  │  Headless Chromium in isolated Docker container   │    │
│  │  Saved auth sessions for AllData/Identifix/PD    │    │
│  │  Snapshot system for AI to "see" page structure   │    │
│  └──────────────────────────────────────────────────┘   │
│                                                          │
│  ┌──────────── PERSISTENT STORAGE ─────────────────┐    │
│  │  ~/.openclaw/memory/ — conversation history      │    │
│  │  Local JSON/SQLite — vehicle cache, quote log    │    │
│  │  Optional: Supabase for multi-shop scaling       │    │
│  └──────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────┘
```

---

## 4. The Workflow — What Happens When a Service Advisor Texts

**Service advisor sends via WhatsApp:**
> "2019 Honda Civic 2.0L, customer says check engine light on, P0420 code"

**OpenClaw processes this through skills in sequence:**

### Step 1: VIN/Vehicle Decode
- `vin-decoder` skill decodes the vehicle
- OpenClaw memory checks if this customer/vehicle has been seen before

### Step 2: Parallel Research (This is Where the Magic Happens)
OpenClaw's browser automation opens 3 tabs simultaneously:

**AllData** → Searches P0420 for 2019 Civic 2.0L
- Extracts: TSBs related to catalytic converter efficiency
- Screenshots: Removal/installation procedure with torque specs
- Captures: Wiring diagram for O2 sensors

**Identifix Direct-Hit** → Searches known fixes
- "Top fix: Replace downstream O2 sensor (78% success rate)"
- "Second fix: Replace catalytic converter (15%)"
- Common misdiagnosis warnings

**ProDemand** → Real Fixes + labor times
- Labor: 1.2 hours for O2 sensor, 2.8 hours for catalytic converter
- Parts: upstream/downstream sensor part numbers
- Related TSBs and recalls

### Step 3: Claude Synthesizes the Results
Claude reads all the extracted data and determines:
- Most likely repair: downstream O2 sensor replacement (based on Identifix success rate)
- Recommended diagnostic: Verify with live sensor data before committing
- Upsell opportunity: Also inspect catalytic converter while in there

### Step 4: Parts Pricing
- `partstech-search` skill queries PartsTech API
- Pulls live pricing from cousin's connected suppliers
- OEM Denso sensor: $89.99 (in stock at local supplier)
- Aftermarket Bosch: $64.50 (in stock)

### Step 5: Build the Estimate
- `autoleap-estimate` skill creates estimate via API:
  - Labor: 1.2 hrs × shop rate
  - Parts: O2 sensor (customer choice OEM/aftermarket)
  - Shop supplies + tax
  - Diagnostic fee
- Sends estimate draft to AutoLeap for review

### Step 6: Reply to Service Advisor

**OpenClaw responds via WhatsApp:**
> **2019 Honda Civic 2.0L — P0420 Diagnosis & Estimate**
>
> **Most Likely Fix:** Downstream O2 sensor replacement (78% success per Identifix)
>
> **Labor:** 1.2 hrs
> **Parts:**
> - OEM Denso 234-9119: $89.99 (in stock @ AutoZone Commercial)
> - Aftermarket Bosch 15510: $64.50 (in stock @ O'Reilly)
>
> **Estimate total:** $XXX (created in AutoLeap — ready for review)
>
> **⚠️ Recommend:** Verify with live O2 sensor data before replacing. TSB 19-071 applies.
>
> **Procedure attached** [screenshots of R&R steps from AllData]
>
> Want me to send the estimate to the customer?

---

## 5. Custom Skill Structure (How to Build Each One)

Each skill lives in `~/.openclaw/skills/` on your VPS. Here's the structure:

### Example: `alldata-lookup` skill

```
~/.openclaw/skills/alldata-lookup/
├── SKILL.md          # Instructions for OpenClaw on when/how to use this
├── scripts/
│   ├── search.js     # Browser automation: login, search, extract
│   ├── screenshot.js # Capture procedure images
│   └── parse.js      # Structure extracted HTML into clean data
└── package.json      # Dependencies (if any)
```

**SKILL.md contents:**
```yaml
---
emoji: 🔧
name: alldata-lookup
description: Search AllData Repair for vehicle service procedures, TSBs, DTCs, and labor times
requires:
  env:
    - ALLDATA_USERNAME
    - ALLDATA_PASSWORD
  config:
    - alldata_url
---

# AllData Repair Lookup

Use this skill when you need to find OEM repair procedures, technical service
bulletins, diagnostic trouble codes, labor times, wiring diagrams, or
teardown/installation procedures for a specific vehicle.

## Usage
- Search by Year/Make/Model/Engine + symptom or DTC code
- Returns: procedure steps, torque specs, fluid capacities, diagrams
- Can capture screenshots of step-by-step procedures

## How it works
1. Opens AllData in the managed browser
2. Navigates to the vehicle (YMME or VIN)
3. Searches for the requested repair/diagnostic info
4. Extracts structured data and captures screenshots
5. Returns formatted results to the conversation
```

### Example: `partstech-search` skill

```
~/.openclaw/skills/partstech-search/
├── SKILL.md
└── scripts/
    └── search.js     # REST API calls to PartsTech
```

This one doesn't need browser automation — it's a clean API integration:
```javascript
// scripts/search.js
const fetch = require('node-fetch');

async function searchParts(vin, partType) {
  const response = await fetch('https://api.partstech.com/v1/search', {
    headers: {
      'Authorization': `Bearer ${process.env.PARTSTECH_API_KEY}`,
      'Content-Type': 'application/json'
    },
    method: 'POST',
    body: JSON.stringify({ vin, partType })
  });
  return response.json();
}
```

---

## 6. GUI vs Chat — You Get Both

### Primary Interface: Messaging (WhatsApp/Telegram/Slack)
The service advisor texts the AI from their phone or shop computer. This is the "chat box" — but it's in apps they already use daily. No new software to learn.

### Secondary Interface: OpenClaw Control UI (Web Dashboard)
OpenClaw has a browser-based web dashboard at `https://your-vps-ip/?token=YOUR_TOKEN`. This gives you:
- Conversation history viewer
- Skills management (install/configure)
- System status and logs
- Configuration settings

### Optional Phase 2: Custom Web Dashboard
If your cousin wants a dedicated shop dashboard with panels for:
- Active vehicles/estimates
- Procedure image gallery
- Parts comparison tables
- Technician assignment board

You could build a React frontend that reads from OpenClaw's memory/storage and the AutoLeap API. But start with messaging — it's faster to deploy and service advisors will adopt it instantly.

---

## 7. Hosting on VPS — DigitalOcean Setup

### Option A: DigitalOcean 1-Click Deploy (Recommended to Start)
DigitalOcean has an official OpenClaw 1-Click image that handles:
- Docker container isolation
- Authenticated gateway token
- Hardened firewall rules
- Non-root user execution
- Automatic service restart on reboot

**Steps:**
1. Go to DigitalOcean Marketplace → search "OpenClaw"
2. Deploy on a 8GB/4vCPU droplet ($48/mo)
3. SSH in, run the setup wizard
4. Connect your Anthropic API key
5. Pair with WhatsApp (scan QR code)
6. Install custom skills

### Option B: Manual Docker Compose (More Control)
```bash
# On your existing hjworkflows.com VPS
git clone https://github.com/openclaw/openclaw.git
cd openclaw
docker compose up -d
```

### Login Access for the Shop
No batch script needed. Two options:
1. **WhatsApp/Telegram** — they just text the bot from their phone
2. **Web Dashboard** — bookmark `https://advisor.hjworkflows.com/?token=GATEWAY_TOKEN`

The gateway token authenticates access. Each service advisor pairs their messaging app with the OpenClaw instance.

---

## 8. Cost Reality Check

### API Token Costs (The Real Expense)

| Usage Level | Monthly Cost | Notes |
|-------------|-------------|-------|
| Light (5-10 estimates/day, Sonnet) | $30-70/mo | Recommended starting point |
| Moderate (15-25 estimates/day, Sonnet) | $70-150/mo | Good for busy single shop |
| Heavy (30+ estimates/day, Opus) | $300-750/mo | Opus is smarter but 5x more expensive |

**Recommendation:** Start with Claude Sonnet 4.5 ($3/$15 per million input/output tokens). It's fast and smart enough for this use case. Only escalate to Opus for complex diagnostic reasoning if needed.

### Total Monthly Cost

| Item | Cost |
|------|------|
| DigitalOcean Droplet (8GB/4vCPU) | $48 |
| Anthropic API (Sonnet, moderate usage) | $70-150 |
| OpenClaw software | Free (MIT license) |
| PartsTech | Free |
| Existing shop subscriptions (AllData, Identifix, ProDemand, AutoLeap) | $0 additional |
| **Total** | **~$120-200/mo** |

**vs. VA at $1,500-3,000/mo → 90-93% cost reduction**

### Cost Optimization Tips
- Cache common procedures locally (don't re-lookup the same P0420 for Civic every time)
- Use OpenClaw's persistent memory to avoid redundant API calls
- Set the model to Sonnet by default, Opus only for complex diagnostics
- Browser automation is free (no API cost) — only Claude reasoning costs tokens

---

## 9. Security Considerations (Important)

Given your security background, you'll appreciate these concerns:

### Do
- Deploy on a **dedicated VPS**, never on a personal machine
- Use DigitalOcean's 1-Click with built-in security hardening
- Store AllData/Identifix credentials as encrypted environment variables
- Audit all skills before installing — **341 malicious skills were found on ClawHub** (reported Feb 1, 2026)
- Only install skills you write yourself or from trusted sources
- Run OpenClaw in Docker container isolation
- Enable the gateway token for authenticated access
- Set `tools.elevated` carefully — audit what gets sandbox bypass

### Don't
- Don't install random skills from ClawHub without code review
- Don't run on your cousin's shop computer directly
- Don't store customer PII in OpenClaw's memory without encryption
- Don't give OpenClaw access to payment/financial systems
- Don't use a Claude Max subscription for automated access (violates TOS)

---

## 10. Research & Build Phases

### Phase 1: Foundation (Week 1-2)
1. Deploy OpenClaw on DigitalOcean (1-Click or Docker Compose)
2. Connect Anthropic API key (Sonnet 4.5)
3. Pair with WhatsApp and/or Telegram
4. Test basic functionality: web search, file creation, browser automation
5. Get AllData, Identifix, and ProDemand login credentials from cousin

### Phase 2: Browser Automation Skills (Week 2-4)
6. Build `alldata-lookup` skill — browser login, VIN search, procedure extraction, screenshots
7. Build `identifix-search` skill — Direct-Hit search, known fixes extraction
8. Build `prodemand-lookup` skill — Real Fixes, labor times, parts lookup
9. Handle session persistence (cookie reuse to avoid re-login)
10. Test on 10+ real vehicles with known issues

### Phase 3: API Integration Skills (Week 3-5)
11. Sign up for PartsTech, get API key, build `partstech-search` skill
12. Apply for AutoLeap Partner API access, build `autoleap-estimate` skill
13. Build `vin-decoder` skill (NHTSA free API)
14. Submit Mitchell 1 TAPE integration request (parallel track)

### Phase 4: Orchestration & Intelligence (Week 5-7)
15. Build `estimate-builder` skill that chains: decode → research → price → quote
16. Configure shop-specific settings: labor rate, markup %, preferred suppliers
17. Set up cron jobs: morning pending estimate reminder, parts order status check
18. Build procedure screenshot pipeline with step numbering

### Phase 5: Test & Deploy (Week 7-9)
19. Run 20+ real estimates through the full pipeline
20. Compare AI estimates vs. VA estimates for accuracy
21. Train service advisors (10-minute walkthrough: "just text it like a person")
22. Set up monitoring and error alerts
23. Document the system for maintenance

### Phase 6: Scale (Month 3+)
24. Package as a repeatable "done-for-you" service for other shops
25. Add Supabase backend for multi-shop data
26. Build custom web dashboard if needed
27. Publish skills to ClawHub (after security audit)
28. Market through AI Horizon project

---

## 11. Key URLs & Resources

| Resource | URL |
|----------|-----|
| OpenClaw Official Site | `https://openclaw.ai` |
| OpenClaw Docs | `https://docs.openclaw.ai` |
| OpenClaw GitHub | `https://github.com/openclaw/openclaw` |
| DigitalOcean 1-Click Deploy Guide | `digitalocean.com/community/tutorials/how-to-run-openclaw` |
| OpenClaw Browser Automation Docs | `https://docs.openclaw.ai/tools/browser` |
| Custom Skill Creation Guide | Search "OpenClaw Custom Skill Creation Step by Step" |
| AutoLeap Developer Portal | `https://developers.myautoleap.com/` |
| PartsTech API Docs | `https://api-docs.partstech.com/` |
| Mitchell 1 API/Integration Request | `https://mitchell1.com/resources/api-request/` |
| NHTSA VIN Decoder (free) | `https://vpic.nhtsa.dot.gov/api/` |
| Awesome OpenClaw Skills (reference) | `github.com/VoltAgent/awesome-openclaw-skills` |

---

## 12. Comparison: OpenClaw vs. Open WebUI + LangGraph

| Factor | OpenClaw | Open WebUI + LangGraph |
|--------|----------|----------------------|
| **Browser automation** | Built-in (CDP) | Must add Playwright separately |
| **Messaging integration** | Native (WhatsApp, Telegram, Slack) | None — browser-only |
| **GUI** | Control UI dashboard + messaging | Full ChatGPT-like web UI |
| **Image display** | Via messaging apps (limited) | Rich inline display |
| **Skill/plugin system** | Built-in, SKILL.md format | Custom code needed |
| **Cron/proactive tasks** | Built-in scheduler | Must build separately |
| **Persistent memory** | Built-in | Must add database |
| **Setup complexity** | 1-Click deploy available | Multiple services to configure |
| **Maturity** | Weeks old, moving fast | Established, stable |
| **Security track record** | Active concerns (malicious skills) | More vetted |
| **API cost** | Same (depends on model) | Same |
| **Best for** | Messaging-first workflow | Dashboard-first workflow |

**Verdict:** OpenClaw is the better fit if your cousin's service advisors prefer texting from their phone. Open WebUI is better if they want a desktop dashboard with rich image/procedure display. You could even run both — OpenClaw for messaging + Open WebUI for the dashboard — against the same backend.
