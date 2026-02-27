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

  // ── Step 3a: Find all MOTOR-related elements in the Browse dialog ──
  let motorTabFound = false;

  // Debug: find all elements containing "MOTOR" text to understand the DOM structure
  const motorElements = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll("*"));
    return all
      .filter(el => {
        if (!el.offsetParent && el.offsetWidth === 0) return false;
        const t = (el.innerText || el.textContent || "").trim();
        return t.includes("MOTOR") && t.length < 80 && el.children.length < 5;
      })
      .map(el => {
        const rect = el.getBoundingClientRect();
        return {
          tag: el.tagName,
          text: (el.innerText || el.textContent || "").trim().substring(0, 60),
          cls: (el.className || "").substring(0, 50),
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
          children: el.children.length,
        };
      })
      .slice(0, 15);
  });
  console.log(`${LOG} MOTOR-related elements: ${JSON.stringify(motorElements)}`);

  // ── Step 3b: Click MOTOR Primary tab ──
  // From the screenshots, MOTOR Primary is a tab in the Browse dialog's tab bar.
  // It may be a <li>, <a>, <span>, or <div> element. Look for compact elements.
  console.log(`${LOG} Looking for MOTOR Primary tab element...`);

  const motorTabClick = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll("*"));
    // Look for elements whose text is exactly or nearly "MOTOR Primary"
    for (const el of all) {
      if (!el.offsetParent && el.offsetWidth === 0) continue;
      const text = (el.innerText || el.textContent || "").trim();
      if (text === "MOTOR Primary" || text === "MOTOR Primary") {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && rect.x < 1280) {
          // Click the parent if it's a span/text node (the tab container is clickable)
          const clickEl = el.closest("li, a, [role='tab'], button") || el;
          const clickRect = clickEl.getBoundingClientRect();
          return {
            found: true,
            rect: { x: clickRect.x + clickRect.width / 2, y: clickRect.y + clickRect.height / 2 },
            text: text,
            tag: clickEl.tagName,
            cls: (clickEl.className || "").substring(0, 40),
          };
        }
      }
    }
    // Fallback: look for elements containing "MOTOR Primary" with small text
    for (const el of all) {
      if (!el.offsetParent && el.offsetWidth === 0) continue;
      const text = (el.innerText || el.textContent || "").trim();
      if (text.includes("MOTOR Primary") && text.length < 30) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 5 && rect.height > 5 && rect.x >= 0 && rect.x < 1280) {
          return {
            found: true,
            rect: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
            text: text,
            tag: el.tagName,
            cls: (el.className || "").substring(0, 40),
          };
        }
      }
    }
    return { found: false };
  });

  if (motorTabClick.found) {
    console.log(`${LOG} MOTOR Primary tab: ${motorTabClick.tag}.${motorTabClick.cls} at (${Math.round(motorTabClick.rect.x)}, ${Math.round(motorTabClick.rect.y)}) — clicking...`);
    await page.mouse.click(motorTabClick.rect.x, motorTabClick.rect.y);
    await sleep(3000);

    await page.screenshot({ path: "/tmp/debug-motor-after-tab-click.png" });

    // Check if MOTOR tree appeared
    const treeCheck = await page.evaluate(() => {
      const treeItems = Array.from(document.querySelectorAll(
        "div[role='button'], li[role='treeitem'], [class*='category-item'], [class*='tree-node']"
      )).filter(el => el.offsetParent !== null);
      return {
        treeItemCount: treeItems.length,
        treeItems: treeItems.slice(0, 5).map(el => el.textContent.trim().substring(0, 40)),
      };
    });
    console.log(`${LOG} After MOTOR tab click — tree items: ${JSON.stringify(treeCheck)}`);

    if (treeCheck.treeItemCount > 0) {
      console.log(`${LOG} MOTOR tree visible with ${treeCheck.treeItemCount} items ✓`);
      motorTabFound = true;
    }
  } else {
    console.log(`${LOG} MOTOR Primary tab element not found`);
  }

  // ── Step 3c: Click "Connect to MOTOR" → opens vehicle/engine selection sidebar ──
  // From screenshots: clicking "Connect to MOTOR" opens the customer sidebar with
  // a "Search vehicle" dropdown showing engine options:
  //   - "2002 Toyota RAV4 Base - Engine: U/K L (S) BATTERY EV (EV/BEV)" (wrong)
  //   - "2002 Toyota RAV4 Base - Engine: 2.0L L4 (1AZ-FE) GAS FI" (correct)
  // We need to select the GAS engine, click Save, then re-open Browse for MOTOR tree.
  if (!motorTabFound) {
    console.log(`${LOG} Trying "Connect to MOTOR" button...`);

    // Scroll into view first (button is often off-screen at x>1200)
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button"));
      for (const btn of btns) {
        if (btn.textContent.trim() === "Connect to MOTOR" && btn.offsetParent !== null) {
          btn.scrollIntoView({ block: "center", inline: "center" });
          return true;
        }
      }
      return false;
    });
    await sleep(500);

    // Get fresh coordinates and click
    const connectRect = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button"));
      for (const btn of btns) {
        if (btn.textContent.trim() === "Connect to MOTOR") {
          const rect = btn.getBoundingClientRect();
          return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, inView: rect.x >= 0 && rect.x < 1280 };
        }
      }
      return null;
    });

    if (connectRect && connectRect.inView) {
      console.log(`${LOG} "Connect to MOTOR" at (${Math.round(connectRect.x)}, ${Math.round(connectRect.y)}) — clicking...`);
      await page.mouse.click(connectRect.x, connectRect.y);
      await sleep(4000);

      await page.screenshot({ path: "/tmp/debug-motor-after-connect.png" });

      // ── Step 3d: Handle the vehicle/engine selection sidebar ──
      // The sidebar shows "Search vehicle" with engine options in a dropdown.
      // We need to select the GAS engine (not EV/BEV).
      const engineSelected = await selectMotorEngine(page, vehicle);

      if (engineSelected) {
        console.log(`${LOG} Engine selected — saving and closing sidebar...`);

        // Click Save button in the sidebar
        const saveClicked = await page.evaluate(() => {
          const btns = Array.from(document.querySelectorAll("button"));
          for (const b of btns) {
            if (b.textContent.trim() === "Save" && b.offsetParent !== null) {
              // Prefer buttons inside the sidebar dialog
              const inDialog = b.closest("[role='dialog']");
              if (inDialog) {
                const rect = b.getBoundingClientRect();
                return { found: true, rect: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } };
              }
            }
          }
          // Fallback: any visible Save button
          for (const b of btns) {
            if (b.textContent.trim() === "Save" && b.offsetParent !== null) {
              const rect = b.getBoundingClientRect();
              return { found: true, rect: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } };
            }
          }
          return { found: false };
        });

        if (saveClicked.found) {
          await page.mouse.click(saveClicked.rect.x, saveClicked.rect.y);
          console.log(`${LOG} Save clicked in vehicle sidebar`);
          await sleep(5000);
        }

        // Close the sidebar
        await closeCustomerSidebar(page);
        await sleep(2000);

        // ── Step 3e: Re-open Browse and click MOTOR Primary tab ──
        console.log(`${LOG} Re-opening Browse after MOTOR connection...`);
        await clickByTextOutsideDialog(page, "Browse", ["button"]);
        await sleep(3000);

        await page.screenshot({ path: "/tmp/debug-motor-after-reopen.png" });

        // Try MOTOR Primary tab again (should now be active/linked)
        const retryTab = await page.evaluate(() => {
          const all = Array.from(document.querySelectorAll("*"));
          for (const el of all) {
            if (!el.offsetParent && el.offsetWidth === 0) continue;
            const text = (el.innerText || el.textContent || "").trim();
            if (text === "MOTOR Primary" || (text.includes("MOTOR Primary") && text.length < 30)) {
              const clickEl = el.closest("li, a, [role='tab'], button, p") || el;
              const rect = clickEl.getBoundingClientRect();
              if (rect.width > 5 && rect.x < 1280) {
                return { found: true, rect: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } };
              }
            }
          }
          return { found: false };
        });

        if (retryTab.found) {
          console.log(`${LOG} MOTOR Primary tab found after connection — clicking...`);
          await page.mouse.click(retryTab.rect.x, retryTab.rect.y);
          await sleep(5000);

          // Take screenshot to see if tab activated
          await page.screenshot({ path: "/tmp/debug-motor-after-tab-click2.png" });

          // Check content area — what's showing after tab click?
          const contentCheck = await page.evaluate(() => {
            const items = Array.from(document.querySelectorAll(
              "div[role='button'], li[role='treeitem'], [class*='category-item'], [class*='tree-node']"
            )).filter(el => el.offsetParent !== null);

            // Also check what the main content area contains
            // Look for any list-like content besides canned services
            const allLi = Array.from(document.querySelectorAll("li")).filter(el =>
              el.offsetParent !== null && !el.closest("nav") && el.textContent.trim().length > 2
            );
            const lastContent = allLi.slice(0, 10).map(l => l.textContent.trim().substring(0, 50));

            // Check which tab appears active (bold/highlighted)
            const tabs = Array.from(document.querySelectorAll("p[class*='service-tab']"))
              .filter(el => el.offsetParent !== null)
              .map(el => ({
                text: el.textContent.trim(),
                cls: el.className,
                active: el.className.includes("active") || el.className.includes("selected"),
                bg: getComputedStyle(el).backgroundColor,
                color: getComputedStyle(el).color,
              }));

            // Check for loading/spinner
            const spinner = !!document.querySelector("[class*='spinner'], [class*='loading']");

            return {
              treeItemCount: items.length,
              treeItems: items.slice(0, 5).map(el => el.textContent.trim().substring(0, 40)),
              tabs,
              listContent: lastContent,
              spinner,
            };
          });
          console.log(`${LOG} Content after MOTOR tab click: ${JSON.stringify(contentCheck)}`);

          if (contentCheck.treeItemCount > 0) {
            motorTabFound = true;
          } else if (contentCheck.tabs.some(t => t.text.includes("MOTOR Primary") && !t.active)) {
            // Tab didn't activate — try clicking harder (double-click or click parent)
            console.log(`${LOG} MOTOR Primary tab not active — trying parent element click...`);
            const parentClick = await page.evaluate(() => {
              const tabs = document.querySelectorAll("p[class*='service-tab']");
              for (const tab of tabs) {
                if (tab.textContent.trim() === "MOTOR Primary" || tab.textContent.trim().includes("MOTOR Primary")) {
                  // Try clicking parent elements
                  let target = tab.parentElement || tab;
                  const rect = target.getBoundingClientRect();
                  return { found: true, rect: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }, tag: target.tagName };
                }
              }
              return { found: false };
            });
            if (parentClick.found) {
              console.log(`${LOG} Clicking parent ${parentClick.tag} at (${Math.round(parentClick.rect.x)}, ${Math.round(parentClick.rect.y)})...`);
              await page.mouse.click(parentClick.rect.x, parentClick.rect.y);
              await sleep(5000);
              await page.screenshot({ path: "/tmp/debug-motor-parent-click.png" });

              const retreeCheck = await page.evaluate(() => {
                const items = Array.from(document.querySelectorAll(
                  "div[role='button'], li[role='treeitem'], [class*='category-item'], [class*='tree-node']"
                )).filter(el => el.offsetParent !== null);
                return items.length;
              });
              console.log(`${LOG} Tree after parent click: ${retreeCheck} items`);
              if (retreeCheck > 0) motorTabFound = true;
            }
          }
        }
      } else {
        console.log(`${LOG} Could not select engine in vehicle sidebar`);
      }
    } else {
      console.log(`${LOG} "Connect to MOTOR" button not found or off-screen`);
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

  // ── Navigate MOTOR left tree (2 levels: System → Component) ──
  // MOTOR UI: left panel = category tree, right panel = operational procedures.
  // After selecting the right Component (e.g., "Engine"), the right panel shows
  // procedures like "Catalytic Converter R&R" with labor hours and a "+" button.
  const maxTreeLevels = 3;
  let lastPickedName = "";
  let previousItems = new Set();

  for (let level = 0; level < maxTreeLevels; level++) {
    const currentLevel = level + 1;

    const allOptions = await readCategoryOptions(page);
    let options;
    if (currentLevel === 1) {
      options = allOptions;
    } else {
      options = allOptions.filter(o => !previousItems.has(o));
      if (options.length === 0) {
        console.log(`${LOG} No new tree items at level ${currentLevel} — tree navigation done`);
        break;
      }
    }

    console.log(`${LOG} Tree level ${currentLevel} (${options.length}): ${options.slice(0, 10).join(", ")}${options.length > 10 ? "..." : ""}`);

    if (options.length === 0) break;

    if (options.length === 1) {
      console.log(`${LOG} Level ${currentLevel}: Auto-selecting "${options[0]}"`);
      previousItems = new Set(allOptions);
      await clickCategoryOption(page, options[0]);
      lastPickedName = options[0];
      await sleep(2000);
      continue;
    }

    const levelLabel = getLevelLabel(currentLevel);
    const pick = await askClaudeForCategory(repairContext, options, levelLabel, lastPickedName);
    if (!pick) {
      return { success: false, error: `Claude could not pick ${levelLabel} from: ${options.join(", ")}` };
    }

    console.log(`${LOG} Level ${currentLevel} (${levelLabel}): Claude → "${pick}"`);
    previousItems = new Set(allOptions);

    const clicked = await clickCategoryOption(page, pick);
    if (!clicked) {
      const fuzzy = findClosestMatch(pick, options);
      if (fuzzy && fuzzy !== pick) {
        console.log(`${LOG} Fuzzy match: "${pick}" → "${fuzzy}"`);
        await clickCategoryOption(page, fuzzy);
      } else {
        return { success: false, error: `Could not click "${pick}" at level ${currentLevel}` };
      }
    }

    lastPickedName = pick;
    await sleep(2000);
  }

  // ── Re-confirm MOTOR Primary tab is active after tree clicks ──
  // Tree clicks may cause Angular to re-render and lose MOTOR tab focus.
  console.log(`${LOG} Re-clicking MOTOR Primary tab to ensure it's active...`);
  const motorReclick = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll("*"));
    for (const el of all) {
      if (!el.offsetParent && el.offsetWidth === 0) continue;
      const text = (el.innerText || el.textContent || "").trim();
      if (text === "MOTOR Primary" && el.children.length < 3) {
        const clickEl = el.closest("li, a, [role='tab'], button, p") || el;
        const rect = clickEl.getBoundingClientRect();
        if (rect.width > 5 && rect.x < 1280) {
          return { found: true, rect: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } };
        }
      }
    }
    return { found: false };
  });
  if (motorReclick.found) {
    await page.mouse.click(motorReclick.rect.x, motorReclick.rect.y);
    await sleep(3000);
    console.log(`${LOG} MOTOR Primary tab re-clicked ✓`);
  }

  // ── Read operational procedures from RIGHT panel ──
  // After tree navigation, the right panel shows procedures with Labor, Parts,
  // Subtotal columns and a green "+" button to add each one.
  console.log(`${LOG} Reading operational procedures from right panel...`);
  await page.screenshot({ path: "/tmp/debug-motor-procedures.png" });

  // Debug: dump what's visible in the right panel area
  const rightPanelDump = await page.evaluate(() => {
    // Look for table-like structures or lists with $ amounts
    const allBtns = Array.from(document.querySelectorAll("button")).filter(b =>
      b.offsetParent !== null && (
        b.className.includes("btn-success") || b.className.includes("add")
      )
    );
    const btnInfo = allBtns.map(b => {
      const row = b.closest("tr, [class*='row'], [class*='item']") || b.parentElement;
      return {
        btnText: b.textContent.trim().substring(0, 20),
        btnClass: b.className.substring(0, 40),
        rowText: (row?.textContent || "").trim().substring(0, 80),
        inDialog: !!b.closest("[role='dialog']"),
        parentTag: (row?.tagName || "?"),
        parentClass: (row?.className || "").substring(0, 40),
      };
    });
    // Also look for header text like "Operational", "Labor", "Parts", "Subtotal"
    const headers = Array.from(document.querySelectorAll("th, [class*='header'], [class*='col-header']"))
      .filter(el => el.offsetParent !== null)
      .map(el => el.textContent.trim().substring(0, 30))
      .filter(t => t.length > 0);
    return { buttons: btnInfo.slice(0, 10), headers: [...new Set(headers)].slice(0, 15) };
  });
  console.log(`${LOG} Right panel dump: ${JSON.stringify(rightPanelDump)}`);

  // ── Targeted DOM discovery: find MOTOR procedure row structure ──
  // We know MOTOR procedures like "Cooling System" exist in the DOM.
  // Find their exact structure, siblings, and any add/click mechanisms.
  const motorRowDiscovery = await page.evaluate(() => {
    // Find elements containing known MOTOR procedure keywords
    const keywords = ["Cooling System", "Compression Test", "Emission Control", "Leak Inspection", "Catalytic"];
    const results = [];
    for (const kw of keywords) {
      const els = Array.from(document.querySelectorAll("*")).filter(el =>
        el.offsetParent !== null &&
        el.textContent.includes(kw) &&
        el.textContent.trim().length < 100 &&
        el.children.length < 8
      );
      for (const el of els.slice(0, 3)) {
        // Walk up to find the row container
        let row = el;
        for (let i = 0; i < 5; i++) {
          if (row.parentElement) row = row.parentElement;
          const tag = row.tagName.toLowerCase();
          if (tag === "tr" || row.className?.includes("row") || row.className?.includes("item")) break;
        }
        // Find ALL clickable elements in this row
        const clickables = Array.from(row.querySelectorAll("button, a, i, [role='button'], [class*='click'], [class*='add'], [class*='plus']"))
          .filter(c => c.offsetParent !== null)
          .map(c => ({
            tag: c.tagName,
            text: c.textContent.trim().substring(0, 20),
            cls: (c.className || "").substring(0, 50),
            cursor: getComputedStyle(c).cursor,
            rect: (() => { const r = c.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })(),
          }));
        // Also find any elements with pointer cursor (clickable)
        const pointers = Array.from(row.querySelectorAll("*"))
          .filter(c => c.offsetParent !== null && getComputedStyle(c).cursor === "pointer" && c.children.length < 2)
          .map(c => ({
            tag: c.tagName,
            text: c.textContent.trim().substring(0, 20),
            cls: (c.className || "").substring(0, 50),
          }));
        results.push({
          keyword: kw,
          elTag: el.tagName,
          elClass: (el.className || "").substring(0, 50),
          elText: el.textContent.trim().substring(0, 60),
          rowTag: row.tagName,
          rowClass: (row.className || "").substring(0, 60),
          rowHTML: row.innerHTML?.substring(0, 200),
          clickables: clickables.slice(0, 5),
          pointers: pointers.slice(0, 5),
        });
      }
    }
    return results;
  });
  console.log(`${LOG} MOTOR row discovery: ${JSON.stringify(motorRowDiscovery)}`);

  const procedures = await readProcedures(page);
  console.log(`${LOG} Found ${procedures.length} procedures: ${procedures.slice(0, 5).map(p => p.name).join(", ")}${procedures.length > 5 ? "..." : ""}`);

  if (procedures.length === 0) {
    return { success: false, error: "No operational procedures found in MOTOR right panel" };
  }

  // ── Ask Claude to pick the correct procedure ──
  const procNames = procedures.map(p => `${p.name} (${p.hours}h, $${p.labor})`);
  const procPick = await askClaudeForCategory(
    repairContext,
    procNames,
    "operational procedure",
    lastPickedName
  );

  if (!procPick) {
    // Fallback: text-match against repair description
    const repairDesc = (diagnosis?.ai?.repair_plan?.labor?.description || diagnosis?.ai?.diagnoses?.[0]?.cause || "").toLowerCase();
    const directMatch = procedures.find(p => p.name.toLowerCase().includes("catalytic") || repairDesc.includes(p.name.toLowerCase().split(" ")[0]));
    if (directMatch) {
      console.log(`${LOG} Direct text match: "${directMatch.name}"`);
      await clickProcedurePlus(page, directMatch);
      await sleep(3000);
      return { success: true, procedure: directMatch.name, hours: directMatch.hours, addOns: [] };
    }
    return { success: false, error: "Claude could not pick a procedure and no text match found" };
  }

  // Find the matching procedure from Claude's pick
  const cleanPick = procPick.replace(/\s*\([\d.]+h.*\)$/, "").trim(); // strip "(1.2h, $150)" suffix
  const matchedProc = procedures.find(p => p.name === cleanPick)
    || procedures.find(p => p.name.toLowerCase().includes(cleanPick.toLowerCase())
      || cleanPick.toLowerCase().includes(p.name.toLowerCase()));

  if (!matchedProc) {
    const fuzzyProc = findClosestMatch(cleanPick, procedures.map(p => p.name));
    const fp = procedures.find(p => p.name === fuzzyProc);
    if (fp) {
      console.log(`${LOG} Fuzzy procedure match: "${cleanPick}" → "${fp.name}"`);
      await clickProcedurePlus(page, fp);
      await sleep(3000);
      return { success: true, procedure: fp.name, hours: fp.hours, addOns: [] };
    }
    return { success: false, error: `Could not find procedure "${cleanPick}" in right panel` };
  }

  console.log(`${LOG} Procedure: "${matchedProc.name}" — ${matchedProc.hours}h, $${matchedProc.labor} — clicking "+"...`);
  const addResult = await clickProcedurePlus(page, matchedProc);
  if (!addResult) {
    return { success: false, error: `Could not click "+" for "${matchedProc.name}"` };
  }

  await sleep(3000);
  await page.screenshot({ path: "/tmp/debug-motor-after-add.png" });

  // ── Read hours from the estimate (GOLDEN RULE: NEVER modify) ──
  const hours = matchedProc.hours || (await readMotorHours(page));
  console.log(`${LOG} MOTOR labor added: "${matchedProc.name}" — ${hours}h (NEVER modifying Qty/Hrs)`);

  return {
    success: true,
    procedure: matchedProc.name,
    hours,
    addOns: [],
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

// ─── Vehicle/Engine Selection for MOTOR Linking ─────────────────────────────

/**
 * Select the correct engine in the MOTOR vehicle linking sidebar.
 * The sidebar shows a "Search vehicle" dropdown with engine options.
 * We need the GAS engine, not EV/BEV/Hybrid.
 *
 * @param {import('puppeteer-core').Page} page
 * @param {object} vehicle - { year, make, model, engine }
 * @returns {Promise<boolean>} true if an engine was selected
 */
async function selectMotorEngine(page, vehicle) {
  // Check if the sidebar opened with vehicle search dropdown
  const dropdownItems = await page.evaluate(() => {
    // Look for autocomplete dropdown items or search result items
    const items = Array.from(document.querySelectorAll(
      ".p-autocomplete-panel li, .p-autocomplete-items li, " +
      "[class*='autocomplete'] li, [role='option'], [role='listbox'] li, " +
      "[class*='dropdown-menu'] li, [class*='search-result']"
    )).filter(el => el.offsetParent !== null);

    if (items.length > 0) {
      return items.map((el, i) => ({
        index: i,
        text: el.textContent.trim().substring(0, 100),
        rect: (() => {
          const r = el.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        })(),
      }));
    }

    // Also check for any visible list items in the sidebar that look like vehicle options
    const sidebarItems = Array.from(document.querySelectorAll("[role='dialog'] li, [role='dialog'] [class*='option']"))
      .filter(el => el.offsetParent !== null && el.textContent.includes("Engine"));
    return sidebarItems.map((el, i) => ({
      index: i,
      text: el.textContent.trim().substring(0, 100),
      rect: (() => {
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      })(),
    }));
  });

  console.log(`${LOG} Engine dropdown items: ${JSON.stringify(dropdownItems)}`);

  if (dropdownItems.length === 0) {
    // No dropdown visible — maybe we need to click on the vehicle search first
    console.log(`${LOG} No engine dropdown visible — trying to trigger it...`);

    // Look for "Search vehicle" input or vehicle name that can be clicked
    const searchInput = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll("[role='dialog'] input"))
        .filter(el => el.offsetParent !== null);
      for (const inp of inputs) {
        const placeholder = (inp.placeholder || "").toLowerCase();
        const value = (inp.value || "").toLowerCase();
        if (placeholder.includes("vehicle") || placeholder.includes("search") || value.includes("toyota") || value.includes("rav4")) {
          const rect = inp.getBoundingClientRect();
          return { found: true, rect: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }, value: inp.value };
        }
      }
      return { found: false };
    });

    if (searchInput.found) {
      console.log(`${LOG} Found vehicle search input: "${searchInput.value}" — clicking to open dropdown...`);
      await page.mouse.click(searchInput.rect.x, searchInput.rect.y);
      await sleep(2000);

      // Re-check for dropdown items
      const retryItems = await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll(
          ".p-autocomplete-panel li, .p-autocomplete-items li, " +
          "[class*='autocomplete'] li, [role='option'], [role='listbox'] li"
        )).filter(el => el.offsetParent !== null && el.textContent.includes("Engine"));
        return items.map((el, i) => ({
          index: i,
          text: el.textContent.trim().substring(0, 100),
          rect: (() => {
            const r = el.getBoundingClientRect();
            return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
          })(),
        }));
      });

      if (retryItems.length > 0) {
        return await pickGasEngine(page, retryItems, vehicle);
      }
    }

    return false;
  }

  return await pickGasEngine(page, dropdownItems, vehicle);
}

/**
 * From a list of engine options, pick the GAS engine (not EV/BEV/Hybrid).
 */
async function pickGasEngine(page, items, vehicle) {
  // Score each item — prefer GAS, avoid EV/BEV/Hybrid
  const PREFER = ["gas", "fi", "mfi", "dohc", "sohc"];
  const AVOID = ["ev", "bev", "electric", "battery", "hybrid", "phev", "u/k"];

  let bestIdx = -1;
  let bestScore = -999;

  for (const item of items) {
    const lower = item.text.toLowerCase();
    let score = 0;

    // Check for preferred terms
    for (const p of PREFER) {
      if (lower.includes(p)) score += 5;
    }
    // Check for avoid terms
    for (const a of AVOID) {
      if (lower.includes(a)) score -= 10;
    }
    // Bonus for matching engine displacement if we know it
    if (vehicle.engine?.displacement && lower.includes(vehicle.engine.displacement.toLowerCase())) {
      score += 8;
    }
    // Bonus for matching cylinder count
    if (vehicle.engine?.cylinders && lower.includes(`${vehicle.engine.cylinders}`)) {
      score += 3;
    }

    console.log(`${LOG}   Engine option ${item.index}: score=${score} "${item.text.substring(0, 60)}"`);

    if (score > bestScore) {
      bestScore = score;
      bestIdx = item.index;
    }
  }

  if (bestIdx >= 0 && items[bestIdx]) {
    const chosen = items[bestIdx];
    console.log(`${LOG} Selected engine: "${chosen.text.substring(0, 60)}" (score ${bestScore})`);
    await page.mouse.click(chosen.rect.x, chosen.rect.y);
    await sleep(2000);
    return true;
  }

  // Fallback: if only 2 options and one is EV, pick the other
  if (items.length === 2) {
    const evIdx = items.findIndex(i => i.text.toLowerCase().includes("ev") || i.text.toLowerCase().includes("battery"));
    const gasIdx = evIdx === 0 ? 1 : 0;
    if (evIdx >= 0) {
      console.log(`${LOG} Fallback: picking non-EV option: "${items[gasIdx].text.substring(0, 60)}"`);
      await page.mouse.click(items[gasIdx].rect.x, items[gasIdx].rect.y);
      await sleep(2000);
      return true;
    }
  }

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

// ─── Procedure Panel (Right Side) ────────────────────────────────────────────

/**
 * Read operational procedures from the MOTOR right panel.
 *
 * DOM structure (discovered from live AutoLeap):
 *   div.motor-service-item                          ← row container
 *     app-accordian
 *       div.accordian-header.pointer                ← clickable header (full row)
 *         div.custom-accordian-header-checkbox       ← checkbox to SELECT this procedure
 *         div.custom-header-template                ← contains name + pricing text
 *           p.motor-service-name                    ← procedure name (e.g. "Catalytic Converter R&R")
 *         ... price/hours columns ...
 *         i.fa-chevron-right                        ← expand chevron
 *         i.motor-service-info                      ← info icon
 *         i.fa-file-alt.repair-diagram-             ← repair diagram
 *         i.fa-clock                                ← clock icon (hours nearby)
 *         i.fa-tools                                ← tools icon
 *
 * To ADD a procedure: click its checkbox, then click the "Add" button at bottom.
 * There are NO green btn-success "+" buttons in MOTOR panels.
 */
async function readProcedures(page) {
  let allProcs = [];
  let prevCount = 0;
  const maxScrollAttempts = 10;

  for (let scroll = 0; scroll <= maxScrollAttempts; scroll++) {
    const procs = await page.evaluate(() => {
      const results = [];

      // ── Primary strategy: Find MOTOR procedure rows by their unique class ──
      const motorRows = Array.from(document.querySelectorAll(
        "[class*='motor-service-item'], [class*='motor-service']"
      )).filter(el => el.offsetParent !== null);

      for (const row of motorRows) {
        // Extract procedure name from p.motor-service-name
        const nameEl = row.querySelector("[class*='motor-service-name']");
        let name = nameEl ? nameEl.textContent.trim() : "";

        // Fallback: try the custom-header-template
        if (!name) {
          const tmpl = row.querySelector("[class*='custom-header-template']");
          if (tmpl) {
            // Get text from the first P or span child (not the whole template which has prices)
            const firstText = tmpl.querySelector("p, span");
            name = firstText ? firstText.textContent.trim() : "";
          }
        }

        if (!name || name.length < 3) continue;

        // Clean name
        name = name.replace(/\s*[ⓘℹ].*/, "").replace(/\s+/g, " ").trim();

        // Extract hours: look for clock icon and its nearby text sibling
        let hours = 0;
        const leafEls = Array.from(row.querySelectorAll("span, div, i, p")).filter(el =>
          el.offsetParent !== null && el.children.length === 0
        );
        for (let i = 0; i < leafEls.length; i++) {
          const cls = (leafEls[i].className || "").toLowerCase();
          if (cls.includes("clock") || cls.includes("time")) {
            // Next sibling leaf should be hours
            for (let j = i + 1; j < Math.min(i + 3, leafEls.length); j++) {
              const m = leafEls[j].textContent.trim().match(/^(\d+\.?\d*)$/);
              if (m && parseFloat(m[1]) > 0 && parseFloat(m[1]) < 30) {
                hours = parseFloat(m[1]);
                break;
              }
            }
            if (hours > 0) break;
          }
        }
        // Fallback: parse hours from row text (e.g. "$150.00  1.20  $0.00")
        if (hours === 0) {
          const rowText = row.textContent || "";
          // Look for standalone decimal that's NOT a price (not preceded by $)
          const nums = rowText.match(/(?:^|\s)(\d+\.\d{2})(?:\s|$)/g);
          if (nums) {
            for (const n of nums) {
              const val = parseFloat(n.trim());
              if (val > 0 && val < 20 && !rowText.includes(`$${n.trim()}`)) {
                hours = val;
                break;
              }
            }
          }
        }

        // Extract labor price (first $X.XX in the row)
        const rowText = row.textContent || "";
        const priceMatch = rowText.match(/\$(\d+\.?\d*)/);
        const labor = priceMatch ? parseFloat(priceMatch[1]) : 0;

        // Get the checkbox click target (custom-accordian-header-checkbox)
        const checkbox = row.querySelector("[class*='accordian-header-checkbox'], [class*='accordion-header-checkbox']");
        let checkboxRect = null;
        if (checkbox && checkbox.offsetParent !== null) {
          const r = checkbox.getBoundingClientRect();
          checkboxRect = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        }

        // Fallback: get the accordion header itself (the whole row is clickable)
        if (!checkboxRect) {
          const header = row.querySelector("[class*='accordian-header'], [class*='accordion-header']");
          if (header && header.offsetParent !== null) {
            const r = header.getBoundingClientRect();
            checkboxRect = { x: r.x + 20, y: r.y + r.height / 2 }; // Click near left edge (checkbox area)
          }
        }

        if (checkboxRect) {
          results.push({
            name,
            hours,
            labor,
            plusRect: checkboxRect, // Reuse plusRect field for the checkbox click target
          });
        }
      }

      return results;
    });

    // Merge new procs (deduplicate by name)
    const existingNames = new Set(allProcs.map(p => p.name));
    for (const p of procs) {
      if (!existingNames.has(p.name)) {
        allProcs.push(p);
        existingNames.add(p.name);
      }
    }

    // If no new procedures found after scroll, stop
    if (allProcs.length === prevCount && scroll > 0) break;
    prevCount = allProcs.length;

    // Scroll the right panel down to load more
    if (scroll < maxScrollAttempts) {
      await page.evaluate(() => {
        // Find the scrollable container for MOTOR procedures
        const containers = Array.from(document.querySelectorAll(
          "[class*='motor'], [class*='content'], [class*='panel-body'], [class*='scroll']"
        )).filter(el => el.scrollHeight > el.clientHeight && el.offsetParent !== null);
        for (const c of containers) {
          if (c.scrollHeight > c.clientHeight + 50) {
            c.scrollTop += 300;
            return;
          }
        }
      });
      await sleep(500);
    }
  }

  return allProcs;
}

/**
 * Click the green "+" button for a specific procedure.
 * Uses the stored plusRect coordinates for native mouse click.
 */
/**
 * Select a MOTOR procedure and add it to the estimate.
 *
 * MOTOR uses checkbox + "Add" button pattern:
 * 1. Click the checkbox (or accordion header) to select the procedure
 * 2. Click the "Add" button at the bottom of the dialog
 *
 * @param {import('puppeteer-core').Page} page
 * @param {{ name: string, hours: number, labor: number, plusRect: { x: number, y: number } }} proc
 * @returns {Promise<boolean>}
 */
async function clickProcedurePlus(page, proc) {
  if (!proc.plusRect) return false;

  // Step 1: Scroll the procedure into view
  await page.evaluate((name) => {
    const searchText = name.substring(0, 20);
    const els = Array.from(document.querySelectorAll("[class*='motor-service-name'], [class*='motor-service-item']"))
      .filter(el => el.offsetParent !== null && el.textContent.includes(searchText));
    if (els.length > 0) {
      els[0].scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, proc.name);
  await sleep(500);

  // Step 2: Re-find the checkbox for this procedure (coordinates may have shifted after scroll)
  const freshRect = await page.evaluate((name) => {
    const searchText = name.substring(0, 20);
    const rows = Array.from(document.querySelectorAll("[class*='motor-service-item']"))
      .filter(el => el.offsetParent !== null && el.textContent.includes(searchText));
    for (const row of rows) {
      // Try checkbox first
      const cb = row.querySelector("[class*='accordian-header-checkbox'], [class*='accordion-header-checkbox']");
      if (cb && cb.offsetParent !== null) {
        const r = cb.getBoundingClientRect();
        if (r.width > 0) return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }
      // Fallback: click the accordion header near its left edge
      const header = row.querySelector("[class*='accordian-header'], [class*='accordion-header']");
      if (header && header.offsetParent !== null) {
        const r = header.getBoundingClientRect();
        return { x: r.x + 20, y: r.y + r.height / 2 };
      }
    }
    return null;
  }, proc.name);

  const clickTarget = freshRect || proc.plusRect;
  console.log(`${LOG} Clicking checkbox for "${proc.name}" at (${Math.round(clickTarget.x)}, ${Math.round(clickTarget.y)})`);
  await page.mouse.click(clickTarget.x, clickTarget.y);
  await sleep(1000);

  // Step 3: Click the "Add" button to add the selected procedure to the estimate
  console.log(`${LOG} Clicking "Add" button to confirm procedure...`);
  const addClicked = await clickAddButton(page);
  if (addClicked) {
    console.log(`${LOG} "Add" button clicked ✓`);
    return true;
  }

  // Fallback: maybe the checkbox click already added it (some UI variants)
  console.log(`${LOG} "Add" button not found — checkbox click may have been sufficient`);
  return true;
}

// ─── DOM Readers ────────────────────────────────────────────────────────────

/**
 * Read category options visible in the MOTOR tree.
 * Filters noise: skips containers (long text), headers ("Categories", "All"),
 * and decorative elements ("Powered by").
 */
async function readCategoryOptions(page) {
  return page.evaluate((itemSel, textSel) => {
    const NOISE = /^(categories|all|powered by|loading|search|add|cancel|close|back|save)$/i;
    const items = [];

    for (const sel of itemSel.split(", ")) {
      const els = Array.from(document.querySelectorAll(sel)).filter(el =>
        el.offsetParent !== null
      );
      if (els.length === 0) continue;

      els.forEach((el) => {
        // Prefer a direct child text element (span, .category-name) over the container
        let text = "";
        for (const ts of textSel.split(", ")) {
          const child = el.querySelector(ts);
          if (child) {
            text = child.textContent.trim();
            break;
          }
        }
        if (!text) text = el.textContent.trim();

        // Skip noise: too long (container text), headers, buttons
        if (!text || text.length <= 1) return;
        if (text.length > 60) return;              // container with concatenated children
        if (text.includes("  ")) return;            // multiple items joined (container)
        if (NOISE.test(text)) return;
        if (text.includes("Powered by")) return;
        // Skip if text contains newlines (multi-line container)
        if (text.includes("\n")) return;

        items.push(text);
      });

      if (items.length > 0) break;
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
 * Prefers exact text match on leaf elements, then partial match.
 */
async function clickCategoryOption(page, optionText) {
  const result = await page.evaluate(
    (text, itemSel, textSel) => {
      // Strategy 1: Find via CATEGORY_ITEM selectors, prefer child text match
      for (const sel of itemSel.split(", ")) {
        const els = Array.from(document.querySelectorAll(sel)).filter(el =>
          el.offsetParent !== null
        );
        for (const el of els) {
          // Check child text elements first (more precise)
          for (const ts of textSel.split(", ")) {
            const child = el.querySelector(ts);
            if (child && child.textContent.trim() === text) {
              const rect = el.getBoundingClientRect();
              return { found: true, rect: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } };
            }
          }
          // Then check element's own text (but must be short = leaf)
          const elText = el.textContent.trim();
          if (elText === text && elText.length < 60) {
            const rect = el.getBoundingClientRect();
            return { found: true, rect: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } };
          }
        }
      }

      // Strategy 2: Partial match on CATEGORY_ITEM selectors
      for (const sel of itemSel.split(", ")) {
        const els = Array.from(document.querySelectorAll(sel)).filter(el =>
          el.offsetParent !== null
        );
        for (const el of els) {
          const elText = el.textContent.trim();
          if (elText.length < 60 && (elText.includes(text) || text.includes(elText))) {
            const rect = el.getBoundingClientRect();
            return { found: true, rect: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } };
          }
        }
      }

      // Strategy 3: Broader fallback — any leaf-ish element with exact text
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
    SERVICES.CATEGORY_ITEM,
    SERVICES.CATEGORY_TEXT
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
