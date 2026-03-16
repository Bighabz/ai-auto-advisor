---
phase: 2
slug: conversational-engine
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-16
---

# Phase 2 — Validation Strategy

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
| 02-01-01 | 01 | 1 | CONV-01..06, ERR-01..03 | unit | `node tests/unit/test-conversation.js` | ❌ W0 | ⬜ pending |
| 02-02-01 | 02 | 2 | CONV-01, CONV-06 | unit | `node tests/unit/test-conversation.js` | ❌ W0 | ⬜ pending |
| 02-02-02 | 02 | 2 | CONV-02 | unit | `node tests/unit/test-conversation.js` | ❌ W0 | ⬜ pending |
| 02-02-03 | 02 | 2 | CONV-03 | unit | `node tests/unit/test-conversation.js` | ❌ W0 | ⬜ pending |
| 02-03-01 | 03 | 3 | CONV-04, CONV-05 | unit | `node tests/unit/test-conversation.js` | ❌ W0 | ⬜ pending |
| 02-03-02 | 03 | 3 | ERR-01, ERR-02, ERR-03 | unit | `node tests/unit/test-conversation.js` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/unit/test-conversation.js` — stubs for CONV-01 through CONV-06 and ERR-01 through ERR-03

*Existing `tests/unit/run.js` infrastructure covers test discovery.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| SAM personality feels right in live chat | CONV-01 | Subjective tone assessment | Send 5 different message types to @hillsideautobot — greeting, car question, estimate request, approval, gibberish |
| Progress message appears during pipeline | CONV-04 | Requires live 15-min pipeline | Send estimate request, watch for "Working on it..." message |
| Customer info collection flow feels natural | CONV-02 | Requires multi-turn live conversation | Send estimate without customer info, verify SAM asks, provide info, verify pipeline starts |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
