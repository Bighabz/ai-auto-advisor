# Roadmap: SAM — AI Service Advisor

## Overview

The estimate pipeline is complete and working. This milestone builds the conversational intelligence layer on top of it: a serial job queue that prevents Chrome corruption, a unified multi-platform gateway that gives Telegram and WhatsApp a shared brain, and the UX patterns that turn the pipeline from a fragile tool into a trusted daily advisor. Phases are ordered by hard dependencies — the queue and session foundation must be solid before anything conversational is built on it.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Queue and Session Foundation** - Serial queue prevents Chrome corruption; session persistence survives restarts; deprecated model IDs replaced (completed 2026-03-16)
- [x] **Phase 2: Conversational Engine** - SAM personality, intent routing, customer info collection, progress updates, plain-language errors — shared module extracted (completed 2026-03-16)
- [x] **Phase 3: Multi-Platform Gateway** - Unified gateway core wires Telegram and WhatsApp to the same brain; platform-specific formatting; delivery actions (completed 2026-03-16)
- [ ] **Phase 4: Smart Features and Delivery** - History-aware context, proactive warnings, estimate delivery to customer, parts ordering on approval

## Phase Details

### Phase 1: Queue and Session Foundation
**Goal**: The pipeline is protected from concurrent Chrome corruption, sessions survive service restarts, and deprecated model IDs are replaced before April 19 deadline
**Depends on**: Nothing (first phase)
**Requirements**: QUEUE-01, QUEUE-02, QUEUE-03, QUEUE-04, SESS-01, SESS-02, SESS-03, MODEL-01, MODEL-02, MODEL-03
**Success Criteria** (what must be TRUE):
  1. When a second estimate request arrives while one is running, the sender immediately receives their queue position and estimated wait — no silence, no duplicate pipeline runs
  2. When a queued request reaches the front of the queue, the pipeline starts automatically without any action from the user
  3. After the Pi or service restarts mid-estimate, the shop can still type "delete that estimate" or "order parts" and SAM recognizes the last estimate context
  4. Sessions older than 24 hours are cleaned up automatically — no manual intervention needed
  5. All Claude calls in the codebase reference non-deprecated model IDs (no claude-3-haiku-20240307 anywhere)
**Plans**: 5 plans

Plans:
- [ ] 01-01-PLAN.md — Test scaffolds: test-job-queue.js, test-session-store.js, test-model-ids.js (Nyquist Wave 0)
- [ ] 01-02-PLAN.md — session-store.js module + supabase/migrations/012_sam_sessions.sql
- [x] 01-03-PLAN.md — job-queue.js singleton with p-queue concurrency:1 and EventEmitter
- [ ] 01-04-PLAN.md — Model ID migration: env var substitution in server.js, diagnose.js, motor-nav.js
- [ ] 01-05-PLAN.md — Wire session-store + job-queue into both gateways; SIGTERM handler; cleanup interval

### Phase 2: Conversational Engine
**Goal**: SAM has a consistent professional advisor personality, routes intents correctly, collects customer info before the pipeline, provides progress updates, and returns plain-language errors — extracted into a shared module usable by both gateways
**Depends on**: Phase 1
**Requirements**: CONV-01, CONV-02, CONV-03, CONV-04, CONV-05, CONV-06, ERR-01, ERR-02, ERR-03
**Success Criteria** (what must be TRUE):
  1. When a tech asks "what's the going rate on a Civic water pump?", SAM answers conversationally without creating an AutoLeap RO or running any pipeline
  2. When a tech sends a job request without a customer name and phone, SAM asks for them conversationally and holds the request until they are provided — no estimate runs without both
  3. During a running estimate, SAM sends at most 2 messages: "Working on it..." at start, then the result — no step-by-step play-by-play
  4. When a pipeline step fails (MOTOR timeout, PartsTech unavailable), SAM shows the results that succeeded with a plain-language note on what failed — the tech never sees a raw error or a blank response
  5. Any message from any user receives a visible acknowledgment within 3 seconds, even if the full response takes minutes
**Plans**: 3 plans

Plans:
- [x] 02-01-PLAN.md — Test scaffold: test-conversation.js covering CONV-01 through CONV-06 and ERR-01 through ERR-03 (Nyquist Wave 0)
- [x] 02-02-PLAN.md — Create skills/shared/conversation.js: system prompt rewrite, processMessage, handleMessage, handleToolCall, translateError (tool_result finally fix + fast-path routing)
- [ ] 02-03-PLAN.md — Wire conversation.js into telegram-gateway/server.js: strip duplicated SAM_SYSTEM/processMessage/handleToolCall, import shared module

### Phase 3: Multi-Platform Gateway
**Goal**: Telegram and WhatsApp share the same conversation engine, session store, and queue through a unified gateway core; platform-specific formatting is isolated; delivery and cleanup commands work on both platforms
**Depends on**: Phase 2
**Requirements**: PLAT-01, PLAT-02, PLAT-03, DLVR-03
**Success Criteria** (what must be TRUE):
  1. A tech on WhatsApp and a tech on Telegram see the same SAM personality, the same queue behavior, and the same estimate results — the conversation engine is not duplicated between the two gateways
  2. Telegram messages use Markdown formatting; WhatsApp messages use plain text — no asterisks or underscores appear raw in WhatsApp chats
  3. Progress updates during a running pipeline appear as edited messages on Telegram and as new sequential messages on WhatsApp — both feel natural on their respective platforms
  4. Typing "delete test" on either platform shows a confirmation with customer name and RO number before deleting — no silent deletions
**Plans**: 3 plans

Plans:
- [ ] 03-01-PLAN.md — Wave 0 test scaffolds: test-whatsapp-gateway.js (PLAT-01, PLAT-03), test-whatsapp-format.js (PLAT-02), cleanup test in test-conversation.js (DLVR-03)
- [ ] 03-02-PLAN.md — Refactor whatsapp-gateway/server.js: thin adapter pattern, async Twilio response, sendAck outbound REST, phone normalization, PDF delivery
- [ ] 03-03-PLAN.md — Add cleanup customer-ask instruction to conversation.js system prompt (DLVR-03, PLAT-02)

### Phase 4: Smart Features and Delivery
**Goal**: Shop staff can send estimates to customers and order parts from chat; SAM proactively surfaces vehicle history and prominent warnings on every estimate
**Depends on**: Phase 3
**Requirements**: DLVR-01, DLVR-02, SMART-01, SMART-02
**Success Criteria** (what must be TRUE):
  1. After an estimate is built, the shop can type "send estimate to customer" and SAM delivers the PDF to the vehicle owner via email or text without leaving the chat
  2. After an estimate is approved, the shop can type "order parts" and SAM places the PartsTech order and confirms the order number in the same chat thread
  3. When SAM builds an estimate for a vehicle that has prior history in AutoLeap, the estimate response includes a brief mention of the last visit ("Last time this RAV4 was in: O2 sensor replacement, 2025-11-04")
  4. When an estimate has warnings (non-OEM parts, pricing concerns, known failure patterns), they appear prominently at the top of the response — not buried at the bottom
**Plans**: TBD

Plans:
- [ ] 04-01: Implement DLVR-01 (send estimate PDF to customer via email/text); wire history.js into estimate response for SMART-01
- [ ] 04-02: Implement DLVR-02 (parts ordering on approval via PartsTech); implement SMART-02 warning surface in formatter

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Queue and Session Foundation | 5/5 | Complete   | 2026-03-16 |
| 2. Conversational Engine | 3/3 | Complete   | 2026-03-16 |
| 3. Multi-Platform Gateway | 3/3 | Complete   | 2026-03-16 |
| 4. Smart Features and Delivery | 0/2 | Not started | - |
