/**
 * Local Proxy Server
 *
 * Runs a local proxy on 127.0.0.1:8888 that forwards to the
 * residential proxy with authentication. Chrome can use this
 * local proxy without needing to handle auth itself.
 *
 * Usage: node scripts/proxy-server.js
 */

const fs = require("fs");
const path = require("path");
const ProxyChain = require("proxy-chain");

// Load env
const envPath = path.join(__dirname, "../config/.env");
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx);
    const val = trimmed.slice(eqIdx + 1);
    if (!process.env[key]) process.env[key] = val;
  }
}

const LOG = "[proxy-server]";
const LOCAL_PORT = 8888;

const PROXY_HOST = process.env.PROXY_HOST;
const PROXY_PORT = process.env.PROXY_PORT;
const PROXY_USER = process.env.PROXY_USER;
const PROXY_PASS = process.env.PROXY_PASS;

if (!PROXY_HOST || !PROXY_PORT || !PROXY_USER || !PROXY_PASS) {
  console.error(`${LOG} ERROR: Missing PROXY_* env vars`);
  console.error(`${LOG} Required: PROXY_HOST, PROXY_PORT, PROXY_USER, PROXY_PASS`);
  process.exit(1);
}

const upstreamUrl = `http://${PROXY_USER}:${PROXY_PASS}@${PROXY_HOST}:${PROXY_PORT}`;

async function main() {
  const server = new ProxyChain.Server({
    port: LOCAL_PORT,
    prepareRequestFunction: () => {
      return {
        upstreamProxyUrl: upstreamUrl,
      };
    },
  });

  await server.listen();
  console.log(`${LOG} Local proxy running on http://127.0.0.1:${LOCAL_PORT}`);
  console.log(`${LOG} Forwarding to ${PROXY_HOST}:${PROXY_PORT}`);
  console.log(`${LOG} Chrome can use: --proxy-server=http://127.0.0.1:${LOCAL_PORT}`);
}

main().catch((err) => {
  console.error(`${LOG} Fatal error:`, err);
  process.exit(1);
});
