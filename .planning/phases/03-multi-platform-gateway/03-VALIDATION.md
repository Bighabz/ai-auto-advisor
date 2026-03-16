---
phase: 3
slug: multi-platform-gateway
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-16
---

# Phase 3 — Validation Strategy

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
| 03-01-01 | 01 | 1 | PLAT-01..03, DLVR-03 | unit | `node tests/unit/run.js` | ❌ W0 | ⬜ pending |
| 03-02-01 | 02 | 2 | PLAT-02 | unit | `node tests/unit/run.js` | ❌ W0 | ⬜ pending |
| 03-03-01 | 03 | 3 | PLAT-01, PLAT-03 | unit | `node tests/unit/run.js` | ❌ W0 | ⬜ pending |
| 03-03-02 | 03 | 3 | DLVR-03 | unit | `node tests/unit/run.js` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tests/unit/test-whatsapp-gateway.js` — stubs for PLAT-01, PLAT-03
- [ ] `tests/unit/test-whatsapp-format.js` — stubs for PLAT-02
- [ ] Cleanup test case added to `test-conversation.js` for DLVR-03

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| WhatsApp message formatting looks correct | PLAT-02 | Visual assessment on device | Send estimate via WhatsApp, check no raw Markdown symbols |
| PDF arrives as WhatsApp attachment | PLAT-02 | Requires Twilio/Meta API + real phone | Send estimate, verify PDF attachment downloads on phone |
| Cleanup works on both platforms | DLVR-03 | Requires live bot on both Telegram + WhatsApp | Run test estimate, "delete that" on both platforms |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
