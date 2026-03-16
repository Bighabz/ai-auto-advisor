---
phase: 03-multi-platform-gateway
plan: "03"
subsystem: conversation
tags: [system-prompt, cleanup, claude, conversation-engine]

# Dependency graph
requires:
  - phase: 03-multi-platform-gateway
    provides: test scaffold with DLVR-03 RED stub for cleanup customer-ask behavior
provides:
  - buildSystemPrompt() includes CLEANUP COMMANDS section instructing Claude to ask about customer record deletion before calling cleanup_estimate
  - delete_customer_vehicle parameter guidance baked into shared system prompt
affects: [telegram-gateway, whatsapp-gateway, conversation-engine]

# Tech tracking
tech-stack:
  added: []
  patterns: [system-prompt-instruction-for-pre-tool-confirmation]

key-files:
  created: []
  modified:
    - skills/shared/conversation.js

key-decisions:
  - "CLEANUP COMMANDS section appended after FORMATTING section — surgical addition, no existing content changed"
  - "Instruction placed in shared engine (conversation.js) so both Telegram and WhatsApp get identical cleanup behavior with no platform-specific code"

patterns-established:
  - "Pre-tool-call instruction pattern: system prompt instructs Claude to ask a clarifying question before invoking a destructive tool"

requirements-completed: [PLAT-02, DLVR-03]

# Metrics
duration: 4min
completed: 2026-03-16
---

# Phase 3 Plan 03: Cleanup Customer-Ask System Prompt Summary

**CLEANUP COMMANDS section added to buildSystemPrompt() — Claude now asks "Delete just the estimate, or also the customer record?" before calling cleanup_estimate on both Telegram and WhatsApp**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-16T22:50:00Z
- **Completed:** 2026-03-16T22:54:00Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Added CLEANUP COMMANDS section to `buildSystemPrompt()` in the shared conversation engine
- DLVR-03 test turns GREEN (was the only RED test in test-conversation.js)
- All 15 test-conversation.js tests now pass (14 previously passing + 1 newly GREEN)
- Behavior is platform-agnostic — lives in shared engine, applies identically on Telegram and WhatsApp (satisfies PLAT-02)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add cleanup customer-ask instruction to buildSystemPrompt()** - `512cb7a` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified
- `skills/shared/conversation.js` - Appended CLEANUP COMMANDS block to system prompt template literal (7 lines added, 1 line modified)

## Decisions Made
- Placed the new section after FORMATTING (end of main prompt string) and before the `lastEstimate` context block — keeps logical ordering: personality → routing → collection → errors → formatting → cleanup
- Used exact wording from CONTEXT.md locked decision: "Delete just the estimate, or also the customer record?"
- Instruction specifies the tool's two-step preview/confirm behavior is handled internally — prevents Claude from adding a redundant preview before calling the tool

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- DLVR-03 requirement satisfied: cleanup prompt instructs Claude to ask about customer record deletion
- PLAT-02 satisfied: cleanup behavior is shared-engine-driven, identical on both platforms
- Phase 3 Wave 2 plans can proceed (03-04 and beyond if any remain)
- test-whatsapp-gateway.js has 4 pre-existing RED stubs from 03-01 (PLAT-01/PLAT-03) — these are awaiting their respective Wave 2 plans, not a concern for this plan

---
*Phase: 03-multi-platform-gateway*
*Completed: 2026-03-16*
