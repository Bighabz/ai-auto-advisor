# Phase 3: Multi-Platform Gateway - Research

**Researched:** 2026-03-16
**Domain:** Node.js platform adapter pattern, WhatsApp formatting, Twilio/Meta PDF delivery, cleanup UX
**Confidence:** HIGH — grounded entirely in existing codebase analysis; no speculative external library research needed

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **WhatsApp Formatting:** Match Telegram format as closely as possible — strip any unsupported Markdown symbols. WhatsApp supports `*bold*` and `_italic_` — use those where Telegram uses Markdown. Any symbols WhatsApp can't render (code blocks, headers, etc.) get stripped to plain text. PDF sent as WhatsApp document attachment (tap to download).
- **Cleanup UX:** Full detail confirmation: "Delete RO#16589 — John Smith, 2002 Toyota RAV4 ($1,254.22)? Reply YES to confirm." Two-step: preview first (confirmed=false), then delete on explicit YES (confirmed=true) — already built in Phase 1. When deleting, ask each time: "Delete just the estimate, or also the customer record?" Same flow on both Telegram and WhatsApp — no platform differences in cleanup behavior.

### Claude's Discretion
- Gateway-core dispatcher architecture (how unified module is structured)
- Express vs raw http for WhatsApp server (research recommended Express)
- How to handle progress message delivery differences (Telegram edits vs WhatsApp new messages — note: user decided only 2 messages, so editing may not be needed)
- Platform adapter interface design
- WhatsApp PDF attachment mechanism (Twilio media URL vs Meta Graph API)

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PLAT-01 | Shared conversation engine used by both Telegram and WhatsApp gateways | `conversation.js` already accepts platform string; WhatsApp server.js needs to call `conversation.handleMessage("whatsapp", ...)` instead of its own bespoke `handleMessage()` |
| PLAT-02 | Platform-specific formatting (Telegram Markdown vs WhatsApp plain text) | formatter.js already exports `formatForWhatsApp()`; conversation.js already uses it for both; the gap is Telegram-specific rendering via `toTelegramMarkdown()` sitting only in telegram server.js |
| PLAT-03 | Progress updates delivered via message editing (Telegram) or new messages (WhatsApp) — both natural | Phase 2 decision simplified this: only 2 messages (ACK + result), no mid-pipeline edits needed. `sendAck` dep injection already handles platform difference |
| DLVR-03 | Cleanup command deletes test estimates with confirmation showing customer name + RO# | `cleanup_estimate` tool already built in conversation.js with two-step preview/confirm; WhatsApp server bypasses conversation.js so cleanup never reaches it — fix is wiring WhatsApp to conversation.js |
</phase_requirements>

---

## Summary

Phase 3 is fundamentally a **wiring task**, not a build task. The shared conversation engine (`conversation.js`) was built in Phase 2 specifically to be platform-agnostic. It accepts `platform` as a first argument, uses `session-store.js` which already supports the `whatsapp:+phone` composite key, and calls `formatForWhatsApp()` for both platforms already. The missing piece is that `whatsapp-gateway/scripts/server.js` still has its own bespoke `handleMessage()` function with duplicated routing logic (commands, parsing, queue checks) instead of delegating to `conversation.js`.

The Telegram gateway refactor in Phase 2 reduced `server.js` from 709 lines to 250 lines by stripping duplicated logic and calling `conversation.handleMessage()`. WhatsApp needs the exact same surgery. The key differences to preserve are: (1) the HTTP webhook server structure (vs long-poll), (2) Twilio TwiML vs Meta JSON response format, (3) PDF delivery via document attachment rather than file upload. The current WhatsApp server has a `TODO` comment for Meta PDF delivery — that needs resolving.

The cleanup command (DLVR-03) is already fully implemented in `conversation.js` including the two-step preview/confirm flow and the full detail string format the user asked for. It is only inaccessible from WhatsApp because WhatsApp bypasses `conversation.js`. Wiring WhatsApp to the shared engine gives cleanup for free.

**Primary recommendation:** Refactor `whatsapp-gateway/scripts/server.js` to follow the Telegram thin-adapter pattern exactly — strip all routing/pipeline logic, delegate to `conversation.handleMessage("whatsapp", ...)`, keep only Twilio/Meta wire protocol handling.

---

## Standard Stack

### Core (already in codebase — no new installs)
| Module | Location | Purpose | Status |
|--------|----------|---------|--------|
| `skills/shared/conversation.js` | existing | Shared engine — Claude routing, SAM personality, all tool handling | Ready, used by Telegram |
| `skills/shared/session-store.js` | existing | Platform-aware Supabase + memcache sessions | Ready, supports `whatsapp:+phone` |
| `skills/shared/job-queue.js` | existing | Singleton FIFO queue, prevents parallel Chrome | Ready |
| `skills/whatsapp-gateway/scripts/formatter.js` | existing | `formatForWhatsApp()` — 2-message format | Ready |
| `skills/whatsapp-gateway/scripts/parser.js` | existing | `parseMessage()`, `detectCommand()` | OBSOLETE after refactor — Claude handles routing |
| `node-fetch` | existing | HTTP requests (dynamic import pattern) | Ready |
| `form-data` | existing | Multipart for Telegram `sendDocument` | Ready |

### No New Dependencies Required
The refactor reuses everything already installed. The `parser.js` and `detectCommand()` approach gets retired — Claude's `tool_use` routing (already in `conversation.js`) replaces it on WhatsApp just as it replaced it on Telegram.

---

## Architecture Patterns

### Recommended Project Structure (after Phase 3)

```
skills/whatsapp-gateway/scripts/
├── server.js           # REFACTORED: thin adapter — HTTP webhook + Twilio/Meta wire protocol only
│                       # No routing logic, no buildEstimate calls, no session management
├── formatter.js        # UNCHANGED — formatForWhatsApp() already correct
└── parser.js           # RETIRED (kept for reference, no longer called by server.js)

skills/telegram-gateway/scripts/
└── server.js           # REFERENCE — already refactored in Phase 2, 250 lines
                        # WhatsApp server.js should look like this when done

skills/shared/
├── conversation.js     # UNCHANGED — already handles "whatsapp" platform string
└── session-store.js    # UNCHANGED — already handles platform:chatId composite key
```

### Pattern 1: Thin Adapter (Telegram reference implementation)

**What:** Platform server handles only wire protocol. All business logic lives in `conversation.js`.

**When to use:** Every platform gateway. Telegram already does this — WhatsApp copies the pattern.

```javascript
// THE PATTERN (from telegram-gateway/scripts/server.js, lines 221-236)
// Source: skills/telegram-gateway/scripts/server.js

return conversation.handleMessage("telegram", chatId, messageText.trim(), {
  sendAck: async () => {
    await telegramAPI("sendMessage", {
      chat_id: chatId,
      text: "Working on it...",
      // NO parse_mode — plain text avoids Markdown parse errors on vehicle names
    });
  },
  notifyPosition: async (pos, waitMin) => {
    await telegramAPI("sendMessage", {
      chat_id: chatId,
      text: `Got it! You're #${pos} in queue — one estimate is running now. Yours starts in ~${waitMin} min.`,
    });
  },
});
// Returns: { messages: string[], pdfPath?: string, wiringDiagrams?: object[] }
```

**WhatsApp equivalent — platform string changes, deps inject WhatsApp send functions:**

```javascript
// Source: inferred from conversation.js deps interface
// WhatsApp sendAck: POST to Twilio or Meta API (not TwiML — TwiML is synchronous response only)
// WhatsApp notifyPosition: same mechanism as sendAck
return conversation.handleMessage("whatsapp", from, messageText, {
  sendAck: async () => {
    await sendWhatsAppMessage(from, "On it — building the estimate now.");
  },
  notifyPosition: async (pos, waitMin) => {
    await sendWhatsAppMessage(from, `You're #${pos} in queue (~${waitMin} min). I'll send results when it's your turn.`);
  },
});
```

### Pattern 2: WhatsApp Response Delivery — Critical Architecture Decision

**The challenge:** Twilio TwiML responses are synchronous (respond to the POST). Meta Graph API messages are async (fire-and-forget). The conversation engine takes 15-60 seconds to run the pipeline — Twilio requires a response within 15 seconds or it retries.

**Current server.js approach (line 313-324):** TwiML responds immediately with formatted messages. This works for simple commands but will timeout for estimate pipeline (which takes 60s+).

**Correct pattern for pipeline requests:**
1. Respond to Twilio POST immediately with empty TwiML (200 OK, no messages)
2. Run pipeline async
3. Send result via Twilio REST API (outbound message, not TwiML response)

```javascript
// Twilio outbound message via REST API
// Source: Twilio documentation (verified against existing codebase pattern)
async function sendTwilioMessage(to, body, mediaUrl) {
  const fetch = (await import("node-fetch")).default;
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_NUMBER;
  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;

  const params = new URLSearchParams({ From: from, To: to, Body: body });
  if (mediaUrl) params.append("MediaUrl", mediaUrl);

  await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64"),
    },
    body: params,
  });
}
```

**Empty TwiML acknowledge:**
```xml
<?xml version="1.0" encoding="UTF-8"?><Response></Response>
```

### Pattern 3: WhatsApp PDF Delivery

**Twilio path:** PDF must be hosted at a publicly accessible URL. Twilio sends it as `MediaUrl` in the TwiML or REST API call. The Pi is on a residential IP — this is the blocker. Options:
- Upload to a temporary public URL (S3, Cloudflare R2, or DigitalOcean Spaces)
- Host a small static file server on the VPS and serve PDFs via its public IP
- Skip PDF on WhatsApp for now, mention "Check AutoLeap for PDF"

**Meta path:** Upload document to Meta's media endpoint first, then send as document message type.

```javascript
// Meta document send (when META_WHATSAPP_TOKEN is set)
// Source: Meta WhatsApp Business API docs (Graph API v18.0)
async function sendMetaDocument(to, filePath, caption) {
  const fetch = (await import("node-fetch")).default;
  const FormData = (await import("form-data")).default;
  const token = process.env.META_WHATSAPP_TOKEN;
  const phoneNumberId = process.env.META_PHONE_NUMBER_ID;

  // Step 1: Upload media
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("file", fs.createReadStream(filePath), { filename: "estimate.pdf" });
  const uploadResp = await fetch(
    `https://graph.facebook.com/v18.0/${phoneNumberId}/media`,
    { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form }
  );
  const { id: mediaId } = await uploadResp.json();

  // Step 2: Send document message
  await fetch(`https://graph.facebook.com/v18.0/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "document",
      document: { id: mediaId, caption: caption || "Estimate PDF" },
    }),
  });
}
```

### Pattern 4: WhatsApp Markdown Stripping

**What WhatsApp supports vs what it doesn't:**

| Markdown | Telegram | WhatsApp | Action |
|----------|----------|----------|--------|
| `*text*` | bold | bold | Keep as-is |
| `_text_` | italic | italic | Keep as-is |
| `**text**` | bold (after conversion) | not supported | Strip `**` → `*` |
| `` `code` `` | monospace | not supported | Strip backticks, keep text |
| `# Header` | not supported | not supported | Strip `#`, keep text |
| `---` | not supported | not supported | Strip entirely |
| `[text](url)` | inline link | not supported | Keep text only |

**Current formatter.js already uses `*bold*` and `_italic_`** — it was written for WhatsApp from the start. The formatter is correct. No changes needed to formatter.js.

**The Telegram adapter** does `**bold** → *bold*` conversion via `toTelegramMarkdown()` in `server.js`. This conversion lives only in the Telegram gateway, which is correct.

**WhatsApp adapter** should pass formatter output directly — no conversion needed since `formatForWhatsApp()` already produces WhatsApp-native markup.

### Anti-Patterns to Avoid

- **Keeping `parser.js` / `detectCommand()` active in WhatsApp server:** `conversation.js` uses Claude for intent routing. `detectCommand()` is a regex-based fallback that predates the Claude engine. Using both creates routing split-brain. Remove it from the server entrypoint, let Claude handle all routing.
- **Responding to Twilio with TwiML containing pipeline results:** Pipeline takes 60s, Twilio webhook timeout is 15s. TwiML works only for instant command responses (help, status). All pipeline responses must go via outbound REST API.
- **Re-implementing cleanup logic in WhatsApp server:** The `cleanup_estimate` tool in `conversation.js` already has the full two-step flow. Don't duplicate it.
- **Separate `handleMessage()` in WhatsApp server:** The current `server.js` has its own `handleMessage(from, messageText)` function that duplicates conversation routing. This is exactly what got deleted from Telegram in Phase 2. Delete it here too.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| WhatsApp intent routing | `detectCommand()` regex matching | `conversation.handleMessage()` via Claude | Claude already routes correctly; parser.js has false positives; conversation engine handles edge cases Claude was specifically prompted for |
| Session management | In-server `Map` per gateway | `session-store.js` already imported | Already imported in server.js line 49; just not used by the main handler path |
| Cleanup two-step flow | New WhatsApp-specific confirm logic | `cleanup_estimate` tool in conversation.js | Already has preview/confirm; already returns correct message format |
| PDF hosting for Twilio | Full file server | VPS static serve or "check AutoLeap" fallback | Twilio needs public URL; residential Pi IP unreachable from Twilio |

---

## Common Pitfalls

### Pitfall 1: Twilio Webhook Timeout (15 seconds)
**What goes wrong:** Current server.js awaits `handleMessage()` which awaits pipeline (60s). Twilio retries after 15s, creating duplicate jobs.
**Why it happens:** TwiML response model is synchronous — designed for quick IVR responses, not long-running AI pipelines.
**How to avoid:** Respond with empty `<Response/>` immediately after parsing the request. Fire pipeline handling async. Deliver results via Twilio REST API outbound message.
**Warning signs:** Duplicate estimates appearing, "second request in queue" messages from a single user action.

### Pitfall 2: WhatsApp `from` format differences
**What goes wrong:** Twilio sends `from` as `whatsapp:+15551234567`. Meta sends `from` as `15551234567` (no prefix, no `+`). Session key becomes inconsistent between providers.
**Why it happens:** Different wire format per provider.
**How to avoid:** Normalize `from` before using as session key:
```javascript
// Strip "whatsapp:" prefix and ensure "+" prefix
function normalizeWaFrom(raw) {
  let phone = raw.replace(/^whatsapp:/i, "");
  if (!phone.startsWith("+")) phone = "+" + phone;
  return phone;
}
```
**Warning signs:** "No recent estimate found" when user switches from Twilio sandbox to Meta, or "order those parts" fails to find session.

### Pitfall 3: `sendAck` timing with async pipeline
**What goes wrong:** In WhatsApp, `sendAck` fires mid-pipeline but conversation.js calls `deps.sendAck` before awaiting `handleToolCall`. With TwiML, the HTTP response has already been sent before sendAck fires, so sendAck must use the outbound REST API.
**Why it happens:** Twilio's webhook model is request/response. `sendAck` must be an outbound call, not part of the TwiML response.
**How to avoid:** Implement `sendAck` using `sendTwilioMessage()` or `sendMetaMessages()` — the same outbound function used for results.

### Pitfall 4: `formatForWhatsApp` assumes `results.estimate` shape
**What goes wrong:** The cleanup tool in `conversation.js` returns `{ messages: ["Deleted: ..."] }` — a simple string array. The WhatsApp server should pass these through directly, not through `formatForWhatsApp()`.
**Why it happens:** `formatForWhatsApp()` expects the full orchestrator results object with `vehicle`, `diagnosis`, `parts`, `estimate` keys. Non-estimate responses don't have that shape.
**How to avoid:** WhatsApp server just calls `for (const m of response.messages) await sendWhatsAppMessage(from, m)`. It doesn't run `formatForWhatsApp()` — that's already called inside `conversation.js` via `handleToolCall`.

### Pitfall 5: Regex `detectCommand()` conflicts with Claude routing
**What goes wrong:** If `parser.js` `detectCommand()` is still called before `conversation.handleMessage()`, messages like "approved" or "order" get handled by the regex shortcut, bypassing Claude's context-aware routing. This breaks cases like "what does that order confirmation mean?" being misrouted as `type: "approved"`.
**Why it happens:** The parser was written before Claude routing existed.
**How to avoid:** Remove `detectCommand()` from WhatsApp server entrypoint entirely. `conversation.js` handles all intent routing via Claude.

---

## Code Examples

### WhatsApp Server Structure After Refactor (target)
```javascript
// Source: inferred from telegram-gateway/scripts/server.js (Phase 2 reference)
// This is the full pattern — server.js should look like this

const http = require("http");
const conversation = require("../../shared/conversation");
const { queue } = require("../../shared/job-queue");
const sessionStore = require("../../shared/session-store");

// ... env loading, validateEnv, cleanup intervals (identical to Telegram) ...

async function sendWhatsAppMessage(to, body, mediaUrl) {
  // Twilio REST API outbound message
  // (NOT TwiML — async delivery, no 15s timeout constraint)
}

const server = http.createServer(async (req, res) => {
  if (req.method === "POST" && url.pathname === "/webhook") {
    // 1. Parse Twilio or Meta body
    // 2. Respond 200 IMMEDIATELY with empty TwiML or JSON
    res.writeHead(200, { "Content-Type": "text/xml" });
    res.end("<?xml version=\"1.0\"?><Response></Response>");

    // 3. Handle async — after response sent
    setImmediate(async () => {
      const response = await conversation.handleMessage("whatsapp", from, messageText, {
        sendAck: async () => sendWhatsAppMessage(from, "On it — building the estimate now."),
        notifyPosition: async (pos, waitMin) => sendWhatsAppMessage(from, `You're #${pos} in queue (~${waitMin} min).`),
      });

      for (const m of response.messages) {
        await sendWhatsAppMessage(from, m);
      }
      if (response.pdfPath) {
        await sendWhatsAppDocument(from, response.pdfPath, "Estimate PDF");
      }
    });
  }
});
```

### Cleanup Confirmation Message (already built in conversation.js)
```javascript
// Source: skills/shared/conversation.js lines 503-521
// cleanup_estimate tool — preview path (confirmed=false):
preview = `RO#${estData.code} — ${custName}, ${vehDesc}`;
if (estData.grandTotal) preview += ` ($${estData.grandTotal})`;
// Returns: { messages: ["Will delete estimate: RO#16589 — John Smith, 2002 Toyota RAV4 ($1,254.22). Reply YES to confirm."] }

// The "delete_customer_vehicle" ask must come FROM Claude's text before calling the tool.
// System prompt should instruct: "Before calling cleanup_estimate, ask whether to also delete customer record"
// Current system prompt does NOT have this instruction — needs adding.
```

### WhatsApp Phone Normalization
```javascript
// Source: inferred from Twilio/Meta API docs + existing server.js parseTwilioBody()
function normalizeWaPhone(raw) {
  let phone = String(raw || "").replace(/^whatsapp:/i, "").trim();
  if (phone && !phone.startsWith("+")) phone = "+" + phone;
  return phone;
}
// Usage: session key becomes "whatsapp:+15551234567" (consistent across Twilio and Meta)
```

---

## State of the Art

| Old Approach (current server.js) | New Approach (Phase 3) | Impact |
|----------------------------------|------------------------|--------|
| Bespoke `handleMessage()` in server.js with its own Claude calls | Delegate to `conversation.handleMessage()` | Single source of truth for routing |
| `detectCommand()` regex for "order", "approved", etc. | Claude tool_use routing in `conversation.js` | Handles edge cases, context-aware |
| TwiML-only response (synchronous, 15s timeout) | Empty TwiML ack + async outbound REST | No duplicate jobs from Twilio retries |
| Session store imported but unused in main path | `conversation.js` handles session internally | Estimate persisted, cleanup works |
| PDF delivery TODO comment | Twilio REST `MediaUrl` or Meta document upload | Actual PDF delivery |

**Deprecated after Phase 3:**
- `whatsapp-gateway/scripts/parser.js` — intent routing moves to Claude, file kept for reference
- `whatsapp-gateway/scripts/server.js` bespoke `handleMessage(from, messageText)` — deleted, replaced by `conversation.handleMessage("whatsapp", ...)` delegation

---

## Open Questions

1. **PDF hosting for Twilio WhatsApp**
   - What we know: Twilio requires a public URL for `MediaUrl`; the Pi is on residential IP (`192.168.1.232`) unreachable from Twilio; the VPS (`137.184.4.157`) is reachable; PDF is generated to `/tmp/` on Pi
   - What's unclear: Does Pi send PDF to VPS for hosting, or does this require a cloud storage upload step?
   - Recommendation: For Phase 3, implement PDF delivery as "PDF available in AutoLeap" fallback message when running on Pi; implement Twilio `MediaUrl` delivery only when `WHATSAPP_PDF_BASE_URL` env var is set (VPS or storage URL). This keeps the path clean without blocking the refactor.

2. **System prompt update for cleanup "delete customer?" ask**
   - What we know: The `delete_customer_vehicle` parameter exists in `cleanup_estimate` tool; current system prompt does not instruct Claude to ask about it first
   - What's unclear: Should the ask happen in Claude's conversational text before the tool call, or should the tool call always go first with `delete_customer_vehicle=false` and only ask on retry?
   - Recommendation: Add one instruction to system prompt: "Before calling cleanup_estimate, ask the user: 'Delete just the estimate, or also the customer record?' Then use their answer to set delete_customer_vehicle." This keeps the ask consistent on both platforms.

3. **`sendAck` in current conversation.js — fire-and-forget vs awaited**
   - What we know: `conversation.js` line 575 calls `deps.sendAck("Working on it...")` without awaiting the result (no `await`)
   - What's unclear: For WhatsApp, if `sendAck` makes an async HTTP call, not awaiting means the ack might arrive after the pipeline starts
   - Recommendation: The `sendAck` call in `conversation.js` should be `if (deps.sendAck) await deps.sendAck(...)` — verify current code and fix if needed. LOW risk since pipeline still takes 60s after ack.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Custom Node.js (no external test framework) |
| Config file | none — `tests/unit/run.js` discovers `test-*.js` files |
| Quick run command | `node tests/unit/run.js` |
| Full suite command | `node tests/unit/run.js` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PLAT-01 | `conversation.handleMessage("whatsapp", ...)` routes correctly | unit | `node tests/unit/test-conversation.js` | Already covers platform string |
| PLAT-01 | WhatsApp server delegates to conversation.js (no bespoke routing) | unit | `node tests/unit/test-whatsapp-gateway.js` | Wave 0 — needs creating |
| PLAT-02 | WhatsApp messages contain no raw `**double asterisks**` or code blocks | unit | `node tests/unit/test-whatsapp-format.js` | Wave 0 — needs creating |
| PLAT-02 | Telegram messages convert `**bold**` to `*bold*` | unit | `node tests/unit/test-whatsapp-format.js` | Wave 0 — needs creating |
| PLAT-03 | `sendAck` dep injected correctly for WhatsApp (fires before pipeline) | unit | `node tests/unit/test-whatsapp-gateway.js` | Wave 0 — needs creating |
| DLVR-03 | `cleanup_estimate` tool returns full detail string (RO# + name + vehicle + $) | unit | `node tests/unit/test-conversation.js` | Partial — no cleanup test yet |
| DLVR-03 | Cleanup confirmation prompt asks about customer deletion | unit | `node tests/unit/test-conversation.js` | Wave 0 — add test case |

### Sampling Rate
- **Per task commit:** `node tests/unit/run.js` (< 30s, all suites)
- **Per wave merge:** `node tests/unit/run.js`
- **Phase gate:** All suites pass before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/unit/test-whatsapp-gateway.js` — covers PLAT-01 (delegation to conversation.js), PLAT-03 (sendAck injection)
- [ ] `tests/unit/test-whatsapp-format.js` — covers PLAT-02 (no double-asterisks, no code blocks in WA output)
- [ ] Add `cleanup_estimate` test case to `tests/unit/test-conversation.js` — covers DLVR-03 full detail string

---

## Sources

### Primary (HIGH confidence — direct codebase analysis)
- `skills/shared/conversation.js` — handleMessage() interface, deps injection pattern, cleanup_estimate tool, formatForWhatsApp usage
- `skills/telegram-gateway/scripts/server.js` — thin adapter reference implementation (Phase 2 output, 250 lines)
- `skills/whatsapp-gateway/scripts/server.js` — current state, bespoke handleMessage, Twilio/Meta providers
- `skills/whatsapp-gateway/scripts/formatter.js` — existing WhatsApp formatting, already WA-native markup
- `skills/whatsapp-gateway/scripts/parser.js` — detectCommand() to be retired
- `skills/shared/session-store.js` — platform:chatId composite key, already supports whatsapp platform
- `skills/shared/job-queue.js` — singleton per process, getStatus() API

### Secondary (MEDIUM confidence — API docs knowledge)
- Twilio WhatsApp webhook 15-second timeout — standard documented constraint; async + REST API outbound is the prescribed pattern
- Meta Graph API v18.0 document message type — `type: "document"` with media ID upload; confirmed against existing `sendMetaMessages()` function shape in server.js
- WhatsApp supported formatting (`*bold*`, `_italic_`) vs unsupported (headers, code blocks) — well-documented limitation consistent with existing formatter.js design choices

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; all modules already in codebase
- Architecture: HIGH — direct analysis of Phase 2 Telegram thin adapter; WhatsApp follows identical pattern
- Pitfalls: HIGH — Twilio 15s timeout is a live production risk visible in current server.js `handleMessage()` design; phone normalization pitfall directly observable from Twilio/Meta format differences in existing code
- PDF delivery: MEDIUM — requires env-var gating decision; VPS hosting option documented but not verified end-to-end

**Research date:** 2026-03-16
**Valid until:** 2026-04-16 (stable domain — internal refactor, no fast-moving external APIs)
