"use strict";

const net = require("net");

const CHROME_CDP_PORT = parseInt(process.env.CHROME_DEBUG_PORT, 10) || 18800;

function checkCDP() {
  return new Promise((resolve) => {
    const sock = net.createConnection({ host: "127.0.0.1", port: CHROME_CDP_PORT }, () => {
      sock.destroy();
      resolve(true);
    });
    sock.on("error", () => resolve(false));
    sock.setTimeout(3000, () => { sock.destroy(); resolve(false); });
  });
}

class SessionManager {
  constructor({ logger }) {
    this.log = logger || { info() {}, warn() {}, error() {}, step() { return () => {}; } };
    this.platforms = {
      autoleap: { enabled: !!process.env.AUTOLEAP_EMAIL },
      partstech: { enabled: !!process.env.PARTSTECH_USERNAME },
      prodemand: { enabled: !!process.env.PRODEMAND_USERNAME },
    };
  }

  async checkAuth(platform) {
    const config = this.platforms[platform];
    if (!config) {
      return { authenticated: false, reason_code: "PLATFORM_NOT_CONFIGURED" };
    }
    if (!config.enabled) {
      return { authenticated: false, reason_code: "PLATFORM_DISABLED" };
    }
    try {
      switch (platform) {
        case "autoleap":
          return await this._checkAutoLeap();
        case "partstech":
          return await this._checkPartsTech();
        case "prodemand":
          return await this._checkProDemand();
        default:
          return { authenticated: false, reason_code: "PLATFORM_NOT_CONFIGURED" };
      }
    } catch (err) {
      return { authenticated: false, reason_code: "CHECK_ERROR", error: err.message };
    }
  }

  async healAuth(platform) {
    const config = this.platforms[platform];
    if (!config || !config.enabled) {
      return { success: false, reason_code: config ? "PLATFORM_DISABLED" : "PLATFORM_NOT_CONFIGURED" };
    }
    try {
      switch (platform) {
        case "autoleap":
          return await this._healAutoLeap();
        case "partstech":
          return await this._healPartsTech();
        case "prodemand":
          return await this._healProDemand();
        default:
          return { success: false, reason_code: "PLATFORM_NOT_CONFIGURED" };
      }
    } catch (err) {
      return { success: false, reason_code: "HEAL_ERROR", error: err.message };
    }
  }

  async preflight() {
    const cdpAlive = await checkCDP();
    const status = { cdp: cdpAlive };
    for (const [name, config] of Object.entries(this.platforms)) {
      if (!config.enabled) {
        status[name] = { authenticated: false, reason_code: "PLATFORM_DISABLED" };
        continue;
      }
      if (!cdpAlive && name !== "autoleap") {
        status[name] = { authenticated: false, reason_code: "CDP_UNREACHABLE" };
        continue;
      }
      const check = await this.checkAuth(name);
      if (check.authenticated) {
        status[name] = check;
        continue;
      }
      this.log.warn(`${name} auth failed (${check.reason_code}), attempting heal`);
      const heal = await this.healAuth(name);
      status[name] = {
        authenticated: heal.success,
        reason_code: heal.success ? "HEALED" : heal.reason_code,
        healed: heal.success,
      };
    }
    this.log.info("preflight complete", status);
    return status;
  }

  async _checkAutoLeap() {
    const fs = require("fs");
    const os = require("os");
    const path = require("path");
    const tokenPath = path.join(os.tmpdir(), "autoleap-token.json");
    try {
      const data = JSON.parse(fs.readFileSync(tokenPath, "utf8"));
      const expiresAt = data.expiresAt || 0;
      if (Date.now() < expiresAt - 5 * 60 * 1000) {
        return { authenticated: true, reason_code: null, token_source: "cache" };
      }
      return { authenticated: false, reason_code: "TOKEN_EXPIRED" };
    } catch {
      return { authenticated: false, reason_code: "NO_TOKEN_CACHE" };
    }
  }

  async _checkPartsTech() {
    return { authenticated: false, reason_code: "NEEDS_BROWSER_CHECK" };
  }

  async _checkProDemand() {
    return { authenticated: false, reason_code: "NEEDS_BROWSER_CHECK" };
  }

  async _healAutoLeap() {
    return { success: false, reason_code: "HEAL_NOT_WIRED" };
  }

  async _healPartsTech() {
    return { success: false, reason_code: "HEAL_NOT_WIRED" };
  }

  async _healProDemand() {
    return { success: false, reason_code: "HEAL_NOT_WIRED" };
  }
}

module.exports = { SessionManager, checkCDP };
