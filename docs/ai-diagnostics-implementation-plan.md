# AI Diagnostic Engine — Implementation Plan

## Goal
Build a new OpenClaw skill `ai-diagnostics` that provides AI-powered diagnostic intelligence with ranked causes, confidence scores, and TSB/recall awareness. Backed by Supabase pgvector for RAG and Claude API for reasoning.

## Why This Matters Now
The existing AllData, Identifix, and ProDemand skills are **skeleton implementations** (return empty results). The orchestrator currently has no real diagnostic intelligence — it just passes through empty research results. The AI Diagnostic Engine fills this gap immediately, giving the system actual diagnostic capability even before the browser automation skills are completed.

---

## Architecture

```
Input: VIN + DTC code + symptoms + vehicle data (from vin-decoder)
                    |
    ┌───────────────┴───────────────┐
    │      ai-diagnostics skill     │
    │                               │
    │  1. Embed query (OpenAI)      │
    │  2. Vector search (Supabase)  │
    │  3. Fetch TSBs (NHTSA API)    │
    │  4. Synthesize (Claude API)   │
    │  5. Log diagnosis (Supabase)  │
    │                               │
    └───────────────┬───────────────┘
                    |
    Output: Structured JSON
    {
      diagnoses: [
        { cause, confidence, reasoning, parts_needed, labor_category },
        ...top 3
      ],
      tsbs: [...],
      recalls: [...],
      diagnostic_steps: [...],
      low_confidence_warning: true/false
    }
```

---

## Files to Create (7 files)

### 1. `skills/ai-diagnostics/SKILL.md`
Skill definition following the existing frontmatter convention (emoji, name, description, requires).

### 2. `skills/ai-diagnostics/scripts/diagnose.js` — Main Entry Point
- Exports `diagnose({ vin, year, make, model, engine, dtcCodes, symptoms, mileage })`
- Orchestrates: embed → search → TSB lookup → Claude synthesis → log
- Returns structured JSON with ranked diagnoses
- Handles low-confidence cases (< 70%) with warnings

### 3. `skills/ai-diagnostics/scripts/embeddings.js` — Vector Operations
- `generateEmbedding(text)` — calls OpenAI `text-embedding-3-small` API
- `searchSimilarCases(embedding, filters, limit)` — queries Supabase pgvector
- `insertCase(caseData, embedding)` — adds new knowledge to the vector DB
- Uses `@supabase/supabase-js` for database access

### 4. `skills/ai-diagnostics/scripts/seed-data.js` — Knowledge Base Seeder
- Seeds Supabase with initial diagnostic knowledge:
  - ~200 common DTC codes with causes and success rates
  - Vehicle-specific known issues (top 20 vehicles by repair frequency)
  - Common misdiagnosis patterns
- Run once during setup: `node seed-data.js`
- Generates embeddings for each case and stores in pgvector

### 5. `skills/ai-diagnostics/scripts/tsb-lookup.js` — NHTSA TSB/Recall API
- `checkRecalls(make, model, year)` — NHTSA Recalls API (free)
- `checkComplaints(make, model, year)` — NHTSA Complaints API (free)
- Returns relevant TSBs and open recalls for the vehicle
- Caches results in Supabase (TTL: 30 days) to reduce API calls

### 6. `skills/ai-diagnostics/scripts/feedback.js` — Outcome Tracking
- `recordOutcome(diagnosisId, actualCause, wasCorrect)` — logs actual fix
- `getAccuracyStats()` — returns overall and per-DTC accuracy rates
- `learnFromOutcome(diagnosisId, actualCause)` — adds confirmed fix to knowledge base as new vector entry, strengthening future predictions

### 7. `config/supabase-schema.sql` — Database DDL
Complete SQL schema to run in Supabase SQL Editor.

---

## Files to Modify (2 files)

### 1. `skills/estimate-builder/scripts/orchestrator.js`
**Changes:**
- Import the new `diagnose` function from `ai-diagnostics`
- Add a new Step 2.5 between classification (Step 2) and parallel research (Step 3)
- Call `diagnose()` with vehicle data + DTC codes + symptoms
- Use AI diagnosis results to:
  - Set `results.diagnosis.summary` with the ranked causes
  - Improve `extractPartsNeeded()` by using the AI's `parts_needed` output instead of hardcoded DTC-to-parts mapping
  - Add confidence scores to the formatted response
- Keep the existing AllData/Identifix/ProDemand research calls as supplementary data (when they're eventually implemented)

### 2. `config/.env.example`
**Add:**
```
# --- Supabase (Vector DB + Storage) ---
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your_anon_key

# --- OpenAI (Embeddings Only) ---
OPENAI_API_KEY=sk-your-openai-key
```

---

## Supabase Schema Design

```sql
-- Enable pgvector extension
create extension if not exists vector;

-- 1. Diagnostic knowledge base (RAG source)
create table diagnostic_knowledge (
  id uuid default gen_random_uuid() primary key,
  dtc_code text not null,                    -- e.g., "P0420"
  dtc_description text,                       -- "Catalyst System Efficiency Below Threshold"
  vehicle_make text,                          -- "Honda" (null = applies to all)
  vehicle_model text,                         -- "Civic" (null = applies to all)
  year_range_start int,                       -- 2016
  year_range_end int,                         -- 2021
  engine_type text,                           -- "1.5L Turbo" (null = all)
  cause text not null,                        -- "Catalytic converter failure"
  cause_category text,                        -- "emissions", "engine", "electrical", etc.
  confidence_base float default 0.5,          -- base confidence 0.0-1.0
  success_rate float,                         -- from Identifix/repair data, 0.0-1.0
  parts_needed jsonb,                         -- ["catalytic converter", "gaskets"]
  labor_category text,                        -- "basic", "intermediate", "advanced"
  labor_hours_estimate float,                 -- 2.5
  diagnostic_steps text[],                    -- step-by-step verification
  common_misdiagnosis text,                   -- "Often misdiagnosed as O2 sensor"
  source text,                                -- "nhtsa", "identifix", "community", "oem_tsb"
  embedding vector(1536),                     -- OpenAI text-embedding-3-small dimension
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Index for vector similarity search
create index idx_diagnostic_knowledge_embedding
  on diagnostic_knowledge
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- Index for filtering
create index idx_diagnostic_knowledge_dtc on diagnostic_knowledge(dtc_code);
create index idx_diagnostic_knowledge_vehicle on diagnostic_knowledge(vehicle_make, vehicle_model);

-- 2. DTC code reference table
create table dtc_codes (
  code text primary key,                      -- "P0420"
  description text not null,                  -- "Catalyst System Efficiency Below Threshold"
  category text,                              -- "powertrain", "body", "chassis", "network"
  subcategory text,                           -- "fuel_and_air", "ignition", "emissions"
  severity text,                              -- "low", "medium", "high", "critical"
  common_systems text[],                      -- ["catalytic converter", "O2 sensors", "exhaust"]
  created_at timestamptz default now()
);

-- 3. Diagnosis log (every diagnosis run)
create table diagnosis_log (
  id uuid default gen_random_uuid() primary key,
  vin text,
  vehicle_year int,
  vehicle_make text,
  vehicle_model text,
  engine text,
  mileage int,
  dtc_codes text[],                           -- ["P0420", "P0430"]
  symptoms text,
  top_prediction text,                        -- cause from rank 1
  top_confidence float,                       -- confidence of rank 1
  all_predictions jsonb,                      -- full ranked list
  tsbs_found jsonb,
  recalls_found jsonb,
  rag_cases_used int,                         -- how many similar cases were found
  processing_time_ms int,
  created_at timestamptz default now()
);

-- 4. Diagnosis outcomes (feedback loop)
create table diagnosis_outcomes (
  id uuid default gen_random_uuid() primary key,
  diagnosis_log_id uuid references diagnosis_log(id),
  predicted_cause text,
  actual_cause text,
  was_correct boolean,
  parts_used jsonb,                           -- actual parts that fixed it
  labor_actual_hours float,
  technician_notes text,
  created_at timestamptz default now()
);

-- 5. TSB cache (reduce NHTSA API calls)
create table tsb_cache (
  id uuid default gen_random_uuid() primary key,
  vehicle_make text not null,
  vehicle_model text not null,
  vehicle_year int not null,
  tsb_data jsonb,
  recall_data jsonb,
  complaint_data jsonb,
  fetched_at timestamptz default now(),
  expires_at timestamptz default (now() + interval '30 days')
);

create index idx_tsb_cache_vehicle on tsb_cache(vehicle_make, vehicle_model, vehicle_year);

-- RPC function for vector similarity search with filters
create or replace function match_diagnostic_cases(
  query_embedding vector(1536),
  match_threshold float default 0.5,
  match_count int default 10,
  filter_dtc text default null,
  filter_make text default null,
  filter_model text default null,
  filter_year int default null
)
returns table (
  id uuid,
  dtc_code text,
  cause text,
  cause_category text,
  confidence_base float,
  success_rate float,
  parts_needed jsonb,
  labor_category text,
  labor_hours_estimate float,
  diagnostic_steps text[],
  common_misdiagnosis text,
  vehicle_make text,
  vehicle_model text,
  year_range_start int,
  year_range_end int,
  engine_type text,
  source text,
  similarity float
)
language plpgsql
as $$
begin
  return query
  select
    dk.id,
    dk.dtc_code,
    dk.cause,
    dk.cause_category,
    dk.confidence_base,
    dk.success_rate,
    dk.parts_needed,
    dk.labor_category,
    dk.labor_hours_estimate,
    dk.diagnostic_steps,
    dk.common_misdiagnosis,
    dk.vehicle_make,
    dk.vehicle_model,
    dk.year_range_start,
    dk.year_range_end,
    dk.engine_type,
    dk.source,
    1 - (dk.embedding <=> query_embedding) as similarity
  from diagnostic_knowledge dk
  where 1 - (dk.embedding <=> query_embedding) > match_threshold
    and (filter_dtc is null or dk.dtc_code = filter_dtc)
    and (filter_make is null or dk.vehicle_make is null or dk.vehicle_make = filter_make)
    and (filter_model is null or dk.vehicle_model is null or dk.vehicle_model = filter_model)
    and (filter_year is null or dk.year_range_start is null
         or (filter_year >= dk.year_range_start and filter_year <= dk.year_range_end))
  order by similarity desc
  limit match_count;
end;
$$;
```

---

## Seed Data Strategy

The `seed-data.js` script will populate the knowledge base with:

### Tier 1: DTC Code Reference (~200 codes)
- All P0xxx powertrain codes that cover 80% of shop visits
- Focus: P0420, P0171, P0300-P0304, P0442, P0455, P0128, P0135, P0401, etc.
- Source: NHTSA standard DTC definitions

### Tier 2: DTC-to-Cause Mappings (~500 entries)
- Each DTC code gets 2-5 cause entries with success rates
- Example for P0420:
  - Catalytic converter failure (65% success rate)
  - Downstream O2 sensor failure (20%)
  - Exhaust leak before cat (8%)
  - ECU calibration / software update needed (5%)
  - Upstream O2 sensor degraded (2%)
- Includes: parts_needed, labor_category, diagnostic_steps

### Tier 3: Vehicle-Specific Patterns (~100 entries)
- Known issues for top 20 vehicles by repair frequency
- Example: "2016-2019 Honda Civic 1.5T P0420 — often resolved by ECU update (TSB 19-045) before cat replacement"
- Example: "2014-2018 Chevy Silverado 5.3L P0420 — AFM lifter failure commonly triggers this code"

### Embedding Strategy
- Concatenate: `{dtc_code} {dtc_description} {vehicle_make} {vehicle_model} {year_range} {engine_type} {cause} {symptoms_keywords}`
- Generate embedding via OpenAI `text-embedding-3-small` (1536 dimensions)
- Store in `diagnostic_knowledge.embedding` column

---

## Confidence Scoring Algorithm

```
Final confidence = weighted combination of:

1. RAG Similarity Score (30% weight)
   - How closely the query matches known cases in the vector DB
   - Cosine similarity from pgvector search

2. Base Confidence from Knowledge Base (25% weight)
   - Pre-assigned confidence for this DTC→cause mapping
   - Higher for well-documented, frequently confirmed fixes

3. Success Rate (25% weight)
   - Historical success rate from repair data
   - "78% of shops confirmed this fix resolved P0420"

4. Vehicle Specificity Bonus (10% weight)
   - +0.1 if the case matches exact make/model
   - +0.05 if matches make only
   - 0 if generic (applies to all vehicles)

5. Mileage/Age Relevance (10% weight)
   - Certain failures correlate with mileage ranges
   - Cat converter failures peak at 60-100K miles
   - O2 sensors peak at 80-120K miles

Formula:
confidence = (rag_sim * 0.30) + (base_conf * 0.25) + (success_rate * 0.25)
           + (vehicle_bonus * 0.10) + (mileage_factor * 0.10)

Capped at 0.95 (never claim 100% confidence)
Minimum display: 0.05 (5%)
```

---

## Claude Diagnostic Prompt Design

The `diagnose.js` script calls Claude directly with a structured prompt:

**System Prompt:**
```
You are an expert automotive diagnostic AI. Given a vehicle, DTC code(s), symptoms,
similar past cases from our database, and any relevant TSBs/recalls, provide a
structured diagnosis.

Rules:
1. Rank causes by probability. Never exceed 95% confidence.
2. Confidence scores must sum to ~100% across all causes.
3. If RAG cases strongly agree, weight them heavily.
4. If a TSB exists for this exact vehicle+DTC, mention it prominently.
5. Always suggest diagnostic verification steps before committing to a repair.
6. Flag common misdiagnoses.
7. Be conservative — recommend diagnosis verification for anything below 80%.

Respond ONLY with valid JSON matching this schema: { diagnoses: [...], ... }
```

**User Prompt (constructed dynamically):**
```
Vehicle: {year} {make} {model} {trim}
Engine: {displacement} {cylinders}cyl
Mileage: {mileage}
VIN: {vin}

DTC Code(s): {dtcCodes}
Symptoms: {symptoms}

=== SIMILAR PAST CASES (from our database) ===
{top 10 RAG results with similarity scores}

=== TSBs & RECALLS ===
{NHTSA API results}

Provide your diagnosis as JSON.
```

---

## Integration with Existing Orchestrator

### Changes to `orchestrator.js`

```javascript
// New import at top
const { diagnose } = require("../ai-diagnostics/scripts/diagnose");

// In buildEstimate(), after Step 2 (classify & route), add:

// ─── Step 2.5: AI Diagnosis ───
console.log("\n[Step 2.5] Running AI diagnostic engine...");
const aiDiagnosis = await diagnose({
  vin: vehicle.vin,
  year: vehicle.year,
  make: vehicle.make,
  model: vehicle.model,
  engine: vehicle.engine?.displacement,
  dtcCodes: requestInfo.dtcCodes,
  symptoms: params.query,
  mileage: vehicle.mileage,
});

results.diagnosis = {
  ...results.diagnosis,
  ai: aiDiagnosis,
  summary: formatDiagnosisSummary(aiDiagnosis), // new helper function
};

// Update extractPartsNeeded to use AI diagnosis output
// instead of hardcoded DTC→parts mapping
```

The AI diagnosis runs **before** the parallel research (AllData/Identifix/ProDemand) so its results can inform what to search for. When browser skills are eventually implemented, their results will supplement the AI diagnosis.

---

## Implementation Order

### Step 1: Supabase Setup
- Create Supabase project (if not exists)
- Run `supabase-schema.sql` in SQL Editor
- Get URL + anon key, add to `.env`

### Step 2: `embeddings.js`
- Implement OpenAI embedding generation
- Implement Supabase pgvector search via RPC
- Implement case insertion
- Test: generate embedding for "P0420 Honda Civic catalyst" and verify storage

### Step 3: `seed-data.js`
- Build the DTC code reference dataset (~200 codes)
- Build DTC-to-cause mappings (~500 entries)
- Build vehicle-specific patterns (~100 entries)
- Run seeder: generates embeddings + inserts to Supabase
- Verify: query "P0420 2019 Civic" returns relevant cases

### Step 4: `tsb-lookup.js`
- Implement NHTSA recalls API call
- Implement NHTSA complaints API call
- Add Supabase caching (30-day TTL)
- Test: look up recalls for 2019 Honda Civic

### Step 5: `diagnose.js`
- Import embeddings.js, tsb-lookup.js
- Build the Claude prompt with RAG context
- Implement confidence scoring algorithm
- Call Anthropic API directly (structured JSON output)
- Return ranked diagnoses
- Test: run full diagnosis for P0420 on 2019 Honda Civic

### Step 6: `feedback.js`
- Implement outcome recording
- Implement accuracy stats query
- Implement learning (add confirmed fixes to knowledge base)

### Step 7: `SKILL.md`
- Write skill definition following existing convention

### Step 8: Orchestrator Integration
- Modify `orchestrator.js` to call `diagnose()`
- Update `extractPartsNeeded()` to use AI output
- Update `formatServiceAdvisorResponse()` with confidence scores
- Update `.env.example`

### Step 9: Testing
- Run 20 test cases with known outcomes
- Verify confidence scores are reasonable
- Test low-confidence warning path
- Test with missing data (no VIN, no mileage, symptoms only)
- Test TSB/recall detection

---

## Verification / Testing Plan

1. **Unit tests:** Run `diagnose()` with 5 known DTC scenarios:
   - P0420 on 2019 Honda Civic (should suggest cat converter)
   - P0300 on 2018 Ford F-150 (should suggest ignition system)
   - P0171 on 2017 Toyota Camry (should suggest MAF/intake leak)
   - P0442 on 2020 Chevy Equinox (should suggest gas cap/EVAP)
   - P0128 on 2016 Hyundai Sonata (should suggest thermostat)

2. **Integration test:** Run full `buildEstimate()` pipeline with AI diagnostics enabled, verify the formatted response includes confidence scores and the parts list is driven by AI output.

3. **Edge cases:**
   - Unknown DTC code → should return low confidence, generic guidance
   - No VIN provided → should still work with YMME only
   - Multiple DTC codes → should consider interaction effects
   - Very high mileage vehicle → should weight age-related failures higher

4. **Accuracy baseline:** After seeding, run the 20 test cases and record baseline accuracy. Target: 75%+ top prediction correct.

---

## Dependencies to Install

```bash
cd skills/ai-diagnostics
npm init -y
npm install @supabase/supabase-js openai @anthropic-ai/sdk
```

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `skills/ai-diagnostics/SKILL.md` | NEW — Skill definition |
| `skills/ai-diagnostics/scripts/diagnose.js` | NEW — Main diagnostic engine |
| `skills/ai-diagnostics/scripts/embeddings.js` | NEW — Vector operations |
| `skills/ai-diagnostics/scripts/seed-data.js` | NEW — Knowledge base seeder |
| `skills/ai-diagnostics/scripts/tsb-lookup.js` | NEW — NHTSA TSB/recall lookup |
| `skills/ai-diagnostics/scripts/feedback.js` | NEW — Outcome tracking |
| `config/supabase-schema.sql` | NEW — Database DDL |
| `skills/estimate-builder/scripts/orchestrator.js` | MODIFY — Add AI diagnosis step |
| `config/.env.example` | MODIFY — Add Supabase + OpenAI keys |
