# Phase 1: Queue and Session Foundation - Research

**Researched:** 2026-03-15
**Domain:** Node.js in-process job queue, Supabase session persistence, Claude model migration
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Persist sessions to Supabase (already configured — `@supabase/supabase-js` in package.json)
- Key scheme: `platform:chatId` composite (e.g. `telegram:1385723011`, `whatsapp:+13105551234`)
- Store: last estimate result (autoLeapEstimate IDs, totals, RO#), conversation stage, collected customer data
- 24-hour TTL with cleanup sweep on startup and periodic interval
- Fall back to in-memory Map if Supabase is unreachable (graceful degradation)
- In-memory FIFO with `p-queue` (concurrency: 1) — no Redis
- ESM import via Node.js 22 native `require(esm)` or `@esm2cjs/p-queue` fork
- EventEmitter for progress/completion/error events consumed by gateways
- Position reporting: when queued, tell user their position and rough wait (~15 min per job)
- If user sends another message while their job is queued, acknowledge without re-queuing
- Replace all hardcoded model strings with env var lookups: `process.env.CLAUDE_SONNET_MODEL || "claude-sonnet-4-6"` and `process.env.CLAUDE_HAIKU_MODEL || "claude-haiku-4-5-20251001"`
- Three files to update: `server.js`, `diagnose.js`, `motor-nav.js`

### Claude's Discretion
- Exact Supabase table schema for sessions
- p-queue vs hand-rolled Promise queue (whichever integrates cleaner with CommonJS)
- EventEmitter event names and payload shapes
- Session cleanup interval timing
- SIGTERM handler implementation for graceful shutdown

### Deferred Ideas (OUT OF SCOPE)
- None — discussion stayed within phase scope
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| QUEUE-01 | Estimate requests serialized — only one pipeline runs at a time | p-queue concurrency:1 guarantees serial execution; wrap `buildEstimate()` call at line 311 of telegram server.js |
| QUEUE-02 | When request arrives during active pipeline, user gets position + estimated wait | `queue.size` gives pending count; send message before `queue.add()` returns; ~15 min per job |
| QUEUE-03 | Queued requests auto-start when previous pipeline completes | p-queue auto-drains; no manual trigger needed — next job starts immediately on completion |
| QUEUE-04 | User can check status of their queued/running request mid-pipeline | Queue module tracks `activeJobs` Map keyed by `platform:chatId`; status query checks this map |
| SESS-01 | Conversation history and estimate results persist across Pi/service restarts | Supabase `sam_sessions` table; JSONB columns for history and last_estimate; read on startup per chatId |
| SESS-02 | "Delete that estimate" and "order parts" work after service restart | `sessions.get(chatId)` must load from Supabase before each command lookup; session-store module wraps Map with async hydration |
| SESS-03 | Sessions expire after 24 hours of inactivity | `updated_at` column + `WHERE updated_at < now() - interval '24 hours'` DELETE in cleanup sweep |
| MODEL-01 | Gateway Claude calls upgraded from deprecated claude-3-haiku-20240307 | server.js line 219: `"claude-sonnet-4-5-20250929"` → `process.env.CLAUDE_SONNET_MODEL \|\| "claude-sonnet-4-6"` |
| MODEL-02 | diagnose.js Claude calls upgraded from deprecated model | diagnose.js line 34: `CLAUDE_MODEL = "claude-sonnet-4-5-20250929"` → env var with `claude-sonnet-4-6` default |
| MODEL-03 | MOTOR category selection Claude calls upgraded from deprecated model | motor-nav.js line 1288: `"claude-haiku-4-5-20251001"` already correct — needs env var wrapper only |
</phase_requirements>

---

## Summary

Phase 1 is three independent, non-overlapping workstreams: (1) serial job queue around `buildEstimate()`, (2) Supabase-backed session persistence replacing in-memory Maps, and (3) a one-line-per-file model ID migration. None of these workstreams touch each other's code paths — they can be planned as separate tasks and executed in any order.

The queue is the highest-risk item because it wraps the hottest code path (the 60-second estimate pipeline) and must integrate with both the Telegram and WhatsApp gateways without breaking the existing `handleMessage` → `handleToolCall` → `buildEstimate` flow. The session store is the most architecturally invasive because it makes every `sessions.get(chatId)` call asynchronous, which cascades through `handleToolCall` and `processMessage`. The model migration is purely mechanical — three files, one-line change each.

The codebase is CommonJS, Node.js 22.16.0. Both `p-queue` (native ESM, v9.1.0) and `@esm2cjs/p-queue` are not yet installed. Node.js 22.12+ supports `require(esm)` natively without a flag, meaning native `p-queue` can be required directly. The `@esm2cjs/p-queue` fork is still the safer documentation-friendly choice. Neither is installed — install is required on Pi.

**Primary recommendation:** Create three new modules — `skills/shared/job-queue.js`, `skills/shared/session-store.js`, and a `config/.env` update — then wire them into both gateways. Do not modify the orchestrator.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@esm2cjs/p-queue` | 9.x compat | Serial job queue, concurrency:1 | CJS-explicit fork of the ecosystem standard; `queue.size`, `pause/resume`, `onIdle()` built in. Alternative: native `p-queue@9.1.0` via Node.js 22 `require(esm)` — also valid. |
| `@supabase/supabase-js` | ^2.95.3 (already in package.json) | Session persistence | Already installed and used throughout codebase; Supabase project `vtgjljmicmrprnexloeb` active |
| Node.js `EventEmitter` | built-in | Queue progress/completion events | Zero dependency; already used by Node.js core throughout codebase conventions |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@anthropic-ai/sdk` | 0.78.0 | Claude API client | Add to `package.json` — currently runtime-only dep; always needed |
| `puppeteer-core` | latest stable | CDP browser control | Add to `package.json` — currently runtime-only dep; always needed |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@esm2cjs/p-queue` | `p-queue@9.1.0` via `require(esm)` | Native ESM require works on Node 22.16.0 — simpler, no fork. Slightly less explicit for future maintainers. Either works. |
| `@esm2cjs/p-queue` | Hand-rolled Promise chain | Loses `queue.size` (needed for position reporting) and `onIdle()`. Not recommended. |
| `@esm2cjs/p-queue` | BullMQ | Requires Redis daemon — overkill for Pi with 2-5 simultaneous users |
| Supabase sessions | Redis sessions | Redis adds another service to manage on Pi; Supabase already pays the infra cost |

**Installation:**
```bash
# On Pi — run in /home/sam/ai-auto-advisor
npm install @esm2cjs/p-queue
npm install @anthropic-ai/sdk puppeteer-core
```

---

## Architecture Patterns

### New Module Locations
```
skills/
└── shared/
    ├── job-queue.js          # NEW — singleton queue + EventEmitter
    ├── session-store.js      # NEW — Supabase-backed sessions with in-memory fallback
    ├── session-manager.js    # EXISTING — platform auth checks (unchanged)
    ├── health.js             # EXISTING — startup cleanup (piggyback session sweep here)
    └── logger.js             # EXISTING — unchanged
```

### Pattern 1: Singleton Job Queue Module

**What:** A single exported queue instance with an EventEmitter. Both gateways import from the same module so they share one queue and one Chrome.

**When to use:** Every `buildEstimate()` call routes through this module.

```javascript
// skills/shared/job-queue.js
"use strict";

const { EventEmitter } = require("events");
const LOG = "[job-queue]";

// p-queue: either fork or native ESM via Node 22 require(esm)
let PQueue;
try {
  PQueue = require("@esm2cjs/p-queue").default;
} catch {
  // fallback: Node.js 22 native require(esm)
  const mod = require("p-queue");
  PQueue = mod.default || mod;
}

const queue = new PQueue({ concurrency: 1 });
const emitter = new EventEmitter();

// Track active and pending jobs by userId
const activeJobs = new Map();  // userId -> { status: "running"|"queued", position, startedAt }

async function enqueueEstimate(userId, jobFn, { notifyPosition } = {}) {
  const pending = queue.size;   // jobs already waiting (not counting the one about to run)
  const position = pending + 1; // this job's place in line

  if (activeJobs.has(userId)) {
    // User already has a job in the queue — don't double-enqueue
    return { alreadyQueued: true, position: activeJobs.get(userId).position };
  }

  activeJobs.set(userId, { status: "queued", position, queuedAt: Date.now() });

  if (pending > 0 && notifyPosition) {
    // Tell the user they're in line before we even add to queue
    await notifyPosition(position, pending * 15);  // ~15 min per job
  }

  return queue.add(async () => {
    activeJobs.set(userId, { status: "running", startedAt: Date.now() });
    emitter.emit("job:start", { userId });
    try {
      const result = await jobFn();
      emitter.emit("job:complete", { userId, result });
      return result;
    } catch (err) {
      emitter.emit("job:error", { userId, error: err });
      throw err;
    } finally {
      activeJobs.delete(userId);
    }
  });
}

function getStatus(userId) {
  return activeJobs.get(userId) || null;
}

module.exports = { enqueueEstimate, getStatus, emitter, queue };
```

**Key design decisions:**
- `queue.size` counts jobs *waiting* (not the running one). Position = `queue.size + 1` before `queue.add()`.
- The `notifyPosition` callback is called BEFORE `queue.add()` so the user gets the message immediately, not after waiting for the queue slot.
- `activeJobs` Map prevents double-enqueueing from the same user sending a second message mid-queue.

### Pattern 2: Supabase Session Store with In-Memory Fallback

**What:** A module that wraps session read/write with Supabase persistence. Falls back to in-memory Map if Supabase is unreachable.

**When to use:** Replace direct `sessions.get/set/delete` calls in both gateway servers.

```javascript
// skills/shared/session-store.js
"use strict";

const { createClient } = require("@supabase/supabase-js");
const LOG = "[session-store]";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
const TABLE = "sam_sessions";
const TTL_MS = 24 * 60 * 60 * 1000;  // 24 hours

let supabase = null;
if (SUPABASE_URL && SUPABASE_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
}

// In-memory fallback — always used for speed, Supabase is write-through
const memCache = new Map();

function makeKey(platform, chatId) {
  return `${platform}:${chatId}`;
}

async function getSession(platform, chatId) {
  const key = makeKey(platform, chatId);

  // Memory cache hit (fast path)
  if (memCache.has(key)) return memCache.get(key);

  // Load from Supabase
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from(TABLE)
        .select("*")
        .eq("session_key", key)
        .single();
      if (!error && data) {
        const session = {
          lastEstimate: data.last_estimate,
          history: data.history || [],
          stage: data.stage || "idle",
          collectedData: data.collected_data || {},
          updatedAt: data.updated_at,
        };
        memCache.set(key, session);
        return session;
      }
    } catch (err) {
      console.error(`${LOG} getSession error: ${err.message}`);
    }
  }
  return null;
}

async function setSession(platform, chatId, session) {
  const key = makeKey(platform, chatId);
  memCache.set(key, session);

  if (supabase) {
    try {
      await supabase.from(TABLE).upsert({
        session_key: key,
        platform,
        chat_id: String(chatId),
        last_estimate: session.lastEstimate || null,
        history: session.history || [],
        stage: session.stage || "idle",
        collected_data: session.collectedData || {},
        updated_at: new Date().toISOString(),
      }, { onConflict: "session_key" });
    } catch (err) {
      console.error(`${LOG} setSession error: ${err.message}`);
    }
  }
}

async function deleteSession(platform, chatId) {
  const key = makeKey(platform, chatId);
  memCache.delete(key);

  if (supabase) {
    try {
      await supabase.from(TABLE).delete().eq("session_key", key);
    } catch (err) {
      console.error(`${LOG} deleteSession error: ${err.message}`);
    }
  }
}

async function cleanupExpiredSessions() {
  if (!supabase) return { deleted: 0 };
  try {
    const cutoff = new Date(Date.now() - TTL_MS).toISOString();
    const { data, error } = await supabase
      .from(TABLE)
      .delete()
      .lt("updated_at", cutoff)
      .select("session_key");
    const deleted = data?.length || 0;
    if (deleted > 0) console.log(`${LOG} Cleaned up ${deleted} expired sessions`);
    return { deleted };
  } catch (err) {
    console.error(`${LOG} cleanup error: ${err.message}`);
    return { deleted: 0 };
  }
}

module.exports = { getSession, setSession, deleteSession, cleanupExpiredSessions, makeKey };
```

### Pattern 3: Supabase Table Schema for Sessions

**What:** A single `sam_sessions` table. JSONB for flexible payload (no schema churn as estimate results evolve).

```sql
-- Migration: sam_sessions table for cross-restart session persistence
CREATE TABLE IF NOT EXISTS sam_sessions (
  session_key   text PRIMARY KEY,          -- "telegram:1385723011", "whatsapp:+13105551234"
  platform      text NOT NULL,             -- "telegram" | "whatsapp"
  chat_id       text NOT NULL,             -- platform-native ID as string
  last_estimate jsonb,                     -- full results object from buildEstimate()
  history       jsonb DEFAULT '[]'::jsonb, -- Claude messages array
  stage         text DEFAULT 'idle',       -- "idle" | "collecting_info" | "queued" | "running" | "done"
  collected_data jsonb DEFAULT '{}'::jsonb, -- { name, phone, vehicle, complaint }
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

-- Index for TTL cleanup sweep
CREATE INDEX IF NOT EXISTS sam_sessions_updated_at_idx ON sam_sessions (updated_at);
```

**Key decisions:**
- `session_key` as PRIMARY KEY — upsert on conflict is the write pattern. No separate ID column needed.
- `last_estimate` is JSONB, not a normalized foreign key. The estimate result object is ~20KB of nested data; normalizing it would require a JOIN for every `sessions.get()` call and block evolution of the results schema.
- `history` is JSONB array (the Claude `messages` array). The gateway already caps this at `MAX_HISTORY=20` entries before writing.
- `stage` is a text field, not an enum — avoids a migration if stages are added in Phase 2.

### Pattern 4: Wiring the Queue into the Telegram Gateway

**What:** Minimal diff to `handleToolCall` — the queue wraps only the `buildEstimate()` call, not the entire `handleMessage` function.

**Current code (server.js line 311):**
```javascript
const results = await buildEstimate(params);
```

**New code pattern:**
```javascript
const { enqueueEstimate, getStatus } = require("../../shared/job-queue");

// In handleToolCall, inside the "run_estimate" branch:
const userId = `telegram:${chatId}`;
const existing = getStatus(userId);
if (existing) {
  const pos = existing.position;
  const waitMin = pos * 15;
  return { messages: [`Already building an estimate for you — you're #${pos} in queue (~${waitMin} min). I'll send results when it's your turn.`] };
}

const results = await enqueueEstimate(userId, () => buildEstimate(params), {
  notifyPosition: async (pos, waitMin) => {
    await telegramAPI("sendMessage", {
      chat_id: chatId,
      text: `Got it! You're #${pos} in queue — one estimate is running now. Yours starts in ~${waitMin} min.`,
    });
  },
});
```

**Why wrap only `buildEstimate()` and not `handleMessage()`:** The Claude `processMessage()` call is fast (< 2s). Only the 60-second pipeline needs serialization. Wrapping the whole message handler would also queue status queries and simple chat responses, which is wrong.

### Pattern 5: SIGTERM Graceful Shutdown

**What:** Allow the running job to finish before the process exits. Without this, a systemd restart mid-pipeline corrupts the AutoLeap estimate state.

```javascript
// In gateway server startup (after queue is initialized)
process.on("SIGTERM", async () => {
  console.log("[telegram] SIGTERM received — waiting for active job to finish...");
  await queue.onIdle();  // wait for current job to complete, no new jobs accepted
  console.log("[telegram] Queue drained — exiting");
  process.exit(0);
});
```

**Why:** systemd sends SIGTERM before SIGKILL. Default timeout is 90 seconds — enough for a running estimate to finish (typical: 60-90s). The queue's `onIdle()` promise resolves when all jobs complete.

### Anti-Patterns to Avoid

- **Wrapping `handleMessage` in the queue:** This serializes chat replies and blocks simple messages like "help" or "status" behind a 60-second pipeline. Only `buildEstimate()` needs serialization.
- **Making sessions synchronous with a startup hydration:** Loading all sessions at startup is O(n) Supabase queries. Load-on-demand (`getSession` on first reference per chatId) is the right pattern.
- **Storing the full `conversations` map (history) separately from `lastEstimate`:** Both must survive restart together for "order parts" to work correctly. The session row should hold both.
- **Using `queue.clear()` to cancel queued jobs:** This drops jobs silently. If needed in the future, notify users before clearing.
- **Migrating the existing `sessions` Map variable name in-place:** The existing `sessions` Map is referenced in 8+ places in server.js. Create `sessionStore` as the new import name and do a search/replace to avoid confusion.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Serial job queue | Custom Promise chain or mutex | `p-queue` | Missing `queue.size`, pause/resume, `onIdle()` — all needed for this phase |
| Session TTL cleanup | Custom timestamp comparison in JS | SQL `WHERE updated_at < now() - interval '24 hours'` | Database-side delete is atomic and survives process restarts |
| Supabase upsert | INSERT + UPDATE if-exists | `.upsert({ onConflict: "session_key" })` | Supabase/Postgres handles the race condition natively |
| JSONB queries | Parsing JSON after SELECT * | Supabase `.select("last_estimate->autoLeapEstimate")` with JSONB path | More efficient, works for future targeted reads |

**Key insight:** The Pi's single-threaded Node.js process means the queue only needs to prevent multiple concurrent `buildEstimate()` calls, not multi-process coordination. An in-memory queue is sufficient and correct.

---

## Common Pitfalls

### Pitfall 1: `queue.size` Counts Waiting Jobs, Not Total

**What goes wrong:** Developer checks `queue.size` to tell the user their position and reports 0 when there IS an active job (because the active job is in `queue.pending`, not `queue.size`).

**Why it happens:** p-queue separates `size` (waiting) from `pending` (running). When one job is running and two are waiting: `queue.size === 2`, `queue.pending === 1`.

**How to avoid:** Position in line = `queue.size + 1` (captures the waiting jobs ahead of you). To check "is anything running": `queue.pending > 0`. Capture `queue.size` BEFORE `queue.add()` — after adding, `size` increments and you can't distinguish.

**Warning signs:** Users report being told "you're #0 in queue."

### Pitfall 2: Session Reads Must Be Awaited — All Call Sites Become Async

**What goes wrong:** Replacing `sessions.get(chatId)` (sync) with `getSession(platform, chatId)` (async) without awaiting it. JavaScript won't throw — it silently returns a Promise object instead of the session data.

**Why it happens:** `sessions.get()` was synchronous. The new `getSession()` hits Supabase and is async. All call sites in `handleToolCall` and `processMessage` must use `await`.

**How to avoid:** Search for every `sessions.get(chatId)` in both gateway server files and wrap with `await`. The memory cache in `session-store.js` makes the await fast (< 1ms) when the session is already loaded.

**Warning signs:** `lastEstimate.autoLeapEstimate` is undefined; "No recent estimate to order from" message appears after restart.

### Pitfall 3: `conversations` Map Is Also Volatile — Both Maps Must Be Migrated

**What goes wrong:** Migrating `sessions` (estimate results) to Supabase but leaving `conversations` (Claude history) in-memory. After restart, "order parts" works (estimate is persisted) but SAM has forgotten the conversation context, leading to confusing responses.

**Why it happens:** Server.js has TWO separate maps: `sessions` (line 67) for estimate results and `conversations` (line 68) for Claude history. SESS-01/SESS-02 require both to survive restarts for the full "delete that estimate" command flow to work.

**How to avoid:** The `session-store.js` schema stores both `last_estimate` and `history` in the same row. The write path in `setSession` must update both fields atomically.

**Warning signs:** After restart, SAM says "I don't have any context about a recent estimate" even though the estimate data is in Supabase.

### Pitfall 4: Double-Enqueue From Rapid Messages

**What goes wrong:** User sends two messages in quick succession while no job is running. Both messages pass the "is anything running?" check before either enters the queue, resulting in two `buildEstimate()` calls scheduled to run sequentially — a phantom duplicate job.

**Why it happens:** The check and the enqueue are not atomic in JavaScript's async event loop. Between `getStatus(userId)` returning null and `queue.add()` registering the job, a second message can arrive.

**How to avoid:** Set `activeJobs.set(userId, ...)` synchronously BEFORE the `await queue.add()` call. Because Node.js is single-threaded, setting the map key synchronously prevents a second message from seeing an empty status before the first job is registered.

**Warning signs:** Two estimate pipelines run for the same user in the same session; AutoLeap creates two ROs.

### Pitfall 5: WhatsApp Gateway Needs the Same Queue Instance

**What goes wrong:** Creating separate queue instances in the Telegram and WhatsApp server files. Chrome is shared — two separate queues allow concurrent pipeline runs across gateways.

**Why it happens:** Each gateway is a separate Node.js process (separate systemd services). A module-level singleton in `job-queue.js` only works within a single process.

**How to avoid:** If both gateways run as separate processes (current setup), they cannot share a single in-memory queue. The practical solution for a single-shop Pi: the Telegram gateway is the primary path. The WhatsApp gateway can have its OWN queue instance — concurrent runs between Telegram and WhatsApp are unlikely in practice (one shop, 2-3 users). Document this limitation explicitly.

**Longer-term fix (not Phase 1):** A lock file in `/tmp/sam-pipeline.lock` or a lightweight IPC socket. Out of scope for this phase.

**Warning signs:** Telegram estimate and WhatsApp estimate both start within seconds of each other; AutoLeap navigator state corrupted.

### Pitfall 6: model ID in `motor-nav.js` Uses Raw HTTPS, Not SDK

**What goes wrong:** Assuming all three model ID changes are identical. `motor-nav.js` makes raw HTTPS requests to `api.anthropic.com` (not the Anthropic SDK) because the SDK is not available inside the browser skill's hot path. The model ID is in a hardcoded JSON body string.

**Why it happens:** `motor-nav.js` avoids importing the SDK to reduce load time inside the playbook. It builds the request body manually at line 1287-1288.

**How to avoid:** The fix is still an env var substitution, but it must replace the string inside the JSON body construction:
```javascript
// Before (line 1288):
model: "claude-haiku-4-5-20251001",

// After:
model: process.env.CLAUDE_HAIKU_MODEL || "claude-haiku-4-5-20251001",
```
Note: `motor-nav.js` currently uses `claude-haiku-4-5-20251001` which is already the correct non-deprecated model. The change adds env var flexibility but does NOT change behavior unless `CLAUDE_HAIKU_MODEL` is set.

---

## Code Examples

Verified patterns from official sources and codebase inspection:

### Supabase Upsert Pattern (from @supabase/supabase-js v2 docs)
```javascript
// Source: Supabase JS client v2 — upsert with conflict resolution
const { error } = await supabase
  .from("sam_sessions")
  .upsert(
    { session_key: key, last_estimate: data, updated_at: new Date().toISOString() },
    { onConflict: "session_key" }
  );
```

### p-queue Size vs Pending (verified against p-queue v9 source)
```javascript
// queue.size = jobs waiting in the queue (not yet running)
// queue.pending = jobs currently running (max 1 with concurrency:1)
// User's position = queue.size + 1 (jobs ahead + theirs)
const position = queue.size + 1;           // capture BEFORE queue.add()
const waitMinutes = queue.size * 15;       // jobs ahead × 15min each
await queue.add(async () => { ... });      // now size increments
```

### SIGTERM with queue.onIdle() (Node.js EventEmitter + p-queue)
```javascript
process.on("SIGTERM", async () => {
  // Stop accepting new work
  queue.pause();
  // Wait for active job (up to systemd's KillTimeoutSec)
  await queue.onIdle();
  process.exit(0);
});
```

### Model ID env var substitution (all three files)
```javascript
// server.js line 219 — gateway main conversation model
model: process.env.CLAUDE_SONNET_MODEL || "claude-sonnet-4-6",

// diagnose.js line 34 — diagnostic synthesis model
const CLAUDE_MODEL = process.env.CLAUDE_SONNET_MODEL || "claude-sonnet-4-6";

// motor-nav.js line 1288 — MOTOR category selection (fast/cheap calls)
model: process.env.CLAUDE_HAIKU_MODEL || "claude-haiku-4-5-20251001",
```

### Session cleanup piggybacking on health.js pattern (existing cleanupArtifacts)
```javascript
// In server.js startup — mirror the existing cleanupArtifacts() pattern
const { cleanupExpiredSessions } = require("../../shared/session-store");

// On startup
cleanupExpiredSessions().then(({ deleted }) => {
  if (deleted > 0) log.info("startup session cleanup", { deleted });
});

// Periodic — every 6 hours alongside cleanupArtifacts
setInterval(() => {
  cleanupExpiredSessions();
}, 6 * 60 * 60 * 1000);
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `claude-3-haiku-20240307` | `claude-haiku-4-5-20251001` | Deprecated; retires April 19, 2026 | CRITICAL deadline — must migrate before retirement |
| `claude-sonnet-4-5-20250929` | `claude-sonnet-4-6` | March 2026 | Same pricing; better instruction following; no breaking API changes |
| In-memory `sessions` Map | Supabase `sam_sessions` table | This phase | Survives restarts; enables "order parts" after reboot |
| No concurrency guard | `p-queue` concurrency:1 | This phase | Prevents Chrome corruption from concurrent builds |

**Deprecated/outdated:**
- `claude-3-haiku-20240307`: Retires April 19, 2026. All three files must be updated in this phase.
- `telegram_sessions` table (referenced in STATE.md concerns): Never created. The new `sam_sessions` table with `platform:chatId` composite key supersedes this concept and covers both gateways.

---

## Open Questions

1. **WhatsApp gateway queue isolation**
   - What we know: Telegram and WhatsApp run as separate processes; in-memory queue cannot be shared between them
   - What's unclear: How often do concurrent Telegram + WhatsApp estimate runs actually happen in production at Hillside Auto?
   - Recommendation: Accept the limitation for Phase 1 (document it). Each gateway gets its own queue. Concurrent cross-platform runs are unlikely for a 1-3 user shop. Revisit in Phase 3 (multi-platform) with a file-lock or IPC approach.

2. **History size in Supabase — write frequency**
   - What we know: `MAX_HISTORY=20` messages, each up to ~600 tokens (the `max_tokens` limit). Estimate: ~5-15KB per session row. Supabase free tier is 500MB.
   - What's unclear: Whether writing the full history on every message is a cost/rate concern.
   - Recommendation: Write history to Supabase only when `sessions.set()` is called (after estimate completion or customer data collection) — not on every Claude chat turn. Chat turns update in-memory only. This reduces write frequency to ~2-3 writes per estimate workflow.

3. **Existing `SessionManager` class name collision**
   - What we know: `skills/shared/session-manager.js` exports `SessionManager` — a class for platform auth checks (AutoLeap, PartsTech, ProDemand). It is unrelated to conversation sessions.
   - What's unclear: Will future developers confuse `session-manager.js` (auth preflight) with `session-store.js` (conversation persistence)?
   - Recommendation: Name the new module `session-store.js` (not `session-manager.js`) to maintain the distinction. The SKILL.md for `shared/` should document the difference.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Custom Node.js runner (`tests/unit/run.js`) — no Jest/Mocha |
| Config file | None — `run.js` auto-discovers `test-*.js` files |
| Quick run command | `node tests/unit/run.js` |
| Full suite command | `node tests/unit/run.js` (same — all tests run in < 30s) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| QUEUE-01 | Only one buildEstimate runs at a time | unit | `node tests/unit/test-job-queue.js` | ❌ Wave 0 |
| QUEUE-02 | User gets position message when queued | unit | `node tests/unit/test-job-queue.js` | ❌ Wave 0 |
| QUEUE-03 | Next job auto-starts on completion | unit | `node tests/unit/test-job-queue.js` | ❌ Wave 0 |
| QUEUE-04 | Status query returns active/queued state | unit | `node tests/unit/test-job-queue.js` | ❌ Wave 0 |
| SESS-01 | Session survives restart (Supabase round-trip) | integration | `node tests/unit/test-session-store.js` | ❌ Wave 0 |
| SESS-02 | order_parts works after restart (session hydrate) | integration | `node tests/unit/test-session-store.js` | ❌ Wave 0 |
| SESS-03 | Sessions older than 24h deleted by cleanup | unit | `node tests/unit/test-session-store.js` | ❌ Wave 0 |
| MODEL-01 | server.js uses env var model with correct default | unit | `node tests/unit/test-model-ids.js` | ❌ Wave 0 |
| MODEL-02 | diagnose.js uses env var model with correct default | unit | `node tests/unit/test-model-ids.js` | ❌ Wave 0 |
| MODEL-03 | motor-nav.js uses env var model with correct default | unit | `node tests/unit/test-model-ids.js` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `node tests/unit/run.js`
- **Per wave merge:** `node tests/unit/run.js`
- **Phase gate:** Full suite green + manual verify at `@hillsideautobot`: send test estimate, restart Pi service, issue "order parts" command — confirm it resolves the session from Supabase

### Wave 0 Gaps
- [ ] `tests/unit/test-job-queue.js` — covers QUEUE-01 through QUEUE-04. Tests: single job runs, second job queues (size=1), position reporting, auto-drain, idempotent re-enqueue check
- [ ] `tests/unit/test-session-store.js` — covers SESS-01 through SESS-03. Tests: set/get round-trip with Supabase mock (or real Supabase with test key), in-memory fallback when Supabase null, cleanup deletes old rows
- [ ] `tests/unit/test-model-ids.js` — covers MODEL-01 through MODEL-03. Tests: require each file, check model constant value matches env var or expected default, grep for any remaining hardcoded deprecated model IDs

*(SESS-01 and SESS-02 tests will require either a real Supabase connection or a mock client. Given the project has real Supabase credentials, integration tests against the live project are acceptable for this phase.)*

---

## Sources

### Primary (HIGH confidence)
- Codebase inspection: `skills/telegram-gateway/scripts/server.js` — sessions Map, conversations Map, buildEstimate call site (line 311), model ID (line 219)
- Codebase inspection: `skills/ai-diagnostics/scripts/diagnose.js` — CLAUDE_MODEL constant (line 34), `claude-sonnet-4-5-20250929`
- Codebase inspection: `skills/autoleap-browser/scripts/helpers/motor-nav.js` — model at line 1288, raw HTTPS request pattern
- Codebase inspection: `skills/shared/session-manager.js` — existing SessionManager class (auth preflight only, unrelated to conversation sessions)
- Codebase inspection: `skills/shared/health.js` — cleanupArtifacts pattern for piggybacking cleanup
- `.planning/REQUIREMENTS.md` — QUEUE-01 through SESS-03, MODEL-01 through MODEL-03 requirements
- `.planning/codebase/CONCERNS.md` — Chrome concurrency scaling limit, unbounded conversations map, sessions volatility
- `.planning/research/STACK.md` — p-queue recommendation, model ID table, Node.js 22 require(esm) verification
- `package.json` — confirmed `@supabase/supabase-js ^2.95.3` present; confirmed `puppeteer-core` and `@anthropic-ai/sdk` absent

### Secondary (MEDIUM confidence)
- `.planning/research/STACK.md` — p-queue v9 `queue.size` vs `queue.pending` semantics (cited p-queue GitHub)
- `.planning/research/STACK.md` — Model ID verification against platform.claude.com (fetched 2026-03-15)
- Node.js 22.16.0 (confirmed running) — `require(esm)` unflagged since 22.12.0

### Tertiary (LOW confidence)
- None

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all library choices already validated in prior research; codebase confirms package availability
- Architecture: HIGH — integration points pinpointed to specific file + line numbers from direct code inspection
- Pitfalls: HIGH — derived from actual codebase bugs (CONCERNS.md) and async semantics of the pattern choices
- Session schema: MEDIUM — JSONB approach is standard for flexible payloads; specific column set is a design recommendation, not a verified "only way"

**Research date:** 2026-03-15
**Valid until:** 2026-04-10 (stable domain; April 19 model retirement deadline is the hard constraint)
