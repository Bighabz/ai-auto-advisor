# Architecture Patterns

**Domain:** Conversational AI service advisor — multi-platform messaging, request queuing, long-running pipeline
**Researched:** 2026-03-15
**Confidence:** HIGH (grounded in existing codebase + verified patterns)

---

## Context: What Already Exists

The codebase has a mature skill-based pipeline. This research focuses on the **three missing layers** identified in PROJECT.md:

1. **Conversational layer** — SAM needs personality, resilience, and general automotive knowledge (not just estimate triggering)
2. **Queue system** — Single Chrome on Pi; concurrent requests will collide without serialization
3. **Multi-platform gateway** — Telegram works; WhatsApp webhook exists but is incomplete; SMS is unbuilt

The architecture below shows how these three additions integrate with the existing orchestrator without requiring a rewrite.

---

## Recommended Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    PLATFORM ADAPTERS                            │
│                                                                 │
│  TelegramAdapter    WhatsAppAdapter    SMSAdapter (future)      │
│  (long-poll)        (HTTP webhook)     (Twilio)                 │
│       │                  │                  │                   │
└───────┼──────────────────┼──────────────────┼───────────────────┘
        │                  │                  │
        ▼                  ▼                  ▼
┌─────────────────────────────────────────────────────────────────┐
│                   UNIFIED GATEWAY CORE                          │
│                                                                 │
│  • Normalizes inbound messages → { platform, chatId, text }    │
│  • Routes all platforms to same conversation engine             │
│  • Dispatches outbound: text / PDF / photo per platform         │
│  • Owns session store (in-memory Map keyed by platform:chatId) │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│                 CONVERSATION ENGINE                             │
│                                                                 │
│  • Claude claude-sonnet-4-5 with tool_use routing               │
│  • SAM system prompt (personality + automotive knowledge)       │
│  • Intent classification:                                       │
│      "estimate"  → enqueue pipeline job                         │
│      "order"     → enqueue order job                            │
│      "chat"      → respond directly (no queue)                  │
│      "history"   → AutoLeap history lookup (no queue)           │
│  • Maintains conversation history per chatId (max 20 msgs)      │
│  • Injects last-estimate context for follow-up questions        │
└─────────────┬─────────────────────────┬───────────────────────┘
              │ estimate / order job    │ chat / history answer
              ▼                         ▼
┌─────────────────────────┐   ┌─────────────────────────────────┐
│      JOB QUEUE          │   │    DIRECT RESPONSE PATH         │
│                         │   │                                 │
│  In-memory FIFO array   │   │  Synchronous — returns text     │
│  One worker at a time   │   │  directly to gateway.           │
│  Per-job status:        │   │  No queue needed.               │
│    queued               │   │  Used for:                      │
│    running              │   │  • General automotive Q&A       │
│    done                 │   │  • Vehicle history lookup       │
│    error                │   │  • Status/help commands         │
│                         │   │  • Post-estimate follow-up chat │
│  Progress callback      │   └─────────────────────────────────┘
│  signals gateway to     │
│  send "step X of Y"     │
│  updates mid-pipeline   │
└─────────────┬───────────┘
              │ dequeue one job at a time
              ▼
┌─────────────────────────────────────────────────────────────────┐
│               EXISTING ORCHESTRATOR (unchanged)                 │
│                                                                 │
│  buildEstimate() — 8-step pipeline                              │
│  handleOrderRequest() — PartsTech cart                          │
│  handleApprovalAndOrder() — approval + order                    │
│                                                                 │
│  Takes progressCallback(stage) → triggers queue progress signal │
└─────────────────────────────────────────────────────────────────┘
```

---

## Component Boundaries

| Component | Responsibility | Communicates With | Location |
|-----------|---------------|-------------------|----------|
| **Platform Adapter** | Speak each platform's wire protocol (long-poll, webhook, SMS API). Translate to/from normalized messages. | Gateway Core (inbound + outbound) | `skills/telegram-gateway/`, `skills/whatsapp-gateway/`, future `skills/sms-gateway/` |
| **Gateway Core** | Platform-agnostic message routing. Session store. Dispatch responses. | Platform Adapters, Conversation Engine | New module: `skills/shared/gateway-core.js` |
| **Conversation Engine** | Claude `tool_use` routing. SAM personality. History tracking. Intent → job or direct answer. | Gateway Core (receives message, returns response/job), Job Queue (enqueues) | Refactor of current `telegram-gateway/server.js` Claude logic into `skills/shared/conversation.js` |
| **Job Queue** | Serialize pipeline executions. One job at a time (single Chrome). Status tracking. Progress event bus. | Conversation Engine (enqueue), Orchestrator (execute), Gateway Core (progress updates) | New module: `skills/shared/queue.js` |
| **Orchestrator** | The existing 8-step estimate pipeline. No change required. | Job Queue (called by worker), all research/estimate skills | `skills/estimate-builder/scripts/orchestrator.js` |
| **Shared Session Store** | Per-chat state: conversation history, last estimate results, in-flight job status. | Gateway Core, Conversation Engine | Extracted from gateway servers into `skills/shared/session-store.js` |

---

## Data Flow

### Estimate Request (Happy Path)

```
1. Technician texts Telegram: "2019 Civic, P0420, customer John Smith 555-1234"

2. TelegramAdapter receives long-poll update
   → normalizes to: { platform: "telegram", chatId: 12345, text: "..." }
   → passes to GatewayCore.handleInbound()

3. GatewayCore looks up session for chatId 12345
   → passes (message, history, lastEstimate) to ConversationEngine.process()

4. ConversationEngine sends to Claude with tool_use
   → Claude returns tool_use: run_estimate { make, model, year, symptoms, customer_name, customer_phone }

5. ConversationEngine calls JobQueue.enqueue({ type: "estimate", params, chatId })
   → JobQueue assigns jobId, status = "queued"
   → Returns { queued: true, position: 1, jobId }

6. ConversationEngine returns to GatewayCore: "On it! Queued (1 ahead of you)"
   GatewayCore dispatches via TelegramAdapter.send()

7. If position > 1:
   JobQueue.onPosition(chatId) → GatewayCore sends "1 job ahead of yours — won't be long"

8. When job reaches front, Worker calls orchestrator.buildEstimate(params, progressCallback)

9. progressCallback("diagnosis_done") fires
   → JobQueue emits progress event
   → GatewayCore receives it
   → TelegramAdapter edits the ack message: "Got vehicle specs. Checking repair data..."

10. progressCallback("research_done") fires → similar update

11. buildEstimate() resolves with results
    → Worker updates job status = "done", stores results in SessionStore
    → GatewayCore receives completion event
    → Formats 4 messages via formatter.js
    → TelegramAdapter sends messages + PDF attachment
```

### Queue Full / Concurrent Request

```
1. Tech A sends estimate request → job 1 starts running
2. Tech B sends estimate request → job 2 queued (position 1 in queue)
3. GatewayCore → TelegramAdapter sends Tech B: "Building an estimate right now — yours is next, about 10-15 min"
4. Job 1 completes → Tech A gets results
5. Worker dequeues job 2 → Tech B gets "Your turn — building it now..." edit on ack message
```

### Chat (No Queue)

```
1. Technician texts: "what does P0420 mean?"
2. ConversationEngine.process() → Claude identifies chat intent (no tool_use)
3. Claude returns text answer directly
4. GatewayCore dispatches text via platform adapter
5. No queue involvement — total round-trip ~2-3 seconds
```

### WhatsApp (Same Core, Different Adapter)

```
1. Twilio POST to /webhook on port 3000
2. WhatsAppAdapter parses Twilio form body → { platform: "whatsapp", chatId: "+15551234567", text: "..." }
3. Same GatewayCore + ConversationEngine + JobQueue path as Telegram
4. Outbound: WhatsAppAdapter formats and POSTs back via Twilio API
```

---

## Key Design Decisions

### Decision 1: In-Memory Queue, No Redis

The Pi runs one process. Redis adds operational complexity (another service, another failure mode) for zero benefit at single-process scale. An in-memory array with a single async worker is 30 lines of code and perfectly matches the constraint: single Chrome, one job at a time.

**Trade-off accepted:** Queue state lost on process restart. A restart takes ~5 seconds; the shop texts again. This is acceptable for the current deployment.

**When to revisit:** If multiple Pi processes or VPS workers need to share a queue — then BullMQ + Redis. Not now.

### Decision 2: Shared Gateway Core, Not Duplicated Logic

The current Telegram and WhatsApp servers each re-implement Claude routing, session management, and response formatting. This means bugs get fixed in one but not the other. Extract the common engine once into `skills/shared/`; adapters only handle wire protocol differences.

**Build order implication:** Gateway Core must be built before WhatsApp adapter is wired up. Telegram adapter refactor comes first (proof of concept), then WhatsApp wires in for free.

### Decision 3: Progress Updates via Callback, Not Polling

The orchestrator already accepts a `progressCallback` parameter (present in `telegram-gateway/server.js` behind `TELEGRAM_PROGRESS_UPDATES` feature flag). Extend this — the callback fires into the job queue's event emitter, which triggers the gateway to edit the ack message. No polling, no new infrastructure. Uses Telegram's `editMessageText` for seamless in-place status updates.

WhatsApp cannot edit messages — progress updates for WhatsApp should be new messages sent mid-pipeline ("Still working — pulling parts now...").

### Decision 4: Intent Routing at Conversation Engine, Not Gateway

The current Telegram server does intent detection inside the gateway. This must move to the shared Conversation Engine so WhatsApp and SMS get the same routing logic. The gateway adapters become thin: receive, normalize, send — nothing more.

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Running buildEstimate() Directly in the Polling Loop

**What goes wrong:** The current `pollUpdates()` loop in `telegram-gateway/server.js` awaits `buildEstimate()` inline. While that one estimate runs (10-20 min), the polling loop is blocked. A second technician's message sits unread in Telegram's update queue until the first job finishes. Result: second tech gets no acknowledgment, thinks the bot is dead, texts again, gets a duplicate job queued.

**Instead:** Acknowledge immediately ("On it!"), enqueue the job, continue polling. The worker runs the job on its own async tick.

### Anti-Pattern 2: Parallel Browser Sessions

**What goes wrong:** Two concurrent `buildEstimate()` calls share the single Chrome CDP on port 18800. Tab references cross-contaminate. AutoLeap playbook opens PartsTech in a new tab — with two jobs running, tab indices collide, parts get linked to the wrong estimate.

**Instead:** The queue worker enforces serial execution. One job runs. Period. Queue position is visible to users.

### Anti-Pattern 3: Platform-Specific Business Logic in Adapters

**What goes wrong:** Putting "if customer_name missing, ask for it" inside `WhatsAppAdapter` means it gets out of sync with Telegram's version when the system prompt changes.

**Instead:** Customer info collection is a Conversation Engine concern. The system prompt + Claude tool_use schema enforces it consistently across all platforms.

### Anti-Pattern 4: In-Memory Session Store Per Gateway

**What goes wrong:** Today, `sessions` (last estimate) and `conversations` (Claude history) are `Map` instances inside `telegram-gateway/server.js`. If WhatsApp gateway is a separate process (which it currently is — separate systemd service), a tech who sent the estimate via Telegram can't say "customer approved" via WhatsApp because the session doesn't transfer.

**The practical fix now:** Extract session store to a shared module. Both adapters import from the same in-memory store. Works as long as they run in the same process. For cross-process (separate services), sessions would need Supabase or Redis persistence — defer this; for Hillside Auto the same tech uses the same platform.

---

## Component Build Order

Build order is driven by dependencies. Each layer must exist before the one above it.

```
1. skills/shared/session-store.js
   — Extract Map-based session store from telegram-gateway/server.js
   — No new logic; just makes it importable by multiple gateways
   — Prerequisite: everything else

2. skills/shared/queue.js
   — In-memory FIFO job queue
   — EventEmitter for progress events
   — Worker loop: dequeue → call orchestrator → emit done
   — Prerequisite: session-store (to save results on completion)

3. skills/shared/conversation.js
   — Extract Claude tool_use engine from telegram-gateway/server.js
   — Add general automotive knowledge handling (chat intent path)
   — System prompt revamp (personality + resilience)
   — Prerequisite: queue (to enqueue estimate jobs)

4. skills/shared/gateway-core.js
   — Platform-agnostic inbound/outbound dispatcher
   — Imports conversation + queue
   — Prerequisite: conversation, queue, session-store

5. skills/telegram-gateway/scripts/server.js (refactor)
   — Slim down to adapter only: long-poll → gateway-core → send
   — Prerequisite: gateway-core

6. skills/whatsapp-gateway/scripts/server.js (refactor)
   — Wire existing webhook server to gateway-core
   — Handle WhatsApp-specific formatting differences (no message editing)
   — Prerequisite: gateway-core

7. skills/sms-gateway/ (future)
   — Twilio SMS adapter follows same pattern
   — Prerequisite: gateway-core
```

---

## Scalability Considerations

This architecture is sized for Hillside Auto today. Documented for future awareness:

| Concern | Current Scale (1 shop, 2-4 users) | Future Scale (multi-shop) |
|---------|-----------------------------------|--------------------------|
| Queue | In-memory array, single worker | BullMQ + Redis, per-shop workers |
| Session store | In-memory Map | Supabase-persisted sessions |
| Browser | Single Chrome on Pi | One Chrome instance per shop (separate workers) |
| Platform adapters | Telegram + WhatsApp | Same gateway-core, add adapters |
| Progress updates | Telegram edit-message, WhatsApp new-message | Platform-specific adapter handles it transparently |

---

## Sources

- Existing codebase: `skills/telegram-gateway/scripts/server.js` — direct analysis
- Existing codebase: `skills/estimate-builder/scripts/orchestrator.js` — direct analysis
- Existing codebase: `.planning/codebase/ARCHITECTURE.md` — direct analysis
- [AI Bot Architectures in 2025: From Orchestration to LLM-in-the-Loop](https://medium.com/@Mobisoft.Infotech/ai-chatbot-architecture-building-scalable-conversational-systems-253189a45d3d) — MEDIUM confidence (WebSearch)
- [Building a persistent conversational AI chatbot with Temporal](https://temporal.io/blog/building-a-persistent-conversational-ai-chatbot-with-temporal) — MEDIUM confidence, referenced for queue/state patterns (WebSearch, not using Temporal itself)
- [BullMQ — Background Jobs and Message Queue for Node.js](https://bullmq.io/) — HIGH confidence (official docs, referenced for when to graduate beyond in-memory)
- [Queue Data Structures: How to Build a Node Task Queue](https://www.sitepoint.com/implement-task-queue-node-js/) — MEDIUM confidence, confirms in-memory array is viable for single-process (WebSearch)
- [Intent Recognition and Auto-Routing in Multi-Agent Systems](https://gist.github.com/mkbctrl/a35764e99fe0c8e8c00b2358f55cd7fa) — MEDIUM confidence, confirms LLM-native routing pattern (WebSearch)
- [How I Built a Multi-Platform Social Media Automation System with Node.js](https://dev.to/propfirmkey/how-i-built-a-multi-platform-social-media-automation-system-with-nodejs-4jag) — LOW confidence (single source, WebSearch), adapter pattern confirmed by other sources

---

*Architecture analysis: 2026-03-15*
