# SAM Diagnostics Engine v2 — Full Scope Design

**Date:** February 6, 2026
**Author:** Habib — AI Horizon Project
**Status:** Approved for implementation

---

## Vision

SAM is an AI virtual service advisor that replaces the human VA for auto repair shops. A tech or service advisor texts SAM with a vehicle and symptoms — SAM researches the problem, builds a complete estimate with best-value parts from PartsTech, pulls labor times, attaches diagrams and procedures, and delivers a ready-to-send quote. The SA can then order parts, send the estimate to the customer, or ask follow-up questions — all through chat.

Any shop can set it up by providing their platform logins. SAM handles the rest.

**Competitor reference:** MasterTech.ai — AI-driven estimates from shop history, OEM R&R parts extraction, canned jobs, overdue service detection. SAM matches and exceeds this by adding real-time parts ordering, browser automation across all major platforms, and a conversational AI assistant.

---

## Four Modes of Operation

### 1. Estimate Mode (Primary Workflow)
Tech provides vehicle + symptoms/codes + mileage. SAM returns a complete estimate with diagnosis, repair plan, priced parts, labor times, PDF, diagrams, and mechanic reference.

### 2. Chat Mode (Always Available)
Tech or SA asks any automotive question at any time. SAM answers from the knowledge base, OEM data, or Claude reasoning. Can reference the current vehicle/repair context. Can update estimates mid-conversation.

### 3. Labor Guide Mode
SA asks for labor time on a specific job. SAM pulls from ARI labor guides (seeded + live fallback), ProDemand, or the knowledge base. Returns hours, procedure overview, special tools needed.

### 4. Diagram Mode
Tech asks for a diagram or part location. SAM pulls from AllData/ProDemand via browser automation when available, or provides detailed text descriptions with locations from the knowledge base.

---

## End-to-End Pipeline

```
Tech texts SAM: "2019 Civic 87k miles, P0420, runs rough at idle"
     |
     +-- 1. IDENTIFY VEHICLE
     |    VIN decode (NHTSA) -> exact year/make/model/trim/engine
     |
     +-- 2. DIAGNOSE
     |    Knowledge base lookup (instant, pgvector)
     |    -> High confidence? Use KB repair plan directly
     |    -> Low confidence? Call Claude with RAG context
     |    Check NHTSA for TSBs/recalls
     |
     +-- 3. BUILD REPAIR PLAN
     |    Parts list with positions, quantities, OEM-vs-aftermarket
     |    Labor time from ARI / KB / ProDemand
     |    Mechanic notes, tools, torque specs
     |    Diagrams from AllData/ProDemand (when available)
     |
     +-- 4. PRICE PARTS
     |    PartsTech browser automation (like a human SA)
     |    -> Search each part by vehicle + part name
     |    -> Compare suppliers, pick best value in-stock
     |    -> Hold in cart, ready to order on demand
     |
     +-- 5. BUILD ESTIMATE
     |    Parts (with shop markup) + Labor + Shop supplies + Tax
     |    Create in AutoLeap (browser automation)
     |    Generate PDF
     |
     +-- 6. DELIVER
     |    Send formatted quote to SA via WhatsApp/Telegram
     |    Attach: PDF, diagrams, labor guide, mechanic reference
     |
     +-- 7. ON DEMAND
          SA: "order those parts"       -> SAM orders via PartsTech
          SA: "torque on cat bolts?"    -> SAM answers from KB/OEM
          SA: "add cabin filter"        -> SAM updates estimate
          Tech: "where's the MAF?"      -> SAM answers with location
          SA: "send to customer"        -> SAM sends via AutoLeap
```

---

## Diagnosis-Driven Repair Plan

### The Problem With v1
The v1 diagnostics engine returns a flat JSON blob — causes with confidence scores, a parts name list, and estimated labor hours. The orchestrator picks through it, but the connections are shallow:
- Parts search gets part names but no positions, quantities, or OEM preference
- Labor hours are estimates baked into the knowledge base, not real data
- Mechanic specs come from a separate static database, unconnected to the diagnosis
- The estimate uses generic/hardcoded values instead of diagnosis-specific data
- The PDF doesn't reflect diagnostic complexity

### The v2 Solution: Repair Plan Object
The diagnosis doesn't just say "bad catalytic converter." It produces a **repair plan** — a structured object that every downstream skill consumes directly.

```json
{
  "repair_plan": {
    "primary_cause": "Catalytic converter failure",
    "confidence": 0.82,
    "parts": [
      {
        "name": "catalytic converter",
        "position": "bank 1",
        "qty": 1,
        "type": "direct-fit",
        "oem_preferred": true,
        "search_terms": ["catalytic converter", "cat converter direct fit"]
      },
      {
        "name": "exhaust gasket",
        "position": "cat flange",
        "qty": 2,
        "type": "any",
        "oem_preferred": false,
        "search_terms": ["exhaust flange gasket"]
      },
      {
        "name": "O2 sensor",
        "position": "downstream B1S2",
        "qty": 1,
        "type": "inspect-first",
        "conditional": true,
        "condition": "Replace if voltage reading mirrors upstream sensor",
        "search_terms": ["oxygen sensor downstream bank 1"]
      }
    ],
    "labor": {
      "hours": 2.8,
      "source": "ari",
      "category": "intermediate",
      "requires_lift": true,
      "special_notes": "Exhaust work. Apply penetrating oil to studs 24hrs prior."
    },
    "tools": [
      "22mm O2 socket (slotted)",
      "penetrating oil",
      "torque wrench",
      "exhaust hanger removal tool"
    ],
    "torque_specs": {
      "cat flange bolts": "40 ft-lb",
      "O2 sensor": "33 ft-lb"
    },
    "verification": {
      "before_repair": "Compare B1S1 vs B1S2 voltage with scan tool. If B1S2 mirrors B1S1, cat confirmed bad.",
      "after_repair": "Clear codes, drive 50+ miles, verify readiness monitors complete. Check for exhaust leaks."
    },
    "diagrams_needed": ["catalytic converter location", "O2 sensor wiring", "exhaust system layout"],
    "tsbs": [],
    "recalls": []
  }
}
```

This repair plan is the **single source of truth**. PartsTech search uses `parts[].search_terms`. Estimate builder uses `labor.hours`. PDF generator uses `tools` and `torque_specs`. Mechanic reference uses `verification` steps. Everything flows from the diagnosis.

---

## Enriched Knowledge Base

### Schema Changes
The `diagnostic_knowledge` table gets a new `repair_plan` jsonb column that holds the full repair plan structure above. Existing columns (`parts_needed`, `labor_hours_estimate`, `labor_category`, `diagnostic_steps`) remain for backward compatibility.

When `repair_plan` is present, it takes priority. When absent, the system falls back to the existing flat fields + Claude fills gaps.

### Data Strategy
- **Top 40 DTC+vehicle combos** get full repair plans in the knowledge base (covers ~60% of shop volume)
- **Remaining entries** keep the current thin data — Claude generates repair plans on the fly for these
- **Feedback loop** enriches over time — every confirmed repair adds its repair plan back to the KB
- **ARI labor times** seeded for top 50 procedures across top 20 vehicles

---

## Labor Intelligence — ARI Integration

### Architecture
```
diagnose() identifies cause -> "catalytic converter replacement"
     |
     v
Check knowledge base for labor time
     |
     +-- Found (pre-seeded from ARI): use immediately (0ms)
     +-- NOT found: call ari-labor skill (browser automation)
                         |
                         v
                    web.ari.app -> select vehicle -> search procedure
                         |
                         v
                    Cache in labor_cache table (90-day TTL)
```

### New Skill: `ari-labor`
- Browser automation skill targeting `web.ari.app`
- Input: year, make, model, procedure name
- Output: labor hours, procedure name, notes
- Caches results in Supabase `labor_cache` table
- Graceful fallback to KB estimates if ARI is down

### New Table: `labor_cache`
```sql
labor_cache (
  id uuid PK,
  vehicle_make text NOT NULL,
  vehicle_model text NOT NULL,
  vehicle_year int NOT NULL,
  procedure_name text NOT NULL,
  labor_hours float NOT NULL,
  labor_source text DEFAULT 'ari',
  notes text,
  fetched_at timestamptz DEFAULT now(),
  expires_at timestamptz DEFAULT (now() + interval '90 days')
)
```

---

## PartsTech — Full Browser Automation

### Beyond API: Use It Like a Human
SAM doesn't just query PartsTech's API for pricing. It uses PartsTech **like a human SA would** via OpenClaw browser automation:

1. **Search** — Enter vehicle + part name, browse results
2. **Compare** — Review suppliers, pricing, availability, brands
3. **Select** — Pick best value (in-stock, preferred brand, best price)
4. **Cart** — Add to cart, ready to order
5. **Order** — When SA says "order those parts," SAM clicks through and places the order

### New Skill: `partstech-order` (extends existing `partstech-search`)
- Browser automation against logged-in PartsTech session
- Uses the repair plan's `parts[].search_terms` for accurate searching
- Applies shop preferences (preferred suppliers, OEM vs aftermarket)
- Holds parts in cart until SA confirms order
- Places order on demand

### Dual Mode
- **API mode** (current): Fast pricing lookups for estimate building
- **Browser mode** (new): Full interaction for ordering and detailed comparison

---

## Platform Browser Automation Skills

All platforms use the same pattern: OpenClaw browser automation against the shop's active logged-in session on their desktop. No separate API keys needed.

### Skills to Build/Complete

| Skill | Platform | What SAM Does | Status |
|-------|----------|---------------|--------|
| `alldata-lookup` | AllData Repair | Search procedures, TSBs, wiring diagrams. Screenshot R&R steps. Extract torque specs. | Skeleton |
| `identifix-search` | Identifix Direct-Hit | Search known fixes ranked by success rate. Extract misdiagnosis warnings. | Skeleton |
| `prodemand-lookup` | ProDemand/Mitchell 1 | Real Fixes, labor times, OEM part numbers, procedures. | Skeleton |
| `partstech-search` | PartsTech | Search parts, compare, select best value. Already has API. | Working (API) |
| `partstech-order` | PartsTech | Add to cart, place orders via browser automation. | New |
| `autoleap-estimate` | AutoLeap | Create estimates, add line items, send to customer. Pull repair history. | Working (API) |
| `ari-labor` | ARI Labor Guides | Pull labor times for common procedures. | New |

### Commercialization Setup
When a new shop signs up:
1. Shop provides their logins for each platform
2. OpenClaw stores credentials securely as encrypted env vars
3. OpenClaw browser starts sessions for each platform on first use
4. Sessions persist (cookie reuse) — no re-login needed each time
5. SAM uses whatever platforms the shop subscribes to — gracefully degrades if a platform isn't available

---

## Progressive Intelligence Tiers

The system gets smarter as more data sources come online:

### Tier 1 (Current — Works Now)
- Knowledge base (pgvector RAG) + Claude for gaps
- NHTSA TSBs/recalls (free API)
- ARI labor times (seeded + live)
- PartsTech API for parts pricing
- AutoLeap API for estimates

### Tier 2 (When Browser Skills Complete)
- AllData: OEM procedures, diagrams, torque specs replace KB estimates
- Identifix: Real success rates override KB confidence scores
- ProDemand: Real labor times override ARI/estimated times, OEM part numbers
- PartsTech browser: Full ordering capability, not just pricing

### Tier 3 (Full Integration)
- AutoLeap repair history: "This Civic was in 6 months ago for an O2 sensor — if P0420 is back, the cat is almost certainly bad now"
- Shop-wide analytics: "We've done 14 cat replacements on 2016-2019 Civics, 12 successful" — real success rates from this shop
- Feedback loop: Every confirmed repair enriches the knowledge base automatically
- Canned jobs: Pre-built common service packages from shop history

---

## AI Chat — Conversational Assistant

SAM is not just a quote machine. It's a **full automotive AI assistant** available via WhatsApp/Telegram at all times.

### Capabilities
- **Repair questions**: "What's the firing order on a 5.3L Silverado?"
- **Spec lookups**: "What's the torque for caliper bracket bolts on a 2020 Camry?"
- **Part locations**: "Where's the MAF sensor on a 2017 Altima?"
- **Procedure help**: "What's the procedure for bleeding brakes on a 2019 F-150?"
- **Estimate updates**: "Add a cabin air filter to the current estimate"
- **Order management**: "Order those parts" / "What's the status of my last order?"
- **General knowledge**: "What's the difference between DOT 3 and DOT 4 brake fluid?"

### How It Works
- OpenClaw's conversational engine is the default mode
- The estimate pipeline is triggered by specific requests ("build estimate", "quote me", DTC codes detected)
- All other messages go to the AI chat
- Chat has access to: current vehicle context, active estimate, knowledge base, Claude reasoning
- Can switch between modes fluidly: start with a question, end up building an estimate

---

## Diagram & Procedure Delivery

### Sources (by priority)
1. **AllData** (browser automation) — OEM diagrams, R&R procedures, wiring diagrams
2. **ProDemand** (browser automation) — Real Fixes with images, labor procedures
3. **Knowledge base** — Text descriptions of part locations, procedures, specs

### How Diagrams Flow
- The repair plan includes `diagrams_needed` — a list of what the tech needs to see
- If AllData/ProDemand browser skills are active, SAM captures screenshots of relevant diagrams
- Screenshots are attached to the response alongside the estimate
- If browser skills aren't available, SAM provides detailed text descriptions from the KB

### Labor Guide Delivery
- Labor time + procedure overview included in every estimate
- Source tagged: "ARI", "ProDemand", "estimated"
- Includes: special tools, prerequisite steps, torque specs, fluid specs

---

## Implementation Priorities

### Phase 1: Enrich the Engine (Next)
1. Add `repair_plan` jsonb column to `diagnostic_knowledge`
2. Add `labor_cache` table to Supabase
3. Enrich top 40 DTC+vehicle combos with full repair plans
4. Update `diagnose.js` to output repair plan objects
5. Update orchestrator to consume repair plans
6. Seed ARI labor times for top 50 procedures

### Phase 2: ARI Labor Skill
7. Build `ari-labor` skill (browser automation → web.ari.app)
8. Integrate into diagnose.js as labor time source

### Phase 3: PartsTech Browser Automation
9. Build `partstech-order` skill (browser automation for ordering)
10. Add cart management and order placement

### Phase 4: Complete Browser Skills
11. Complete `alldata-lookup` (diagrams, procedures, screenshots)
12. Complete `identifix-search` (success-rated fixes)
13. Complete `prodemand-lookup` (labor times, Real Fixes, OEM parts)

### Phase 5: AutoLeap History Integration
14. Pull repair history from AutoLeap for the current vehicle
15. Use shop-wide repair data to improve confidence scores
16. Build canned jobs from repair history patterns

### Phase 6: Commercialization
17. Multi-shop support via Supabase
18. Onboarding flow: shop provides logins, SAM configures itself
19. Shop-specific settings: markup, preferred suppliers, labor rate
20. Usage dashboard and analytics

---

## Key Design Principles

1. **Knowledge base first, Claude for gaps** — Fast and cheap for common repairs, smart for unusual ones
2. **Repair plan is the single source of truth** — Every downstream skill consumes it
3. **Browser automation = human SA** — SAM uses platforms exactly like a person would
4. **Progressive enhancement** — Works with just the KB today, gets smarter as browser skills come online
5. **Graceful degradation** — If a platform is down or not subscribed, SAM still works with what's available
6. **Feedback loop** — Every confirmed repair makes the system smarter
7. **Commercializable** — Any shop plugs in their logins and SAM works as their VA
