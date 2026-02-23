# Pricing Gate + Brain/Actuator Split Design

**Date:** 2026-02-23
**Status:** Approved

## Problem

When AutoLeap native pricing fails and PartsTech returns wholesale-only prices, the pipeline can send wholesale prices directly to customers. This leaks shop cost data.

## Solution

### 1. Pricing Gate (hard gate in orchestrator)

At the end of `buildEstimate()`, before returning:

- Track `pricing_source`: `autoleap-native` | `matrix-fallback` | `FAILED_PRICING_SOURCE`
- If parts exist AND `parts_retail_total <= 0`: block customer-facing output
- Set `results.customer_ready = false` and `results.pricing_gate = "BLOCKED"`
- Add warning `PRICING_GATE_BLOCKED`

### 2. Execution Policy (3-tier)

1. **AutoLeap-native** (preferred): browser-use completes transfer/link, scrape retail from AutoLeap estimate, use AutoLeap PDF as source of truth
2. **Matrix fallback**: apply shop markup % to wholesale cost, mark `pricing_source = matrix-fallback`
3. **Failed**: return `FAILED_PRICING_SOURCE`, no customer PDF send

### 3. Formatter Guard

When `results.customer_ready === false`:
- Suppress dollar totals
- Show internal-only message: "Parts pricing couldn't be resolved — review before sending"
- Do not attach PDF

### 4. SKILL.md Update

Add Pricing Gate section to estimate-reliability skill.

## Files Changed

- `skills/estimate-builder/scripts/orchestrator.js` — pricing gate + pricing_source tracking
- `skills/whatsapp-gateway/scripts/formatter.js` — customer_ready guard
- `skills/estimate-reliability/SKILL.md` — pricing gate documentation
- `skills/shared/contracts.js` — add PRICING_GATE reason codes
