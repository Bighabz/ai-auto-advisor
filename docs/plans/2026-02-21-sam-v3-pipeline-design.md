# SAM v3 Pipeline Design

**Date:** 2026-02-21
**Status:** Approved
**Replaces:** v2 pipeline (sequential research → estimate)

---

## Problem Statement

The current v2 pipeline:
- Searches PartsTech independently (not through AutoLeap)
- Uses ARI for labor times instead of MOTOR (which AutoLeap has built in)
- Generates its own PDF instead of using AutoLeap's estimate PDF
- Runs research and estimate sequentially — slow
- Does not capture wiring diagrams or TSBs from AllData
- Does not capture DTC test plans from ProDemand
- Does not send wiring diagram images back to Telegram

---

## Intended Workflow

### Entry Point

Tech texts @hillsideautobot on Telegram in natural language:

> "2019 Civic 2.0L throwing P0420, customer John Smith 555-1234"
> "got a silverado in the bay, rough idle, CEL on"
> "what does P0420 mean?" (chat — no estimate)

Claude (Anthropic API) handles conversation and detects when to trigger the estimate pipeline via `run_estimate` tool. Claude extracts: year, make, model, engine, VIN, symptoms, DTC codes, customer name, customer phone.

---

## Pipeline Architecture

### Phase 1 — Parallel Launch (simultaneous)

Two browser tracks launch at the same time:

```
Research Tab (Tab 1)                    Estimate Tab (Tab 2)
─────────────────────                   ──────────────────────
AllData:                                AutoLeap:
  • Navigate to vehicle                   • Login (reuse session)
  • Search DTC/symptom                    • Look up customer by
  • Screenshot wiring diagrams              name/phone if provided
  • Capture OEM procedures               • Find or create vehicle
  • Capture TSBs                         • Create empty estimate
  • Capture torque specs                    shell (no parts yet)
                                         • ← WAIT for Phase 2
ProDemand:
  • Navigate to vehicle
  • Search DTC/symptom
  • Capture Real Fixes
  • Capture DTC test plans
  • Capture labor times

Identifix:
  • Navigate to vehicle
  • Search DTC/symptom
  • Capture confirmed fixes
  • Capture misdiagnosis warnings
  • Capture success rates
```

**Phase 1 timeout:** 60 seconds. Any platform that doesn't respond is skipped gracefully.

---

### Phase 2 — Estimate Population (after research completes)

Using research context to build the estimate in AutoLeap:

1. **Parts identification** — from research results:
   - Repair plan parts (from KB)
   - Parts mentioned in confirmed fixes (Identifix)
   - Parts from Real Fixes (ProDemand)
   - Merged, deduplicated

2. **Parts search** — via AutoLeap's built-in PartsTech integration:
   - Search each identified part in AutoLeap
   - Select best match (OEM preferred, then aftermarket)
   - Add to estimate line items

3. **Labor** — via AutoLeap's built-in MOTOR labor guide:
   - Search vehicle + repair type in MOTOR
   - Use MOTOR hours (not ARI, not ProDemand, not hardcoded)
   - Add to estimate line items

4. **Finalize estimate:**
   - Apply shop markup from shop config
   - Apply tax rate from shop config
   - If customer has email/phone → AutoLeap sends estimate to customer
   - Download PDF from AutoLeap

---

### Phase 3 — Send to Telegram (always)

Regardless of customer data, always send to Telegram:

**Message 1 — Diagnosis:**
- Vehicle info
- Top diagnosis + confidence %
- Alternative diagnoses
- Recall count (NHTSA)
- Identifix confirmed fix (if found)
- Estimate total

**Message 2 — Research Findings:**
- ProDemand Real Fixes (top 2-3)
- DTC test plan steps
- Identifix success-rated fixes
- Misdiagnosis warnings

**Message 3 — Mechanic Reference:**
- OEM procedures (AllData)
- Torque specs
- Tools needed
- TSBs relevant to DTC

**Images — Wiring Diagrams:**
- Each wiring diagram screenshot sent as a Telegram photo
- Captioned with diagram name (e.g. "AllData: P0420 Catalyst Monitor Circuit")

**Document — PDF Estimate:**
- Downloaded from AutoLeap (if estimate created)
- OR generated locally (if no AutoLeap estimate — no customer data)

**Message 4 — Action Prompt:**
- "Reply APPROVED when customer gives the go-ahead"
- "Reply ORDER to order parts now"

---

## Customer Data Rules

| Scenario | AutoLeap Estimate | Send to Customer | PDF Source |
|----------|-------------------|------------------|------------|
| Customer name + phone/email | Yes | Yes (AutoLeap sends) | AutoLeap download |
| Customer name only | Yes (draft) | No | AutoLeap download |
| No customer data | No | No | Generated locally |

---

## Skills Impact

### Skills to Edit

| Skill | Changes |
|-------|---------|
| `alldata-lookup/scripts/search.js` | Add wiring diagram screenshots, TSB capture, full OEM procedures |
| `alldata-lookup/scripts/wiring.js` | **NEW** — dedicated wiring diagram navigator + screenshotter |
| `alldata-lookup/scripts/tsb.js` | **NEW** — TSB fetcher |
| `prodemand-lookup/scripts/search.js` | Add DTC test plan capture, improve labor extraction |
| `identifix-search/scripts/search.js` | Add misdiagnosis warnings, improve success rate capture |
| `autoleap-browser/scripts/estimate.js` | Use MOTOR labor guide, populate with research context, download PDF |
| `autoleap-browser/scripts/parts.js` | **NEW** — search + add parts via AutoLeap's PartsTech integration |
| `estimate-builder/scripts/orchestrator.js` | Major rewrite — hybrid parallel Phase 1/2/3 architecture |
| `telegram-gateway/scripts/server.js` | Add `sendPhoto()` for wiring diagram images |
| `whatsapp-gateway/scripts/formatter.js` | Add wiring diagram image list to output, TSB section, DTC test plan |

### Skills to Retire

| Skill | Why |
|-------|-----|
| `partstech-search` | Replaced by AutoLeap built-in PartsTech |
| `partstech-order` | Replaced by AutoLeap ordering workflow |
| `ari-labor` | Replaced by AutoLeap MOTOR labor guide |
| `estimate-pdf` | Replaced by AutoLeap PDF download (keep as fallback) |

### Skills Unchanged

- `ai-diagnostics` — KB lookup + Claude diagnosis (keep as-is)
- `vehicle-specs` — NHTSA specs (keep as-is)
- `vin-decoder` — VIN decode (keep as-is)
- `shop-management` — shop config (keep as-is)
- `shared/browser.js` — shared browser module (keep as-is)

---

## Orchestrator Rewrite — Phase Structure

```javascript
async function buildEstimate(params) {

  // Phase 1 — Parallel launch
  const [researchResults, autoLeapSession] = await Promise.all([
    runResearch(params),          // Tab 1: AllData + ProDemand + Identifix
    setupAutoLeapSession(params), // Tab 2: Login + customer + empty estimate
  ]);

  // Phase 2 — Populate estimate with research context
  const estimate = await populateEstimate(autoLeapSession, researchResults, params);

  // Phase 3 — Assemble output
  return assembleOutput(researchResults, estimate, params);
}
```

Each phase is independently timeout-wrapped. If AutoLeap session setup fails, falls back to local PDF. If research times out, estimate uses KB data only.

---

## Error Handling

| Failure | Fallback |
|---------|----------|
| AllData unreachable | Skip, note in output |
| ProDemand unreachable | Skip, use KB data only |
| Identifix unreachable | Skip |
| AutoLeap login fails | Generate local PDF, no AutoLeap estimate |
| Customer not found in AutoLeap | Create new customer |
| MOTOR labor not found | Fall back to ProDemand labor → KB estimate → 1.0h default |
| No wiring diagrams found | Skip image messages |
| PartsTech search fails in AutoLeap | Note parts in estimate as "sourcing required" |

---

## Output Changes from v2

| Feature | v2 | v3 |
|---------|----|----|
| Parts source | PartsTech direct | AutoLeap PartsTech integration |
| Labor source | ARI / ProDemand / hardcoded | MOTOR via AutoLeap |
| PDF source | Generated locally (pdfkit) | Downloaded from AutoLeap |
| Wiring diagrams | Not captured | Screenshots sent as Telegram photos |
| TSBs | Not captured | Captured from AllData, shown in Message 3 |
| DTC test plans | Not captured | Captured from ProDemand, shown in Message 2 |
| Customer estimate | AutoLeap API (partial) | AutoLeap browser (full — sends to customer) |
| Research + estimate | Sequential | Hybrid parallel |

---

## Competitor Reference

Target feature parity with **MasterTech.ai**:
- ✅ Wiring diagrams (screenshots from AllData)
- ✅ OEM service data: procedures, specs, fluids, TSBs, DTC test plans
- ✅ MOTOR labor guides (via AutoLeap)
- ✅ AI-powered diagnosis from shop history + KB + Claude
- ✅ Confirmed fixes from peer shops (Identifix Direct-Hit network)
- 🔜 Voice assistance (future)
- 🔜 VIN camera scanner (future — AutoLeap has this)

---

## Success Criteria

1. Tech sends vehicle + DTC → receives diagnosis + wiring diagrams + PDF within 90 seconds
2. Wiring diagram images appear as photos in Telegram chat
3. AutoLeap estimate created with correct MOTOR labor + PartsTech parts
4. If customer data provided, estimate sent to customer from AutoLeap
5. PDF always arrives in Telegram regardless of customer data
6. Any single platform failure does not halt the pipeline
