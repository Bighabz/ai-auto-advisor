/**
 * MOTOR Labor Tree Navigation
 *
 * Navigates AutoLeap's MOTOR catalog using the Browse dialog's category tree.
 * Uses Claude AI (haiku) to pick the correct category at each level
 * based on the vehicle and diagnosis context.
 *
 * KEY INSIGHT (from screenshots):
 * - Services tab has a "Browse" button that opens a MODAL/DIALOG
 * - Inside the Browse dialog: "Connect to MOTOR" → "MOTOR Primary" tab → tree
 * - The customer sidebar is ALSO a [role="dialog"] — must close it FIRST
 * - After Browse opens, everything happens INSIDE the dialog (do NOT close it)
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

  // ── Step 0: Close CUSTOMER sidebar (check for "Contact" text to ID it) ──
  await closeCustomerSidebar(page);
  await sleep(1000);

  // Take a starting screenshot
  await page.screenshot({ path: "/tmp/debug-motor-start.png" });

  // ── Step 1: Click Services tab on the estimate page ──
  console.log(`${LOG} Clicking Services tab...`);
  const servicesClicked = await clickByTextOutsideDialog(page, "Services", [
    "a", "li", "[role='tab']",
  ]);
  console.log(`${LOG} Services tab clicked: ${servicesClicked}`);
  await sleep(2000);

  // ── Step 2: Click Browse button to open the service catalog dialog ──
  console.log(`${LOG} Clicking Browse button...`);
  const browseClicked = await clickByTextOutsideDialog(page, "Browse", ["button"]);
  console.log(`${LOG} Browse button clicked: ${browseClicked}`);
  await sleep(3000);

  // Take screenshot after Browse
  await page.screenshot({ path: "/tmp/debug-motor-after-browse.png" });

  // ── Step 3: Inside the Browse dialog, find MOTOR ──
  // From now on, we work INSIDE the dialog (not outside it)

  // Log what's in the dialog
  const dialogState = await page.evaluate(() => {
    const dialog = document.querySelector("[role='dialog'], [class*='modal-content']");
    if (!dialog) return { found: false };
    const tabs = Array.from(dialog.querySelectorAll("a, button, li, [role='tab'], span"))
      .filter(el => el.offsetParent !== null)
      .map(el => el.textContent.trim())
      .filter(t => t.length > 0 && t.length < 50);
    return { found: true, tabs: [...new Set(tabs)].slice(0, 25) };
  });
  console.log(`${LOG} Dialog state: ${JSON.stringify(dialogState)}`);

  // ── Step 3a: Try clicking MOTOR Primary tab (even if grayed out) ──
  // From screenshots: tabs are [AutoLeap] [MOTOR Primary] [MOTOR Secondary] [Magic Services]
  // MOTOR Primary is grayed when "Vehicle is not linked" — clicking may trigger linking
  let motorTabFound = false;

  console.log(`${LOG} Looking for MOTOR Primary tab...`);
  const motorTabResult = await findInDialog(page, SERVICES.MOTOR_TAB_TEXT);
  if (motorTabResult.found) {
    console.log(`${LOG} MOTOR Primary tab found at (${Math.round(motorTabResult.rect.x)}, ${Math.round(motorTabResult.rect.y)}) — clicking...`);
    await page.mouse.click(motorTabResult.rect.x, motorTabResult.rect.y);
    await sleep(3000);

    // Take screenshot to see result of clicking MOTOR Primary
    await page.screenshot({ path: "/tmp/debug-motor-after-tab-click.png" });

    // Check if we got a vehicle linking dialog or MOTOR tree
    const afterTabClick = await page.evaluate(() => {
      // Check for any new dialog/popup about vehicle linking
      const allDialogs = Array.from(document.querySelectorAll("[role='dialog'], [class*='modal']"))
        .filter(d => d.offsetParent !== null || d.offsetWidth > 0);
      const texts = allDialogs.map(d => d.textContent.trim().substring(0, 300));

      // Check if MOTOR tree appeared (category items)
      const treeItems = document.querySelectorAll(
        "div[role='button'], li[role='treeitem'], [class*='category-item'], [class*='tree-node']"
      );
      const visibleItems = Array.from(treeItems).filter(el => el.offsetParent !== null);

      // Check for vehicle selection / engine selection
      const selects = Array.from(document.querySelectorAll("select, [class*='dropdown']"))
        .filter(el => el.offsetParent !== null)
        .map(el => ({ tag: el.tagName, cls: (el.className || "").substring(0, 40) }));

      return {
        dialogCount: allDialogs.length,
        dialogTexts: texts,
        treeItemCount: visibleItems.length,
        treeItems: visibleItems.slice(0, 5).map(el => el.textContent.trim().substring(0, 40)),
        selects,
      };
    });
    console.log(`${LOG} After MOTOR tab click: ${JSON.stringify(afterTabClick)}`);

    if (afterTabClick.treeItemCount > 0) {
      console.log(`${LOG} MOTOR tree visible with ${afterTabClick.treeItemCount} items ✓`);
      motorTabFound = true;
    }
  }

  // ── Step 3b: If MOTOR tree not showing, try "Connect to MOTOR" button ──
  if (!motorTabFound) {
    console.log(`${LOG} MOTOR tree not visible — trying "Connect to MOTOR" button...`);
    const connectResult = await findInDialog(page, SERVICES.CONNECT_MOTOR_TEXT);
    if (connectResult.found) {
      console.log(`${LOG} Found "Connect to MOTOR" at (${Math.round(connectResult.rect.x)}, ${Math.round(connectResult.rect.y)}) — clicking...`);
      await page.mouse.click(connectResult.rect.x, connectResult.rect.y);
      await sleep(4000);

      // Take screenshot
      await page.screenshot({ path: "/tmp/debug-motor-after-connect.png" });

      // Check for vehicle linking dialog (may need to select engine)
      const postConnect = await page.evaluate(() => {
        const allDialogs = Array.from(document.querySelectorAll("[role='dialog'], [class*='modal']"))
          .filter(d => d.offsetParent !== null || d.offsetWidth > 0);
        const buttons = [];
        const texts = [];
        const inputs = [];
        for (const d of allDialogs) {
          const btns = d.querySelectorAll("button");
          btns.forEach(b => {
            if (b.offsetParent) buttons.push(b.textContent.trim().substring(0, 40));
          });
          texts.push(d.textContent.trim().substring(0, 200));
          const inps = d.querySelectorAll("input, select");
          inps.forEach(i => {
            if (i.offsetParent) inputs.push({
              tag: i.tagName,
              type: i.type || "",
              name: i.name || "",
              placeholder: (i.placeholder || "").substring(0, 30),
            });
          });
        }
        return { dialogCount: allDialogs.length, buttons: [...new Set(buttons)], texts, inputs };
      });
      console.log(`${LOG} After Connect to MOTOR: ${JSON.stringify(postConnect)}`);

      // Check if there's a vehicle search/select that we need to interact with
      if (postConnect.inputs.length > 0) {
        console.log(`${LOG} Found input fields after Connect — may need vehicle selection`);
      }

      // Wait more and retry MOTOR Primary tab
      await sleep(5000);
      const motorRetry = await findInDialog(page, SERVICES.MOTOR_TAB_TEXT);
      if (motorRetry.found) {
        console.log(`${LOG} MOTOR Primary tab found — clicking...`);
        await page.mouse.click(motorRetry.rect.x, motorRetry.rect.y);
        await sleep(2000);
        motorTabFound = true;
      }
    } else {
      console.log(`${LOG} "Connect to MOTOR" not found`);
    }
  }

  // ── Step 3c: If still no MOTOR, check the "not linked" warning ──
  if (!motorTabFound) {
    console.log(`${LOG} Checking for "not linked" warning...`);
    const notLinked = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll("*")).filter(el =>
        el.offsetParent !== null &&
        el.textContent.includes("not linked") &&
        el.children.length < 5
      );
      if (els.length > 0) {
        const rect = els[0].getBoundingClientRect();
        return { found: true, text: els[0].textContent.trim().substring(0, 60), rect: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } };
      }
      return { found: false };
    });
    if (notLinked.found) {
      console.log(`${LOG} Found "${notLinked.text}" — clicking...`);
      await page.mouse.click(notLinked.rect.x, notLinked.rect.y);
      await sleep(5000);
      await page.screenshot({ path: "/tmp/debug-motor-after-notlinked.png" });

      // Check for any new dialog/selection that appeared
      const afterNotLinked = await page.evaluate(() => {
        const allDialogs = Array.from(document.querySelectorAll("[role='dialog'], [class*='modal']"))
          .filter(d => d.offsetParent !== null || d.offsetWidth > 0);
        return {
          dialogCount: allDialogs.length,
          texts: allDialogs.map(d => d.textContent.trim().substring(0, 200)),
        };
      });
      console.log(`${LOG} After clicking "not linked": ${JSON.stringify(afterNotLinked)}`);
    }
  }

  if (!motorTabFound) {
    await page.screenshot({ path: "/tmp/debug-motor-no-tab.png" });
    // Dump all visible elements in the dialog for debugging
    const debugInfo = await page.evaluate(() => {
      const dialog = document.querySelector("[role='dialog'], [class*='modal-content']");
      const container = dialog || document;
      const els = Array.from(container.querySelectorAll("button, a, li, [role='tab'], [role='button']"))
        .filter(el => el.offsetParent !== null)
        .map(el => ({
          tag: el.tagName,
          text: el.textContent.trim().substring(0, 40),
          cls: (el.className || "").substring(0, 40),
        }))
        .filter(e => e.text.length > 0)
        .slice(0, 30);
      return els;
    });
    console.log(`${LOG} Visible elements: ${JSON.stringify(debugInfo)}`);
    return { success: false, error: "MOTOR Primary tab not found — MOTOR may not be connected" };
  }

  console.log(`${LOG} MOTOR Primary tab clicked ✓`);

  // Take screenshot to see MOTOR tree
  await page.screenshot({ path: "/tmp/debug-motor-after-tab.png" });

  // Build repair context for Claude
  const repairContext = buildRepairContext(diagnosis, vehicle);
  console.log(`${LOG} Repair context: ${repairContext.substring(0, 100)}...`);

  // ── Navigate MOTOR tree levels with Claude AI ──
  const maxLevels = 7;
  let lastPickedName = "";

  for (let level = 0; level < maxLevels; level++) {
    const currentLevel = level + 1;

    // Read current category options from DOM (inside the dialog)
    const options = await readCategoryOptions(page);
    console.log(`${LOG} Level ${currentLevel} options (${options.length}): ${options.slice(0, 8).join(", ")}${options.length > 8 ? "..." : ""}`);

    if (options.length === 0) {
      // No more categories — check if we have an "Add" button
      const hasAdd = await hasAddButton(page);
      if (hasAdd) {
        console.log(`${LOG} Found Add button at level ${currentLevel} — adding labor`);
        break;
      }
      console.log(`${LOG} No options at level ${currentLevel} — may be at leaf`);
      break;
    }

    if (options.length === 1) {
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

    // Click the picked option using native mouse click
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
  const addClicked = await clickAddButton(page);
  if (!addClicked) {
    return { success: false, error: "Could not find Add button to confirm labor" };
  }
  await sleep(3000);

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

// ─── Sidebar Management ──────────────────────────────────────────────────────

/**
 * Close the CUSTOMER sidebar specifically (not the MOTOR catalog dialog).
 * Identifies it by looking for "Contact" or "Vehicles" tab text inside the dialog.
 */
async function closeCustomerSidebar(page) {
  const closed = await page.evaluate(() => {
    const dialogs = document.querySelectorAll("[role='dialog'], [class*='sidebar-right'], [class*='drawer']");
    for (const dialog of dialogs) {
      if (!dialog.offsetParent && dialog.offsetWidth === 0) continue;

      // Check if this dialog is the CUSTOMER sidebar (has "Contact" or "Vehicles" text)
      const dialogText = dialog.textContent || "";
      const isCustomerSidebar =
        dialogText.includes("Contact") &&
        (dialogText.includes("Vehicles") || dialogText.includes("Repair order"));
      if (!isCustomerSidebar) continue;

      // Find the × close button
      const closeBtns = dialog.querySelectorAll(
        "button[class*='close'], [class*='close-btn'], i.fa-times, i.pi-times"
      );
      for (const btn of closeBtns) {
        const clickTarget = btn.closest("button") || btn;
        if (clickTarget.offsetParent !== null || clickTarget.offsetWidth > 0) {
          const rect = clickTarget.getBoundingClientRect();
          return { closed: true, rect: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } };
        }
      }

      // Try × text
      const allEls = dialog.querySelectorAll("*");
      for (const el of allEls) {
        if (el.textContent.trim() === "×" && el.children.length === 0 && el.offsetParent !== null) {
          const rect = el.getBoundingClientRect();
          return { closed: true, rect: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } };
        }
      }
    }
    return { closed: false };
  });

  if (closed.closed && closed.rect) {
    await page.mouse.click(closed.rect.x, closed.rect.y);
    console.log(`${LOG} Closed customer sidebar ✓`);
    await sleep(1000);
    return true;
  }

  // If no sidebar found, try pressing Escape just in case
  await page.keyboard.press("Escape");
  await sleep(300);
  return false;
}

// ─── Click Helpers ───────────────────────────────────────────────────────────

/**
 * Find an element by text INSIDE a dialog/modal.
 * Returns { found, rect } for native mouse click.
 */
async function findInDialog(page, text) {
  return page.evaluate((text) => {
    // First check inside dialogs/modals
    const dialogs = document.querySelectorAll("[role='dialog'], [class*='modal-content'], [class*='modal-body']");
    for (const dialog of dialogs) {
      if (!dialog.offsetParent && dialog.offsetWidth === 0) continue;
      const els = dialog.querySelectorAll("button, a, li, span, div, [role='tab'], [role='button']");
      for (const el of els) {
        if (!el.offsetParent && el.offsetWidth === 0) continue;
        const elText = el.textContent.trim();
        if (elText === text || (elText.includes(text) && elText.length < text.length * 3)) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            return { found: true, rect: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }, text: elText.substring(0, 50) };
          }
        }
      }
    }

    // Fallback: check the whole page
    const els = document.querySelectorAll("button, a, li, span, div, [role='tab'], [role='button']");
    for (const el of els) {
      if (!el.offsetParent && el.offsetWidth === 0) continue;
      const elText = el.textContent.trim();
      if (elText === text || (elText.includes(text) && elText.length < text.length * 3)) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          return { found: true, rect: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }, text: elText.substring(0, 50) };
        }
      }
    }
    return { found: false };
  }, text);
}

/**
 * Click an element by text OUTSIDE of any dialog (for page-level elements like tabs).
 * Uses native mouse click.
 */
async function clickByTextOutsideDialog(page, text, tagSelectors) {
  const result = await page.evaluate((text, selectors) => {
    const selectorStr = selectors.join(", ");
    const candidates = Array.from(document.querySelectorAll(selectorStr))
      .filter(el => {
        if (!el.offsetParent && el.offsetWidth === 0) return false;
        if (el.closest("[role='dialog']")) return false;
        return true;
      });

    for (const el of candidates) {
      const elText = el.textContent.trim();
      if (elText === text || (elText.includes(text) && elText.length < text.length * 3)) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          return { found: true, rect: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }, text: elText.substring(0, 40) };
        }
      }
    }
    return { found: false };
  }, text, tagSelectors);

  if (result.found && result.rect) {
    await page.mouse.click(result.rect.x, result.rect.y);
    return true;
  }
  return false;
}

/**
 * Check if an "Add" button is visible anywhere.
 */
async function hasAddButton(page) {
  return page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    return btns.some(b =>
      b.textContent.trim() === "Add" && b.offsetParent !== null
    );
  });
}

/**
 * Click the "Add" button using native mouse click.
 */
async function clickAddButton(page) {
  const result = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    for (const b of btns) {
      if (b.textContent.trim() === "Add" && b.offsetParent !== null) {
        const rect = b.getBoundingClientRect();
        return { found: true, rect: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } };
      }
    }
    // Broader: btn-success with "Add" text
    for (const b of btns) {
      if (
        b.textContent.trim().includes("Add") &&
        b.classList.contains("btn-success") &&
        b.offsetParent !== null
      ) {
        const rect = b.getBoundingClientRect();
        return { found: true, rect: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } };
      }
    }
    return { found: false };
  });

  if (result.found && result.rect) {
    await page.mouse.click(result.rect.x, result.rect.y);
    return true;
  }
  return false;
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
 * Read category options visible in the MOTOR tree.
 * Searches both inside and outside dialogs (MOTOR catalog IS a dialog).
 */
async function readCategoryOptions(page) {
  return page.evaluate((itemSel, textSel) => {
    const items = [];
    for (const sel of itemSel.split(", ")) {
      const els = Array.from(document.querySelectorAll(sel)).filter(el =>
        el.offsetParent !== null
      );
      if (els.length > 0) {
        els.forEach((el) => {
          let text = "";
          for (const ts of textSel.split(", ")) {
            const child = el.querySelector(ts);
            if (child) { text = child.textContent.trim(); break; }
          }
          if (!text) text = el.textContent.trim();
          if (text && text.length > 1 && !text.match(/^(add|cancel|close|back)$/i)) {
            items.push(text);
          }
        });
        break;
      }
    }
    return [...new Set(items)];
  }, SERVICES.CATEGORY_ITEM, SERVICES.CATEGORY_TEXT);
}

/**
 * Read qualifier radio/option elements.
 */
async function readQualifierOptions(page) {
  return page.evaluate((sel) => {
    const items = [];
    for (const s of sel.split(", ")) {
      const els = Array.from(document.querySelectorAll(s)).filter(el =>
        el.offsetParent !== null
      );
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
      const els = Array.from(document.querySelectorAll(s)).filter(el =>
        el.offsetParent !== null
      );
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
 * Click a category option by text. Uses native mouse click.
 */
async function clickCategoryOption(page, optionText) {
  const result = await page.evaluate(
    (text, itemSel) => {
      for (const sel of itemSel.split(", ")) {
        const els = Array.from(document.querySelectorAll(sel)).filter(el =>
          el.offsetParent !== null
        );
        for (const el of els) {
          const elText = el.textContent.trim();
          if (elText.includes(text) || text.includes(elText)) {
            const rect = el.getBoundingClientRect();
            return { found: true, rect: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } };
          }
        }
      }
      // Broader fallback
      const all = Array.from(document.querySelectorAll("div, li, span, button, a")).filter(el =>
        el.offsetParent !== null
      );
      for (const el of all) {
        if (el.children.length < 3 && el.textContent.trim() === text) {
          const rect = el.getBoundingClientRect();
          return { found: true, rect: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } };
        }
      }
      return { found: false };
    },
    optionText,
    SERVICES.CATEGORY_ITEM
  );

  if (result.found && result.rect) {
    await page.mouse.click(result.rect.x, result.rect.y);
    return true;
  }
  return false;
}

/**
 * Click an add-on checkbox by text.
 */
async function clickAddOn(page, addOnText) {
  const result = await page.evaluate(
    (text, sel) => {
      for (const s of sel.split(", ")) {
        const els = Array.from(document.querySelectorAll(s)).filter(el =>
          el.offsetParent !== null
        );
        for (const el of els) {
          if ((el.textContent || "").trim().includes(text)) {
            const rect = el.getBoundingClientRect();
            return { found: true, rect: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } };
          }
        }
      }
      return { found: false };
    },
    addOnText,
    SERVICES.ADDON_CHECKBOX
  );

  if (result.found && result.rect) {
    await page.mouse.click(result.rect.x, result.rect.y);
    return true;
  }
  return false;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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
