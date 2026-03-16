# Technology Stack

**Project:** SAM — Conversational AI Layer, Queue System, Multi-Platform Messaging
**Researched:** 2026-03-15
**Milestone scope:** Adding conversational AI state, a serial job queue, unified multi-platform messaging, and graceful error handling on top of the existing estimate pipeline.

---

## Decision Context

The existing system is CommonJS, Node.js 22, no web framework, single shared Chrome on a Raspberry Pi 4. The new layer must NOT break those constraints. The key architectural pressures are:

- **Single Chrome instance** — a second concurrent estimate run will corrupt AutoLeap state. The queue must be strictly serial (concurrency = 1).
- **10-20 minute pipeline runs** — users need progress updates or they assume it's broken.
- **Multi-turn conversation state** — the bot must remember what it asked and what the user answered within a session (e.g., collecting name + phone before running the pipeline).
- **Graceful degradation** — ProDemand, PartsTech, AutoLeap each can fail independently. The bot must deliver partial results with explanatory warnings rather than a dead response.
- **CommonJS throughout** — ESM-only packages require workarounds. Node.js 22.12+ unflagged `require(esm)` means native ESM packages can now be required synchronously on the existing Node version, but this should be treated as a fallback, not a first choice.

---

## Recommended Stack

### Conversational AI: Model Upgrade

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `@anthropic-ai/sdk` | `0.78.0` (current) | Claude API client | Already installed on Pi/VPS outside package.json |
| `claude-sonnet-4-6` | latest alias | Primary routing + conversation | Replaces `claude-sonnet-4-5-20250929`. Sonnet 4.6 is the current production model, same price ($3/$15 per MTok), preferred by developers over 4.5. Model ID: `claude-sonnet-4-6`. |
| `claude-haiku-4-5-20251001` | pinned snapshot | Fast classification calls | Cheap ($1/$5 per MTok), 200k context, fast. Use for intent detection (estimate vs general chat), slot filling classification. Replaces `claude-3-haiku-20240307` which is deprecated April 19, 2026. |

**Confidence: HIGH** — Verified against official Anthropic model docs (platform.claude.com/docs/en/about-claude/models/overview, fetched 2026-03-15).

**What NOT to use:** `claude-3-haiku-20240307` — deprecated, retires April 19, 2026. Stop using it before that date.

### Conversation State: In-Process Map with TTL

**Recommendation: Hand-rolled session store (no new dependency)**

A `Map<userId, sessionState>` keyed by platform-specific user ID (Telegram chat ID, WhatsApp `From` number). Each entry holds:

```js
{
  messages: [],          // Claude messages array (full history for stateless API)
  stage: "idle",         // "idle" | "collecting_info" | "queued" | "running" | "done"
  collectedData: {},     // name, phone, vehicle, complaint as they're collected
  lastActivity: Date.now(),
  platform: "telegram"   // for reply routing
}
```

TTL cleanup: `setInterval` every 30 minutes, evict sessions where `Date.now() - lastActivity > 4 * 60 * 60 * 1000` (4 hours). This prevents memory accumulation on a Pi with limited RAM.

**Why not a library:** node-cache (v5.1.2) works fine but adds a dependency for a 20-line pattern. The Raspberry Pi has limited RAM — keep the footprint minimal. The Claude Messages API requires passing the full `messages` array on each call; a plain Map is the most direct structure for that.

**Why not LangChain/LangGraph:** Heavyweight, opinionated, introduces ESM complications. The existing orchestrator already implements the routing logic Claude needs. LangChain would add 50+ MB of dependencies to solve a problem that a 30-line session module solves.

**Confidence: HIGH** — Node.js 22 Map is stable. Pattern verified across multiple sources. Claude API statelessness confirmed in official docs.

### Job Queue: `p-queue` (CJS fork)

| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| `@esm2cjs/p-queue` | `9.x` compat | Serial estimate queue (concurrency=1) | Pure in-process, no Redis, no daemon. Single worker on Pi. ESM-to-CJS fork is the correct CommonJS path. |

**Why p-queue over alternatives:**

- **BullMQ** requires Redis. Running Redis on a Raspberry Pi 4 adds ~50-100 MB RAM overhead and another service to manage. The queue only needs to hold 2-5 jobs at a time (shop staff, not thousands of users). Redis is overkill.
- **fastq** (v1.20.1) is a lean in-memory queue but lacks built-in queue-size inspection, pause/resume, and idle events that are useful for sending "you're #2 in queue" status messages.
- **Custom Promise chain** is viable but you lose pause/resume, size inspection, and the `onIdle()` hook.
- **p-queue** (v9.1.0) has exactly the features needed: `{concurrency: 1}`, `queue.size` for position reporting, `queue.pause()` / `queue.resume()`, and `queue.onIdle()`. It is native ESM but the `@esm2cjs/p-queue` fork provides a CommonJS export. Node.js 22.12+ also allows `require(esm)` natively, so either approach works.

**Installation:**
```bash
npm install @esm2cjs/p-queue
```

**Usage pattern:**
```js
const PQueue = require("@esm2cjs/p-queue").default;
const queue = new PQueue({ concurrency: 1 });

// Add an estimate job
queue.add(async () => {
  await notifyPosition(userId, queue.size);
  return runOrchestrator(jobParams);
});
```

**Confidence: MEDIUM** — `@esm2cjs/p-queue` is a maintained fork; npm confirms it exists and provides CJS. Alternative: use Node.js 22 native `require(esm)` with the original `p-queue@9.1.0` — confirmed unflagged in Node.js 22.12+ (which matches the running version v22.16.0).

### Multi-Platform Messaging: Adapter Layer (No New Framework)

**Recommendation: Hand-rolled adapter module, NOT a third-party unification library**

The system already has a Telegram gateway (long-polling) and a WhatsApp gateway (Twilio webhook on port 3000). The right move is a thin `platform-adapter.js` that normalizes inbound messages and outbound `send()` calls into a shared interface:

```js
// Inbound normalized event
{ platform, userId, text, rawEvent }

// Outbound interface
adapter.send(userId, text, { platform, parseMode? })
adapter.sendDocument(userId, filePath, { platform })
adapter.editMessage(userId, messageId, text, { platform })  // progress editing
```

Each platform registers itself. The conversation manager calls `adapter.send()` — it never knows which platform it's talking to.

**Why NOT a unification SaaS (Vonage, Unipile, Sent.dm):** These are cloud APIs that route your messages through their servers. For a single-shop Pi installation, a third-party dependency that costs money and introduces a network hop is wrong. The shop is already paying for Twilio. Adding another gateway layer adds failure modes.

**Why NOT Telegraf or grammY:** These are full Telegram bot frameworks. The existing Telegram gateway is a 200-line file that works correctly. Replacing it mid-milestone adds migration risk for zero functional gain. Telegraf v4 has complex TypeScript types that are incompatible with the CJS/no-TS codebase. grammY is ESM-native. Neither adds anything the existing gateway doesn't already do.

**Twilio SDK (optional):** The existing WhatsApp gateway calls Twilio REST directly via `node-fetch`. Adding `twilio` npm package (v5.13.0) is optional — it simplifies outbound message sending (no manual auth header construction) but adds a 10 MB dependency. Verdict: add it only if sending MMS/media via WhatsApp becomes a requirement. For text replies, the existing raw REST approach is fine.

**Confidence: HIGH** — Adapter pattern is standard; no library verification needed. Twilio version confirmed via npm.

### HTTP Server: Express (upgrade from raw `http`)

| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| `express` | `^4.21.x` | WhatsApp webhook server | Replaces raw `http` module in `skills/whatsapp-gateway/scripts/server.js` |

**Why Express over the raw `http` module:** The existing webhook server manually parses query strings and bodies. Express adds body parsing middleware (`express.urlencoded`, `express.json`) and route matching in ~3 lines. The existing server is brittle — Twilio sends `application/x-www-form-urlencoded` and the manual parser has been the source of past bugs.

**Why NOT Fastify:** Fastify is 20-30% faster at high throughput, but this server handles 5-10 requests per day from one shop. Fastify's performance advantage is irrelevant. Express has zero migration risk, is CommonJS-native, and every Node.js developer knows it. Fastify's schema validation adds setup complexity for no benefit here.

**Express v4 vs v5:** Express v5 (released October 2024) is now stable and the current recommended version, but v4 continues to receive security patches. Either works. Start with v4 to avoid the `path-to-regexp` breaking changes in v5 — the existing code has no complex route params, so upgrading to v5 later is trivial.

```bash
npm install express
```

**Confidence: HIGH** — Express v4/v5 stability is well-established. Version confirmed via npm ecosystem.

### Error Resilience: `opossum` Circuit Breaker

| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| `opossum` | `^9.0.0` | Circuit breaker for browser automation calls | Opens circuit after N failures, provides fallback, auto-resets |

**Why opossum over cockatiel:**

- `opossum` v9.0.0 is the current release. It is CommonJS-compatible (`require("opossum")` works directly). Maintained by Red Hat/NodeShift with strong long-term support signals.
- `cockatiel` v3.2.1 is a well-designed TypeScript-first library but its CommonJS compatibility is less tested in the community; opossum has far more real-world production usage in Node.js environments.
- `opossum` has built-in `timeout` option, `fallback()` registration, `halfOpen` state (tries one request after resetTimeout), and `errorThresholdPercentage`. This maps directly to the browser automation failure modes: ProDemand login timeout, PartsTech SSO failure, AutoLeap navigation hang.

**Usage pattern for browser skills:**
```js
const CircuitBreaker = require("opossum");

const prodemandBreaker = new CircuitBreaker(runProdemandSearch, {
  timeout: 75000,                  // matches existing PRODEMAND_TIMEOUT
  errorThresholdPercentage: 50,    // open after 50% failure rate
  resetTimeout: 120000,            // try again after 2 min
  volumeThreshold: 2               // need at least 2 calls before opening
});
prodemandBreaker.fallback(() => ({ error: "ProDemand unavailable, degrading gracefully" }));
```

**Confidence: HIGH** — opossum v9.0.0 confirmed via npm. CommonJS compatibility confirmed. Red Hat maintainership confirmed via GitHub.

**What NOT to use:** Writing manual retry loops with `setTimeout`. These accumulate in the event loop, don't track failure rates, and have no automatic recovery. Every browser skill currently does some version of this — opossum replaces it uniformly.

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Job Queue | `@esm2cjs/p-queue` | BullMQ | BullMQ requires Redis daemon; overkill for 1-5 concurrent jobs on Pi |
| Job Queue | `@esm2cjs/p-queue` | fastq | Missing queue-size inspection and pause/resume needed for status messages |
| Circuit Breaker | opossum | cockatiel | Less CJS adoption in community; opossum better documented for Node.js |
| Telegram Gateway | Existing raw long-poll | Telegraf / grammY | Framework migration risk; existing gateway works; Telegraf CJS issues, grammY is ESM |
| Messaging Unification | Hand-rolled adapter | Vonage/Unipile/Sent.dm | Cloud dependency, adds cost, extra failure point for single-shop Pi install |
| HTTP Server | express | fastify | 5-10 req/day doesn't benefit from Fastify's throughput advantage; Express CJS is simpler |
| Conversation State | In-process Map | Redis-backed session | Redis overhead on Pi; conversation sessions are tied to single-process server lifecycle anyway |
| Model | claude-sonnet-4-6 | claude-sonnet-4-5-20250929 | 4.5 is legacy; 4.6 is current, same price, better instruction following |
| Fast model | claude-haiku-4-5-20251001 | claude-3-haiku-20240307 | 3-haiku deprecated April 19, 2026 — must migrate before retirement |

---

## Module/ESM Notes

The codebase is CommonJS. Node.js 22.16.0 (running version on Pi and VPS) has `require(esm)` unflagged as of Node.js 22.12.0. This means:

- `p-queue@9.1.0` (native ESM) can be `require()`'d directly on Node.js 22.16.0 **without the `@esm2cjs` fork**.
- `node-fetch@3` (already used via dynamic import) could be `require()`'d too — but dynamic import is already working, so don't change it.
- **Decision:** Use `@esm2cjs/p-queue` for explicitness. The CJS fork makes the intent clear to future maintainers and avoids relying on an "unflagged experimental" label even though it's now stable.

**Confidence: HIGH** — Node.js 22.12.0 changelog confirms `require(esm)` unflagged. Running version 22.16.0 exceeds this. Verified via multiple sources.

---

## Installation Summary

```bash
# Add to package.json (core new deps)
npm install express @esm2cjs/p-queue opossum

# Already installed outside package.json on Pi/VPS — add to package.json
npm install @anthropic-ai/sdk puppeteer-core

# Optional: only if outbound Twilio media messages needed
npm install twilio
```

**No new dev dependencies required** — the existing no-build, no-TS, no-linter setup is preserved.

---

## Model IDs Reference (verified 2026-03-15)

| Use | Model ID | Cost (in/out per MTok) | Notes |
|-----|----------|------------------------|-------|
| Main routing + conversation | `claude-sonnet-4-6` | $3 / $15 | Current production model |
| Fast classification | `claude-haiku-4-5-20251001` | $1 / $5 | Replaces deprecated 3-haiku |
| (Legacy, do not use) | `claude-sonnet-4-5-20250929` | $3 / $15 | Still works, but superseded |
| (DEPRECATED) | `claude-3-haiku-20240307` | $0.25 / $1.25 | Retires April 19, 2026 |

Source: platform.claude.com/docs/en/about-claude/models/overview (fetched 2026-03-15)

---

## Sources

- Anthropic Models Overview (fetched 2026-03-15): https://platform.claude.com/docs/en/about-claude/models/overview
- BullMQ docs: https://docs.bullmq.io/
- opossum GitHub: https://github.com/nodeshift/opossum
- p-queue GitHub: https://github.com/sindresorhus/p-queue
- @esm2cjs/p-queue npm: https://www.npmjs.com/package/@esm2cjs/p-queue
- Node.js 22 require(esm) stability: https://joyeecheung.github.io/blog/2025/12/30/require-esm-in-node-js-from-experiment-to-stability/
- Node.js 22 LTS with require(esm): https://socket.dev/blog/node-js-delivers-first-lts-with-require-esm-enabled
- fastq GitHub: https://github.com/mcollina/fastq
- Opossum circuit breaker pattern: https://developers.redhat.com/blog/2021/04/15/fail-fast-with-opossum-circuit-breaker-in-node-js
- Twilio Node.js SDK npm: https://www.npmjs.com/package/twilio
- Claude Sonnet 4.6 announcement: https://www.anthropic.com/news/claude-sonnet-4-6
- grammY vs Telegraf comparison: https://grammy.dev/resources/comparison
- Express vs Fastify 2025: https://betterstack.com/community/guides/scaling-nodejs/fastify-express/

---

*Researched: 2026-03-15 | Confidence: HIGH (stack choices), MEDIUM (p-queue CJS fork longevity)*
