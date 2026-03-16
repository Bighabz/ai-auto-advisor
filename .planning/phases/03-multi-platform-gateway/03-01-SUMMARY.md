---
phase: "03"
plan: "01"
subsystem: testing
tags: [tdd, wave-0, whatsapp, plat-01, plat-02, plat-03, dlvr-03]
dependency_graph:
  requires: []
  provides:
    - "Wave 0 test scaffolds for Phase 3"
    - "PLAT-01 and PLAT-03 RED stubs in test-whatsapp-gateway.js"
    - "PLAT-02 formatter regression guards in test-whatsapp-format.js"
    - "DLVR-03 cleanup prompt RED stub appended to test-conversation.js"
  affects:
    - "tests/unit/test-whatsapp-gateway.js"
    - "tests/unit/test-whatsapp-format.js"
    - "tests/unit/test-conversation.js"
tech_stack:
  added: []
  patterns:
    - "try/require guard (exit 0 when module absent)"
    - "source-level architecture assertion (fs.readFileSync + string check)"
    - "TDD RED-before-implementation (Wave 0)"
key_files:
  created:
    - tests/unit/test-whatsapp-gateway.js
    - tests/unit/test-whatsapp-format.js
  modified:
    - tests/unit/test-conversation.js
decisions:
  - "test-whatsapp-gateway.js exits 1 (not 0) after failures so run.js marks the suite FAILED — confirming RED state in Wave 0"
  - "PLAT-02 formatter tests are GREEN immediately because formatter.js was already WA-native — they serve as regression guards going forward"
  - "DLVR-03 buildSystemPrompt test probes for 'customer record' OR 'delete_customer_vehicle' in the prompt text; currently only in tool description so test is RED until Plan 03 adds the instruction to the system prompt"
  - "normalizeWaPhone contract test uses serverMod?.normalizeWaPhone check so it fails gracefully with a clear message rather than crashing"
metrics:
  duration: "4 min"
  completed_date: "2026-03-16"
  tasks_completed: 2
  files_changed: 3
---

# Phase 03 Plan 01: Wave 0 Test Scaffolds Summary

Wave 0 test scaffolds for Phase 3 multi-platform gateway — three files (two new, one extended) that collectively cover PLAT-01, PLAT-02, PLAT-03, and DLVR-03 before any implementation begins. All RED tests confirmed before commit.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Create test-whatsapp-gateway.js (PLAT-01, PLAT-03 stubs) | 0523b63 | tests/unit/test-whatsapp-gateway.js |
| 2 | Create test-whatsapp-format.js (PLAT-02) + DLVR-03 stub in test-conversation.js | 5ce5b35 | tests/unit/test-whatsapp-format.js, tests/unit/test-conversation.js |

## Verification Results

| Test File | State | Notes |
|-----------|-------|-------|
| test-whatsapp-gateway.js | RED (4 fail, 1 pass) | PLAT-01 arch check + normalizeWaPhone fail; sendAck passes |
| test-whatsapp-format.js | GREEN (6 pass) | Formatter was already WA-native — regression guards in place |
| test-conversation.js | RED (1 new fail) | DLVR-03 customer-record prompt check; all 14 existing tests pass |
| run.js full suite | Completes (10 pass, 2 fail) | No crashes; failures are Wave 0 expected state |

## What Each Test Checks

### test-whatsapp-gateway.js (PLAT-01, PLAT-03)
- **PLAT-01 arch**: `server.js` must import and call `conversation.handleMessage` (source-level, RED until Plan 02)
- **PLAT-01 no detectCommand**: Active code must not contain `detectCommand(` after Plan 02 strips bespoke routing (RED)
- **PLAT-03 sendAck**: `handleMessage("whatsapp", ...)` calls injected `sendAck` on `tool_use` response (GREEN — conversation.js already supports it)
- **PLAT-01 normalizeWaPhone contract**: `server.js` must export `normalizeWaPhone` (RED until Plan 02)
- **PLAT-01 phone normalization**: Function strips `whatsapp:` prefix and prepends `+` (RED until Plan 02)

### test-whatsapp-format.js (PLAT-02)
All 6 tests GREEN — formatter.js was designed for WhatsApp from the start. Tests serve as regression guards to prevent accidental Markdown drift.

### test-conversation.js additions (DLVR-03)
- **DLVR-03 cleanup prompt**: `buildSystemPrompt()` must contain instruction to ask about deleting customer record (RED until Plan 03)
- **DLVR-03 translateError**: `translateError("")` returns non-empty plain-language string (GREEN)

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

Files created:
- tests/unit/test-whatsapp-gateway.js — FOUND
- tests/unit/test-whatsapp-format.js — FOUND

Files modified:
- tests/unit/test-conversation.js — FOUND (DLVR-03 section appended)

Commits:
- 0523b63 — FOUND
- 5ce5b35 — FOUND
