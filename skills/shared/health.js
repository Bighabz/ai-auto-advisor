"use strict";

const net = require("net");
const os = require("os");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const CHROME_CDP_PORT = parseInt(process.env.CHROME_DEBUG_PORT, 10) || 18800;
const ARTIFACTS_DIR = path.join(os.tmpdir(), "sam-artifacts");
const SCREENSHOTS_DIR = path.join(os.homedir(), ".openclaw", "media", "browser");
const ARTIFACT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_SCREENSHOTS = 50;

const startTime = Date.now();

function checkPort(port) {
  return new Promise((resolve) => {
    const sock = net.createConnection({ host: "127.0.0.1", port }, () => {
      sock.destroy();
      resolve(true);
    });
    sock.on("error", () => resolve(false));
    sock.setTimeout(3000, () => { sock.destroy(); resolve(false); });
  });
}

function isProcessRunning(name) {
  try {
    const cmd = process.platform === "win32"
      ? `tasklist /FI "IMAGENAME eq ${name}" /NH`
      : `pgrep -f "${name}" 2>/dev/null`;
    const result = execSync(cmd, { timeout: 5000, encoding: "utf8" });
    return result.trim().length > 0;
  } catch {
    return false;
  }
}

function getDiskFreeMb() {
  try {
    if (process.platform === "win32") {
      return 999999;
    }
    const result = execSync("df -m / | tail -1 | awk '{print $4}'", { timeout: 5000, encoding: "utf8" });
    return parseInt(result.trim(), 10) || 0;
  } catch {
    return -1;
  }
}

async function checkHealth() {
  const chrome = isProcessRunning("chrome") || isProcessRunning("chromium");
  const cdp = await checkPort(CHROME_CDP_PORT);
  const disk_free_mb = getDiskFreeMb();
  const uptime_s = Math.round((Date.now() - startTime) / 1000);
  return {
    chrome,
    cdp,
    disk_free_mb,
    uptime_s,
    disk_warning: disk_free_mb > 0 && disk_free_mb < 500,
    timestamp: new Date().toISOString(),
  };
}

function cleanupArtifacts(opts = {}) {
  const dryRun = opts.dryRun ?? false;
  let artifactsRemoved = 0;
  let screenshotsRemoved = 0;

  if (fs.existsSync(ARTIFACTS_DIR)) {
    const cutoff = Date.now() - ARTIFACT_MAX_AGE_MS;
    try {
      const entries = fs.readdirSync(ARTIFACTS_DIR);
      for (const entry of entries) {
        const full = path.join(ARTIFACTS_DIR, entry);
        try {
          const stat = fs.statSync(full);
          if (stat.mtimeMs < cutoff) {
            if (!dryRun) {
              fs.rmSync(full, { recursive: true, force: true });
            }
            artifactsRemoved++;
          }
        } catch {}
      }
    } catch {}
  }

  if (fs.existsSync(SCREENSHOTS_DIR)) {
    try {
      const files = fs.readdirSync(SCREENSHOTS_DIR)
        .map((f) => ({ name: f, path: path.join(SCREENSHOTS_DIR, f) }))
        .filter((f) => {
          try { return fs.statSync(f.path).isFile(); } catch { return false; }
        })
        .sort((a, b) => {
          try {
            return fs.statSync(b.path).mtimeMs - fs.statSync(a.path).mtimeMs;
          } catch { return 0; }
        });

      if (files.length > MAX_SCREENSHOTS) {
        const toRemove = files.slice(MAX_SCREENSHOTS);
        for (const f of toRemove) {
          if (!dryRun) {
            try { fs.unlinkSync(f.path); } catch {}
          }
          screenshotsRemoved++;
        }
      }
    } catch {}
  }

  return { artifacts: artifactsRemoved, screenshots: screenshotsRemoved };
}

function validateEnv(required) {
  const missing = [];
  for (const key of required) {
    if (!process.env[key]) missing.push(key);
  }
  return { valid: missing.length === 0, missing };
}

module.exports = { checkHealth, cleanupArtifacts, validateEnv };
