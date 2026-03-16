# Requirements: SAM — AI Service Advisor

**Defined:** 2026-03-15
**Core Value:** A shop tech texts a vehicle and problem, and gets back a complete, accurate, customer-ready estimate with real parts pricing and labor times.

## v1 Requirements

### Queue & Serialization

- [x] **QUEUE-01**: Estimate requests are serialized — only one pipeline runs at a time
- [x] **QUEUE-02**: When a request arrives during an active pipeline, user is told their position and estimated wait
- [x] **QUEUE-03**: Queued requests automatically start when the previous pipeline completes
- [x] **QUEUE-04**: User can check status of their queued/running request mid-pipeline

### Session Persistence

- [x] **SESS-01**: Conversation history and estimate results persist across Pi/service restarts
- [x] **SESS-02**: "Delete that estimate" and "order parts" commands work after service restart
- [x] **SESS-03**: Sessions expire after 24 hours of inactivity (auto-cleanup)

### Model Migration

- [x] **MODEL-01**: Gateway Claude calls upgraded from deprecated claude-3-haiku to claude-haiku-4-5 or claude-sonnet-4-6
- [x] **MODEL-02**: diagnose.js Claude calls upgraded from deprecated model
- [x] **MODEL-03**: MOTOR category selection Claude calls upgraded from deprecated model

### Conversation Engine

- [x] **CONV-01**: SAM has a consistent professional advisor personality across all messages
- [x] **CONV-02**: SAM collects customer name and phone conversationally before running estimate
- [x] **CONV-03**: SAM answers general automotive questions without triggering the estimate pipeline
- [x] **CONV-04**: SAM sends progress updates during the pipeline ("Researching ProDemand...", "Building estimate...")
- [x] **CONV-05**: SAM provides immediate acknowledgment within 3 seconds of any message
- [x] **CONV-06**: SAM distinguishes between estimate requests and general questions (no false triggers)

### Error Handling

- [x] **ERR-01**: Partial results are shown when some pipeline steps fail (labor without parts, etc.)
- [x] **ERR-02**: All errors are translated to plain shop language ("Couldn't pull MOTOR labor, used AI estimate instead")
- [x] **ERR-03**: Pipeline failures don't crash the bot — SAM recovers and stays responsive

### Delivery & Actions

- [ ] **DLVR-01**: Shop can send completed estimate PDF to customer via email or text from chat
- [ ] **DLVR-02**: Shop can approve and order parts from the most recent estimate via chat
- [x] **DLVR-03**: Cleanup command deletes test estimates with confirmation showing customer name + RO#

### Smart Features

- [ ] **SMART-01**: SAM proactively mentions relevant vehicle history ("Last time this RAV4 was in...")
- [ ] **SMART-02**: SAM surfaces warnings prominently (no OEM parts, pricing concerns, common failures)

### Multi-Platform

- [x] **PLAT-01**: Shared conversation engine used by both Telegram and WhatsApp gateways
- [x] **PLAT-02**: Platform-specific formatting (Telegram Markdown vs WhatsApp plain text)
- [x] **PLAT-03**: Progress updates delivered via message editing (Telegram) or new messages (WhatsApp)

## v2 Requirements

### Resilience

- **RES-01**: Circuit breakers on all browser automation (opossum) with auto-recovery
- **RES-02**: OOM protection — Chrome memory monitoring with restart trigger
- **RES-03**: Automatic retry for transient browser failures

### Smart Features

- **SMART-03**: Canned job suggestions for common services (oil change, brake job)
- **SMART-04**: Multi-tech isolation in group chats (each tech gets their own context)
- **SMART-05**: Job status query mid-pipeline ("is that estimate done yet?")

### Multi-Shop

- **SHOP-01**: Any shop can plug in AutoLeap credentials and use SAM
- **SHOP-02**: Per-shop configuration (labor rate, markup matrix, platform credentials)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Customer-facing chatbot | SAM talks to shop staff, not end customers — liability and auth complexity |
| Voice/call support | Text-based only — telephony cost and Pi hardware constraints |
| Web dashboard | Messaging IS the UI — separate product |
| NLU/intent classification pipeline | Claude handles routing via prompts — trained classifier is overkill for 3-5 users |
| Multi-shop SaaS (billing, onboarding) | Hillside Auto first |
| Chatbot builder / no-code config | SAM is custom-built, not a platform |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| QUEUE-01 | Phase 1 | Complete |
| QUEUE-02 | Phase 1 | Complete |
| QUEUE-03 | Phase 1 | Complete |
| QUEUE-04 | Phase 1 | Complete |
| SESS-01 | Phase 1 | Complete |
| SESS-02 | Phase 1 | Complete |
| SESS-03 | Phase 1 | Complete |
| MODEL-01 | Phase 1 | Complete |
| MODEL-02 | Phase 1 | Complete |
| MODEL-03 | Phase 1 | Complete |
| CONV-01 | Phase 2 | Complete |
| CONV-02 | Phase 2 | Complete |
| CONV-03 | Phase 2 | Complete |
| CONV-04 | Phase 2 | Complete |
| CONV-05 | Phase 2 | Complete |
| CONV-06 | Phase 2 | Complete |
| ERR-01 | Phase 2 | Complete |
| ERR-02 | Phase 2 | Complete |
| ERR-03 | Phase 2 | Complete |
| PLAT-01 | Phase 3 | Complete |
| PLAT-02 | Phase 3 | Complete |
| PLAT-03 | Phase 3 | Complete |
| DLVR-03 | Phase 3 | Complete |
| DLVR-01 | Phase 4 | Pending |
| DLVR-02 | Phase 4 | Pending |
| SMART-01 | Phase 4 | Pending |
| SMART-02 | Phase 4 | Pending |

**Coverage:**
- v1 requirements: 27 total
- Mapped to phases: 27
- Unmapped: 0

---
*Requirements defined: 2026-03-15*
*Last updated: 2026-03-15 — traceability updated to 4-phase roadmap*
