/**
 * MOTOR Labor Tree Navigation
 *
 * Navigates AutoLeap's MOTOR catalog using a 7-level category tree.
 * Uses Claude AI (haiku) to pick the correct category at each level
 * based on the vehicle and diagnosis context.
 */

const https = require("https");
const { SERVICES } = require("./selectors");

const LOG = "[playbook:motor]";

/**
 * Navigate the MOTOR category tree to find and add the correct labor line.
 *
 * @param {import('puppeteer-core').Page} page - AutoLeap estimate page
 * @param {object} diagnosis - Diagnosis result (has .ai.diagnoses, .codes, .ai.repair_plan)
 * @param {object} vehicle - { year, make, model, engine, vin }
 * @returns {{ success: boolean, procedure?: string, hours?: number, addOns?: string[], error?: string }}
 */
async function navigateMotorTree(page, diagnosis, vehicle) {
  console.log(`${LOG} Opening MOTOR labor catalog...`);

  // Click Services tab
  await clickFirstAvailable(page, SERVICES.TAB);
  await sleep(2000);

  // Click Browse button
  await clickFirstAvailable(page, SERVICES.BROWSE_BTN);
  await sleep(2000);

  // Wait for modal
  try {
    await page.waitForSelector(SERVICES.MODAL.split(", ")[0], { timeout: 8000 });
  } catch {
    const hasModal = await page.evaluate(() => {
      return !!document.querySelector('[role="dialog"], [class*="modal"]');
    });
    if (!hasModal) {
      return { success: false, error: "Browse modal did not open" };
    }
  }

  // ── Step 11a: Connect to MOTOR ──
  console.log(`${LOG} Checking MOTOR connection...`);

  // Scroll modal tabs to reveal MOTOR
  await page.evaluate((sel) => {
    const container = document.querySelector(sel);
    if (container) container.scrollLeft += 500;
  }, SERVICES.MODAL_TABS.split(", ")[0]);
  await sleep(1000);

  // Check if "Connect to MOTOR" button exists
  const connectBtn = await findElement(page, SERVICES.CONNECT_MOTOR);
  if (connectBtn) {
    console.log(`${LOG} Clicking "Connect to MOTOR"...`);
    await connectBtn.click();
    await sleep(3000);
  }

  // Click MOTOR Primary tab
  const motorTab = await findElement(page, SERVICES.MOTOR_TAB);
  if (!motorTab) {
    return { success: false, error: "MOTOR Primary tab not found — MOTOR may not be connected" };
  }
  await motorTab.click();
  await sleep(2000);

  // Build repair context for Claude
  const repairContext = buildRepairContext(diagnosis, vehicle);
  console.log(`${LOG} Repair context: ${repairContext.substring(0, 100)}...`);

  // ── Navigate levels with Claude AI ──
  const maxLevels = 7;
  let currentLevel = 0;
  let lastPickedName = "";

  for (let level = 0; level < maxLevels; level++) {
    currentLevel = level + 1;

    // Read current category options from DOM
    const options = await readCategoryOptions(page);

    if (options.length === 0) {
      // No more categories — check if we have an "Add" button
      const addBtn = await findElement(page, SERVICES.ADD_BTN);
      if (addBtn) {
        console.log(`${LOG} Found Add button at level ${currentLevel} — adding labor`);
        break;
      }
      console.log(`${LOG} No options at level ${currentLevel} — may be at leaf`);
      break;
    }

    // Check if one of the options is an "Add" action
    const hasAddAction = options.some(
      (o) => o.toLowerCase().includes("add") || o.toLowerCase().includes("select")
    );

    if (options.length === 1 && !hasAddAction) {
      // Auto-select single option
      console.log(`${LOG} Level ${currentLevel}: Auto-selecting "${options[0]}"`);
      await clickCategoryOption(page, options[0]);
      lastPickedName = options[0];
      await sleep(1500);
      continue;
    }

    // Ask Claude to pick
    const levelLabel = getLevelLabel(currentLevel);
    const pick = await askClaudeForCategory(
      repairContext,
      options,
      levelLabel,
      lastPickedName
    );

    if (!pick) {
      return { success: false, error: `Claude could not pick a ${levelLabel} from: ${options.join(", ")}` };
    }

    console.log(`${LOG} Level ${currentLevel} (${levelLabel}): Claude picked "${pick}"`);

    // Click the picked option
    const clicked = await clickCategoryOption(page, pick);
    if (!clicked) {
      // Try fuzzy match
      const fuzzy = findClosestMatch(pick, options);
      if (fuzzy && fuzzy !== pick) {
        console.log(`${LOG} Fuzzy match: "${pick}" → "${fuzzy}"`);
        await clickCategoryOption(page, fuzzy);
      } else {
        return { success: false, error: `Could not click "${pick}" at level ${currentLevel}` };
      }
    }

    lastPickedName = pick;
    await sleep(1500);
  }

  // ── Handle qualifiers (if present) ──
  const qualifiers = await readQualifierOptions(page);
  if (qualifiers.length > 0) {
    console.log(`${LOG} Qualifiers found: ${qualifiers.join(", ")}`);
    const qualPick = await askClaudeForCategory(
      repairContext,
      qualifiers,
      "qualifier",
      lastPickedName
    );
    if (qualPick) {
      console.log(`${LOG} Qualifier selected: "${qualPick}"`);
      await clickCategoryOption(page, qualPick);
      await sleep(1500);
    }
  }

  // ── Handle add-ons (if present) ──
  const addOns = await readAddOnOptions(page);
  const selectedAddOns = [];
  if (addOns.length > 0) {
    console.log(`${LOG} Add-ons available: ${addOns.join(", ")}`);
    const addOnPicks = await askClaudeForAddOns(repairContext, addOns, lastPickedName);
    for (const pick of addOnPicks) {
      console.log(`${LOG} Add-on selected: "${pick}"`);
      await clickAddOn(page, pick);
      selectedAddOns.push(pick);
      await sleep(500);
    }
  }

  // ── Click "Add" button ──
  console.log(`${LOG} Clicking "Add" to add labor line...`);
  const addBtn = await findElement(page, SERVICES.ADD_BTN);
  if (addBtn) {
    await addBtn.click();
    await sleep(3000);
  } else {
    // Try clicking any visible "Add" button in the modal
    const clicked = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      for (const btn of btns) {
        if (btn.textContent.trim() === "Add" && btn.offsetParent !== null) {
          btn.click();
          return true;
        }
      }
      return false;
    });
    if (!clicked) {
      return { success: false, error: "Could not find Add button to confirm labor" };
    }
    await sleep(3000);
  }

  // ── Read the hours (GOLDEN RULE: NEVER modify) ──
  const hours = await readMotorHours(page);
  console.log(`${LOG} MOTOR labor added: ${hours}h (NEVER modifying Qty/Hrs)`);

  return {
    success: true,
    procedure: lastPickedName,
    hours,
    addOns: selectedAddOns,
  };
}

// ─── Claude AI Integration ──────────────────────────────────────────────────

/**
 * Ask Claude to pick a category from a list of options.
 */
async function askClaudeForCategory(repairContext, options, levelLabel, parentCategory) {
  const optionsList = options.map((o, i) => `${i + 1}. ${o}`).join("\n");

  const prompt = parentCategory
    ? `You are navigating a MOTOR labor catalog. Current level: ${levelLabel}.\nParent category: ${parentCategory}\n\n${repairContext}\n\nOptions:\n${optionsList}\n\nPick the ONE best option for this repair. Reply with ONLY the option text, nothing else.`
    : `You are navigating a MOTOR labor catalog. Current level: ${levelLabel}.\n\n${repairContext}\n\nOptions:\n${optionsList}\n\nPick the ONE best option for this repair. Reply with ONLY the option text, nothing else.`;

  const response = await callClaude(prompt);
  if (!response) return null;

  // Clean response — Claude might return with number prefix or quotes
  let cleaned = response.trim().replace(/^\d+\.\s*/, "").replace(/^["']|["']$/g, "");

  // Exact match
  if (options.includes(cleaned)) return cleaned;

  // Case-insensitive match
  const lower = cleaned.toLowerCase();
  const match = options.find((o) => o.toLowerCase() === lower);
  if (match) return match;

  // Partial match (Claude's answer is contained in an option or vice versa)
  const partial = options.find(
    (o) => o.toLowerCase().includes(lower) || lower.includes(o.toLowerCase())
  );
  if (partial) return partial;

  // Closest match by word overlap
  return findClosestMatch(cleaned, options);
}

/**
 * Ask Claude which add-ons apply to this repair.
 */
async function askClaudeForAddOns(repairContext, addOns, baseProcedure) {
  const optionsList = addOns.map((o, i) => `${i + 1}. ${o}`).join("\n");

  const prompt = `You are selecting add-ons for a MOTOR labor procedure.\nBase procedure: ${baseProcedure}\n\n${repairContext}\n\nAvailable add-ons:\n${optionsList}\n\nWhich add-ons are applicable for this specific vehicle and repair? Reply with ONLY the add-on names (one per line). If none apply, reply "NONE".`;

  const response = await callClaude(prompt);
  if (!response || response.trim().toUpperCase() === "NONE") return [];

  const picks = response
    .split("\n")
    .map((l) => l.trim().replace(/^\d+\.\s*/, "").replace(/^[-*]\s*/, ""))
    .filter(Boolean);

  // Match each pick to actual add-on options
  const matched = [];
  for (const pick of picks) {
    const lower = pick.toLowerCase();
    const match = addOns.find(
      (a) => a.toLowerCase() === lower || a.toLowerCase().includes(lower) || lower.includes(a.toLowerCase())
    );
    if (match) matched.push(match);
  }

  return matched;
}

/**
 * Call Claude API (haiku model for speed).
 */
async function callClaude(userMessage) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.log(`${LOG} ANTHROPIC_API_KEY not set — cannot use Claude for MOTOR nav`);
    return null;
  }

  try {
    const body = JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 100,
      messages: [{ role: "user", content: userMessage }],
    });

    const data = await new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: "api.anthropic.com",
          path: "/v1/messages",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
        },
        (res) => {
          let raw = "";
          res.on("data", (c) => (raw += c));
          res.on("end", () => {
            try {
              resolve(JSON.parse(raw));
            } catch {
              reject(new Error(`Claude API parse error: ${raw.substring(0, 200)}`));
            }
          });
        }
      );
      req.on("error", reject);
      req.write(body);
      req.end();
    });

    const text = data?.content?.[0]?.text || "";
    return text.trim();
  } catch (err) {
    console.log(`${LOG} Claude API error: ${err.message}`);
    return null;
  }
}

// ─── DOM Readers ────────────────────────────────────────────────────────────

/**
 * Read category options visible in the MOTOR tree modal.
 */
async function readCategoryOptions(page) {
  return page.evaluate((itemSel, textSel) => {
    const items = [];
    for (const sel of itemSel.split(", ")) {
      const els = document.querySelectorAll(sel);
      if (els.length > 0) {
        els.forEach((el) => {
          // Try to get text from specific child elements first
          let text = "";
          for (const ts of textSel.split(", ")) {
            const child = el.querySelector(ts);
            if (child) { text = child.textContent.trim(); break; }
          }
          if (!text) text = el.textContent.trim();
          // Filter out empty, very short, or button-only items
          if (text && text.length > 1 && !text.match(/^(add|cancel|close|back)$/i)) {
            items.push(text);
          }
        });
        break;
      }
    }
    return [...new Set(items)]; // deduplicate
  }, SERVICES.CATEGORY_ITEM, SERVICES.CATEGORY_TEXT);
}

/**
 * Read qualifier radio/option elements.
 */
async function readQualifierOptions(page) {
  return page.evaluate((sel) => {
    const items = [];
    for (const s of sel.split(", ")) {
      const els = document.querySelectorAll(s);
      els.forEach((el) => {
        const text = (el.textContent || el.getAttribute("aria-label") || "").trim();
        if (text && text.length > 1) items.push(text);
      });
      if (items.length > 0) break;
    }
    return [...new Set(items)];
  }, SERVICES.QUALIFIER_OPTION);
}

/**
 * Read add-on checkbox elements.
 */
async function readAddOnOptions(page) {
  return page.evaluate((sel) => {
    const items = [];
    for (const s of sel.split(", ")) {
      const els = document.querySelectorAll(s);
      els.forEach((el) => {
        const text = (el.textContent || el.getAttribute("aria-label") || "").trim();
        if (text && text.length > 1) items.push(text);
      });
      if (items.length > 0) break;
    }
    return [...new Set(items)];
  }, SERVICES.ADDON_CHECKBOX);
}

/**
 * Read the MOTOR hours from the estimate line item.
 * GOLDEN RULE: read only, NEVER modify.
 */
async function readMotorHours(page) {
  const hours = await page.evaluate((sel) => {
    for (const s of sel.split(", ")) {
      const el = document.querySelector(s);
      if (el) {
        const val = parseFloat(el.value || el.textContent);
        if (!isNaN(val) && val > 0) return val;
      }
    }
    // Try finding hours in the last added service line
    const lines = document.querySelectorAll('[class*="service-line"], [class*="line-item"], tr');
    for (const line of Array.from(lines).reverse()) {
      const text = line.textContent || "";
      const match = text.match(/(\d+\.?\d*)\s*(?:hrs?|hours?)/i);
      if (match) return parseFloat(match[1]);
    }
    return 0;
  }, SERVICES.HOURS_FIELD);
  return hours;
}

// ─── DOM Clickers ───────────────────────────────────────────────────────────

/**
 * Click a category option by text.
 */
async function clickCategoryOption(page, optionText) {
  return page.evaluate(
    (text, itemSel) => {
      for (const sel of itemSel.split(", ")) {
        const els = document.querySelectorAll(sel);
        for (const el of els) {
          if (el.textContent.trim().includes(text) || text.includes(el.textContent.trim())) {
            el.click();
            return true;
          }
        }
      }
      // Broader fallback
      const all = document.querySelectorAll("div, li, span, button, a");
      for (const el of all) {
        if (el.children.length < 3 && el.textContent.trim() === text) {
          el.click();
          return true;
        }
      }
      return false;
    },
    optionText,
    SERVICES.CATEGORY_ITEM
  );
}

/**
 * Click an add-on checkbox by text.
 */
async function clickAddOn(page, addOnText) {
  return page.evaluate(
    (text, sel) => {
      for (const s of sel.split(", ")) {
        const els = document.querySelectorAll(s);
        for (const el of els) {
          if ((el.textContent || "").trim().includes(text)) {
            el.click();
            return true;
          }
        }
      }
      return false;
    },
    addOnText,
    SERVICES.ADDON_CHECKBOX
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function findElement(page, selectorStr) {
  for (const sel of selectorStr.split(", ")) {
    try {
      const el = await page.$(sel);
      if (el) return el;
    } catch { /* try next */ }
  }
  return null;
}

async function clickFirstAvailable(page, selectorStr) {
  for (const sel of selectorStr.split(", ")) {
    try {
      const el = await page.$(sel);
      if (el) {
        await el.click();
        return true;
      }
    } catch { /* try next */ }
  }
  // Text-based fallback
  return page.evaluate((sels) => {
    for (const sel of sels.split(", ")) {
      // Extract text hint from :has-text("...")
      const match = sel.match(/:has-text\("([^"]+)"\)/);
      if (match) {
        const text = match[1];
        const els = document.querySelectorAll("button, a, [role='button'], [role='tab']");
        for (const el of els) {
          if (el.textContent.trim().includes(text)) {
            el.click();
            return true;
          }
        }
      }
    }
    return false;
  }, selectorStr);
}

function buildRepairContext(diagnosis, vehicle) {
  const codes = diagnosis?.codes || [];
  const topDiag = diagnosis?.ai?.diagnoses?.[0];
  const repairPlan = diagnosis?.ai?.repair_plan;

  let ctx = `Vehicle: ${vehicle.year} ${vehicle.make} ${vehicle.model}`;
  if (vehicle.engine?.displacement) ctx += ` ${vehicle.engine.displacement}`;
  if (vehicle.drivetrain) ctx += ` ${vehicle.drivetrain}`;
  ctx += "\n";

  if (codes.length > 0) ctx += `DTC codes: ${codes.join(", ")}\n`;
  if (topDiag?.cause) ctx += `Diagnosis: ${topDiag.cause}\n`;
  if (repairPlan?.labor?.description) ctx += `Repair: ${repairPlan.labor.description}\n`;

  return ctx;
}

function getLevelLabel(level) {
  const labels = {
    1: "Primary System",
    2: "Component Group",
    3: "Operation Type",
    4: "Qualifier",
    5: "Sub-qualifier",
    6: "Variation",
    7: "Detail",
  };
  return labels[level] || `Level ${level}`;
}

function findClosestMatch(target, candidates) {
  const tWords = target.toLowerCase().split(/\s+/);
  let bestScore = 0;
  let bestCandidate = null;

  for (const c of candidates) {
    const cWords = c.toLowerCase().split(/\s+/);
    let score = 0;
    for (const tw of tWords) {
      for (const cw of cWords) {
        if (tw === cw) score += 2;
        else if (cw.includes(tw) || tw.includes(cw)) score += 1;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestCandidate = c;
    }
  }

  return bestCandidate;
}

module.exports = {
  navigateMotorTree,
};
