---
name: clawdbot-estimate-reliability
description: Stabilizes and debugs the AutoLeap -> PartsTech -> ProDemand estimate pipeline with deterministic preflight checks, reason-coded failure handling, bounded remediations, and structured verification output. Use when Telegram estimates are slow, return pricing TBD/$0, select wrong engines, miss MOTOR labor, or produce fallback PDFs.
---

# Clawdbot Estimate Reliability

## Purpose

Use this skill to run and repair the estimate pipeline in a deterministic way:
- AutoLeap auth/session health
- PartsTech pricing health
- ProDemand engine/labor accuracy
- AutoLeap estimate + PDF completion

Always prefer reproducible diagnosis over ad-hoc hotfixes.

## Inputs

Collect these inputs at start (if available):
- User prompt text
- Vehicle: year, make, model, VIN (optional)
- Requested repair/part (for example: catalytic converter)
- Customer name and phone (optional)
- Target environment (local vs Pi)

## Execution Workflow

Copy this checklist and update status during work:

```text
Runbook Progress
- [ ] 1) Preflight checks
- [ ] 2) Launch run with trace id
- [ ] 3) Validate stage outputs
- [ ] 4) Apply mapped remediation (if needed)
- [ ] 5) Re-run once
- [ ] 6) Report final status + reason codes
```

### 1) Preflight checks (mandatory)

Before any code edit or conclusion:
1. Confirm service is running.
2. Confirm Chrome/CDP endpoint is reachable.
3. Confirm AutoLeap is not on login screen.
4. Confirm required env vars exist for runtime context.
5. Confirm repository state is clean enough to deploy safely.

If any preflight fails, stop and return a reason code immediately.

### 2) Launch run with trace id

- Generate a trace id and include it in all logs and summaries.
- Run one test prompt end-to-end.
- Capture stage durations:
  - preflight/auth
  - ProDemand lookup
  - PartsTech pricing
  - AutoLeap estimate build
  - PDF generation/send

### 3) Validate stage outputs

Validate these checkpoints in order:

1. **ProDemand engine**
   - Log selected engine text.
   - If emissions repair and engine is EV/plugin, classify as failure.

2. **ProDemand labor**
   - Ensure labor op + hours returned.
   - If missing, keep reason code and proceed with degraded handling.

3. **PartsTech search**
   - Confirm `GetProducts`-style network responses occurred after input.
   - Confirm at least one priceable item or classify no-priceable result.

4. **AutoLeap estimate**
   - Confirm estimate id/code creation.
   - Confirm labor source selected by precedence policy.

5. **PDF source**
   - Confirm source path: AutoLeap REST, puppeteer fallback, or local fallback.

### 4) Apply mapped remediation (bounded)

Only apply one remediation path per failure category, max 1 retry each.

- `AL_AUTH_MISSING`
  - Refresh session/login once, then retry.
- `PT_RENDER_TIMEOUT`
  - Reopen PartsTech via fresh SSO context; poll readiness; retry search.
- `PT_NO_PRODUCTS`
  - Re-run one fresh search context; verify request was emitted.
- `PD_ENGINE_BAD_SELECTION`
  - Re-run selector with scored chooser and explicit post-click settle wait.
- `AL_CUSTOMER_CREATE_FAILED`
  - Continue without customer attachment; mark degraded.
- `PDF_AUTLEAP_UNAVAILABLE`
  - Attempt approved fallback once; keep source label in output.

Never perform unbounded retries.

### 5) Re-run once

After remediation, perform one clean re-run of the same prompt.
If still failing in the same stage, stop and escalate with exact evidence.

### 6) Final report format

Always return:

```markdown
Status: SUCCESS | DEGRADED | FAILED
Trace ID: <id>

Stage Results
- ProDemand engine: <value>
- ProDemand labor: <hours/source or reason>
- PartsTech pricing: <count, selected part, price or reason>
- AutoLeap estimate: <id/code or reason>
- PDF source: <autoleap-rest | puppeteer-fallback | local-fallback>

Reason Codes
- <CODE_1>
- <CODE_2>

Next Action
- <single most valuable next action>
```

## Reason Codes

Use these normalized codes:
- `AL_AUTH_MISSING`
- `AL_TOKEN_CAPTURE_FAILED`
- `AL_CUSTOMER_CREATE_FAILED`
- `AL_ESTIMATE_CREATE_FAILED`
- `PD_ENGINE_BAD_SELECTION`
- `PD_LABOR_NOT_FOUND`
- `PT_TAB_NOT_FOUND`
- `PT_RENDER_TIMEOUT`
- `PT_SEARCH_INPUT_MISSING`
- `PT_NO_PRODUCTS`
- `PT_NO_PRICEABLE_ITEMS`
- `PDF_AUTLEAP_UNAVAILABLE`
- `PDF_FALLBACK_ONLY`
- `PRICING_GATE_BLOCKED`

## Pricing Gate

A hard gate at the end of `buildEstimate()` prevents wholesale price leakage.

### How It Works

1. **pricing_source tracking**: every run records how prices were resolved:
   - `autoleap-native` — AutoLeap created the estimate with retail prices
   - `matrix-fallback` — shop markup % applied to wholesale cost
   - `FAILED_PRICING_SOURCE` — parts exist but no retail pricing resolved
   - `no-parts` — no parts needed for this job

2. **Hard gate**: if parts exist AND `parts_retail_total <= 0`:
   - `results.customer_ready = false`
   - `results.pricing_gate = "BLOCKED"`
   - Warning `PRICING_GATE_BLOCKED` added to results

3. **Formatter guard**: when `customer_ready === false`:
   - Dollar totals suppressed in customer-facing messages
   - PDF not attached
   - Internal-only message shown: "Parts pricing couldn't be resolved — review before sending"

### Non-Negotiable Rule

Never send wholesale/cost prices to a customer. If retail pricing cannot be resolved, the estimate stays internal-only until a human reviews it.

## Reliability Rules

- Do not trust stale tabs; prefer fresh context for PartsTech runs.
- Do not silently overwrite labor hours; log source precedence.
- Do not claim success if output is degraded; mark as `DEGRADED`.
- Do not invent prices/brands from memory.
- Do not leave fixes Pi-local; sync back to repository source of truth.

## Source Precedence Policy

- Labor: `MOTOR` > configured shop default > AI fallback.
- Parts: priceable supplier quote > non-priceable supplier item with note > `pricing TBD`.

## Verification Matrix (minimum)

Run at least these prompts after significant changes:
1. `2002 Toyota RAV4 needs new catalytic converter customer John 555-1234`
2. Single-name customer variant
3. Non-customer variant
4. Non-emissions repair (for example alternator)
5. Hybrid vehicle case

## Escalation Criteria

Escalate with artifacts (logs + snapshots + stage durations) when:
- Same reason code repeats after one remediation retry.
- Vendor UI/selector drift suspected.
- Estimate creation succeeds but PDF source remains local fallback unexpectedly.

