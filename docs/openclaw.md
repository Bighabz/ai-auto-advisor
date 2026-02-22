# OpenClaw — SAM Reference

Complete reference for building and debugging browser automation skills in SAM.
This is the authoritative guide — if the code and this doc conflict, trust the code.

---

## Table of Contents

1. [Architecture](#architecture)
2. [Services & Startup](#services--startup)
3. [shared/browser.js — The API Every Skill Uses](#sharedbrowserjs--the-api-every-skill-uses)
4. [Snapshot Format](#snapshot-format)
5. [Standard Skill Structure](#standard-skill-structure)
6. [Workflow Patterns](#workflow-patterns)
7. [v3 Task Delegation](#v3-task-delegation)
8. [Error Handling Conventions](#error-handling-conventions)
9. [Screenshot Handling](#screenshot-handling)
10. [Platform-Specific Notes](#platform-specific-notes)
11. [Common Pitfalls](#common-pitfalls)
12. [Raw CLI Reference](#raw-cli-reference)

---

## Architecture

```
Telegram/WhatsApp
       │
       ▼
 telegram-gateway          ← receives message, routes to Claude
       │
       ▼
   Claude (tool_use)       ← decides to chat or call run_estimate
       │
       ▼
  orchestrator.js          ← master pipeline (Phase 1/2/3)
  ┌────┴────────────────────────────┐
  │ Phase 1 (parallel)              │
  │  ├── alldata-lookup/search.js   │ ── OpenClaw browser tab
  │  ├── prodemand-lookup/search.js │ ── OpenClaw browser tab
  │  ├── identifix-search/search.js │ ── OpenClaw browser tab
  │  └── autoleap-browser/ setup    │ ── OpenClaw browser tab
  │                                 │
  │ Phase 2 (sequential)            │
  │  ├── autoleap-browser/parts.js  │ ── AutoLeap PartsTech
  │  └── autoleap-browser/estimate  │ ── AutoLeap MOTOR labor
  │                                 │
  │ Phase 3 (output assembly)       │
  │  └── telegram-gateway sendPhoto │ ── Telegram Bot API
  └─────────────────────────────────┘
       │
       ▼
openclaw-gateway (systemd)  ← WebSocket control plane on localhost
       │
       ▼
openclaw-browser (systemd)  ← Chromium headless, CDP port 18800
```

**Key facts:**
- All browser skills share ONE Chromium instance (single process, multiple tabs)
- The browser profile is `openclaw` — isolated from any local Chrome installation
- Gateway runs on `localhost` only — never exposed to the internet
- The Pi has a residential IP — no proxy needed. VPS needs WARP (SOCKS5 on 40000)

---

## Services & Startup

### On Raspberry Pi

```bash
# Start all services
sudo systemctl start openclaw-gateway openclaw-browser sam-telegram

# Check status
sudo systemctl status openclaw-gateway
sudo systemctl status openclaw-browser
sudo systemctl status sam-telegram

# Follow logs live
journalctl -u sam-telegram -f
journalctl -u openclaw-gateway -f

# Restart after code changes
sudo systemctl restart sam-telegram

# Restart browser after gateway gets stuck
sudo systemctl restart openclaw-gateway openclaw-browser
```

### Service dependency order

```
openclaw-gateway (must start first)
       ↓
openclaw-browser (requires gateway)
       ↓
sam-telegram (requires browser)
```

### openclaw-gateway flags

The gateway requires `--allow-unconfigured` on the Pi (no setup wizard has been run):

```ini
ExecStart=/usr/bin/openclaw gateway --allow-unconfigured
```

Without this flag, gateway exits with code 1 and causes a crash loop.

### Browser service (Pi — no proxy)

```ini
ExecStart=/usr/bin/chromium-browser --headless --no-sandbox --disable-gpu \
  --disable-dev-shm-usage \
  --remote-debugging-port=18800 \
  --user-data-dir=/home/sam/.openclaw/browser/openclaw/user-data \
  --no-first-run
```

### Browser service (VPS — WARP proxy)

```ini
ExecStart=/usr/bin/google-chrome-stable --headless --no-sandbox --disable-gpu \
  --disable-dev-shm-usage \
  --remote-debugging-port=18800 \
  --user-data-dir=/root/.openclaw/browser/openclaw/user-data \
  --no-first-run \
  --proxy-server=socks5://127.0.0.1:40000
```

---

## shared/browser.js — The API Every Skill Uses

**Import:** `const browser = require("../../shared/browser");`

All browser skills use this module. Never call `openclaw` CLI directly in skill code — always go through `shared/browser.js`.

### Core Commands

```javascript
browser.ensureBrowser()
```
Ensures the managed browser is running and has at least one open tab. Call at the start of every skill function. Idempotent.

---

```javascript
browser.navigateTo(url)
```
Navigate the current tab to `url`. Validates that protocol is `http:` or `https:` — throws for anything else (including `javascript:` or `about:`). Use this for all URL navigation.

---

```javascript
browser.waitForLoad(state = "load")
```
Wait for the page to reach a load state. Options: `"load"` (default), `"networkidle"`, `"domcontentloaded"`.

**Critical:** Always use the default `"load"` — never pass `"networkidle"` unless absolutely necessary. `networkidle` causes 20-second gateway timeouts on heavy pages like repair platforms.

Non-fatal: swallows timeout errors so the caller continues.

---

```javascript
const snap = browser.takeSnapshot()
```
Returns raw snapshot text containing numbered element refs. **Refs are NOT stable across page navigations — always re-snapshot after any navigation or click that changes the page.**

---

```javascript
browser.clickRef(ref)
```
Click the element identified by `ref` (a string or number from the snapshot).

---

```javascript
browser.typeInRef(ref, text, submit = false)
```
Type `text` into the element at `ref`. Pass `submit = true` to press Enter automatically after typing. Text is passed as a safe process argument — never interpolated into a shell string.

---

```javascript
browser.pressKey(key)
```
Press a named key: `"Enter"`, `"Tab"`, `"Escape"`, `"ArrowDown"`, etc.

---

```javascript
browser.captureScreenshot(outputPath)
```
Screenshot current viewport. Returns the final file path. OpenClaw outputs `MEDIA:~/.openclaw/media/browser/<uuid>.png` — `handleScreenshotResult()` expands the `~` and copies to `outputPath`.

---

```javascript
browser.captureFullPageScreenshot(outputPath)
```
Full-page screenshot (scrolls and stitches). Use for long repair procedures.

---

### Snapshot Parsing

```javascript
const elements = browser.parseSnapshot(snap)
```
Parse the raw snapshot text into an array of `{ ref, type, text }` objects.

Snapshot line format:
```
[12] button "Search"
[23] input "Year"
[45] link "Honda"
[67] statictext "Some content without a type"
```

Parsed result:
```javascript
[
  { ref: "12", type: "button", text: "Search" },
  { ref: "23", type: "input", text: "Year" },
  { ref: "45", type: "link", text: "Honda" },
  { ref: "67", type: "statictext", text: "Some content without a type" },
]
```

---

```javascript
browser.findRef(elements, textMatch)
```
Find the first element whose text contains `textMatch` (case-insensitive). Returns the `ref` string, or `null`.

---

```javascript
browser.findAllRefs(elements, textMatch)
```
Find all elements whose text contains `textMatch`. Returns array of element objects (not just refs).

Also accepts a **predicate function**:
```javascript
browser.findAllRefs(elements.refs, (r) => r.role === "link" && /wiring/i.test(r.name || ""))
```

---

```javascript
browser.findRefByType(elements, type, textMatch)
```
Find first element of a specific type (button, input, link, statictext) containing `textMatch`.

```javascript
// Example: find the password input
const passRef = browser.findRefByType(elements, "input", "password");
```

---

```javascript
browser.findRefByTypeOnly(elements, type)
```
Find first element of a specific type, ignoring text. Useful when there's only one textbox on a page.

---

### Login Helpers

```javascript
browser.ensureLoggedIn(url, username, password, logPrefix, authKeywords = [])
```
Full login flow:
1. `ensureBrowser()`
2. `navigateTo(url)` + `waitForLoad()`
3. Take snapshot
4. If `isAuthenticated()` → skip (session still valid)
5. If `isLoginPage()` → call `performLogin()`
6. Re-verify after login

Returns `{ success: boolean, error?: string }`.

```javascript
// Typical usage in a skill's login function:
function login() {
  return browser.ensureLoggedIn(
    process.env.ALLDATA_URL,
    process.env.ALLDATA_USERNAME,
    process.env.ALLDATA_PASSWORD,
    "[alldata]",
    ["repair", "estimates", "vehicle"]  // keywords that confirm logged-in state
  );
}
```

---

```javascript
browser.isLoginPage(elements)  // → boolean
browser.isAuthenticated(elements, positiveKeywords)  // → boolean
browser.performLogin(elements, username, password)  // → { success, error? }
```

`isAuthenticated()` counts how many of its keyword list appear in the snapshot. Needs at least 2 matches to return `true`.

---

### Vehicle Selection Helpers

```javascript
browser.selectVehicle({ vin, year, make, model, engine }, logPrefix)
```
Tries VIN entry first (if `vin` provided), falls back to Year/Make/Model dropdowns. Works on AllData, Identifix, ProDemand.

```javascript
browser.selectVehicleVIN(vin, logPrefix)
browser.selectVehicleYMME({ year, make, model, engine }, logPrefix)
```

All return `{ success: boolean, error?: string }`.

---

### Search Helpers

```javascript
browser.performSearch(query, searchLabels)
```
Find a search input by label, type `query`, press Enter, wait for load.

```javascript
browser.getPageElements()  // → parsed elements from current page snapshot
browser.extractTextContent(elements, minLength = 20)  // → string[] of content text
```

---

## Snapshot Format

Raw snapshot output (what `takeSnapshot()` returns):

```
[1] button "Create Estimate"
[2] link "Estimates"
[3] link "Customers"
[4] input "Search customers"
[5] statictext "Welcome, Hillside Auto Clinic"
[6] button "Logout"
```

**Ref numbers**: Integer strings — unique per snapshot, reset on every new snapshot. Never cache a ref across a navigation.

**Types**: `button`, `input`, `link`, `statictext`, `select`, `checkbox`, `radio`, `heading`, `image`. Type is `"unknown"` for elements where OpenClaw couldn't determine the role.

**Text**: What appears on the element. For inputs, it's the placeholder or label. For buttons, it's the button label.

### Parsing rules in shared/browser.js

1. Match `[ref] type "text"` or `[ref] type 'text'`
2. Match `[ref] type unquotedText` (single word text)
3. Lines that don't match either pattern are skipped

---

## Standard Skill Structure

Every browser-based skill follows this pattern:

```javascript
// skills/platform-name/scripts/search.js
"use strict";

const browser = require("../../shared/browser");

const LOG = "[platform-name]";

/**
 * Main entry point. Called by orchestrator.
 * @returns {{ field1, field2, error?: string }}
 */
function search(params) {
  try {
    // 1. Login
    const loginResult = browser.ensureLoggedIn(
      process.env.PLATFORM_URL,
      process.env.PLATFORM_USERNAME,
      process.env.PLATFORM_PASSWORD,
      LOG
    );
    if (!loginResult.success) return { error: loginResult.error };

    // 2. Select vehicle
    const vehicleResult = browser.selectVehicle(params, LOG);
    if (!vehicleResult.success) return { error: vehicleResult.error };

    // 3. Search DTC/symptom
    browser.performSearch(params.query);

    // 4. Extract results
    const snap = browser.takeSnapshot();
    const elements = browser.parseSnapshot(snap);
    const data = extractResults(elements);

    return data;
  } catch (err) {
    console.error(`${LOG} Search error: ${err.message}`);
    return { error: err.message };
  }
}

function extractResults(elements) {
  // ... platform-specific extraction
}

module.exports = { search };
```

**Key conventions:**
- Log prefix: `[skill-name]` matching the directory name
- Return `{ error: string }` on failure — never throw out of the skill
- Use `browser.` prefix for all OpenClaw calls
- Re-snapshot after every navigation or significant click

---

## Workflow Patterns

### Pattern 1: Login → Navigate → Extract

Used by: AllData, Identifix, ProDemand

```javascript
function search(params) {
  // Step 1: Ensure logged in
  const login = browser.ensureLoggedIn(url, user, pass, LOG);
  if (!login.success) return { error: login.error };

  // Step 2: Select vehicle (re-snapshot internally)
  browser.selectVehicle(params, LOG);

  // Step 3: Navigate to specific section
  let snap = browser.takeSnapshot();
  let els = browser.parseSnapshot(snap);
  const sectionLink = browser.findRef(els, "diagnostic trouble codes");
  if (sectionLink) {
    browser.clickRef(sectionLink);
    browser.waitForLoad();
  }

  // Step 4: Search within section
  browser.performSearch(params.query);

  // Step 5: Extract results (re-snapshot)
  snap = browser.takeSnapshot();
  els = browser.parseSnapshot(snap);
  return extractData(els);
}
```

### Pattern 2: Navigate back through history

Used when iterating through a list of items (TSBs, wiring diagrams):

```javascript
const items = browser.findAllRefs(elements, "tsb");

for (const item of items.slice(0, 8)) {
  browser.clickRef(item.ref);
  browser.waitForLoad();

  // Extract from detail page
  const detailSnap = browser.takeSnapshot();
  const detailEls = browser.parseSnapshot(detailSnap);
  results.push(extractDetail(detailEls));

  // Go back to list — re-snapshot after back
  browser.navigateTo("javascript:history.back()");  // ← NOT supported (non-http protocol)
  // Instead, save the list URL and navigate back to it:
  browser.navigateTo(listUrl);
  browser.waitForLoad();

  snap = browser.takeSnapshot();  // ← always re-snapshot after navigation
  elements = browser.parseSnapshot(snap);
}
```

**Important:** `navigateTo()` rejects non-http URLs. To go back, either:
- Store the list page URL and re-navigate to it
- Use `browser.pressKey("Alt+Left")` (browser back) — use sparingly
- Or navigate back to the section URL directly

### Pattern 3: Screenshot capture

```javascript
const screenshotDir = path.join(process.env.HOME || "/home/sam", ".openclaw", "media", "wiring");
fs.mkdirSync(screenshotDir, { recursive: true });
const screenshotPath = path.join(screenshotDir, `wiring-${Date.now()}.png`);

browser.captureScreenshot(screenshotPath);

if (fs.existsSync(screenshotPath)) {
  results.push({ name: diagramName, screenshotPath });
}
```

OpenClaw writes to `~/.openclaw/media/browser/<uuid>.png` and outputs `MEDIA:<path>`. The `captureScreenshot()` wrapper parses this, expands `~`, and copies to your `outputPath`.

### Pattern 4: Form fill and submit

```javascript
let snap = browser.takeSnapshot();
let els = browser.parseSnapshot(snap);

// Find the input
const yearRef = browser.findRefByType(els, "input", "year");
browser.clickRef(yearRef);
browser.typeInRef(yearRef, "2019");          // type without submit
browser.pressKey("Tab");                      // move to next field

// Re-snapshot for next field
snap = browser.takeSnapshot();
els = browser.parseSnapshot(snap);

const makeRef = browser.findRefByType(els, "input", "make");
browser.typeInRef(makeRef, "Honda", true);   // type + press Enter (submit=true)
browser.waitForLoad();
```

---

## v3 Task Delegation

The v3 orchestrator runs the pipeline in three phases. Here is which function calls which skill:

### Phase 1 (parallel — `Promise.all`)

```
orchestrator.buildEstimate()
    ├── runResearch(vehicle, requestInfo, params)         ← 40s timeout
    │       ├── searchAllData(researchQuery)              → alldata-lookup/search.js
    │       │       ├── captureWiringDiagrams()           → alldata-lookup/wiring.js
    │       │       └── fetchTSBs()                      → alldata-lookup/tsb.js
    │       ├── searchDirectHit(researchQuery)            → identifix-search/search.js
    │       └── searchProDemand(researchQuery)            → prodemand-lookup/search.js
    │               └── extractDtcTestPlan()              (internal to search.js)
    │
    └── setupAutoLeapSession(vehicle, params)             ← 40s timeout
            ├── autoLeapBrowser.login.ensureLoggedIn()   → autoleap-browser/login.js
            └── autoLeapBrowser.customer.findOrCreate()  → autoleap-browser/customer.js
```

### Phase 2 (sequential)

```
orchestrator.populateEstimate(autoLeapSession, researchResults, ...)
    ├── extractPartsNeeded(...)                           ← internal (no browser)
    ├── autoLeapBrowser.parts.searchAndAddParts()        → autoleap-browser/parts.js
    ├── autoLeapBrowser.estimate.createEstimate()        → autoleap-browser/estimate.js
    ├── autoLeapBrowser.send.sendEstimate()              → autoleap-browser/send.js
    └── autoLeapBrowser.estimate.downloadPdf()           → autoleap-browser/estimate.js
```

### Phase 3 (output assembly — no browser)

```
orchestrator.buildEstimate() assembles results.formattedResponse

telegram-gateway/server.js handleToolCall()
    ├── sendMessage(chatId, msg1)    ← Diagnosis
    ├── sendPhoto(chatId, diagram1)  ← Wiring diagrams (one per photo)
    ├── sendPhoto(chatId, diagram2)
    ├── sendMessage(chatId, msg2)    ← Research findings
    ├── sendMessage(chatId, msg3)    ← Mechanic reference + TSBs
    ├── sendDocument(chatId, pdf)    ← PDF estimate
    └── sendMessage(chatId, msg4)    ← Action prompt
```

### Research results contract

The `researchResults` object passed from Phase 1 to Phase 2:

```javascript
{
  alldata: {
    procedures: [],       // OEM repair procedure steps
    torqueSpecs: {},      // { partName: "value ft-lbs" }
    specialTools: [],
    laborTime: null,
    screenshots: [],
    wiringDiagrams: [     // NEW in v3
      { name: "P0420 Catalyst Monitor Circuit", screenshotPath: "/path/to/file.png" }
    ],
    tsbs: [               // NEW in v3
      { number: "21-123", title: "Rough Idle P0300", date: "03/2021", summary: "..." }
    ],
    error: null,          // set if AllData failed/skipped
  },
  identifix: {
    fixCount: 3,
    topFix: { description: "Replace downstream O2 sensor", successRate: 78, confirmedCount: 45 },
    misdiagnosisWarnings: ["Do not replace cat without testing O2 sensors first"],
    error: null,
  },
  prodemand: {
    realFixes: [{ symptom: "P0420", cause: "Faulty O2 sensor", repair: "Replace" }],
    laborTimes: [{ procedure: "O2 sensor replacement", hours: 0.5 }],
    dtcTestPlan: [        // NEW in v3
      { step: 1, action: "Verify freeze frame data..." },
      { step: 2, action: "Check for exhaust leaks..." },
    ],
    error: null,
  },
  // Flattened for convenience:
  wiringDiagrams: [],    // same as alldata.wiringDiagrams
  tsbs: [],              // same as alldata.tsbs
  dtcTestPlan: [],       // same as prodemand.dtcTestPlan
}
```

### Estimate result contract

The `estimate` object passed from Phase 2 to output assembly:

```javascript
{
  success: true,
  estimateId: "EST-12345",
  total: 487.50,
  totalLabor: 180.00,
  totalParts: 285.00,
  shopSupplies: 14.62,
  tax: 7.88,
  pdfPath: "/tmp/autoleap-estimate-EST-12345-1708550400000.pdf",
  estimateSource: "browser",   // "browser" | "local-pdf"
  addedParts: [...],
  failedParts: [...],
  error: null,
}
```

---

## Error Handling Conventions

### Always return, never throw (from skills)

```javascript
// CORRECT — graceful degradation
try {
  const result = doSomething();
  return result;
} catch (err) {
  console.error(`${LOG} Error: ${err.message}`);
  return { error: err.message };
}

// WRONG — crashes the pipeline
const result = doSomething(); // throws → orchestrator crashes
```

### Orchestrator uses Promise.allSettled for research

```javascript
const [alldataResult, identifixResult, prodemandResult] = await Promise.allSettled([...]);

// allSettled never rejects — check status:
const alldata = alldataResult.status === "fulfilled"
  ? alldataResult.value
  : { error: alldataResult.reason?.message };
```

### Timeout wrapping

```javascript
function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms)
    ),
  ]);
}

// Usage:
const result = await withTimeout(searchAllData(query), 40_000, "AllData");
```

### Fallback chain

```
AutoLeap browser estimate
    ↓ (fails)
generate local PDF (estimate-pdf skill)
    ↓ (fails)
No PDF — send text messages only, note PDF unavailable
```

---

## Screenshot Handling

OpenClaw saves screenshots to its own media directory and outputs:
```
MEDIA:~/.openclaw/media/browser/abc123.png
```

`shared/browser.js` handles this automatically in `captureScreenshot()`:

```javascript
function handleScreenshotResult(result, outputPath) {
  const mediaMatch = result.match(/MEDIA:(.+)/);
  if (mediaMatch) {
    let srcPath = mediaMatch[1].trim();
    if (srcPath.startsWith("~")) {
      srcPath = srcPath.replace("~", process.env.HOME || "/root");
    }
    if (outputPath && srcPath !== outputPath) {
      require("fs").copyFileSync(srcPath, outputPath);
      return outputPath;
    }
    return srcPath;
  }
  return outputPath || result.trim();
}
```

**To capture and keep a screenshot:**

```javascript
const fs = require("fs");
const path = require("path");

const dir = path.join(process.env.HOME || "/home/sam", ".openclaw", "media", "wiring");
fs.mkdirSync(dir, { recursive: true });
const outputPath = path.join(dir, `wiring-${Date.now()}.png`);

const savedPath = browser.captureScreenshot(outputPath);

if (fs.existsSync(savedPath)) {
  // Use savedPath — it points to the copied file
}
```

**To send a screenshot as a Telegram photo:**
The `telegram-gateway/server.js` `sendPhoto()` function reads the file from disk and posts it via `sendPhoto` multipart API. Pass the `screenshotPath` from the wiring diagram object.

---

## Platform-Specific Notes

### AllData (`my.alldata.com`)

- **Login check keywords:** `"repair"`, `"estimates"`, `"vehicle"`, `"search"`
- **Vehicle selection:** YMME dropdowns (Year → Make → Model → Engine)
- **DTC search:** Navigate to "Diagnostic Trouble Codes" section, search the code
- **Wiring section:** Usually under "Electrical" or "Wiring Diagrams" in the left nav
- **TSB section:** "Technical Service Bulletins" in the left nav
- **IP sensitivity:** Datacenter IPs get 403. Pi residential IP works directly. VPS needs WARP.
- **Screenshots:** Use `captureFullPageScreenshot()` for wiring diagrams (they're tall)

### Identifix (`direct-hit.identifix.com`)

- **Login URL:** `https://direct-hit.identifix.com` (not `www.identifix.com` — that's the marketing page)
- **Login check keywords:** `"direct-hit"`, `"search"`, `"fixes"`
- **Vehicle selection:** YMME dropdowns
- **Data extracted:** Known fixes (ranked by success rate), confirmed counts, misdiagnosis warnings
- **Top fix:** Highest `successRate` with `confirmedCount >= 5`

### ProDemand (`www.prodemand.com`)

- **Dual-mode:** TAPE API (preferred, direct) or browser automation (fallback)
- **Login check keywords:** `"vehicle"`, `"repair"`, `"real fixes"`
- **Data extracted:** Real Fixes, labor times, part numbers, DTC test plans
- **DTC test plan:** Under "Test Plan" or "Diagnostic Procedure" tab after DTC lookup

### AutoLeap (`app.myautoleap.com`)

- **Login:** Email + password at `https://app.myautoleap.com`
- **Login check keywords:** `"estimates"`, `"customers"`, `"dashboard"`, `"vehicles"`
- **Parts:** AutoLeap's embedded PartsTech integration — search within estimate
- **Labor:** MOTORS labor guide — search by repair type within estimate services
- **PDF download:** "Download PDF" or "Print" button within the estimate view
- **Customer flow:** Find existing customer → if not found, create new → add vehicle → create estimate

---

## Common Pitfalls

### 1. Using `networkidle` in waitForLoad

```javascript
// BAD — causes 20s timeouts on AllData/ProDemand
browser.waitForLoad("networkidle");

// GOOD — use default
browser.waitForLoad();
```

### 2. Caching refs across navigations

```javascript
// BAD — ref 23 is gone after navigation
const ref = browser.findRef(elements, "Search");
browser.clickRef(ref);
browser.waitForLoad();
browser.typeInRef(ref, "P0420");  // ← BAD: ref is stale

// GOOD — re-snapshot after navigation
const ref = browser.findRef(elements, "Search");
browser.clickRef(ref);
browser.waitForLoad();
const snap2 = browser.takeSnapshot();     // ← re-snapshot
const els2 = browser.parseSnapshot(snap2);
const searchRef2 = browser.findRef(els2, "Search");
browser.typeInRef(searchRef2, "P0420");
```

### 3. Using `open` instead of `navigate`

```javascript
// openclaw browser open → creates a NEW tab
// openclaw browser navigate → uses CURRENT tab

// In shared/browser.js, navigateTo() uses "navigate" (correct)
// Don't call browserCmd("open", url) from skill code — it creates a new tab
```

### 4. Not calling `ensureBrowser()` first

```javascript
// BAD — browser may not be running
const snap = browser.takeSnapshot();  // throws if browser down

// GOOD — always call ensureBrowser first
browser.ensureBrowser();
const snap = browser.takeSnapshot();
```

### 5. Using execSync with shell strings (old pattern — DO NOT USE)

```javascript
// BAD — old pattern, command injection risk
execSync(`openclaw browser --browser-profile openclaw type ${ref} "${text}"`);

// GOOD — use shared/browser.js which uses execFileSync with arg arrays
browser.typeInRef(ref, text);
```

### 6. OpenClaw install on arm64 (Raspberry Pi)

```bash
# arm64 native modules fail to build — use --ignore-scripts
npm install -g openclaw --ignore-scripts
```

### 7. Gateway gets stuck after heavy browser use

```bash
# Symptom: skills hang, no response from browser
# Fix: restart both services
sudo systemctl restart openclaw-gateway openclaw-browser
```

### 8. Screenshot path on Windows vs Pi

```javascript
// Don't hardcode /root — use HOME env var
const dir = path.join(process.env.HOME || "/home/sam", ".openclaw", "media", "wiring");
```

---

## Raw CLI Reference

Only use these for manual testing/debugging — not in skill code.

```bash
# Lifecycle
openclaw browser status
openclaw browser start
openclaw browser stop

# Navigation
openclaw browser --browser-profile openclaw navigate https://my.alldata.com
openclaw browser --browser-profile openclaw open https://example.com  # NEW TAB

# Snapshot
openclaw browser --browser-profile openclaw snapshot
openclaw browser --browser-profile openclaw snapshot --efficient

# Actions
openclaw browser --browser-profile openclaw click 12
openclaw browser --browser-profile openclaw type 23 "P0420"
openclaw browser --browser-profile openclaw type 23 "P0420" --submit
openclaw browser --browser-profile openclaw press Enter
openclaw browser --browser-profile openclaw select 9 "Honda"

# Wait
openclaw browser --browser-profile openclaw wait --load load
openclaw browser --browser-profile openclaw wait --load networkidle
openclaw browser --browser-profile openclaw wait "#element-id"

# Screenshot
openclaw browser --browser-profile openclaw screenshot
openclaw browser --browser-profile openclaw screenshot --full-page

# Tabs
openclaw browser --browser-profile openclaw tabs
openclaw browser --browser-profile openclaw tab new
openclaw browser --browser-profile openclaw tab select 2
openclaw browser --browser-profile openclaw tab close 2

# Debugging
openclaw browser --browser-profile openclaw console
openclaw browser --browser-profile openclaw errors
openclaw browser --browser-profile openclaw highlight 12
openclaw browser --browser-profile openclaw evaluate --fn '(el) => el.textContent' --ref 7
```

---

## Environment Variables

| Variable | Used By | Description |
|----------|---------|-------------|
| `OPENCLAW_BROWSER_PROFILE` | shared/browser.js | Browser profile name (default: `openclaw`) |
| `OPENCLAW_EXEC_TIMEOUT` | shared/browser.js | CLI command timeout in ms (default: 30000) |
| `ALLDATA_URL` | alldata-lookup | Platform URL |
| `ALLDATA_USERNAME` | alldata-lookup | Login username |
| `ALLDATA_PASSWORD` | alldata-lookup | Login password |
| `IDENTIFIX_URL` | identifix-search | Platform URL |
| `IDENTIFIX_USERNAME` | identifix-search | Login username |
| `IDENTIFIX_PASSWORD` | identifix-search | Login password |
| `PRODEMAND_URL` | prodemand-lookup | Platform URL |
| `PRODEMAND_USERNAME` | prodemand-lookup | Login username |
| `PRODEMAND_PASSWORD` | prodemand-lookup | Login password |
| `AUTOLEAP_EMAIL` | autoleap-browser | Login email (also gates browser automation) |
| `AUTOLEAP_PASSWORD` | autoleap-browser | Login password |

All variables are loaded from `config/.env` at startup by the gateway service.
