# Phase 1: Queue and Session Foundation - Context

**Gathered:** 2026-03-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Serial job queue that prevents Chrome corruption from concurrent estimate requests. Session persistence that survives Pi/service restarts. Model migration off deprecated claude-3-haiku-20240307 before April 19, 2026 deadline. This is pure infrastructure — no user-facing personality or conversational changes.

</domain>

<decisions>
## Implementation Decisions

### Session Storage
- Persist to Supabase (already configured in codebase — `@supabase/supabase-js` in package.json)
- Key scheme: `platform:chatId` composite (e.g. `telegram:1385723011`, `whatsapp:+13105551234`)
- Store: last estimate result (autoLeapEstimate IDs, totals, RO#), conversation stage, collected customer data
- 24-hour TTL with cleanup sweep on startup and periodic interval
- Fall back to in-memory Map if Supabase is unreachable (graceful degradation)

### Queue Implementation
- In-memory FIFO with `p-queue` (concurrency: 1) — no Redis needed for Pi workload
- ESM import via Node.js 22 native `require(esm)` or `@esm2cjs/p-queue` fork
- EventEmitter for progress/completion/error events consumed by gateways
- Position reporting: when queued, tell user their position and rough wait (~15 min per job)
- If user sends another message while their job is queued, acknowledge without re-queuing

### Model Migration
- Replace all hardcoded model strings with env var lookups: `process.env.CLAUDE_SONNET_MODEL || "claude-sonnet-4-6"` and `process.env.CLAUDE_HAIKU_MODEL || "claude-haiku-4-5-20251001"`
- Three files to update: `server.js`, `diagnose.js`, `motor-nav.js`

### Claude's Discretion
- Exact Supabase table schema for sessions
- p-queue vs hand-rolled Promise queue (whichever integrates cleaner with CommonJS)
- EventEmitter event names and payload shapes
- Session cleanup interval timing
- SIGTERM handler implementation for graceful shutdown

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `skills/shared/session-manager.js`: SessionManager class exists but heal methods are stubs — could be extended or replaced
- `skills/shared/health.js`: `cleanupArtifacts()` already runs on startup — session cleanup can piggyback
- `@supabase/supabase-js` already in package.json, Supabase project `vtgjljmicmrprnexloeb` active

### Established Patterns
- Env var feature flags: `if (process.env.X) { try { skill = require("...") } catch {} }` — queue module should follow same pattern
- Log prefix convention: `const LOG = "[queue]"` / `const LOG = "[session-store]"`
- Error return objects: `{ success: false, error: "message" }` for graceful degradation
- Module-level constants for config: `const CHROME_CDP_URL = "..."` pattern

### Integration Points
- `skills/telegram-gateway/scripts/server.js` line 281: `buildEstimate(params)` — wrap this call in queue
- `skills/telegram-gateway/scripts/server.js`: `sessions` Map (line ~66) — replace with persistent store
- `skills/estimate-builder/scripts/orchestrator.js`: `progressCallback` already exists but behind feature flag
- `skills/whatsapp-gateway/scripts/server.js`: parallel gateway that needs same queue/session access

</code_context>

<specifics>
## Specific Ideas

No specific requirements — user delegated all Phase 1 decisions to Claude's discretion. This is infrastructure work.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 01-queue-and-session-foundation*
*Context gathered: 2026-03-15*
