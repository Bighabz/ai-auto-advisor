# Phase 3: Multi-Platform Gateway - Context

**Gathered:** 2026-03-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Wire WhatsApp gateway to the same `conversation.js` shared module that Telegram already uses. Build a unified gateway-core dispatcher so both platforms share the same SAM brain, queue, and session store. Platform-specific formatting (Telegram Markdown vs WhatsApp bold-only). Cleanup command works on both platforms with confirmation.

</domain>

<decisions>
## Implementation Decisions

### WhatsApp Formatting
- Match Telegram format as closely as possible — strip any unsupported Markdown symbols
- WhatsApp supports `*bold*` and `_italic_` — use those where Telegram uses Markdown
- Any symbols WhatsApp can't render (code blocks, headers, etc.) get stripped to plain text
- PDF sent as WhatsApp document attachment (tap to download)

### Cleanup UX
- Full detail confirmation: "Delete RO#16589 — John Smith, 2002 Toyota RAV4 ($1,254.22)? Reply YES to confirm."
- Two-step: preview first (confirmed=false), then delete on explicit YES (confirmed=true) — already built in Phase 1
- When deleting, ask each time: "Delete just the estimate, or also the customer record?"
- Same flow on both Telegram and WhatsApp — no platform differences in cleanup behavior

### Claude's Discretion
- Gateway-core dispatcher architecture (how unified module is structured)
- Express vs raw http for WhatsApp server (research recommended Express)
- How to handle progress message delivery differences (Telegram edits vs WhatsApp new messages — note: user decided only 2 messages, so editing may not be needed)
- Platform adapter interface design
- WhatsApp PDF attachment mechanism (Twilio media URL vs Meta Graph API)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `skills/shared/conversation.js`: Phase 2 deliverable — `handleMessage()` accepts platform string and deps injection, ready for WhatsApp
- `skills/shared/session-store.js`: Platform-aware with `platform:chatId` composite key — already supports `whatsapp:+phone`
- `skills/shared/job-queue.js`: Singleton per process — each gateway gets its own queue instance (documented limitation)
- `skills/whatsapp-gateway/scripts/formatter.js`: Existing `formatForWhatsApp()` — 2-message format already built
- `skills/whatsapp-gateway/scripts/server.js`: Existing WhatsApp gateway with raw http module — needs refactoring

### Established Patterns
- Telegram gateway is now a thin adapter importing from `conversation.js` — WhatsApp should follow same pattern
- `conversation.handleMessage("telegram", chatId, text, { sendAck, notifyPosition })` — WhatsApp calls same with `"whatsapp"` platform
- Session store already handles both platforms via composite key

### Integration Points
- `skills/whatsapp-gateway/scripts/server.js`: Main refactor target — strip duplicated logic, import from `conversation.js`
- `skills/telegram-gateway/scripts/server.js`: Reference implementation of thin adapter pattern
- Webhook endpoint: `http://137.184.4.157:3000/webhook` (VPS) or Pi equivalent

</code_context>

<specifics>
## Specific Ideas

No specific requirements — follow the Telegram adapter pattern established in Phase 2. WhatsApp should feel identical to Telegram from the shop's perspective.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 03-multi-platform-gateway*
*Context gathered: 2026-03-16*
