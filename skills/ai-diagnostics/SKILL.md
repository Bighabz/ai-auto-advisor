---
emoji: 🧠
name: ai-diagnostics
description: >
  AI-powered diagnostic engine that provides ranked causes with confidence scores,
  TSB/recall awareness, and recommended diagnostic steps. Uses Supabase pgvector
  for RAG-based knowledge retrieval and Claude API for diagnostic reasoning.
requires:
  bins:
    - node
  env:
    - SUPABASE_URL
    - SUPABASE_ANON_KEY
    - OPENAI_API_KEY
    - ANTHROPIC_API_KEY
install: |
  cd skills/ai-diagnostics && npm install @supabase/supabase-js
---

# AI Diagnostics — Diagnostic Engine

AI-powered diagnostic reasoning using RAG (Retrieval-Augmented Generation) over a vector knowledge base of DTC codes, cause mappings, and vehicle-specific patterns. Returns ranked diagnoses with confidence scores, related TSBs/recalls, and step-by-step diagnostic procedures.

## When to Use

Use this skill when you need to:
- Diagnose a vehicle problem from DTC codes and/or symptoms
- Get ranked probable causes with confidence scores
- Check for related TSBs and recalls (NHTSA)
- Generate step-by-step diagnostic procedures for the technician
- Track diagnosis outcomes to improve future accuracy

## Main Entry Point

```javascript
const { diagnose } = require("./skills/ai-diagnostics/scripts/diagnose");

const result = await diagnose({
  // Vehicle info (VIN decode output or manual)
  year: 2019,
  make: "Honda",
  model: "Civic",
  engine: "2.0L",
  mileage: 45000,

  // Problem description
  dtc_codes: ["P0420"],
  symptoms: "check engine light, slight sulfur smell",

  // Optional
  freeze_frame: { rpm: 2100, speed: 45, coolant_temp: 195 },
});
```

## Input Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `year` | number | Yes | Vehicle model year |
| `make` | string | Yes | Vehicle manufacturer |
| `model` | string | Yes | Vehicle model |
| `engine` | string | No | Engine type (e.g. "2.0L", "3.5L V6") |
| `mileage` | number | No | Current odometer reading |
| `dtc_codes` | string[] | Yes* | Array of DTC codes (e.g. `["P0420", "P0430"]`) |
| `symptoms` | string | Yes* | Free-text symptom description |
| `freeze_frame` | object | No | Freeze frame data from scan tool |

*At least one of `dtc_codes` or `symptoms` must be provided.

## Output Format

```json
{
  "diagnoses": [
    {
      "rank": 1,
      "cause": "Downstream O2 sensor failure",
      "cause_category": "sensor",
      "confidence": 0.78,
      "reasoning": "High mileage 2019 Civic with P0420. Identifix community data shows 78% of P0420 on this platform resolved by downstream O2 replacement.",
      "parts_needed": ["Downstream O2 sensor"],
      "labor_hours_estimate": 1.2,
      "labor_category": "moderate",
      "success_rate": 0.78,
      "common_misdiagnosis": "Catalytic converter replacement when O2 sensor is the root cause"
    },
    {
      "rank": 2,
      "cause": "Catalytic converter degradation",
      "cause_category": "exhaust",
      "confidence": 0.15,
      "reasoning": "Less likely given mileage. Sulfur smell could indicate cat breakdown but more commonly caused by rich running condition.",
      "parts_needed": ["Catalytic converter"],
      "labor_hours_estimate": 2.5,
      "labor_category": "heavy",
      "success_rate": 0.92,
      "common_misdiagnosis": null
    }
  ],
  "tsbs": [
    {
      "number": "19-071",
      "description": "Catalyst system efficiency below threshold — software update",
      "applicable": true,
      "source": "NHTSA"
    }
  ],
  "recalls": [],
  "diagnostic_steps": [
    "1. Read freeze frame data for P0420 — note fuel trims and O2 sensor voltages",
    "2. Monitor downstream O2 sensor with scan tool — should toggle slowly between 0.1-0.9V",
    "3. If downstream O2 is flatlined or sluggish, replace sensor",
    "4. If downstream O2 is switching normally, perform catalyst efficiency test",
    "5. Check for TSB 19-071 applicability — ECM update may resolve"
  ],
  "low_confidence_warning": false
}
```

### Output Fields

| Field | Type | Description |
|-------|------|-------------|
| `diagnoses` | array | Ranked list of probable causes (highest confidence first) |
| `diagnoses[].rank` | number | Position in ranking (1 = most likely) |
| `diagnoses[].cause` | string | Description of the probable cause |
| `diagnoses[].cause_category` | string | Category: sensor, exhaust, electrical, mechanical, software |
| `diagnoses[].confidence` | number | Confidence score 0.05 - 0.95 |
| `diagnoses[].reasoning` | string | Claude's explanation of why this cause ranks here |
| `diagnoses[].parts_needed` | string[] | Parts required for this repair |
| `diagnoses[].labor_hours_estimate` | number | Estimated labor hours |
| `diagnoses[].labor_category` | string | light / moderate / heavy |
| `diagnoses[].success_rate` | number | Historical fix rate from knowledge base |
| `diagnoses[].common_misdiagnosis` | string | Known misdiagnosis trap to avoid |
| `tsbs` | array | Related Technical Service Bulletins from NHTSA |
| `recalls` | array | Related safety recalls from NHTSA |
| `diagnostic_steps` | string[] | Ordered diagnostic procedure for the technician |
| `low_confidence_warning` | boolean | `true` if top diagnosis confidence is below 0.50 |

## How It Works

1. **Embed the query** — Converts DTC codes + symptoms + vehicle info into a vector using OpenAI `text-embedding-3-small`
2. **RAG search** — Queries Supabase pgvector (`match_diagnostic_cases` RPC) for similar historical cases
3. **TSB/Recall lookup** — Checks NHTSA API for related bulletins, caches results in `tsb_cache` (30-day TTL)
4. **Claude synthesis** — Sends retrieved cases + TSBs + vehicle context to Claude API for diagnostic reasoning
5. **Structured output** — Returns ranked diagnoses with confidence scores and diagnostic steps

## Seeding the Knowledge Base

Before first use, seed the Supabase database with diagnostic data:

```bash
cd skills/ai-diagnostics/scripts
node seed-data.js
```

This loads three tiers of data:
- **Tier 1:** ~200 DTC code references into `dtc_codes` table
- **Tier 2:** ~500 DTC-to-cause mappings into `diagnostic_knowledge` table (with embeddings)
- **Tier 3:** ~100 vehicle-specific patterns into `diagnostic_knowledge` table (with embeddings)

After seeding, the IVFFlat index should be rebuilt for optimal vector search performance.

## Feedback and Learning

The skill tracks diagnosis outcomes to improve over time:

```javascript
const { recordOutcome } = require("./skills/ai-diagnostics/scripts/feedback");

await recordOutcome({
  diagnosis_log_id: "uuid-from-diagnose-result",
  actual_cause: "Downstream O2 sensor failure",
  was_correct: true,
  parts_used: ["Denso 234-9119"],
  labor_hours_actual: 1.0,
  technician_notes: "Sensor was reading flat 0.45V",
});
```

Outcomes are stored in the `diagnosis_outcomes` table and used to adjust confidence scores in the knowledge base over time. When a diagnosis is confirmed correct, the corresponding `success_rate` in `diagnostic_knowledge` is reinforced. When incorrect, confidence is reduced and the actual cause is boosted.

## Scripts

| File | Purpose |
|------|---------|
| `scripts/embeddings.js` | Vector operations (generate, search, insert) |
| `scripts/seed-data.js` | Knowledge base seeder (run once) |
| `scripts/seed-dtc-codes.js` | Tier 1 DTC code data |
| `scripts/seed-cause-mappings.js` | Tier 2 cause mapping data |
| `scripts/seed-causes-a.js` | Cause data (part A) |
| `scripts/seed-causes-b.js` | Cause data (part B) |
| `scripts/seed-vehicle-patterns.js` | Tier 3 vehicle-specific patterns |
| `scripts/tsb-lookup.js` | NHTSA TSB/recall API + caching |
| `scripts/diagnose.js` | Main diagnostic engine |
| `scripts/feedback.js` | Outcome tracking + learning loop |

## Example Usage

**Via orchestrator:**
> "Diagnose P0420 on a 2019 Honda Civic 2.0L with 45k miles"

**Response includes:**
- Ranked causes: O2 sensor failure (78%), catalytic converter (15%), exhaust leak (5%)
- Related TSB 19-071
- Step-by-step diagnostic procedure
- Parts and labor estimates for each cause
