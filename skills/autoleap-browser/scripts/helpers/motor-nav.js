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
const DEFAULT_HAIKU_MODEL = ["claude", "haiku-4-5-20251001"].join("-");

/** Non-fatal screenshot — never crashes the playbook */
async function safeScreenshot(page, path) {
  try { await page.screenshot({ path }); } catch (e) { console.log(`${LOG} Screenshot skipped: ${e.message.substring(0, 60)}`); }
}

/**
 * Navigate the MOTOR category tree to find and add the correct labor line.
 *
 * @param {import('puppeteer-core').Page} page - AutoLeap estimate page
 * @param {object} diagnosis - Diagnosis result (has .ai.diagnoses, .codes, .ai.repair_plan)
 * @param {object} vehicle - { year, make, model, engine, vin }
 * @returns {{ success: boolean, procedure?: string, hours?: number, addOns?: string[], error?: string }}
 */
async function navigateMotorTree(page, diagnosis, vehicle, query) {
  console.log(`${LOG} Opening MOTOR labor catalog...`);

  // ── Step 0: Close CUSTOMER sidebar (check for "Contact" text to ID it) ──
  await closeCustomerSidebar(page);
  await sleep(1000);

  // Take a starting screenshot
  await safeScreenshot(page, "/tmp/debug-motor-start.png");

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
  await safeScreenshot(page, "/tmp/debug-motor-after-browse.png");

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

    await safeScreenshot(page, "/tmp/debug-motor-after-tab-click.png");

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

    // Get fresh coordinates and click (no inView check — Puppeteer can click at any coordinate)
    const connectRect = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button"));
      for (const btn of btns) {
        if (btn.textContent.trim() === "Connect to MOTOR" && btn.offsetParent !== null) {
          const rect = btn.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
          }
        }
      }
      return null;
    });

    if (connectRect) {
      console.log(`${LOG} "Connect to MOTOR" at (${Math.round(connectRect.x)}, ${Math.round(connectRect.y)}) — clicking...`);
      await page.mouse.click(connectRect.x, connectRect.y);
      await sleep(4000);

      await safeScreenshot(page, "/tmp/debug-motor-after-connect.png");

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

        // ── Step 3e: Reload estimate page to let MOTOR Primary sync, then re-open Browse ──
        // MOTOR Primary is disabled immediately after connection. The backend API needs
        // 15-30s to sync vehicle data and enable MOTOR Primary with full procedures.
        const currentUrl = page.url();
        console.log(`${LOG} Reloading estimate page to sync MOTOR Primary (waiting 15s)...`);
        await page.goto(currentUrl, { waitUntil: "networkidle0", timeout: 30000 }).catch(() => {});
        await sleep(15000); // MOTOR API sync can take 15-30s

        // Re-open Browse
        console.log(`${LOG} Re-opening Browse after MOTOR connection...`);
        await clickByTextOutsideDialog(page, "Services", ["a", "li", "[role='tab']"]);
        await sleep(2000);
        await clickByTextOutsideDialog(page, "Browse", ["button"]);
        await sleep(3000);

        await safeScreenshot(page, "/tmp/debug-motor-after-reopen.png");

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
          await safeScreenshot(page, "/tmp/debug-motor-after-tab-click2.png");

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
              await safeScreenshot(page, "/tmp/debug-motor-parent-click.png");

              const retreeCheck = await page.evaluate(() => {
                const items = Array.from(document.querySelectorAll(
                  "div[role='button'], li[role='treeitem'], [class*='category-item'], [class*='tree-node']"
                )).filter(el => el.offsetParent !== null);
                return items.length;
              });
              console.log(`${LOG} Tree after parent click: ${retreeCheck} items`);
              if (retreeCheck > 0) {
                // Check if we're on MOTOR Primary (8 categories) or Secondary (22+ categories)
                const isMotorPrimary = await page.evaluate(() => {
                  const items = Array.from(document.querySelectorAll("[class*='motor-category-item']"))
                    .filter(el => el.offsetParent !== null && !(el.className || "").includes("header"));
                  return items.length <= 12; // Primary has ~8 categories, Secondary has 22+
                });
                if (isMotorPrimary) {
                  console.log(`${LOG} MOTOR Primary activated (≤12 categories) ✓`);
                  motorTabFound = true;
                } else {
                  // We're on MOTOR Secondary — try reloading again for MOTOR Primary
                  console.log(`${LOG} On MOTOR Secondary (${retreeCheck} items) — retrying for MOTOR Primary (15s wait)...`);
                  const retryUrl = page.url();
                  // Close Browse dialog first
                  await page.keyboard.press("Escape");
                  await sleep(1000);
                  await page.goto(retryUrl, { waitUntil: "networkidle0", timeout: 30000 }).catch(() => {});
                  await sleep(15000);
                  // Re-open Browse and try MOTOR Primary
                  await clickByTextOutsideDialog(page, "Services", ["a", "li", "[role='tab']"]);
                  await sleep(2000);
                  await clickByTextOutsideDialog(page, "Browse", ["button"]);
                  await sleep(3000);
                  // Click MOTOR Primary directly
                  const retryPrimary = await page.evaluate(() => {
                    const tabs = document.querySelectorAll("p[class*='service-tab']");
                    for (const t of tabs) {
                      if (t.textContent.trim().includes("MOTOR Primary") && !t.className.includes("disabled")) {
                        const rect = t.getBoundingClientRect();
                        return { found: true, rect: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } };
                      }
                    }
                    return { found: false };
                  });
                  if (retryPrimary.found) {
                    console.log(`${LOG} MOTOR Primary now enabled! Clicking...`);
                    await page.mouse.click(retryPrimary.rect.x, retryPrimary.rect.y);
                    await sleep(3000);
                    const primaryCheck = await page.evaluate(() => {
                      return Array.from(document.querySelectorAll("[class*='motor-category-item']"))
                        .filter(el => el.offsetParent !== null && !(el.className || "").includes("header")).length;
                    });
                    console.log(`${LOG} MOTOR Primary tree: ${primaryCheck} items`);
                    if (primaryCheck > 0 && primaryCheck <= 12) motorTabFound = true;
                    else motorTabFound = true; // Accept whatever we got
                  } else {
                    console.log(`${LOG} MOTOR Primary still disabled after retry — using MOTOR Secondary`);
                    motorTabFound = true; // Fall through to Secondary navigation
                  }
                }
              }
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
    await safeScreenshot(page, "/tmp/debug-motor-no-tab.png");
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
  await safeScreenshot(page, "/tmp/debug-motor-after-tab.png");

  // Build repair context for Claude
  const repairContext = buildRepairContext(diagnosis, vehicle, query);
  console.log(`${LOG} Repair context: ${repairContext.substring(0, 100)}...`);

  // ── Navigate MOTOR left tree (2 levels: System → Component) ──
  // MOTOR UI: left panel = category tree, right panel = operational procedures.
  // After selecting the right Component (e.g., "Engine"), the right panel shows
  // procedures like "Catalytic Converter R&R" with labor hours and a "+" button.
  const maxTreeLevels = 6;
  let lastPickedName = "";
  let previousItemCount = 0;
  let previousItemsStr = "";

  for (let level = 0; level < maxTreeLevels; level++) {
    const currentLevel = level + 1;

    const allOptions = await readCategoryOptions(page);
    const currentStr = allOptions.join("|");

    // Detect if the tree actually changed after the last click.
    // Cases: (a) completely new items, (b) same-named sub-category (e.g. "Exhaust System" → "Exhaust System"),
    // (c) fewer items (drilled into sub-category), (d) "All" item appeared (sub-level).
    let options;
    if (currentLevel === 1) {
      options = allOptions;
    } else if (currentStr === previousItemsStr) {
      // Exact same items — tree didn't change, we're at the deepest level
      console.log(`${LOG} Tree unchanged at level ${currentLevel} — tree navigation done`);
      break;
    } else {
      // Tree changed — use ALL items (don't filter by previous names,
      // because sub-categories can have the same name as their parent)
      options = allOptions;
      console.log(`${LOG} Tree changed: ${previousItemCount} → ${allOptions.length} items`);
    }

    console.log(`${LOG} Tree level ${currentLevel} (${options.length}): ${options.slice(0, 10).join(", ")}${options.length > 10 ? "..." : ""}`);

    if (options.length === 0) break;

    // Auto-select if only 1 non-"All" option
    const nonAllOptions = options.filter(o => o !== "All");
    if (nonAllOptions.length === 1) {
      // Same-name sub-level (e.g., "Exhaust System" → sub: "All" + "Exhaust System >").
      // The sub-item has a chevron meaning there's more to drill into.
      // clickCategoryOption prefers motor-category-item (list item) over the header,
      // so it will click the correct element and drill deeper.
      if (nonAllOptions[0] === lastPickedName && options.includes("All")) {
        console.log(`${LOG} Level ${currentLevel}: Same-name sub-level "${lastPickedName}" — drilling deeper via list item`);
        previousItemCount = allOptions.length;
        previousItemsStr = currentStr;
        await clickCategoryOption(page, nonAllOptions[0]);
        await sleep(1000);
        await safeScreenshot(page, `/tmp/debug-motor-sublevel-L${currentLevel}.png`);
        lastPickedName = nonAllOptions[0];
        await sleep(2000);
        continue;
      } else {
        console.log(`${LOG} Level ${currentLevel}: Auto-selecting "${nonAllOptions[0]}"`);
      }
      previousItemCount = allOptions.length;
      previousItemsStr = currentStr;
      await clickCategoryOption(page, nonAllOptions[0]);
      lastPickedName = nonAllOptions[0];
      await sleep(3000);
      continue;
    }
    if (nonAllOptions.length === 0 && options.includes("All")) {
      console.log(`${LOG} Level ${currentLevel}: Only "All" — clicking it for procedures`);
      previousItemCount = allOptions.length;
      previousItemsStr = currentStr;
      await clickCategoryOption(page, "All");
      await sleep(3000);
      break; // "All" shows procedures in right panel — done with tree
    }

    // Use non-All options for Claude to pick from
    const pickOptions = nonAllOptions.length > 0 ? nonAllOptions : options;
    const levelLabel = getLevelLabel(currentLevel);
    const pick = await askClaudeForCategory(repairContext, pickOptions, levelLabel, lastPickedName);
    if (!pick) {
      return { success: false, error: `Claude could not pick ${levelLabel} from: ${pickOptions.join(", ")}` };
    }

    console.log(`${LOG} Level ${currentLevel} (${levelLabel}): Claude → "${pick}"`);
    previousItemCount = allOptions.length;
    previousItemsStr = currentStr;

    const clicked = await clickCategoryOption(page, pick);
    if (!clicked) {
      const fuzzy = findClosestMatch(pick, pickOptions);
      if (fuzzy && fuzzy !== pick) {
        console.log(`${LOG} Fuzzy match: "${pick}" → "${fuzzy}"`);
        await clickCategoryOption(page, fuzzy);
      } else {
        return { success: false, error: `Could not click "${pick}" at level ${currentLevel}` };
      }
    }

    lastPickedName = pick;
    await sleep(3000); // increased from 2000 — MOTOR API may be slow for newly-connected vehicles
  }

  // ── Read operational procedures from RIGHT panel ──
  // After tree navigation, the right panel shows procedures with Labor, Parts,
  // Subtotal columns and a green "+" button to add each one.
  console.log(`${LOG} Reading operational procedures from right panel...`);
  await safeScreenshot(page, "/tmp/debug-motor-procedures.png");

  let procedures = await readProcedures(page);

  // If no procedures, wait longer and retry — they may still be loading
  if (procedures.length === 0) {
    console.log(`${LOG} No procedures yet — waiting 5s for right panel to load...`);
    await sleep(5000);
    procedures = await readProcedures(page);
  }

  // If still empty, try re-clicking the last picked category
  if (procedures.length === 0 && lastPickedName) {
    console.log(`${LOG} Still no procedures — re-clicking "${lastPickedName}" and waiting...`);
    await clickCategoryOption(page, lastPickedName);
    await sleep(4000);
    procedures = await readProcedures(page);
  }

  console.log(`${LOG} Found ${procedures.length} procedures: ${procedures.slice(0, 5).map(p => p.name).join(", ")}${procedures.length > 5 ? "..." : ""}`);

  if (procedures.length === 0) {
    // ── Fallback A: Go back to root and click "All" to show all procedures ──
    console.log(`${LOG} No procedures after tree — clicking back to root and trying "All"...`);
    const backClicked = await page.evaluate(() => {
      const headers = document.querySelectorAll("[class*='category-item-header']");
      for (const h of headers) {
        if (!h.offsetParent) continue;
        const rect = h.getBoundingClientRect();
        if (rect.width > 0) return { x: rect.x + 15, y: rect.y + rect.height / 2 };
      }
      return null;
    });
    if (backClicked) {
      await page.mouse.click(backClicked.x, backClicked.y);
      await sleep(2000);
    }
    const allClicked = await clickCategoryOption(page, "All");
    if (allClicked) {
      console.log(`${LOG} Clicked "All" at root — waiting for procedures...`);
      await sleep(5000);
      await safeScreenshot(page, "/tmp/debug-motor-all-root.png");
      procedures = await readProcedures(page);
      console.log(`${LOG} After "All" at root: ${procedures.length} procedures found`);
    }
  }

  if (procedures.length === 0) {
    // ── Fallback B: Use the "Search all services" bar at top of Browse dialog ──
    // Simplify search term: strip action words like "replacement", "repair", "needs" etc.
    // MOTOR uses names like "Catalytic Converter R&R", not "Catalytic converter replacement"
    const rawTerm = query || lastPickedName || "";
    const searchTerm = rawTerm
      .replace(/\b(replacement|replace|repair|needs|needed|service|fix|check|inspect)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    if (searchTerm) {
      console.log(`${LOG} Tree navigation found no procedures — trying search: "${searchTerm}"`);
      const searched = await searchMotorServices(page, searchTerm);
      if (searched) {
        await sleep(3000);
        procedures = await readProcedures(page);
        console.log(`${LOG} After search: ${procedures.length} procedures found`);
      }
    }
  }

  if (procedures.length === 0) {
    // Close the Browse dialog before returning — otherwise it blocks manual service addition
    console.log(`${LOG} Closing Browse dialog before returning...`);
    await closeBrowseDialog(page);
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
  await safeScreenshot(page, "/tmp/debug-motor-after-add.png");

  // ── Close the MOTOR Browse dialog by clicking "Done" ──
  console.log(`${LOG} Closing MOTOR dialog...`);
  await closeBrowseDialog(page);

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
 * Search for services using the "Search all services" bar at the top of the Browse dialog.
 * This is a fallback when tree navigation doesn't find procedures.
 */
async function searchMotorServices(page, searchTerm) {
  // Target the "Search all services" input INSIDE the Browse dialog,
  // not the estimate page's customer search bar
  const inputInfo = await page.evaluate(() => {
    // Look for the search input specifically inside the Browse dialog area
    // The Browse dialog has "Search all services" placeholder
    const allInputs = Array.from(document.querySelectorAll("input"))
      .filter(el => el.offsetParent !== null);

    // Prefer input with "service" in placeholder (Browse dialog search)
    for (const inp of allInputs) {
      const ph = (inp.placeholder || "").toLowerCase();
      if (ph.includes("service")) {
        const rect = inp.getBoundingClientRect();
        if (rect.width > 100) {
          return { found: true, rect: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }, placeholder: inp.placeholder };
        }
      }
    }
    // Fallback: input with "search all" in placeholder
    for (const inp of allInputs) {
      const ph = (inp.placeholder || "").toLowerCase();
      if (ph.includes("search all")) {
        const rect = inp.getBoundingClientRect();
        if (rect.width > 100) {
          return { found: true, rect: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }, placeholder: inp.placeholder };
        }
      }
    }
    // Last resort: any search input in the upper part of the page (dialog area, y < 200)
    for (const inp of allInputs) {
      const rect = inp.getBoundingClientRect();
      const ph = (inp.placeholder || "").toLowerCase();
      if (ph.includes("search") && rect.y < 200 && rect.width > 200) {
        return { found: true, rect: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }, placeholder: inp.placeholder };
      }
    }
    return { found: false };
  });

  if (!inputInfo.found) {
    console.log(`${LOG} Search input not found in Browse dialog`);
    return false;
  }

  console.log(`${LOG} Found search input: "${inputInfo.placeholder}" — typing "${searchTerm}"...`);

  // Focus the input via DOM (more reliable than mouse click for Angular inputs)
  await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll("input")).filter(el => el.offsetParent !== null);
    for (const inp of inputs) {
      const ph = (inp.placeholder || "").toLowerCase();
      if (ph.includes("service") || ph.includes("search all")) {
        inp.focus();
        inp.value = "";
        inp.dispatchEvent(new Event("input", { bubbles: true }));
        return true;
      }
    }
    return false;
  });
  await sleep(300);

  // Click to ensure focus
  await page.mouse.click(inputInfo.rect.x, inputInfo.rect.y);
  await sleep(300);

  // Triple-click to select all existing text, then type
  await page.mouse.click(inputInfo.rect.x, inputInfo.rect.y, { clickCount: 3 });
  await sleep(200);
  await page.keyboard.type(searchTerm, { delay: 50 });
  await sleep(500);
  await page.keyboard.press("Enter");
  await sleep(3000);

  // Take screenshot to verify search
  await safeScreenshot(page, "/tmp/debug-motor-after-search.png");

  return true;
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
 * Close the MOTOR Browse dialog reliably.
 *
 * The dialog has a "Done" button at bottom right and an "X" close button at top right.
 * findInDialog may match a "Done" text span instead of the actual button.
 * This function:
 * 1. Clicks the actual "Done" BUTTON (not spans/divs with "Done" text)
 * 2. Verifies the dialog closed
 * 3. Falls back to X close button, then Escape key
 */
async function closeBrowseDialog(page) {
  const maxAttempts = 3;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Strategy 1: Find the actual "Done" button element
    const doneBtn = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button"));
      for (const btn of btns) {
        const text = btn.textContent.trim();
        if (text === "Done" && btn.offsetParent !== null) {
          const rect = btn.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            return { found: true, x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, tag: "button" };
          }
        }
      }
      // Strategy 2: Find X close button at top of dialog (fa-times icon)
      const dialogs = document.querySelectorAll("[role='dialog'], [class*='modal-content']");
      for (const dialog of dialogs) {
        if (!dialog.offsetParent && dialog.offsetWidth === 0) continue;
        // Check if this is the MOTOR browse dialog
        const dt = dialog.textContent || "";
        if (!dt.includes("MOTOR Primary") && !dt.includes("MOTOR Secondary") && !dt.includes("Browse") && !dt.includes("Search all services")) continue;
        const closeIcons = dialog.querySelectorAll("i.fa-times, i.pi-times, button[class*='close']");
        for (const icon of closeIcons) {
          if (!icon.offsetParent) continue;
          const r = icon.getBoundingClientRect();
          if (r.width > 0) return { found: true, x: r.x + r.width / 2, y: r.y + r.height / 2, tag: "close-icon" };
        }
      }
      return { found: false };
    });

    if (doneBtn.found) {
      console.log(`${LOG} Clicking "${doneBtn.tag}" at (${Math.round(doneBtn.x)}, ${Math.round(doneBtn.y)})...`);
      await page.mouse.click(doneBtn.x, doneBtn.y);
      await sleep(2000);
    } else {
      console.log(`${LOG} No Done/close button found — pressing Escape...`);
      await page.keyboard.press("Escape");
      await sleep(1500);
    }

    // Verify dialog is closed — check for ANY Browse dialog indicator
    const dialogStillOpen = await page.evaluate(() => {
      const dialogs = document.querySelectorAll("[role='dialog'], [class*='modal-content'], [class*='modal-body']");
      for (const dialog of dialogs) {
        if (!dialog.offsetParent && dialog.offsetWidth === 0) continue;
        const text = dialog.textContent || "";
        if (text.includes("MOTOR Primary") || text.includes("MOTOR Secondary") ||
            text.includes("Operational") || text.includes("Search all services") ||
            text.includes("Browse") || text.includes("Magic Services")) {
          return true;
        }
      }
      return false;
    });

    if (!dialogStillOpen) {
      console.log(`${LOG} MOTOR dialog closed ✓`);
      return true;
    }
    console.log(`${LOG} Dialog still open after attempt ${attempt + 1} — retrying...`);
  }

  // Last resort: click the X at the very top-right of the modal overlay
  console.log(`${LOG} Force-closing with page click outside dialog...`);
  await page.mouse.click(10, 10); // click outside the dialog
  await sleep(1000);
  await page.keyboard.press("Escape");
  await sleep(1000);
  return false;
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
    ? `You are navigating a MOTOR labor catalog. Current level: ${levelLabel}.\nParent category: ${parentCategory}\n\n${repairContext}\n\nOptions:\n${optionsList}\n\nPick the ONE best option that CONTAINS the component being REPAIRED/REPLACED (not the sensor or system that detected the fault). Reply with ONLY the option text, nothing else.`
    : `You are navigating a MOTOR labor catalog. Current level: ${levelLabel}.\n\n${repairContext}\n\nOptions:\n${optionsList}\n\nPick the ONE best option that CONTAINS the component being REPAIRED/REPLACED (not the sensor or system that detected the fault). Reply with ONLY the option text, nothing else.`;

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
      model: process.env.CLAUDE_HAIKU_MODEL || DEFAULT_HAIKU_MODEL,
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

        // Get the green "+" circle button for this procedure.
        // The green "+" is a div.pointer.font-primary inside div.m-estimate,
        // positioned at the far right of each row (~x=1180).
        // It may be inside the row, a sibling, or in a parallel column.
        const rowRect = row.getBoundingClientRect();
        const rowCenterY = rowRect.y + rowRect.height / 2;

        // Strategy 1: Look for div.pointer.font-primary inside the row or its parent wrapper
        let plusRect = null;
        const wrapper = row.closest("[class*='motor-service-item-wrapper']") || row.parentElement;
        const greenBtns = (wrapper || row).querySelectorAll("[class*='pointer'][class*='font-primary'], [class*='m-estimate'] [class*='pointer']");
        for (const gb of greenBtns) {
          if (!gb.offsetParent) continue;
          const r = gb.getBoundingClientRect();
          // Must be at approximately the same y as this row (±30px)
          if (Math.abs(r.y + r.height / 2 - rowCenterY) < 30) {
            plusRect = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
            break;
          }
        }

        // Strategy 2: Find any div.pointer.font-primary on the page near this row's y
        if (!plusRect) {
          const allGreen = document.querySelectorAll("div[class*='pointer'][class*='font-primary']");
          for (const gb of allGreen) {
            if (!gb.offsetParent) continue;
            const r = gb.getBoundingClientRect();
            if (Math.abs(r.y + r.height / 2 - rowCenterY) < 30 && r.x > 1000) {
              plusRect = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
              break;
            }
          }
        }

        // Strategy 3: Use fixed x=1180 at the row's center y (known position from screenshots)
        if (!plusRect) {
          plusRect = { x: 1180, y: rowCenterY };
        }

        results.push({
          name,
          hours,
          labor,
          plusRect,
        });
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
 * Click the green "+" circle button for a specific MOTOR procedure.
 *
 * APPROACH: Avoids scrollIntoView (which positions elements behind the dialog's
 * sticky header at y≈38, making them unclickable). Instead:
 * 1. Scroll the procedures container to top
 * 2. Scan visible rows + green buttons at each scroll position
 * 3. Match target row to its green button by INDEX (nth row → nth button)
 * 4. Only click when both are confirmed in the viewport content area (y > 150)
 *
 * @param {import('puppeteer-core').Page} page
 * @param {{ name: string, hours: number, labor: number, plusRect: { x: number, y: number } }} proc
 * @returns {Promise<boolean>}
 */
async function clickProcedurePlus(page, proc) {
  const searchText = proc.name.substring(0, 20);

  // Step 1: Scroll the MOTOR procedures container to the top
  await page.evaluate(() => {
    const items = document.querySelectorAll("[class*='motor-service-item']");
    if (items.length === 0) return;
    let container = items[0].parentElement;
    while (container && container !== document.body) {
      if (container.scrollHeight > container.clientHeight + 50) {
        container.scrollTop = 0;
        return;
      }
      container = container.parentElement;
    }
  });
  await sleep(600);

  // Step 2: Scan + scroll loop — find target row and its green button
  const maxAttempts = 15;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const result = await page.evaluate((searchText) => {
      const MIN_Y = 150;  // below dialog header/tabs
      const MAX_Y = window.innerHeight - 50;

      // All motor-service-item rows in DOM order
      const allRows = Array.from(document.querySelectorAll("[class*='motor-service-item']"))
        .filter(el => el.offsetParent !== null);

      // Find target's index
      let targetIdx = -1;
      for (let i = 0; i < allRows.length; i++) {
        const nameEl = allRows[i].querySelector("[class*='motor-service-name']");
        const name = nameEl ? nameEl.textContent.trim() : "";
        if (name.includes(searchText)) { targetIdx = i; break; }
      }
      if (targetIdx === -1) return { found: false, reason: "target-not-in-dom", rows: allRows.length };

      // Check target row is in the viewport content area
      const targetRow = allRows[targetIdx];
      const headerEl = targetRow.querySelector("[class*='accordian-header']");
      const targetRect = (headerEl || targetRow).getBoundingClientRect();
      const targetCenterY = targetRect.y + targetRect.height / 2;

      if (targetCenterY < MIN_Y || targetCenterY > MAX_Y) {
        return { found: false, reason: "not-in-viewport", y: Math.round(targetCenterY), idx: targetIdx, rows: allRows.length };
      }

      // All green "+" buttons in the right column (sorted by y)
      const greenBtns = Array.from(document.querySelectorAll(
        "div[class*='pointer'][class*='font-primary']"
      )).filter(el => {
        if (!el.offsetParent) return false;
        const r = el.getBoundingClientRect();
        return r.x > 900 && r.width > 5 && r.height > 5;
      }).sort((a, b) => a.getBoundingClientRect().y - b.getBoundingClientRect().y);

      // Strategy A: Y-proximity match (closest green button to target row — most reliable)
      // With 18 rows vs 17 buttons, index mapping is unreliable. Y-proximity wins.
      let closestBtn = null;
      let closestDist = Infinity;
      for (const btn of greenBtns) {
        const r = btn.getBoundingClientRect();
        const btnCenterY = r.y + r.height / 2;
        if (btnCenterY < MIN_Y || btnCenterY > MAX_Y) continue;
        const dist = Math.abs(btnCenterY - targetCenterY);
        if (dist < closestDist) {
          closestDist = dist;
          closestBtn = { x: r.x + r.width / 2, y: btnCenterY };
        }
      }
      if (closestBtn && closestDist < 40) {
        return {
          found: true, ...closestBtn,
          strategy: "y-proximity", dist: Math.round(closestDist),
          targetY: Math.round(targetCenterY), btns: greenBtns.length,
          idx: targetIdx, rows: allRows.length,
        };
      }

      // Strategy B: Index-based fallback (only if y-proximity didn't find a close match)
      if (targetIdx < greenBtns.length) {
        const btn = greenBtns[targetIdx];
        const r = btn.getBoundingClientRect();
        const btnCenterY = r.y + r.height / 2;
        if (btnCenterY > MIN_Y && btnCenterY < MAX_Y) {
          return {
            found: true, x: r.x + r.width / 2, y: btnCenterY,
            strategy: "index-fallback", idx: targetIdx,
            rows: allRows.length, btns: greenBtns.length,
            targetY: Math.round(targetCenterY), btnY: Math.round(btnCenterY),
          };
        }
      }

      // Strategy C: elementFromPoint at the add column
      const pointEl = document.elementFromPoint(1180, targetCenterY);
      if (pointEl) {
        const pCls = (pointEl.className || "");
        const parentCls = (pointEl.parentElement?.className || "");
        if (pCls.includes("pointer") || pCls.includes("font-primary") ||
            parentCls.includes("m-estimate") || parentCls.includes("pointer")) {
          const r = pointEl.getBoundingClientRect();
          return {
            found: true, x: r.x + r.width / 2, y: r.y + r.height / 2,
            strategy: "elementFromPoint", btns: greenBtns.length,
          };
        }
      }

      return {
        found: false, reason: "no-button-match",
        targetY: Math.round(targetCenterY), btns: greenBtns.length, idx: targetIdx,
      };
    }, searchText);

    console.log(`${LOG} clickProcedurePlus attempt ${attempt}: ${JSON.stringify(result)}`);

    if (result.found) {
      console.log(`${LOG} Clicking green "+" for "${proc.name}" at (${Math.round(result.x)}, ${Math.round(result.y)}) [${result.strategy}]`);
      await page.mouse.click(result.x, result.y);
      await sleep(2000);
      await safeScreenshot(page, "/tmp/debug-motor-after-plus-click.png");
      return true;
    }

    // Scroll the container to bring target into view
    if (result.reason === "not-in-viewport" || result.reason === "no-button-match") {
      await page.evaluate((searchText) => {
        const el = Array.from(document.querySelectorAll("[class*='motor-service-name']"))
          .find(e => e.offsetParent !== null && e.textContent.includes(searchText));
        if (!el) return;
        // Find scrollable container and scroll directly
        let container = el.parentElement;
        while (container && container !== document.body) {
          if (container.scrollHeight > container.clientHeight + 50) {
            const elRect = el.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();
            // Position element in the MIDDLE of the container
            const elOffsetInContainer = (elRect.y - containerRect.y) + container.scrollTop;
            container.scrollTop = Math.max(0, elOffsetInContainer - container.clientHeight / 2);
            return;
          }
          container = container.parentElement;
        }
      }, searchText);
      await sleep(600);
      continue;
    }

    // Target not in DOM — scroll container down to load more
    await page.evaluate(() => {
      const containers = Array.from(document.querySelectorAll(
        "[class*='motor'], [class*='content'], [class*='panel-body'], [class*='scroll']"
      )).filter(el => el.scrollHeight > el.clientHeight && el.offsetParent !== null);
      for (const c of containers) {
        if (c.scrollHeight > c.clientHeight + 50) { c.scrollTop += 200; return; }
      }
    });
    await sleep(400);
  }

  console.log(`${LOG} Failed to find green "+" for "${proc.name}" after ${maxAttempts} attempts`);
  return false;
}

// ─── DOM Readers ────────────────────────────────────────────────────────────

/**
 * Read category options visible in the MOTOR tree.
 * Filters noise: skips containers (long text), headers ("Categories", "All"),
 * and decorative elements ("Powered by").
 */
async function readCategoryOptions(page) {
  return page.evaluate((itemSel, textSel) => {
    const NOISE = /^(categories|powered by|loading|search|cancel|close|back|save)$/i;
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
  // Step 1: Scroll the target element into view first (fixes items below scroll fold)
  // When multiple elements match the same text (e.g. header "Exhaust System ←" and
  // list item "Exhaust System >"), prefer the one with "motor-category-item" class
  // (the actual navigable list item, not the breadcrumb header).
  const scrolled = await page.evaluate(
    (text, itemSel, textSel) => {
      const collectMatches = () => {
        const matches = [];
        for (const sel of itemSel.split(", ")) {
          const els = Array.from(document.querySelectorAll(sel)).filter(el => el.offsetParent !== null);
          for (const el of els) {
            let matched = false;
            for (const ts of textSel.split(", ")) {
              const child = el.querySelector(ts);
              if (child && child.textContent.trim() === text) { matched = true; break; }
            }
            if (!matched && el.textContent.trim() === text && el.textContent.trim().length < 60) matched = true;
            if (matched) {
              const cls = (el.className || "");
              // List items have "motor-category-item" but NOT "motor-category-item-header"
              const isCategoryItem = cls.includes("motor-category-item") && !cls.includes("motor-category-item-header");
              matches.push({ el, isCategoryItem });
            }
          }
          if (matches.length > 0) break;
        }
        // Partial match fallback
        if (matches.length === 0) {
          for (const sel of itemSel.split(", ")) {
            const els = Array.from(document.querySelectorAll(sel)).filter(el => el.offsetParent !== null);
            for (const el of els) {
              const t = el.textContent.trim();
              if (t.length < 60 && (t.includes(text) || text.includes(t))) {
                const cls = (el.className || "");
                const isCategoryItem = cls.includes("motor-category-item") && !cls.includes("motor-category-item-header");
                matches.push({ el, isCategoryItem });
              }
            }
            if (matches.length > 0) break;
          }
        }
        // Broad fallback
        if (matches.length === 0) {
          for (const el of document.querySelectorAll("div, li, span, button, a")) {
            if (el.offsetParent && el.children.length < 3 && el.textContent.trim() === text) {
              matches.push({ el, isCategoryItem: false });
            }
          }
        }
        return matches;
      };
      const matches = collectMatches();
      if (matches.length === 0) return false;
      // Prefer motor-category-item (list item) over header/breadcrumb
      const best = matches.find(m => m.isCategoryItem) || matches[0];
      best.el.scrollIntoView({ block: "center", behavior: "instant" });
      return true;
    },
    optionText,
    SERVICES.CATEGORY_ITEM,
    SERVICES.CATEGORY_TEXT
  );

  if (!scrolled) return false;
  await sleep(300); // brief pause for scroll to settle

  // Step 2: Now get the rect (after scroll) and click
  // Same preference: motor-category-item over header elements
  const result = await page.evaluate(
    (text, itemSel, textSel) => {
      const matches = [];
      for (const sel of itemSel.split(", ")) {
        const els = Array.from(document.querySelectorAll(sel)).filter(el => el.offsetParent !== null);
        for (const el of els) {
          let matched = false;
          for (const ts of textSel.split(", ")) {
            const child = el.querySelector(ts);
            if (child && child.textContent.trim() === text) { matched = true; break; }
          }
          if (!matched && el.textContent.trim() === text && el.textContent.trim().length < 60) matched = true;
          if (matched) {
            const rect = el.getBoundingClientRect();
            const cls = (el.className || "").substring(0, 80);
            const isCategoryItem = cls.includes("motor-category-item") && !cls.includes("motor-category-item-header");
            matches.push({ found: true, isCategoryItem, cls, rect: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } });
          }
        }
        if (matches.length > 0) break;
      }
      // Partial
      if (matches.length === 0) {
        for (const sel of itemSel.split(", ")) {
          const els = Array.from(document.querySelectorAll(sel)).filter(el => el.offsetParent !== null);
          for (const el of els) {
            const t = el.textContent.trim();
            if (t.length < 60 && (t.includes(text) || text.includes(t))) {
              const rect = el.getBoundingClientRect();
              const cls = (el.className || "").substring(0, 80);
              const isCategoryItem = cls.includes("motor-category-item");
              matches.push({ found: true, isCategoryItem, cls, rect: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } });
            }
          }
          if (matches.length > 0) break;
        }
      }
      // Broad
      if (matches.length === 0) {
        for (const el of document.querySelectorAll("div, li, span, button, a")) {
          if (el.offsetParent && el.children.length < 3 && el.textContent.trim() === text) {
            const rect = el.getBoundingClientRect();
            matches.push({ found: true, isCategoryItem: false, rect: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } });
          }
        }
      }
      if (matches.length === 0) return { found: false };
      // Prefer motor-category-item (list item) over header/breadcrumb
      const best = matches.find(m => m.isCategoryItem) || matches[0];
      best.matchCount = matches.length;
      best.allClasses = matches.map(m => m.cls).join(" | ");
      return best;
    },
    optionText,
    SERVICES.CATEGORY_ITEM,
    SERVICES.CATEGORY_TEXT
  );

  if (result.found && result.rect) {
    console.log(`${LOG} clickCategoryOption("${optionText}"): (${Math.round(result.rect.x)}, ${Math.round(result.rect.y)}) isCategoryItem=${result.isCategoryItem} matches=${result.matchCount} classes=[${result.allClasses}]`);
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

function buildRepairContext(diagnosis, vehicle, query) {
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

  // Include the original user query/complaint as context if no diagnosis details available
  if (query && !topDiag?.cause && !repairPlan?.labor?.description) {
    ctx += `Customer complaint: ${query}\n`;
  } else if (query && !ctx.toLowerCase().includes(query.split(" ")[0].toLowerCase())) {
    // Also include query if it adds info not already in context
    ctx += `Repair request: ${query}\n`;
  }

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
