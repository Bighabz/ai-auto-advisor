# Playbook Revival — Browser-Driven AutoLeap Estimates

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Re-activate the 14-step browser playbook so AutoLeap's native markup matrix sets retail prices (not code-calculated flat %).

**Architecture:** Orchestrator Step 6 calls `playbook.runPlaybook()` as the primary path. REST `buildEstimate()` is the fallback if playbook fails. Token pre-warm (already in place) ensures Chrome is responsive. PartsTech search in Step 5 still runs to provide part names; playbook Phase 3 re-searches those parts inside AutoLeap's PartsTech integration to trigger the markup matrix.

**Tech Stack:** puppeteer-core (CDP to Chrome on port 18800), Claude Haiku (MOTOR category picking), existing playbook.js + helpers.

---

### Task 1: Create test harness on Pi

**Files:**
- Create: `scripts/test-playbook.js`

**Step 1: Write the test harness**

This script calls `runPlaybook()` directly with hardcoded test data. No Claude API cost for the pipeline — only MOTOR navigation uses haiku (~$0.005).

```javascript
/**
 * Direct playbook test — run on Pi via: node scripts/test-playbook.js
 * No Telegram, no orchestrator, no Claude diagnosis. Just the browser flow.
 */
const { runPlaybook } = require("../skills/autoleap-browser/scripts/playbook");

const testData = {
  customer: { name: "Test Customer", phone: "555-0000" },
  vehicle: { year: 2002, make: "Toyota", model: "RAV4", vin: null },
  diagnosis: {
    ai: {
      diagnoses: [{ cause: "Catalytic converter failure", confidence: 0.9 }],
      repair_plan: { labor: { description: "Replace catalytic converter", hours: 1.3 } },
    },
    codes: ["P0420"],
  },
  parts: [
    {
      requested: { partType: "catalytic converter", searchTerms: ["catalytic converter"] },
      selected: { description: "Catalytic Converter", brand: "MagnaFlow", partNumber: "51356", price: 281.78, totalCost: 281.78 },
    },
  ],
  progressCallback: (phase) => { console.log(`[test] Progress: ${phase}`); return Promise.resolve(); },
};

(async () => {
  console.log("=== PLAYBOOK TEST START ===");
  console.log(`Customer: ${testData.customer.name}`);
  console.log(`Vehicle: ${testData.vehicle.year} ${testData.vehicle.make} ${testData.vehicle.model}`);
  console.log(`Parts: ${testData.parts.length}`);
  console.log("");

  try {
    const result = await runPlaybook(testData);
    console.log("");
    console.log("=== PLAYBOOK RESULT ===");
    console.log(JSON.stringify(result, null, 2));

    if (result.success) {
      console.log(`\nSUCCESS: Estimate ${result.roNumber || result.estimateId}`);
      console.log(`  Total: $${result.total} (labor $${result.totalLabor} + parts $${result.totalParts})`);
      console.log(`  Labor: ${result.laborHours}h`);
      console.log(`  Parts added: ${result.partsAdded.length}`);
      console.log(`  PDF: ${result.pdfPath || "none"}`);
      console.log(`  Warnings: ${result.warnings.length}`);
    } else {
      console.log(`\nFAILED: ${result.error}`);
      console.log(`  Warnings: ${JSON.stringify(result.warnings)}`);
    }
  } catch (err) {
    console.error(`\nCRASH: ${err.message}`);
    console.error(err.stack);
  }
  process.exit(0);
})();
```

**Step 2: Deploy and run on Pi**

```bash
# From local machine
git add scripts/test-playbook.js
git commit -m "test: add direct playbook test harness"
git push origin master

# On Pi
ssh sam@192.168.1.31
cd /home/sam/ai-auto-advisor && git pull origin master
node scripts/test-playbook.js
```

Expected: Playbook runs and we see which phase/step fails first. Record the exact error.

**Step 3: Commit**

Already committed in step 2.

---

### Task 2: Fix playbook puppeteer connection

**Files:**
- Modify: `skills/autoleap-browser/scripts/playbook.js:62-66`

**Step 1: Add protocolTimeout to puppeteer.connect**

The existing code has no `protocolTimeout`, causing "Network.enable timed out" on Pi.

Change line 63-66 from:
```javascript
browser = await puppeteer.connect({
  browserURL: CHROME_CDP_URL,
  defaultViewport: { width: 1280, height: 900 },
});
```
To:
```javascript
browser = await puppeteer.connect({
  browserURL: CHROME_CDP_URL,
  defaultViewport: { width: 1280, height: 900 },
  protocolTimeout: 60000,
});
```

**Step 2: Increase navigation timeouts**

In `ensureLoggedIn()` (line 262), change `timeout: 15000` to `timeout: 30000`.

In `createEstimateWithCustomerVehicle()` (line 316), change `timeout: 15000` to `timeout: 30000`.

**Step 3: Run test harness on Pi**

```bash
ssh sam@192.168.1.31 "cd /home/sam/ai-auto-advisor && git pull && node scripts/test-playbook.js"
```

Expected: Phase 1 (auth) succeeds. Phase 2 may fail on selectors — that's Task 3.

**Step 4: Commit**

```bash
git add skills/autoleap-browser/scripts/playbook.js
git commit -m "fix: add protocolTimeout and increase nav timeouts in playbook"
```

---

### Task 3: Fix Phase 2 selectors (Customer & Vehicle)

**Files:**
- Modify: `skills/autoleap-browser/scripts/playbook.js`
- Modify: `skills/autoleap-browser/scripts/helpers/selectors.js`

**Context:** The `:has-text()` pseudo-selector is NOT supported by puppeteer's native CSS engine. All selectors using `:has-text()` will fail silently. The `clickFirstAvailable()` and `clickByTextFallback()` functions have text fallbacks that parse the `:has-text("...")` pattern, but `findFirstElement()` and `findElement()` do NOT.

This task is iterative — run test harness after each fix, read the error, fix the next selector. The exact selectors depend on what AutoLeap's DOM looks like on the Pi.

**Step 1: Run test harness and read the error**

The error will tell us which phase/step fails and which selector is the problem.

**Step 2: Fix the failing selector**

Common fixes:
- Replace `:has-text("X")` selectors with text-based `page.evaluate()` fallbacks
- Add `data-testid` or `aria-label` selectors if available in AutoLeap's DOM
- Take a screenshot at the failure point to see the actual page state:
  ```javascript
  await page.screenshot({ path: "/tmp/playbook-debug.png", fullPage: true });
  ```

**Step 3: Re-run test harness, repeat until Phase 2 passes**

Gate: Test harness logs `Phase 2: "Save & Create Estimate"` with an estimate ID.

**Step 4: Commit**

```bash
git add skills/autoleap-browser/scripts/playbook.js skills/autoleap-browser/scripts/helpers/selectors.js
git commit -m "fix: Phase 2 selectors for AutoLeap customer/vehicle creation"
```

---

### Task 4: Fix Phase 3 (PartsTech new tab)

**Files:**
- Modify: `skills/autoleap-browser/scripts/helpers/pt-tab.js`
- Modify: `skills/autoleap-browser/scripts/helpers/selectors.js`

**Context:** This is the most complex phase. The flow is:
1. Click "Parts ordering" tab in AutoLeap estimate
2. Click "+" on PartsTech card to open a new browser tab (SSO)
3. In the new tab: search for parts, add cheapest in-stock to cart
4. Submit cart back to AutoLeap (triggers markup matrix)

Key risks:
- PartsTech SSO may not open a new tab (could be iframe instead)
- PartsTech UI selectors may have changed
- Cart submission flow may differ

**Step 1: Run test harness (Phase 2 must pass from Task 3)**

Read the Phase 3 error output.

**Step 2: Fix iteratively — same pattern as Task 3**

Add debug screenshots at failure points:
```javascript
await page.screenshot({ path: "/tmp/pt-debug-1.png" });
```

**Step 3: Gate — test harness logs parts added and submitted**

Expected: `Phase 3: Parts synced to AutoLeap`

**Step 4: Commit**

```bash
git add skills/autoleap-browser/scripts/helpers/pt-tab.js skills/autoleap-browser/scripts/helpers/selectors.js
git commit -m "fix: Phase 3 PartsTech tab selectors and SSO flow"
```

---

### Task 5: Fix Phase 4 (MOTOR labor) and Phase 5 (linking)

**Files:**
- Modify: `skills/autoleap-browser/scripts/helpers/motor-nav.js`
- Modify: `skills/autoleap-browser/scripts/helpers/selectors.js`
- Modify: `skills/autoleap-browser/scripts/playbook.js` (Phase 5: linkPartsToServices)

**Context:**
- MOTOR navigation uses Claude haiku to pick categories (~$0.005 per estimate)
- Phase 5 links parts to labor service — this triggers the markup matrix (THE PROFIT STEP)
- Golden rule: NEVER modify Qty/Hrs after MOTOR populates them

**Step 1: Run test harness (Phases 2-3 must pass)**

**Step 2: Fix MOTOR selectors iteratively**

**Step 3: Fix Phase 5 linking selectors**

**Step 4: Gate — test harness logs MOTOR hours and markup matrix triggered**

Expected:
```
Phase 4: MOTOR labor added: 1.3h (NEVER modifying Qty/Hrs)
Phase 5: Markup matrix triggered (1 parts linked)
```

**Step 5: Commit**

```bash
git add skills/autoleap-browser/scripts/helpers/motor-nav.js skills/autoleap-browser/scripts/helpers/selectors.js skills/autoleap-browser/scripts/playbook.js
git commit -m "fix: Phase 4-5 MOTOR labor and part-to-service linking"
```

---

### Task 6: Fix Phase 6 (Save + PDF + totals)

**Files:**
- Modify: `skills/autoleap-browser/scripts/playbook.js` (saveEstimate, readEstimateTotals)

**Step 1: Run test harness (all prior phases must pass)**

**Step 2: Fix save button selector and totals parsing**

The `readEstimateTotals()` function uses regex on page text. This is fragile. If it fails, add DOM-based selectors for the estimate summary section.

Add content validation for PDF (same as the fix in `autoleap-api.js`): reject if page shows 404, or if PDF < 20KB.

**Step 3: Gate — test harness shows correct totals with native markup pricing**

Expected:
```
Phase 6: Estimate saved
Phase 6: PDF exported → /tmp/estimate-2002-Toyota-RAV4-*.pdf (>20000 bytes)
SUCCESS: Estimate #XXXXX
  Total: $XXX.XX (labor $156.00 + parts $XXX.XX)  ← parts price from AutoLeap's markup matrix
```

**Step 4: Commit**

```bash
git add skills/autoleap-browser/scripts/playbook.js
git commit -m "fix: Phase 6 save, totals parsing, and PDF validation"
```

---

### Task 7: Re-wire orchestrator Step 6

**Files:**
- Modify: `skills/estimate-builder/scripts/orchestrator.js:64-77` (add playbook require)
- Modify: `skills/estimate-builder/scripts/orchestrator.js:1295-1376` (Step 6)
- Modify: `skills/estimate-builder/scripts/orchestrator.js:1463-1490` (Step 7 PDF)

**Step 1: Add playbook require back (after autoLeapApi)**

At line ~75 (after autoLeapApi block), add:
```javascript
// AutoLeap browser playbook — 100% browser-driven estimate creation
let autoLeapPlaybook = null;
if (process.env.AUTOLEAP_EMAIL) {
  try {
    autoLeapPlaybook = require("../../autoleap-browser/scripts/playbook");
  } catch {
    // playbook not available — will fall back to REST API
  }
}
```

**Step 2: Replace Step 6 body**

Replace the current REST API Step 6 block with:
```javascript
// ─── Step 6: Build Estimate in AutoLeap (Browser Playbook → REST fallback) ───
if (params.progressCallback) await params.progressCallback("building_estimate").catch(() => {});

if (autoLeapPlaybook && params.customer) {
  // PRIMARY: Browser playbook — AutoLeap's native markup matrix sets retail prices
  log.info("Step 6: Creating estimate in AutoLeap (browser playbook)...");
  try {
    const estParts = results.parts?.bestValueBundle?.parts || [];
    const partsWithSelection = estParts.filter(p => p.selected);
    console.log(`  → Parts to add via PartsTech: ${partsWithSelection.length}`);

    const playbookResult = await runPlaybook({
      customer: params.customer,
      vehicle: results.vehicle || vehicle,
      diagnosis: results.diagnosis,
      parts: estParts,
      progressCallback: params.progressCallback,
    });

    if (playbookResult.success) {
      results.estimate = {
        success: true,
        estimateId: playbookResult.estimateId,
        estimateCode: playbookResult.roNumber,
        total: playbookResult.total,
        totalLabor: playbookResult.totalLabor,
        totalParts: playbookResult.totalParts,
        laborHours: playbookResult.laborHours,
        laborRate: playbookResult.laborRate || (Number(process.env.AUTOLEAP_LABOR_RATE) || 120),
        shopSupplies: null,
        tax: null,
        customerName: params.customer.name,
        vehicleDesc: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
        pricingSource: "autoleap-native",
      };
      results.resolvedLaborHours = playbookResult.laborHours;
      results.resolvedLaborRate = playbookResult.laborRate;
      results.estimateSource = "autoleap-native";
      if (playbookResult.pdfPath) results.pdfPath = playbookResult.pdfPath;
      // ... logging and trackEvent ...
    } else {
      console.log(`  → Playbook failed: ${playbookResult.error} — falling back to REST API`);
      // FALL THROUGH to REST API fallback below
    }
  } catch (err) {
    console.error(`  → Playbook error: ${err.message} — falling back to REST API`);
  }
}

// REST API fallback (if playbook failed or not available)
if (!results.estimate?.success && autoLeapApi && params.customer) {
  log.info("Step 6 fallback: REST API + code markup...");
  // ... existing buildEstimate() code ...
}
```

**Step 3: Update Step 7 to use playbook PDF if available**

```javascript
// ─── Step 7: PDF ───
if (results.pdfPath) {
  console.log(`  → PDF already available: ${results.pdfPath}`);
} else if (autoLeapApi && results.estimate?.estimateId) {
  // Download via REST/puppeteer
  // ... existing PDF download code ...
}
```

**Step 4: Syntax check**

```bash
node -c skills/estimate-builder/scripts/orchestrator.js
```

**Step 5: Commit**

```bash
git add skills/estimate-builder/scripts/orchestrator.js
git commit -m "feat: re-wire orchestrator Step 6 to use browser playbook with REST fallback"
```

---

### Task 8: Deploy and end-to-end test

**Step 1: Push and deploy**

```bash
git push origin master
ssh sam@192.168.1.31 "cd /home/sam/ai-auto-advisor && git pull origin master"
ssh sam@192.168.1.31 "sudo systemctl restart sam-telegram openclaw-browser openclaw-gateway"
```

**Step 2: Test at @hillsideautobot**

Send: `2002 Toyota RAV4 needs catalytic converter replaced customer Test User 555-0000`

**Step 3: Check logs**

```bash
ssh sam@192.168.1.31 "sudo journalctl -u sam-telegram --no-pager -n 150 --output=cat"
```

Expected: Playbook runs all 6 phases, estimate has native markup pricing, PDF is valid.

**Step 4: Verify pricing**

The parts price should match what AutoLeap's markup matrix produces, NOT the 40% flat code markup ($394.49). The total should be different from $550.49.

**Step 5: Final commit and memory update**

```bash
git commit -m "chore: playbook revival verified — native markup pricing confirmed"
```

Update `MEMORY.md` with playbook status.

---

## Execution Notes

- Tasks 3-6 are iterative debugging loops — each involves: run test → read error → fix selector → repeat
- Add `await page.screenshot({ path: "/tmp/debug-phaseN.png" })` liberally at failure points
- Check screenshots via: `scp sam@192.168.1.31:/tmp/debug-*.png .`
- Each MOTOR navigation call costs ~$0.001 (Claude haiku) — budget ~$0.005 per test
- Full pipeline tests (via Telegram) cost more (Claude Sonnet for routing + diagnosis)
- Use `test-playbook.js` for all debugging — only use Telegram for final verification
