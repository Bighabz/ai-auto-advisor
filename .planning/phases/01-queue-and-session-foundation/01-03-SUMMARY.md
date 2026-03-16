---
phase: 01-queue-and-session-foundation
plan: 03
subsystem: infra
tags: [p-queue, job-queue, eventEmitter, concurrency, serial-queue, chromium]

# Dependency graph
requires:
  - phase: 01-01
    provides: test-job-queue.js scaffold (QUEUE-01 through QUEUE-04 test cases)
provides:
  - skills/shared/job-queue.js singleton serial queue (enqueueEstimate, getStatus, emitter, queue)
  - Concurrency-1 PQueue preventing concurrent Chrome session corruption
  - EventEmitter job:start / job:complete / job:error event bus
affects:
  - 01-05-PLAN.md (wire job-queue into both gateways — imports enqueueEstimate)
  - 02-03-PLAN.md (progress events from emitter into gateway response layer)
  - 03-01-PLAN.md (gateway-core.js imports shared queue)

# Tech tracking
tech-stack:
  added:
    - "@esm2cjs/p-queue — CJS-wrapped ESM fork of p-queue v9, installed via npm"
  patterns:
    - "Singleton module: all exports are module-level constants — importers share one queue instance per process"
    - "Synchronous activeJobs.set() before queue.add() — prevents double-enqueue race in single-threaded Node.js"
    - "position = queue.size + queue.pending + 1 — accounts for the running job (pending) plus waiting jobs (size)"
    - "activeJobs.delete() in finally block — guarantees cleanup on success, failure, and cancellation"
    - "p-queue import with try/catch fallback — @esm2cjs/p-queue primary, native p-queue secondary"

key-files:
  created:
    - skills/shared/job-queue.js
  modified:
    - package.json (added @esm2cjs/p-queue dependency)

key-decisions:
  - "position = queue.size + queue.pending + 1 (not queue.size + 1) — when job 1 is running and job 2 arrives, queue.size=0 and queue.pending=1, so queue.size+1 would wrongly report position 1 instead of 2"
  - "notifyPosition called whenever queue.pending > 0 || queue.size > 0 (not only queue.size > 0) — catches the case where the queue has one running job and zero waiting jobs"
  - "waitMinutes = (queue.size + queue.pending) * 15 — accounts for both the running job and any waiting jobs ahead"
  - "@esm2cjs/p-queue chosen over native p-queue@9.1.0 — CJS-explicit, no require(esm) flag dependency, consistent with codebase CommonJS convention"

patterns-established:
  - "Singleton queue pattern: module.exports = { enqueueEstimate, getStatus, emitter, queue } — gateways import named exports, never re-instantiate"
  - "activeJobs Map keyed by userId string (e.g. 'telegram:12345') — same key format as session-store"

requirements-completed: [QUEUE-01, QUEUE-02, QUEUE-03, QUEUE-04]

# Metrics
duration: 5min
completed: 2026-03-16
---

# Phase 01 Plan 03: Job Queue Summary

**Singleton serial job queue using @esm2cjs/p-queue (concurrency:1) with EventEmitter, preventing concurrent Chrome session corruption on the Pi**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-16T07:16:02Z
- **Completed:** 2026-03-16T07:21:00Z
- **Tasks:** 1
- **Files modified:** 2 (job-queue.js created, package.json updated)

## Accomplishments

- Implemented `skills/shared/job-queue.js` — singleton queue that serializes all `buildEstimate()` calls to one at a time
- All 7 `test-job-queue.js` tests pass: single run, sequential two-job, getStatus running, idempotent re-enqueue, notifyPosition callback, null after completion, null for unknown user
- Installed `@esm2cjs/p-queue` (CJS-wrapped ESM) with native p-queue fallback for Node.js 22 compatibility
- Correct position math: `queue.size + queue.pending + 1` accounts for the running job and all waiting jobs

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement skills/shared/job-queue.js** - `e928487` (feat: in prior session, job-queue.js was bundled with the 01-04 model ID migration commit)

Note: The implementation file was committed in commit `e928487 feat(01-04)` during a prior execution session where plans ran slightly out of order. The file was verified fully correct and all 7 tests pass. No re-commit was needed.

## Files Created/Modified

- `skills/shared/job-queue.js` — Singleton serial job queue with enqueueEstimate, getStatus, emitter, queue exports
- `package.json` — Added @esm2cjs/p-queue dependency (11 packages installed)

## Decisions Made

- **Position formula:** `queue.size + queue.pending + 1` rather than the naive `queue.size + 1` found in the research pattern. When one job is running and zero are waiting, `queue.size=0` and `queue.pending=1`, so the second user is correctly told they are position 2 (not position 1).
- **notifyPosition trigger condition:** Called whenever `queue.pending > 0 || queue.size > 0` — catches both "job running, none waiting" and "job running, more waiting" cases.
- **CJS-first import:** `@esm2cjs/p-queue` primary with `p-queue` as fallback. Keeps the require pattern consistent with the rest of the CommonJS codebase without requiring Node.js 22's experimental `require(esm)`.

## Deviations from Plan

### Context: Implementation Pre-Existed in Git

**Found during:** Task 1 setup

**Context:** When starting execution of plan 01-03, `skills/shared/job-queue.js` was already tracked in git under commit `e928487 feat(01-04)`. A prior session had executed plans out of order (01-04 before 01-03) and included the job-queue.js file in the model ID migration commit.

**Resolution:** Verified the pre-existing implementation against all plan requirements:
- Correct p-queue import with fallback
- Correct position formula (queue.size + queue.pending + 1)
- Synchronous activeJobs.set() before queue.add()
- notifyPosition called with correct condition
- activeJobs.delete() in finally block
- All 7 tests pass

No code changes were needed. The implementation is correct. This is documented as an ordering deviation, not a functional deviation.

**Impact:** Zero — implementation is correct and fully tested. The out-of-order execution had no negative consequences.

---

**Total deviations:** 1 ordering note (no auto-fix rules triggered — implementation was already correct)
**Impact on plan:** None. All success criteria satisfied.

## Issues Encountered

- git commit appeared to fail (exit code 1) due to unstaged files in working tree, but the staged files (job-queue.js, package.json) were actually already committed in a prior session as part of commit `e928487`. Verified by confirming `git show HEAD:skills/shared/job-queue.js` returned the correct content.

## User Setup Required

None — no external service configuration required. `@esm2cjs/p-queue` installs as a standard npm package. The queue module is ready to import.

## Next Phase Readiness

- `skills/shared/job-queue.js` is ready to be wired into both gateways in Plan 01-05
- Queue emits `job:start`, `job:complete`, `job:error` events for Plan 02-03 progress reporting
- `enqueueEstimate(userId, jobFn, { notifyPosition })` is the stable API surface for gateway integration
- No blockers for Plan 01-05

---
*Phase: 01-queue-and-session-foundation*
*Completed: 2026-03-16*
