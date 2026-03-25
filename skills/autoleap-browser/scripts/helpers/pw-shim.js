/**
 * Playwright-to-Puppeteer Compatibility Shim
 *
 * Wraps Playwright's CDP connection to match Puppeteer's API surface,
 * so existing motor-nav.js, pt-tab.js, and playbook code works unchanged.
 *
 * Key translations:
 *   - page.evaluate(fn, arg1, arg2, ...) → multi-arg support via array wrapping
 *   - page.waitForFunction(fn, opts, ...args) → Puppeteer arg order
 *   - page.goto(..., { waitUntil: 'networkidle0' }) → 'networkidle'
 *   - browser.pages() / browser.newPage() / browser.disconnect()
 *   - browser.once('targetcreated', cb) → context.once('page', cb)
 */

const { chromium } = require("playwright-core");

const LOG = "[pw-shim]";

/**
 * Connect to Chrome via CDP and return a Puppeteer-compatible wrapper.
 *
 * @param {{ browserURL: string, defaultViewport?: { width: number, height: number } }} opts
 * @returns {Promise<object>} Puppeteer-compatible browser object
 */
async function connect({ browserURL, defaultViewport }) {
  console.log(`${LOG} Connecting to Chrome via CDP: ${browserURL}`);
  const browser = await chromium.connectOverCDP(browserURL);
  const context = browser.contexts()[0];
  if (!context) throw new Error("No browser context found after CDP connect");

  console.log(`${LOG} Connected — ${context.pages().length} existing page(s)`);

  /** Wrap a Playwright page to behave like a Puppeteer page */
  function wrapPage(page) {
    if (page.__pwShimWrapped) return page;
    page.__pwShimWrapped = true;

    // Handle JavaScript dialogs (alert/confirm/prompt) to prevent crashes.
    // Playwright auto-detects dialogs and crashes if not handled.
    page.on("dialog", async (dialog) => {
      try {
        console.log(`${LOG} Auto-dismissing dialog: ${dialog.type()} "${dialog.message().substring(0, 60)}"`);
        await dialog.accept();
      } catch {
        // Dialog already dismissed — ignore
      }
    });

    // Set viewport if requested
    if (defaultViewport) {
      page.setViewportSize(defaultViewport).catch(() => {});
    }

    // ── page.evaluate: support multi-arg calls ──
    const origEval = page.evaluate.bind(page);
    page.evaluate = async function (fn, ...args) {
      if (typeof fn === "string") return origEval(fn);
      if (args.length === 0) return origEval(fn);
      if (args.length === 1) return origEval(fn, args[0]);
      // Multi-arg: wrap fn to accept a single array arg and spread it
      const wrapper = new Function(
        "__a__",
        `return (${fn.toString()})(...__a__)`
      );
      return origEval(wrapper, args);
    };

    // ── page.waitForFunction: Puppeteer arg order ──
    // Puppeteer: waitForFunction(fn, options, ...args)
    // Playwright: waitForFunction(fn, arg, options)
    const origWFF = page.waitForFunction.bind(page);
    page.waitForFunction = async function (fn, optsOrArg, ...rest) {
      if (
        optsOrArg &&
        typeof optsOrArg === "object" &&
        (optsOrArg.timeout !== undefined || optsOrArg.polling !== undefined)
      ) {
        // Puppeteer-style: second arg is options
        if (rest.length === 0) {
          return origWFF(fn, undefined, optsOrArg);
        } else if (rest.length === 1) {
          return origWFF(fn, rest[0], optsOrArg);
        } else {
          const wrapper = new Function(
            "__a__",
            `return (${fn.toString()})(...__a__)`
          );
          return origWFF(wrapper, rest, optsOrArg);
        }
      }
      // Already Playwright-style or no options
      return origWFF(fn, optsOrArg, rest[0]);
    };

    // ── page.goto: translate waitUntil values ──
    const origGoto = page.goto.bind(page);
    page.goto = async function (url, opts = {}) {
      const pwOpts = { ...opts };
      if (
        pwOpts.waitUntil === "networkidle0" ||
        pwOpts.waitUntil === "networkidle2"
      ) {
        pwOpts.waitUntil = "networkidle";
      }
      return origGoto(url, pwOpts);
    };

    // ── page.waitForResponse: same API, no change needed ──
    // ── page.mouse / page.keyboard / page.screenshot / page.pdf: same API ──

    return page;
  }

  // ── browser wrapper: Puppeteer-compatible surface ──
  const wrapper = {
    pages: () => context.pages().map(wrapPage),

    newPage: async () => wrapPage(await context.newPage()),

    disconnect: () => {
      console.log(`${LOG} Disconnecting...`);
      return browser.close();
    },

    close: () => browser.close(),

    once: (event, cb) => {
      if (event === "targetcreated") {
        context.once("page", async (page) => {
          cb({ page: () => Promise.resolve(wrapPage(page)) });
        });
      }
    },

    on: (event, cb) => {
      if (event === "targetcreated") {
        context.on("page", async (page) => {
          cb({ page: () => Promise.resolve(wrapPage(page)) });
        });
      }
    },

    // Expose originals for advanced usage
    _browser: browser,
    _context: context,
    _wrapPage: wrapPage,
  };

  return wrapper;
}

module.exports = { connect };
