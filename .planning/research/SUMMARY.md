# Project Research Summary

**Project:** SAM — Conversational AI Layer, Queue System, Multi-Platform Messaging
**Domain:** Shop-internal conversational AI advisor over a long-running estimate pipeline
**Researched:** 2026-03-15
**Confidence:** HIGH

## Executive Summary

SAM's estimate pipeline is complete and working. This milestone adds the conversational intelligence layer that makes the pipeline usable in daily shop operations: a serial job queue to prevent Chrome corruption, a unified multi-platform gateway so Telegram and WhatsApp share a single brain, conversation state with session persistence, and the UX patterns (acknowledgments, progress updates, plain-language errors, general automotive Q&A) that turn the pipeline from a fragile tool into a trusted advisor. Experts in this space consistently identify three non-negotiable foundations for a long-running chatbot pipeline: immediate acknowledgment, queue-aware concurrency control, and graceful partial results over silence. All three are missing from the current implementation and must come first.

The recommended approach keeps the stack minimal and the Pi constraints non-negotiable. No new framework replaces the existing Telegram gateway — it gets refactored into a thin adapter. A shared `gateway-core.js` module extracts the Claude routing logic once and both platforms wire into it. The job queue is in-memory (`@esm2cjs/p-queue`, concurrency=1) with no Redis — acceptable for one shop, documented with a BullMQ migration path for multi-shop. The model upgrades to `claude-sonnet-4-6` (current production) and `claude-haiku-4-5-20251001` (replaces deprecated `claude-3-haiku-20240307` which retires April 19, 2026). Three new npm packages cover all new needs: `express` (replace raw `http`), `@esm2cjs/p-queue` (serial queue), `opossum` (circuit breaker for browser skills).

The primary risk is the concurrent Chrome corruption problem — it is silent (no error thrown), produces wrong estimates with real money impact, and is already possible in production today. The fix is straightforward (serial queue in front of `buildEstimate`) but it must be the first thing built, before any conversational layer work. Session state loss on Pi restart is the second major risk: the approval/order flow silently breaks after any service restart because `sessions` is an in-memory Map. Persisting last-estimate JSON to Supabase on every write eliminates this and also enables cross-platform queries (WhatsApp asking about a Telegram estimate). These two fixes are the gate that everything else depends on.

---

## Key Findings

### Recommended Stack

The existing CommonJS/Node.js 22/no-TS/no-build-step constraints are preserved. Three npm packages are new additions: `express` replaces a brittle manual HTTP body parser in the WhatsApp webhook server; `@esm2cjs/p-queue` provides a serial in-memory queue with queue-size inspection and pause/resume (needed for "you're #2 in queue" messages); `opossum` provides circuit-breaker wrapping for ProDemand, PartsTech, and AutoLeap browser calls, replacing ad-hoc retry loops. The Anthropic SDK (`@anthropic-ai/sdk 0.78.0`) is already installed outside `package.json` — it should be added to `package.json` to formalize the dependency.

**Core technologies:**
- `claude-sonnet-4-6`: Primary routing + conversation — current production model, same price as 4.5, better instruction following
- `claude-haiku-4-5-20251001`: Fast intent classification — replaces `claude-3-haiku-20240307` which retires April 19, 2026
- `@esm2cjs/p-queue`: Serial estimate queue — `{concurrency: 1}` enforces single-Chrome constraint; `queue.size` enables position reporting
- `opossum ^9.0.0`: Circuit breaker for browser skills — CommonJS-compatible, Red Hat-maintained, maps to ProDemand/AutoLeap/PartsTech timeout failure modes
- `express ^4.21.x`: WhatsApp webhook server — replaces manual body parser that has been a recurring bug source
- In-process `Map` + TTL eviction: Conversation state — no Redis on Pi; 20-line pattern is sufficient; Claude Messages API requires full history array anyway

**Critical version warning:** `claude-3-haiku-20240307` retires April 19, 2026. All references in `server.js` and `diagnose.js` must be migrated before that date.

### Expected Features

The conversational layer has a hard dependency ordering: queue and acknowledgment must exist before progress updates are meaningful; customer info collection must run before the pipeline; general knowledge routing is independent and can be added at any time.

**Must have (table stakes):**
- Immediate plain-text ACK before pipeline starts — 60-second silence reads as broken
- Progress milestone messages during 10-20 min pipeline — prevent re-submissions
- Serial queue with position reporting — Pi has one Chrome; techs must know they're queued, not ignored
- Customer info collection (name + phone) before pipeline trigger — AutoLeap playbook requirement
- Plain-language error messages — "MOTOR labor timeout, used AI estimate instead" not "browser timeout on motor-nav"
- Partial results over dead silence — show what succeeded, flag what failed with specific reason

**Should have (trust-builders and differentiators):**
- Named "SAM" advisor persona — consistent name + sign-off builds retention in daily use
- General automotive knowledge fallback — answer non-estimate questions (torque specs, code meanings) without triggering pipeline
- Confidence signals and source attribution in estimates — "MOTOR gave us 2.5h" is more trustworthy than bare numbers
- History-aware context on new estimates — "Last time this RAV4 was in, you replaced the O2 sensor" (history.js already built)
- Repair history query from chat — "what did we do on this car?" without opening AutoLeap
- Canned job suggestions for common services — canned-jobs.js already built; needs conversational routing

**Defer (v2+):**
- Customer-facing chatbot — explicitly out of scope; different audience, different trust model
- Rich UI / web dashboard — messaging IS the UI for this product
- Approval workflows (customer-side) — adds auth complexity beyond current scope
- Multi-shop SaaS extensions — multi-shop wiring exists but don't extend it this milestone

### Architecture Approach

The architecture extracts the current per-gateway Claude logic into a shared `skills/shared/` layer, then refactors the platform gateways to be thin wire-protocol adapters only. The four new shared modules are: `session-store.js` (extracted from `telegram-gateway/server.js`, importable by both gateways), `queue.js` (in-memory FIFO with EventEmitter for progress events), `conversation.js` (Claude `tool_use` routing + SAM personality + intent classification), and `gateway-core.js` (platform-agnostic dispatcher that calls conversation + queue). Build order is strictly bottom-up — each module is a prerequisite for the one above it. The orchestrator is untouched.

**Major components:**
1. **Platform Adapters** (`telegram-gateway/`, `whatsapp-gateway/`) — speak each platform's wire protocol; normalize to/from `{platform, chatId, text}`; handle platform-specific formatting differences (Telegram edits messages; WhatsApp sends new messages)
2. **Gateway Core** (`skills/shared/gateway-core.js`) — platform-agnostic routing; owns session store dispatch; imports conversation and queue
3. **Conversation Engine** (`skills/shared/conversation.js`) — Claude `tool_use` routing; SAM system prompt; intent classification (`estimate` → queue, `chat` → direct response, `history` → direct lookup)
4. **Job Queue** (`skills/shared/queue.js`) — serial in-memory FIFO; single worker; EventEmitter progress events to gateway; `queue.size` for position reporting
5. **Session Store** (`skills/shared/session-store.js`) — per-`chatId` conversation history + last estimate; persisted to Supabase (`last_estimate_json`) for restart survival

### Critical Pitfalls

1. **Concurrent Chrome corruption (C1)** — Two `buildEstimate()` calls sharing port 18800 corrupt each other silently, producing wrong estimates with real money impact. Fix: serial queue (concurrency=1) in front of `buildEstimate()` before any other work begins.

2. **Tool fires on shop-talk questions (C2)** — "What's the going rate on a Civic water pump?" triggers a real pipeline run, creating phantom AutoLeap ROs. Fix: system prompt must include explicit non-estimate examples + "Only call run_estimate if the vehicle is physically present at the shop."

3. **Session state lost on Pi restart (C3)** — In-memory `sessions` Map cleared on restart; approval/order flow silently broken. Fix: persist `last_estimate_json` to Supabase `telegram_sessions` table on every write; add startup message "SAM restarted — if you were mid-estimate, please re-send the job."

4. **Dangling tool_use corrupts Claude history (M5)** — If pipeline throws, the `tool_result` push is skipped, leaving a dangling `tool_use` in history. All subsequent Claude calls fail with "invalid message format." Fix: wrap `tool_result` push in a `finally` block — always push a result (even an error string) after any `tool_use` appears.

5. **Hardcoded model IDs will break (N1)** — `claude-3-haiku-20240307` retires April 19, 2026. `claude-sonnet-4-5-20250929` is superseded. Fix: move all model IDs to `CLAUDE_SONNET_MODEL` and `CLAUDE_HAIKU_MODEL` env vars with current IDs as defaults. Do this in the first phase.

---

## Implications for Roadmap

Based on the combined research, four phases cover the full scope. Phase ordering is driven by hard dependencies (queue before progress updates, session store before cross-platform state, conversation engine before gateway refactor) and by risk priority (Chrome corruption is a live production risk that must be closed first).

### Phase 1: Queue, Serialization, and Session Foundation

**Rationale:** Chrome corruption (C1) is a live production defect with silent money impact. Session loss on restart (C3) silently breaks the approval/order flow. Both require gateway-level changes that all subsequent phases build on. Nothing else should be written until these are locked.

**Delivers:** Serial job queue with position reporting; immediate ACK before pipeline; session persistence to Supabase; model ID env vars; `session-store.js` and `queue.js` shared modules extracted.

**Addresses features:** Immediate acknowledgment, queue awareness for concurrent requests, partial results over silence (error returns stored in session), hardcoded model ID migration.

**Avoids:** C1 (concurrent Chrome corruption), C3 (session loss on restart), N1 (hardcoded model IDs), M4 (chat blocked behind pipeline — fast-path for non-tool responses).

### Phase 2: Conversational Engine and System Prompt

**Rationale:** With the queue and session foundation in place, extract the Claude routing logic from `telegram-gateway/server.js` into `skills/shared/conversation.js`. This is the prerequisite for WhatsApp to share the same brain as Telegram. System prompt redesign locks in SAM's personality, the intent-check guard against phantom estimates, and the slot-fill confirmation pattern for customer info collection.

**Delivers:** `conversation.js` shared module; SAM system prompt with intent examples and "vehicle in bay" guard; customer info collection flow (conversational slot-fill); general automotive knowledge fallback; token-budget history trimming; tool_result always pushed in `finally` block.

**Uses:** `claude-sonnet-4-6` for routing, `claude-haiku-4-5-20251001` for fast intent classification.

**Avoids:** C2 (tool fires on shop-talk), C4 (context window token exhaustion), M2 (customer info re-ask loop), M5 (dangling tool_use history corruption).

### Phase 3: Unified Gateway and Multi-Platform Wiring

**Rationale:** Once `conversation.js` and `queue.js` exist as shared modules, build `gateway-core.js` and refactor both platform adapters to wire into it. This gives WhatsApp the same routing, same SAM personality, and same queue that Telegram has. Progress updates are wired in this phase — they depend on the queue's EventEmitter from Phase 1 and the gateway dispatcher from this phase.

**Delivers:** `gateway-core.js`; refactored `telegram-gateway/server.js` as thin adapter; WhatsApp adapter wired to gateway core (not standalone); progress milestone messages during pipeline (Telegram edits, WhatsApp sends new); typing indicator interval; Express replacing raw `http` in WhatsApp server; platform-specific formatters (no cross-bleed).

**Implements:** Platform Adapters + Gateway Core from architecture diagram.

**Avoids:** M1 (progress edit desync — log failures, fall back to sendMessage), N2 (typing indicator expiry), N3 (Markdown format bleed between platforms), M3 (cross-platform session gap — resolved by Supabase session from Phase 1).

### Phase 4: Resilience, Reliability, and Differentiators

**Rationale:** With the full stack operational, harden the system against the remaining failure modes and add the differentiating features (history, canned jobs, confidence signals) that turn SAM from a working tool into a trusted daily advisor. Circuit breakers wrap browser skills here — adds opossum without touching the queue or conversation logic built in earlier phases.

**Delivers:** `opossum` circuit breakers on ProDemand, PartsTech, AutoLeap browser calls; OOM prevention (`--max-old-space-size=256`, systemd restart rate-limiting, SIGTERM cleanup handler); repair history query from chat; canned job suggestions for common services; history-aware context on new estimates; confidence/source signals in conversational output; plain-language error translation for all pipeline failures.

**Uses:** `opossum ^9.0.0`; `history.js` and `canned-jobs.js` skills (already built, need conversational routing).

**Avoids:** N4 (OOM kill mid-estimate), C1 (opossum fallback supplements queue protection for browser timeouts).

### Phase Ordering Rationale

- Phase 1 before everything: Chrome corruption is a live defect; session loss silently breaks money flows. Both must be closed before adding more behavior on top of a broken foundation.
- Phase 2 before Phase 3: `conversation.js` must exist before `gateway-core.js` can import it. The Telegram refactor is the proof-of-concept; WhatsApp wires in for free once the shared core exists.
- Phase 3 before Phase 4: Progress updates require the gateway's EventEmitter wiring from Phase 3. Circuit breakers are additive and don't require the queue or conversation modules to change.
- Phase 4 is independently addable: The differentiator features (history, canned jobs) call existing skills and only need conversational routing from Phase 2 to be in place. They could be split across earlier phases if schedule pressure demands it.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 3:** WhatsApp-specific formatting constraints (no message editing, media attachment formats, Twilio API quirks) — verify current Twilio API capabilities for document/PDF sending
- **Phase 4:** `opossum` integration with the specific browser automation failure modes (puppeteer CDP disconnect vs. navigation timeout vs. Angular SPA state corruption) — behavior at circuit open needs verification against real failure scenarios

Phases with standard patterns (skip research-phase):
- **Phase 1:** Serial queue pattern with `p-queue` and Supabase persistence are well-documented; no research needed
- **Phase 2:** Claude `tool_use` routing and system prompt design are well-understood; Anthropic docs are authoritative

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Model IDs verified against official Anthropic docs (2026-03-15). npm packages confirmed. Node.js 22 `require(esm)` confirmed unflagged. |
| Features | HIGH | Table-stakes features grounded in hard constraints (Pi hardware, AutoLeap requirements, Telegram/WhatsApp API limits). Differentiators grounded in existing built skills. |
| Architecture | HIGH | Directly grounded in codebase analysis. Component boundaries match existing file structure. Build order is dependency-driven with no ambiguity. |
| Pitfalls | HIGH (critical) / MEDIUM (moderate) | Critical pitfalls C1-C4 are directly traceable to existing code (`server.js` line numbers cited). Moderate pitfalls M1-M5 are grounded in API behavior and LLM research. Minor pitfalls are lower-confidence inferences. |

**Overall confidence:** HIGH

### Gaps to Address

- **Cross-platform session composite key design:** The Supabase `telegram_sessions` table was designed for Telegram only. Extending it to a `platform:chatId` composite key for WhatsApp requires a schema migration. Determine whether to extend the existing table or create a new `chat_sessions` table during Phase 1 planning.

- **WhatsApp PDF delivery:** Currently marked as TODO in the WhatsApp gateway code. The mechanism for sending PDF attachments via Twilio (MMS vs. media URL) needs verification during Phase 3 planning. This determines whether the optional `twilio` npm package is needed.

- **`claude-haiku-4-5-20251001` in `diagnose.js`:** The `diagnose.js` skill in `ai-diagnostics` hardcodes `claude-3-haiku-20240307` for fast classification calls. This must be updated as part of the Phase 1 model ID env var migration — it is not just a gateway concern.

- **`@esm2cjs/p-queue` longevity:** The CJS fork is maintained but is a community fork, not the official sindresorhus package. Monitor for abandonment. Fallback: Node.js 22.16.0 supports `require(esm)` natively, so `p-queue@9.1.0` can be required directly if the fork is dropped.

---

## Sources

### Primary (HIGH confidence)
- `platform.claude.com/docs/en/about-claude/models/overview` (fetched 2026-03-15) — model IDs, pricing, deprecation schedule
- `skills/telegram-gateway/scripts/server.js` — codebase analysis, pitfall line numbers
- `skills/estimate-builder/scripts/orchestrator.js` — codebase analysis, pipeline structure
- `.planning/codebase/CONCERNS.md` — documented existing concerns, session store limits
- `p-queue` GitHub (sindresorhus/p-queue) — queue API, concurrency options
- `opossum` GitHub (nodeshift/opossum) — circuit breaker API, CJS compatibility
- Claude tool use docs (`platform.claude.com/docs/en/agents-and-tools/tool-use/implement-tool-use`) — message format requirements, tool_result correctness

### Secondary (MEDIUM confidence)
- `arxiv.org/abs/2505.06120` — LLM multi-turn degradation (39% performance drop in multi-turn tasks)
- `arxiv.org/html/2512.07497v1` — LLM agentic failure modes (over-helpful tool triggering)
- `temporal.io/blog/building-a-persistent-conversational-ai-chatbot-with-temporal` — queue/state patterns
- Bolton Technology, Conceptual Minds, Autymate automotive AI sources — feature landscape for shop AI products
- `betterstack.com/community/guides/scaling-nodejs/fastify-express/` — Express vs Fastify tradeoffs

### Tertiary (LOW confidence)
- `dev.to/propfirmkey` — multi-platform adapter pattern (confirmed by higher-confidence sources)
- `nodered.org/docs/getting-started/raspberrypi` — Node.js memory flags on Pi

---

*Research completed: 2026-03-15*
*Ready for roadmap: yes*
