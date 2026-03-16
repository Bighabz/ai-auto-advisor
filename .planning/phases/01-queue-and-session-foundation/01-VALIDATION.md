---
phase: 1
slug: queue-and-session-foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-15
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Custom Node.js runner (`tests/unit/run.js`) |
| **Config file** | None — `run.js` auto-discovers `test-*.js` files |
| **Quick run command** | `node tests/unit/run.js` |
| **Full suite command** | `node tests/unit/run.js` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `node tests/unit/run.js`
- **After every plan wave:** Run `node tests/unit/run.js`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 01-01-01 | 01 | 1 | SESS-01 | integration | `node tests/unit/test-session-store.js` | ❌ W0 | ⬜ pending |
| 01-01-02 | 01 | 1 | SESS-02 | integration | `node tests/unit/test-session-store.js` | ❌ W0 | ⬜ pending |
| 01-01-03 | 01 | 1 | SESS-03 | unit | `node tests/unit/test-session-store.js` | ❌ W0 | ⬜ pending |
| 01-02-01 | 02 | 1 | QUEUE-01 | unit | `node tests/unit/test-job-queue.js` | ❌ W0 | ⬜ pending |
| 01-02-02 | 02 | 1 | QUEUE-02 | unit | `node tests/unit/test-job-queue.js` | ❌ W0 | ⬜ pending |
| 01-02-03 | 02 | 1 | QUEUE-03 | unit | `node tests/unit/test-job-queue.js` | ❌ W0 | ⬜ pending |
| 01-02-04 | 02 | 1 | QUEUE-04 | unit | `node tests/unit/test-job-queue.js` | ❌ W0 | ⬜ pending |
| 01-03-01 | 03 | 2 | QUEUE-01 | integration | manual Telegram test | N/A | ⬜ pending |
| 01-04-01 | 04 | 1 | MODEL-01 | unit | `node tests/unit/test-model-ids.js` | ❌ W0 | ⬜ pending |
| 01-04-02 | 04 | 1 | MODEL-02 | unit | `node tests/unit/test-model-ids.js` | ❌ W0 | ⬜ pending |
| 01-04-03 | 04 | 1 | MODEL-03 | unit | `node tests/unit/test-model-ids.js` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/unit/test-job-queue.js` — stubs for QUEUE-01 through QUEUE-04
- [ ] `tests/unit/test-session-store.js` — stubs for SESS-01 through SESS-03
- [ ] `tests/unit/test-model-ids.js` — stubs for MODEL-01 through MODEL-03

*Existing `tests/unit/run.js` infrastructure covers test discovery.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Queue position message appears in Telegram | QUEUE-02 | Requires live Telegram bot + Chrome | Send 2 estimates back-to-back at @hillsideautobot, verify second gets position message |
| Session survives Pi restart | SESS-01 | Requires actual Pi reboot | Run estimate, restart sam-telegram service, send "delete that estimate" |
| Progress updates during pipeline | QUEUE-04 | Requires live pipeline run | Send estimate, watch for status messages during 15-min pipeline |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
