# Phase 2: Conversational Engine - Research

**Researched:** 2026-03-16
**Domain:** Claude tool_use conversation engine, system prompt design, error translation, shared module extraction
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**SAM Personality:**
- No intro if user sends a question or request — jump straight to business
- If user just says "hi" or greeting, then introduce: brief, professional, what SAM does
- Returning users: no greeting, no context recall — just respond to what they said
- Tone for explanations: textbook but short (P0420 = catalyst system efficiency below threshold, most commonly failing catalytic converter)
- Errors are NOT acceptable — retry silently, use fallbacks, only surface issues as absolute last resort. No visible errors to shop staff if at all possible
- No humor, no slang — professional advisor tone throughout

**Customer Info Collection:**
- Inline prompt: "Got it — 2014 Versa, wheel bearings. Customer name and phone so I can build it in AutoLeap?"
- Always require BOTH name and phone before running — no exceptions
- Structured format expected: name + 10-digit phone (Claude parses reasonable variations)
- If they give wrong info: start over ("Wrong name — let me restart. Customer name and phone?")
- If no customer info available: insist ("I need a name and number to build the estimate. Send it when you have it and I'll start.")
- If customer already exists in AutoLeap (matching phone): ask to confirm ("I found a John Smith at 555-9876 in AutoLeap — same person?")
- If new request arrives while waiting for customer info: queue both ("Got the Civic too — still need customer info for the Versa first, then I'll do the Civic.")

**Intent Routing:**
- Explicit estimate triggers: "build an estimate for...", "I need a quote for...", "customer needs..."
- Ambiguous messages like "got a Camry in the bay, brakes are shot": confirm first ("Sounds like a brake job on the Camry. Want me to build the estimate?")
- If they give year + make + model + problem with explicit request language: always run estimate (after collecting customer info)
- Pure knowledge questions ("what causes P0420?"): 2-3 sentence authoritative answer, no pipeline triggered
- Edge case "how much is X for Y vehicle?": treat as estimate request if they give specifics

**Progress Updates:**
- Just 2 messages: "Working on it..." at start, then the result
- Minimal activity indicator style — just proves SAM is alive, not step-by-step play-by-play
- No percentages, no milestone breakdown — keep it quiet and professional

**Error Handling Philosophy:**
- Errors should be invisible to the user whenever possible
- Retry failed steps silently before giving up
- Use fallback data (AI labor estimate when MOTOR fails, cached pricing when PartsTech times out)
- Only if ALL fallbacks fail, surface a brief, professional note in the estimate response
- Never show raw error messages, stack traces, or technical details to shop staff

### Claude's Discretion
- Exact system prompt wording (guided by personality decisions above)
- Conversation state machine implementation details
- How to handle tool_result history management
- Retry strategy (how many retries, backoff timing)
- Shared module structure and exports

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CONV-01 | SAM has a consistent professional advisor personality across all messages | System prompt rewrite with locked personality rules; no humor, no slang, textbook-short explanations |
| CONV-02 | SAM collects customer name and phone conversationally before running estimate | Inline prompt pattern with slot-fill confirmation; BOTH required gate; AutoLeap lookup for existing customer confirm |
| CONV-03 | SAM answers general automotive questions without triggering the estimate pipeline | Intent routing in system prompt: explicit triggers vs. ambiguous vs. pure knowledge; confirmation-before-run for ambiguous |
| CONV-04 | SAM sends progress updates during the pipeline | Simple 2-message pattern: immediate ACK + final result; progressCallback already wired in orchestrator |
| CONV-05 | SAM provides immediate acknowledgment within 3 seconds of any message | ACK sent before pipeline; fast-path for non-tool responses; polling loop fix to prevent chat responses queuing behind pipeline |
| CONV-06 | SAM distinguishes between estimate requests and general questions (no false triggers) | Stronger system prompt with explicit negative examples; "vehicle in the bay" language guard; ambiguous = confirm first |
| ERR-01 | Partial results are shown when some pipeline steps fail | results.warnings[] already populated by orchestrator; formatter already translates ERROR_MESSAGES; wire through consistently |
| ERR-02 | All errors are translated to plain shop language | ERROR_MESSAGES map already exists in formatter.js; extend it; never expose raw error strings |
| ERR-03 | Pipeline failures don't crash the bot — SAM recovers and stays responsive | tool_result must be pushed in finally block (not after handleToolCall); session stays valid after pipeline error |
</phase_requirements>

---

## Summary

Phase 2 extracts and rewrites the conversation logic from `skills/telegram-gateway/scripts/server.js` into a shared `skills/shared/conversation.js` module. The primary work is three things: (1) rewriting the system prompt to match locked personality decisions, (2) fixing two correctness bugs in the current conversation loop (tool_result history corruption and chat messages blocked behind the pipeline), and (3) making the 2-message progress pattern work reliably.

The good news: the infrastructure is almost entirely already built. Session store (Phase 1), job queue (Phase 1), error message translations (formatter.js), and progress callback interface (orchestrator.js) all exist. This phase is mostly extraction + rewrite + bug fixes, not new infrastructure.

The key risk is Pitfall M5: if the tool_result history push is skipped when a pipeline throws, the Claude session becomes permanently broken (malformed message array). This must be fixed unconditionally.

**Primary recommendation:** Rewrite the system prompt first (establishes the personality contract), then extract `processMessage` + `handleToolCall` into `conversation.js`, fix the tool_result history bug in the move, and wire the 2-message progress pattern.

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@anthropic-ai/sdk` | (already installed) | Claude API client, tool_use conversation | Already in use; `client.messages.create()` with `tools` array |
| `@supabase/supabase-js` | ^2.95.3 | Session persistence (via session-store.js) | Already in use; Phase 1 built the session store |
| `node-fetch` | ^3.3.2 | HTTP (Telegram API calls) | Already in use; ESM-only, dynamic import pattern |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@esm2cjs/p-queue` | ^7.3.0 | Serial job queue | Already in use via job-queue.js; no new install needed |

### No New Installs Needed
All libraries for Phase 2 are already installed. This phase is pure code extraction and rewrite — no new `npm install` required.

---

## Architecture Patterns

### Recommended Module Structure

The shared conversation module goes into `skills/shared/`:

```
skills/shared/
├── conversation.js          # NEW — extracted + rewritten conversation engine
├── session-store.js         # Phase 1 — already exists
├── job-queue.js             # Phase 1 — already exists
├── logger.js                # exists
├── retry.js                 # exists
└── contracts.js             # exists

skills/telegram-gateway/scripts/
├── server.js                # MODIFIED — strip processMessage/handleToolCall, import from conversation.js
└── (other files unchanged)

tests/unit/
└── test-conversation.js     # NEW — unit tests for conversation.js
```

### Pattern 1: System Prompt Contract

The system prompt is the single most important artifact for CONV-01, CONV-03, and CONV-06.

Key rules that must be in the prompt:
1. **Greeting detection**: "If the ONLY content of a message is a greeting (hi, hey, hello, good morning, yo, what's up, etc.), respond with a one-sentence intro: who SAM is and what SAM does."
2. **Estimate trigger specificity**: Never call `run_estimate` unless the vehicle is being worked on NOW. The word "customer" or "in the bay" or explicit "build/quote/estimate" is the signal. Hypothetical questions, price inquiries, "how much does X cost?" are NOT triggers.
3. **Ambiguous vehicle + problem**: Confirm first. "Sounds like [service] on the [vehicle]. Want me to build the estimate?"
4. **Customer info gate**: No `run_estimate` call until BOTH name AND phone are collected. Inline ask: "Got it — [year] [make] [model], [service]. Customer name and phone so I can build it in AutoLeap?"
5. **Slot-fill commit sentence**: "Once you have name + phone, confirm with: 'Got it — [Name] at [phone]. Running the estimate now.' Then call the tool." This forces Claude to commit before acting (prevents Pitfall M2 re-ask loops).
6. **Knowledge questions**: Answer directly in 2-3 sentences. No tool call. Authoritative, textbook-short.
7. **Error tone**: Never say "I'm sorry" or show raw error text. If something failed, note the fallback used ("Used AI labor estimate — MOTOR data unavailable").
8. **No humor, no slang**: Every message sounds like a sharp colleague, not a chatbot.

### Pattern 2: Shared conversation.js Exports

```javascript
// Source: skills/telegram-gateway/scripts/server.js (extracted + hardened)
module.exports = {
  processMessage,      // (platform, chatId, userText) -> { text, toolCall, stopReason }
  handleToolCall,      // (platform, chatId, toolCall) -> { messages, pdfPath, wiringDiagrams }
  buildTools,          // () -> TOOLS array (ESTIMATE_TOOL, ORDER_TOOL, APPROVE_TOOL, CLEANUP_TOOL)
  buildSystemPrompt,   // (lastEstimate) -> string
  addToolResult,       // (platform, chatId, toolCallId, resultSummary) -> Promise<void>
};
```

The key interface change: `processMessage` takes `platform` as first arg so it works for both Telegram and WhatsApp gateways without modification. The session store already uses `platform:chatId` keys — this threads through naturally.

### Pattern 3: Tool Result History (Correctness Fix)

Current code in `server.js` pushes the tool_result AFTER `handleToolCall()` returns. If `handleToolCall()` throws, the push is skipped and the message array is malformed — next Claude call gets "Invalid message format" API error (Pitfall M5).

Fix: push the tool_result in a `finally` block, always:

```javascript
// Source: derived from Anthropic messages API spec (tool_use requires paired tool_result)
let toolResult = { messages: ["Pipeline error — try again."] };
try {
  toolResult = await handleToolCall(platform, chatId, toolCall);
} finally {
  // ALWAYS add tool_result — even on throw — or message array becomes malformed
  const session = await sessionStore.getSession(platform, chatId);
  const history = session?.history || [];
  if (history.length > 0) {
    const summary = toolResult.messages
      ? toolResult.messages.join(" ").substring(0, 300)
      : "Done";
    history.push({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: toolCall.id, content: summary }],
    });
    await sessionStore.setSession(platform, chatId, { ...session, history });
  }
}
```

### Pattern 4: 2-Message Progress (CONV-04, CONV-05)

User decision: just 2 messages. "Working on it..." at start, result at end.

Implementation: send the ACK immediately (before pipeline), no editing needed. The current code already does this for `run_estimate` — but only for that one tool, and it has the Markdown parse risk. Simplify:

```javascript
// ACK: no parse_mode — vehicle name can contain characters that break Markdown
await telegramAPI("sendMessage", {
  chat_id: chatId,
  text: `Working on it...`,
});
// Pipeline runs
// Result: sent as formatted messages
```

The 3-message progress stage calls (diagnosis_done, research_done, building_estimate) that currently edit the ACK message can be removed entirely — user decided just 2 messages. This eliminates Pitfall M1 (edit rate-limit desync) entirely.

The `FEAT_PROGRESS` flag and `editMessage` calls in `progressCallback` can be removed from `handleToolCall`. The `progressCallback` parameter in `buildEstimate()` should still be passed (for future use) but left as a no-op in this phase.

### Pattern 5: Fast-Path for Non-Tool Responses (CONV-05)

Current polling loop: `await handleMessage(chatId, text, username)` — this blocks the loop for the full pipeline duration (10+ min) even for pure chat responses. A tech asking "what causes P0420?" while an estimate runs waits 10 minutes.

Fix: detect whether Claude called a tool BEFORE committing to the pipeline queue. Pure chat responses (`stopReason === "end_turn"` and no `toolCall`) return immediately without touching the queue:

```javascript
const { text, toolCall, stopReason } = await processMessage(platform, chatId, messageText);

if (!toolCall) {
  // Pure chat — respond immediately, no queue involvement
  return { messages: [text || "Say that again?"] };
}

// Tool call — goes through queue path
const toolResult = await handleToolCall(platform, chatId, toolCall);
// ...
```

This is already almost the structure in `handleMessage()` in `server.js` — it just needs the tool detection to happen before the pipeline call, not inside `handleToolCall()`.

### Pattern 6: History Token Budget

Current code trims by message count (`MAX_HISTORY = 20`). A single `tool_result` containing a full estimate summary can be 300-500 tokens. After several estimate runs, the history exceeds practical token budget even under 20 messages (Pitfall C4).

Fix: trim tool_result content in history to a 30-word summary. Never store the full formatted estimate in the history — just store outcome metadata:

```javascript
// When adding tool_result to history, slim it down
const summary = toolResult.messages
  ? toolResult.messages.join(" ").substring(0, 200)  // 200 chars ≈ 40 tokens
  : "Done";
```

The full estimate text lives in `session.lastEstimate` (Supabase), not in the Claude message history. Claude reads `lastEstimate` from the system prompt context block, not from history. Keep history lean.

### Anti-Patterns to Avoid

- **Separate state machine for slot-filling**: Don't build a custom FSM to track "name collected" / "phone collected" flags. Claude handles multi-turn collection fine with clear instructions. A separate state machine creates two sources of truth and more bugs than it prevents (confirmed by PITFALLS.md M2).
- **editMessage for progress updates**: Removed per user decision. Editing introduces Telegram rate-limit fragility (Pitfall M1). Just send 2 messages.
- **Storing full estimate text in Claude history**: Keeps history lean; full data lives in session.lastEstimate.
- **Re-throwing inside handleToolCall**: Always return `{ messages: [...] }` error objects, never throw. The `finally` block pattern above requires this.
- **Cross-importing platform formatters**: The Telegram gateway should not import `formatForWhatsApp()` for its own chat responses. Formatter produces estimate output only — chat messages are plain strings from Claude.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Conversation history storage | Custom DB schema | `session-store.js` (Phase 1) | Already built — `platform:chatId` composite key, Supabase-backed with memcache |
| Job serialization | Custom mutex/lock | `job-queue.js` (Phase 1) | Already built — `enqueueEstimate()` with `notifyPosition` callback |
| Error message translation | New error handler | `formatter.js` `ERROR_MESSAGES` map | Already 10+ error codes mapped; extend don't replace |
| Intent classification | NLU pipeline / regex | Claude `tool_use` | Claude handles routing natively via system prompt + tool definitions |
| Retry / circuit breaker | Custom retry logic | `skills/shared/retry.js` | Already built — `withRetry()`, `circuitBreaker()`, feature-flagged |

**Key insight:** Phase 2 is an extraction and hardening phase. Almost all needed infrastructure was built in Phase 1 or exists in pre-existing skills. The work is: rewrite the system prompt, extract conversation logic into a shared module, fix the tool_result history bug.

---

## Common Pitfalls

### Pitfall 1: tool_result History Corruption (CRITICAL — ERR-03)
**What goes wrong:** If `handleToolCall()` throws (pipeline exception), the tool_result push is skipped. The next Claude call sees a malformed message array (tool_use with no matching tool_result) and throws "Invalid message format." The session becomes permanently broken until restart.

**Why it happens:** Current code pushes tool_result AFTER `handleToolCall()` returns — only executes on success path.

**How to avoid:** Move tool_result push into a `finally` block. Always push a tool_result, even if content is "Pipeline error — try again." This is a correctness requirement of the Anthropic messages API.

**Warning signs:** "Claude error: invalid message" in logs after any pipeline exception. Session returns "brain glitch" errors on subsequent messages.

### Pitfall 2: Tool Trigger on Ambiguous Shop Talk (CONV-06)
**What goes wrong:** "Got a Camry in the bay, brakes are shot" — Claude calls `run_estimate` immediately, launching the full pipeline, creating a real AutoLeap RO before the tech confirmed they wanted it.

**Why it happens:** Current system prompt says "if vehicle + problem, trigger it." Doesn't distinguish "present in the shop" vs. "talking about a repair."

**How to avoid:** Add "confirm first" instruction for ambiguous messages. Explicit signals: "build an estimate", "I need a quote", "customer needs", "customer is here", "got [vehicle] in the bay" (present tense + location). Hypotheticals, price questions, knowledge questions = never trigger.

**Warning signs:** Phantom ROs in AutoLeap after casual vehicle conversations.

### Pitfall 3: Customer Info Re-Ask Loop (CONV-02)
**What goes wrong:** Tech gives name in one message, phone in next. Claude asks "And the phone number?" Then asks again "Got it — just to confirm, what's the phone?"

**Why it happens:** Claude infers collected state by re-reading history. Without a commit sentence, it stays in uncertainty.

**How to avoid:** System prompt must include: "Once you have name + phone, confirm with one message: 'Got it — [Name] at [phone]. Running the estimate now.' Then call the tool." Forces Claude to commit what it has.

**Warning signs:** Same question asked twice in one session. Tech sends info twice in quick succession.

### Pitfall 4: Chat Responses Queued Behind Pipeline (CONV-05)
**What goes wrong:** Tech asks "what does P0420 mean?" while an estimate is running. Answer arrives 10-15 minutes later.

**Why it happens:** Current polling loop awaits `handleMessage()` for every message. If `handleMessage()` calls the pipeline, subsequent messages wait.

**How to avoid:** Detect tool call BEFORE committing to pipeline queue. `stopReason === "end_turn"` with no `toolCall` = return immediately. Only `toolCall.name === "run_estimate"` goes through the queue.

**Warning signs:** All chat responses delayed by previous pipeline. Tech thinks bot is unresponsive.

### Pitfall 5: Markdown Parse Failure on ACK Message
**What goes wrong:** "Working on it! Building estimate for 2019 Honda Civic..." — Telegram Markdown fails if the vehicle name or customer name contains underscores, parentheses, or other special chars. The ACK never sends.

**Why it happens:** `sendMessage()` uses `parse_mode: "Markdown"` by default.

**How to avoid:** The ACK message (plain "Working on it...") should be sent WITHOUT parse_mode. No Markdown in the initial ACK — it's plain text anyway.

**Warning signs:** Tech never sees the "Working on it" message. No immediate ACK under CONV-05.

---

## Code Examples

### Revised System Prompt Structure (CONV-01, CONV-03, CONV-06)

```javascript
// Derived from locked decisions in CONTEXT.md
const SAM_SYSTEM = `You are SAM, an AI service advisor assistant for auto repair shops. Shop technicians and owners text you throughout the day.

PERSONALITY:
- Professional advisor tone — like a sharp, reliable colleague
- Concise — this is text messaging. 2-3 sentences max for chat responses.
- Textbook-short technical explanations: accurate, specific, no fluff
- No humor, no slang, no hedging ("I think", "maybe", "I'm just an AI")
- No greetings on repeat messages — just respond to what they said

GREETING RULE:
If the ONLY content of the message is a greeting (hi, hey, hello, good morning, etc.) with no vehicle or question, respond with one sentence: briefly introduce SAM and what it does.
Example: "SAM here — send me a vehicle and problem and I'll build the estimate, look up parts pricing, and have it ready in AutoLeap."

INTENT ROUTING:

Estimate request (call run_estimate after collecting customer info):
- Explicit language: "build an estimate", "I need a quote", "customer needs", "write up"
- Vehicle present in shop: "got a [vehicle] in the bay", "customer brought in", "working on"
- Specific service + vehicle: "2019 Civic catalytic converter" with any request intent

Ambiguous (confirm FIRST before running):
- Vehicle + problem described but no explicit request: "got a Camry, brakes are shot"
- Response: "Sounds like [service] on the [year] [make] [model]. Want me to build the estimate?"
- Wait for YES before collecting customer info or running

Knowledge question (answer directly, no tool):
- "What does P0420 mean?" → 2-3 sentence answer. No pipeline.
- "What causes rough idle?" → direct answer
- "How long does X take?" → direct answer
- "What's the going rate for X?" → direct answer
- Price/time questions phrased as hypotheticals → answer, no tool

CUSTOMER INFO COLLECTION:
When ready to run (confirmed estimate request), ask inline:
"Got it — [year] [make] [model], [service]. Customer name and phone so I can build it in AutoLeap?"
- Require BOTH name AND phone — no exceptions
- Parse reasonable formats: "John Smith, 555-867-5309" or two separate messages
- Confirm with ONE message before calling tool: "Got it — [Name] at [phone]. Running the estimate now."
- Then immediately call run_estimate

If no info provided: "I need a name and number to build the estimate. Send it when you have it."
If new request arrives while waiting: "Got the [vehicle] too — still need customer info for the [first vehicle] first, then I'll do the [second vehicle]."

EXISTING CUSTOMER CHECK:
If run_estimate returns a matching AutoLeap customer, ask: "I found [Name] at [phone] in AutoLeap — same person?"

ERROR TONE:
Never show raw errors or technical details. If a step failed, note what fallback was used:
"Labor based on AI estimate — MOTOR data wasn't available."
"Parts pricing unavailable — marked TBD in AutoLeap."

FORMATTING:
*bold* for key numbers. Keep all chat responses SHORT.`;
```

### conversation.js Module Skeleton

```javascript
// skills/shared/conversation.js
"use strict";

/**
 * Conversation Engine — Shared module for Telegram and WhatsApp gateways.
 *
 * Exports:
 *   processMessage(platform, chatId, userText) -> { text, toolCall, stopReason }
 *   handleToolCall(platform, chatId, toolCall, sendAck) -> { messages, pdfPath, wiringDiagrams }
 *   buildTools() -> TOOLS array
 *   buildSystemPrompt(lastEstimate) -> string
 */

const sessionStore = require("./session-store");
const { enqueueEstimate, getStatus } = require("./job-queue");
const { createLogger } = require("./logger");

const log = createLogger("conversation");
const MAX_HISTORY = 20;
const HISTORY_SUMMARY_MAX = 200;  // chars — keep tool_result summaries slim

// ... (tool definitions, system prompt, processMessage, handleToolCall)

module.exports = { processMessage, handleToolCall, buildTools, buildSystemPrompt };
```

### tool_result History Safety Pattern (ERR-03)

```javascript
// In handleMessage() — the fix for Pitfall M5
async function handleMessage(platform, chatId, messageText) {
  const { text, toolCall, stopReason } = await processMessage(platform, chatId, messageText);

  // Fast path: pure chat response — no queue, no pipeline
  if (!toolCall) {
    return { messages: [text || "Say that again?"] };
  }

  // Tool call path — always produce a tool_result, even on error
  let toolResult = { messages: ["Something went wrong — try sending the job again."] };
  try {
    toolResult = await handleToolCall(platform, chatId, toolCall);
  } catch (err) {
    log.error("handleToolCall threw unexpectedly", { err: err.message });
  } finally {
    // CRITICAL: always push tool_result to prevent malformed message array
    await addToolResult(platform, chatId, toolCall.id,
      toolResult.messages ? toolResult.messages.join(" ").substring(0, HISTORY_SUMMARY_MAX) : "Done"
    );
  }

  const allMessages = [];
  if (text && text.trim()) allMessages.push(text.trim());
  if (toolResult.messages) allMessages.push(...toolResult.messages);
  return { messages: allMessages, pdfPath: toolResult.pdfPath, wiringDiagrams: toolResult.wiringDiagrams || [] };
}
```

### Error Translation (ERR-02)

The `ERROR_MESSAGES` map in `formatter.js` already exists with 10+ codes. Extend it and ensure all error paths go through it. For chat-context errors (not estimate results), use inline plain language:

```javascript
// Translation map for pipeline failures surfaced in chat
const CHAT_ERROR_MESSAGES = {
  "no AutoLeap credentials": "AutoLeap isn't configured — set AUTOLEAP_EMAIL to enable estimate creation.",
  "timeout": "That took longer than expected. Try sending the job again.",
  "Chrome not running": "Browser isn't ready — checking Chrome connection.",
};

function translateError(rawError) {
  const msg = rawError || "";
  for (const [key, friendly] of Object.entries(CHAT_ERROR_MESSAGES)) {
    if (msg.toLowerCase().includes(key.toLowerCase())) return friendly;
  }
  // Generic fallback — never show raw error
  return "Something went wrong — try sending the job again.";
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| In-memory Map for sessions | Supabase-backed session-store.js | Phase 1 (complete) | Sessions survive service restarts |
| No job queue | p-queue concurrency:1 via job-queue.js | Phase 1 (complete) | Serial pipeline; no Chrome corruption |
| Hardcoded model IDs | Env var controlled (CLAUDE_SONNET_MODEL) | Phase 1 (complete) | Model upgrade without code deploy |
| Polling loop blocks on pipeline | Fast-path for non-tool responses | Phase 2 (this phase) | Chat responses instant regardless of pipeline state |
| tool_result pushed after return | tool_result in finally block | Phase 2 (this phase) | Session never corrupts on pipeline error |
| Step-by-step progress messages | 2 messages: ACK + result | Phase 2 (this phase) | Simpler, no Telegram rate-limit risk |
| Telegram-specific conversation logic | Shared conversation.js module | Phase 2 (this phase) | Both gateways use identical engine |

**Deprecated/outdated (to remove in this phase):**
- `FEAT_PROGRESS` flag and `editMessage` progress calls in `handleToolCall` — replaced by simple ACK + result pattern
- `SAM_SYSTEM` constant hardcoded in `server.js` — moves to `conversation.js`
- `processMessage` and `handleToolCall` as top-level functions in `server.js` — extracted to `conversation.js`
- `MAX_HISTORY = 20` message-count trimming — replace with token-aware trim (or at minimum, slim tool_result summaries)

---

## Open Questions

1. **AutoLeap customer lookup for CONV-02 "existing customer confirm"**
   - What we know: When `run_estimate` fires, the AutoLeap playbook already searches by phone via `searchCustomer()` in `autoleap-api.js`. If it finds a match, it uses the existing customer.
   - What's unclear: Does `searchCustomer()` return the found customer details before the playbook creates the estimate? Where in the flow does the "I found John Smith — same person?" confirm happen?
   - Recommendation: Check `autoleap-api.js` `searchCustomer()` return shape. The confirm can happen BEFORE calling `run_estimate` (in the customer info collection turn) IF the gateway does a pre-check, OR it can be surfaced as a `results.existingCustomer` field from the playbook. The simpler path: surface it post-pipeline as a follow-up message if the playbook found and used an existing customer. Defer the pre-check path unless the user specifically asks for it.

2. **WhatsApp gateway wiring scope in this phase**
   - What we know: CONTEXT.md says "All extracted into a shared `conversation.js` module usable by both gateways." REQUIREMENTS.md shows PLAT-01 (shared engine) is Phase 2, PLAT-02/PLAT-03 (platform formatting differences) are Phase 3.
   - What's unclear: Does Phase 2 wire `conversation.js` into the WhatsApp gateway, or just create the shared module for Phase 3 to consume?
   - Recommendation: Create `conversation.js` that works for both, update Telegram to use it. Leave WhatsApp gateway wiring to Phase 3 where platform formatting differences are addressed. The module should be designed for both from day one.

3. **Ambiguous intent: "how much is X for Y vehicle?"**
   - What we know: CONTEXT.md says "treat as estimate request if they give specifics."
   - What's unclear: "Specifics" is vague — is `"how much for front brakes on a 2019 Camry"` specific enough?
   - Recommendation: Treat year + make + model + part/service as "specific." Respond with "Sounds like front brakes on the 2019 Camry. Want me to build the estimate?" (ambiguous confirm path) rather than triggering immediately. Safer than triggering on a price question.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Custom Node.js test runner (no external test framework) |
| Config file | none — runner is `tests/unit/run.js` |
| Quick run command | `node tests/unit/run.js` (from project root) |
| Full suite command | `node tests/unit/run.js` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CONV-01 | SAM personality rules enforced in system prompt | unit (source text scan) | `node tests/unit/run.js` | ❌ Wave 0 |
| CONV-02 | Customer info gate: run_estimate blocked without name+phone | unit (mock Claude) | `node tests/unit/run.js` | ❌ Wave 0 |
| CONV-03 | Knowledge questions return text, no tool call | unit (mock Claude) | `node tests/unit/run.js` | ❌ Wave 0 |
| CONV-04 | Progress ACK sent before pipeline | unit (mock telegramAPI) | `node tests/unit/run.js` | ❌ Wave 0 |
| CONV-05 | Non-tool responses return without queue wait | unit (timing assertion) | `node tests/unit/run.js` | ❌ Wave 0 |
| CONV-06 | Ambiguous messages trigger confirm, not tool | unit (mock Claude) | `node tests/unit/run.js` | ❌ Wave 0 |
| ERR-01 | Partial results surfaced when some steps fail | unit (mock orchestrator with partial results) | `node tests/unit/run.js` | ❌ Wave 0 |
| ERR-02 | Raw errors translated to plain language | unit (translateError function) | `node tests/unit/run.js` | ❌ Wave 0 |
| ERR-03 | tool_result always pushed in finally; session valid after pipeline error | unit (throw in handleToolCall) | `node tests/unit/run.js` | ❌ Wave 0 |

**Note on testing approach:** The existing test files (`test-job-queue.js`, `test-session-store.js`) use a zero-dependency pattern — plain `assert()` function, no test framework. New `test-conversation.js` must follow the same pattern. Tests that need Claude responses can use a `mockClaude` function that returns a hardcoded `{ content: [...], stop_reason: "end_turn" }` object without making real API calls.

### Sampling Rate
- **Per task commit:** `node tests/unit/run.js`
- **Per wave merge:** `node tests/unit/run.js`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/unit/test-conversation.js` — covers CONV-01 through CONV-06, ERR-01 through ERR-03
- [ ] `skills/shared/conversation.js` — the module itself (to be created in implementation)

---

## Sources

### Primary (HIGH confidence)
- `skills/telegram-gateway/scripts/server.js` — full source read; current processMessage, handleToolCall, TOOLS, SAM_SYSTEM
- `skills/shared/session-store.js` — full source read; getSession, setSession, makeKey, memcache pattern
- `skills/shared/job-queue.js` — full source read; enqueueEstimate, getStatus, notifyPosition
- `skills/whatsapp-gateway/scripts/formatter.js` — partial read; ERROR_MESSAGES map, formatForWhatsApp
- `.planning/codebase/ARCHITECTURE.md` — architecture analysis
- `.planning/codebase/CONVENTIONS.md` — code conventions
- `.planning/research/PITFALLS.md` — domain pitfall analysis (C2, C4, M1, M2, M4, M5)
- `.planning/phases/02-conversational-engine/02-CONTEXT.md` — user decisions

### Secondary (MEDIUM confidence)
- `.planning/research/FEATURES.md` — feature landscape and MVP ordering
- `.planning/REQUIREMENTS.md` — requirement definitions and traceability
- Anthropic Messages API: tool_use requires paired tool_result in message array — verified from pitfall documentation cross-referencing API spec

### Tertiary (LOW confidence)
- None — all claims grounded in direct source code or documented research

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries already installed and in use; no new dependencies
- Architecture: HIGH — extraction pattern is clear from reading source code; shared module structure follows established `skills/shared/` convention
- System prompt design: HIGH — user decisions in CONTEXT.md are specific and locked; rewrite is deterministic
- Pitfalls: HIGH — C4, M2, M5 identified from direct source code analysis; M1 from existing code behavior

**Research date:** 2026-03-16
**Valid until:** 2026-04-16 (stable — no fast-moving external dependencies in this phase)
