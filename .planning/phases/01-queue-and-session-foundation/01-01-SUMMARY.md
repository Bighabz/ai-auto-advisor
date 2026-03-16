---
phase: 01-queue-and-session-foundation
plan: "01"
subsystem: test-scaffolding
tags: [testing, tdd, model-ids, job-queue, session-store]
dependency_graph:
  requires: []
  provides:
    - QUEUE-01 through QUEUE-04 test coverage (test-job-queue.js)
    - SESS-01 through SESS-03 test coverage (test-session-store.js)
    - MODEL-01 through MODEL-03 test coverage (test-model-ids.js)
  affects:
    - plans/01-02 (session-store implementation driven by test-session-store.js)
    - plans/01-03 (job-queue implementation driven by test-job-queue.js)
    - plans/01-04 (model ID migration gated by test-model-ids.js turning green)
tech_stack:
  added: []
  patterns:
    - "Try/require guard: if module absent, print WARNING and exit 0 — allows suite to run during Wave 1"
    - "test-model-ids.js reads source files via fs.readFileSync — no module require for grep-style tests"
    - "Intentional RED state: test-model-ids.js fails before Plan 01-04 by design"
key_files:
  created:
    - tests/unit/test-job-queue.js
    - tests/unit/test-session-store.js
    - tests/unit/test-model-ids.js
  modified: []
decisions:
  - "test-model-ids.js intentionally exits 1 before Plan 01-04 — this is the RED state; run.js reports 1 failed suite which is expected"
  - "try/require guard pattern keeps suite healthy when job-queue.js and session-store.js do not yet exist"
  - "motor-nav.js uses claude-haiku-4-5-20251001 (not deprecated), but still fails test because it is a hardcoded string not env var"
metrics:
  duration: "2 minutes"
  completed_date: "2026-03-16"
  tasks_completed: 2
  tasks_total: 2
  files_created: 3
  files_modified: 0
---

# Phase 1 Plan 01: Test Scaffold Foundation Summary

**One-liner:** Three TDD scaffold files establishing the verification contract for queue, session, and model-ID requirements — with graceful skip guards for absent modules.

## What Was Built

Three test files added to `tests/unit/` that are auto-discovered by the existing `run.js` runner:

**test-job-queue.js** (QUEUE-01 through QUEUE-04)
- 7 test cases: single job runs immediately, second job queues after first, getStatus during/after execution, idempotent re-enqueue, notifyPosition callback, null for unknown user
- Try/require guard: if `skills/shared/job-queue` absent → WARNING + exit 0
- Tests written against the interface `enqueueEstimate(userId, jobFn, { notifyPosition })` + `getStatus(userId)` + `queue` export

**test-session-store.js** (SESS-01 through SESS-03)
- 7 test cases: makeKey format, getSession null for unknown key, setSession+getSession round-trip, platform/chat_id fields, deleteSession, in-memory fallback, cleanupExpiredSessions graceful when no Supabase
- Try/require guard: if `skills/shared/session-store` absent → WARNING + exit 0
- Supabase round-trip test skipped if `SUPABASE_URL` env var absent

**test-model-ids.js** (MODEL-01 through MODEL-03)
- 9 test cases reading source files directly via `fs.readFileSync` (no module require)
- Checks: no hardcoded model strings in server.js, diagnose.js, motor-nav.js; each must use the appropriate `process.env.CLAUDE_SONNET_MODEL` or `process.env.CLAUDE_HAIKU_MODEL`
- **Intentional RED state** before Plan 01-04: currently exits 1 with 7 failures

## Verification Results

```
node tests/unit/run.js
Suites: 8 passed, 1 failed (9 total)
```

- All 6 pre-existing test suites still pass (contracts, health, logger, retry, session-manager, tab-manager)
- test-job-queue.js: exit 0 (WARNING — module absent guard)
- test-session-store.js: exit 0 (WARNING — module absent guard)
- test-model-ids.js: exit 1 with 7 failures (EXPECTED RED — hardcoded model strings still in source)

Current failing assertions in test-model-ids.js:
- `server.js` has `"claude-sonnet-4-5-20250929"` at line 219 (needs env var)
- `diagnose.js` has `const CLAUDE_MODEL = "claude-sonnet-4-5-20250929"` (needs env var)
- `motor-nav.js` has `"claude-haiku-4-5-20251001"` at line 1288 (needs env var)

## Deviations from Plan

None — plan executed exactly as written.

## Commits

| Task | Description | Hash |
|------|-------------|------|
| 1 | test-job-queue.js scaffold (QUEUE-01–04) | 92046af |
| 2 | test-session-store.js + test-model-ids.js scaffolds | 350c961 |

## Self-Check: PASSED

Files created:
- tests/unit/test-job-queue.js: EXISTS
- tests/unit/test-session-store.js: EXISTS
- tests/unit/test-model-ids.js: EXISTS

Commits:
- 92046af: EXISTS
- 350c961: EXISTS
