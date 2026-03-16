---
phase: 02-conversational-engine
plan: "02"
subsystem: api
tags: [anthropic, claude, tool-use, session-store, job-queue, conversation, dependency-injection]

# Dependency graph
requires:
  - phase: 02-01
    provides: test scaffold (test-conversation.js) with 9 test cases for CONV-01..06 and ERR-01..03
  - phase: 01-queue-and-session-foundation
    provides: session-store.js and job-queue.js shared modules
provides:
  - skills/shared/conversation.js — shared conversation engine (622 lines) exporting processMessage, handleMessage, buildSystemPrompt, buildTools, translateError
affects:
  - Phase 3 WhatsApp gateway wiring
  - Phase 3 Telegram gateway refactor (server.js can import handleMessage from conversation.js)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - deps-injection pattern — claudeClient, sessionStore, enqueueEstimate, sendAck all injectable for unit testing without real API calls
    - session-store adapter pattern — single-key mock interface vs two-arg real store interface handled via makeSessionAdapter()
    - conditional import pattern — AUTOLEAP_EMAIL guard + try/catch prevents require errors in test env
    - finally-block history push — tool_result always written to history regardless of pipeline throw (ERR-03)

key-files:
  created:
    - skills/shared/conversation.js
  modified: []

key-decisions:
  - "Session adapter pattern: mock stores use platform::chatId single-key; real store uses (platform, chatId) two-arg — makeSessionAdapter() normalises both behind a consistent internal interface"
  - "Removed FEAT_PROGRESS and editMessage — progress model is just ACK before pipeline, result after (CONV-04 simplified)"
  - "formatForWhatsApp wrapped in try/catch fallback — partial results from enqueueEstimate don't have full vehicle shape, so formatter crash is graceful"
  - "No humor, no slang, no AI disclaimers verbatim removed from system prompt — test asserts prompt does not contain 'just an AI'"

patterns-established:
  - "deps-injection for Claude client: deps.claudeClient || new Anthropic({apiKey: process.env.ANTHROPIC_API_KEY})"
  - "Error translation layer: all catch blocks call translateError(err.message), never return raw strings"
  - "Fast-path guard: if (!toolCall) return immediately — non-tool responses never touch job queue (CONV-05)"

requirements-completed: [CONV-01, CONV-02, CONV-03, CONV-04, CONV-05, CONV-06, ERR-01, ERR-02, ERR-03]

# Metrics
duration: 12min
completed: 2026-03-16
---

# Phase 2 Plan 02: Shared Conversation Engine Summary

**Deps-injectable Claude conversation engine with professional advisor system prompt, ACK-before-pipeline ordering, finally-block history integrity, and plain-language error translation — all 13 test-conversation.js tests pass GREEN**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-03-16T18:35:00Z
- **Completed:** 2026-03-16T18:47:00Z
- **Tasks:** 2 (combined into 1 commit — same file, both verified GREEN simultaneously)
- **Files modified:** 1

## Accomplishments
- Created `skills/shared/conversation.js` (622 lines) — the primary deliverable of Phase 2
- All 13 test-conversation.js tests pass (CONV-01 through CONV-06, ERR-01 through ERR-03, buildTools shape)
- Full test suite remains 10/10 suites passing (0 failures)
- Professional advisor system prompt with no humor, no slang, greeting detection, ambiguous-confirm, and commit-sentence rules
- tool_result always written to session history in finally block (ERR-03 session integrity)
- Non-tool responses bypass job queue entirely (CONV-05 fast path)
- translateError maps known patterns to plain shop language (ERR-02)
- results.warnings[] surfaced via getErrorMessage() (ERR-01)

## Task Commits

Each task was committed atomically:

1. **Task 1 + Task 2: Create skills/shared/conversation.js** - `e481b88` (feat)

_Note: Both TDD tasks target the same file and were verified GREEN in the same test run. Combined into one atomic commit._

## Files Created/Modified
- `skills/shared/conversation.js` — Shared conversation engine: processMessage, handleMessage, buildSystemPrompt, buildTools, translateError

## Decisions Made
- Session adapter pattern to bridge mock (single-key) vs real (two-arg) store interfaces — the test mock's `getSession(key)` takes one arg while the real store takes `(platform, chatId)`. Solved with `makeSessionAdapter()` that uses `platform::chatId` composite key for mocks and `(platform, chatId)` for the real store.
- Removed FEAT_PROGRESS and editMessage entirely — progress model simplified to ACK + result as per CONTEXT.md locked decisions.
- `formatForWhatsApp` wrapped in try/catch — test's partial result `{ labor, parts, warnings }` doesn't have the full vehicle shape, so without the guard, formatter crashes. Fallback message preserves ERR-01 warning display.
- System prompt text: "no AI disclaimers of any kind" (replaced original phrasing that contained the substring "just an AI" which would fail the test assertion).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] System prompt contained "just an AI" substring in prohibition clause**
- **Found during:** Task 1 verification (test run)
- **Issue:** The prohibition clause read: `no "I'm just an AI" disclaimers` — the test asserts `!prompt.includes("just an AI")`, so the string used to explain what NOT to say triggered the assertion
- **Fix:** Rephrased to `no AI disclaimers of any kind`
- **Files modified:** skills/shared/conversation.js
- **Verification:** CONV-01 test passes
- **Committed in:** e481b88

**2. [Rule 1 - Bug] formatForWhatsApp crash on partial results from enqueueEstimate mock**
- **Found during:** Task 2 verification (ERR-01 test run)
- **Issue:** ERR-01 test's `enqueueWithWarnings` returns `{ labor: null, parts: 299, warnings: ["NO_MOTOR_LABOR"] }` — `formatForWhatsApp` attempts `results.vehicle.year` which throws because `vehicle` is undefined
- **Fix:** Wrapped `formatForWhatsApp(results)` in try/catch with fallback message; warning notes are still appended after the fallback, preserving ERR-01 behavior
- **Files modified:** skills/shared/conversation.js
- **Verification:** ERR-01 test passes, warning note appears in output
- **Committed in:** e481b88

---

**Total deviations:** 2 auto-fixed (2 Rule 1 bugs found during TDD RED→GREEN cycle)
**Impact on plan:** Both fixes necessary for GREEN test state. No scope creep.

## Issues Encountered
- Session store interface mismatch: test mock uses single-arg `getSession(key)` while real store uses two-arg `getSession(platform, chatId)`. Resolved via `makeSessionAdapter()` wrapper — transparent to callers, no test changes needed.

## Self-Check: PASSED
- FOUND: skills/shared/conversation.js
- FOUND: commit e481b88
- Test suite: 10 suites, 0 failed
- Exports verified: [ 'processMessage', 'handleMessage', 'buildSystemPrompt', 'buildTools', 'translateError' ]

## Next Phase Readiness
- `conversation.js` is ready for import by both Telegram and WhatsApp gateways (Phase 3)
- `server.js` can replace its inline `processMessage` + `handleToolCall` with `handleMessage` from conversation.js
- WhatsApp gateway server.js wiring is Phase 3 scope
- No blockers
