# Domain Pitfalls

**Domain:** Conversational AI layer over a long-running estimate pipeline (shop advisor chatbot)
**Researched:** 2026-03-15
**Confidence:** HIGH (grounded in codebase analysis) / MEDIUM (LLM behavior, queue patterns)

---

## Critical Pitfalls

Mistakes that cause rewrites, data corruption, or pipeline failures in production.

---

### Pitfall C1: Concurrent Pipeline Runs Corrupt the Shared Chrome Instance

**What goes wrong:**
Two Telegram messages arrive within seconds of each other (e.g., owner sends a job while a tech sent one moments before). Both calls to `buildEstimate()` fire concurrently. Both use the same `puppeteer-core` connection on port 18800. The second playbook opens tabs that the first playbook is watching, steals focus, and navigates away from the AutoLeap estimate page mid-step. Both estimates corrupt silently — no error thrown, wrong parts linked to wrong labor, or estimate saved with $0 parts.

**Why it happens:**
There is no mutex or queue in front of `buildEstimate()`. The Telegram polling loop calls `handleMessage()` for each update in a `for` loop without any concurrency guard. Two updates in the same poll batch run as concurrent async calls. Identified in `CONCERNS.md` under "Missing Critical Features."

**Consequences:**
- Wrong estimate delivered to shop — real money impact if customer approves
- AutoLeap left in dirty state (tabs open, dialog stuck, Angular SPA state corrupted)
- Chrome instance may require restart to recover
- No error in logs — the corruption is silent

**Warning signs:**
- Two estimate requests received within the same 30-second polling window
- Log shows two "Claude triggered estimate" lines with overlapping timestamps
- PDF total doesn't match sum of labor + parts

**Prevention:**
Implement a serial queue (concurrency: 1) in front of `buildEstimate()`. The `p-queue` npm package (ESM, but wrappable) or a hand-rolled Promise-chain queue works. Queue logic belongs in `handleToolCall()`, not inside the orchestrator. Send "In the queue — I'll get to that next" immediately when a request arrives while the pipeline is running. Do not start the second estimate until the first resolves or rejects.

**Phase to address:** Queue and concurrency phase (first phase of new milestone).

---

### Pitfall C2: Tool Trigger on Ambiguous Shop Talk Fires a $0 Estimate

**What goes wrong:**
Claude's `run_estimate` tool fires on messages that sound like estimate requests but are actually shop-talk questions. Examples: "what's the going rate on a Civic water pump?" or "how long does a Camry timing chain usually take?" Claude extracts vehicle + problem from the question and calls the tool, launching a 10-minute pipeline that charges parts credits, creates a real AutoLeap RO, and sends a PDF for a job that was never actually in the shop.

**Why it happens:**
The system prompt tells Claude to trigger on "specific vehicle + specific problem," but the distinction between "talking about a repair" and "requesting an estimate for a vehicle in the bay" is subtle. Claude's tool-use tendency to be "over-helpful" (documented in LLM agentic failure research) means it errs toward action. The tool description says "service needed" which covers hypothetical questions.

**Consequences:**
- Phantom ROs in AutoLeap cluttering the shop's workboard
- PartsTech API credits wasted
- Tech receives an unsolicited estimate and is confused
- Cleanup flow required (the existing `cleanup_estimate` tool) every time

**Warning signs:**
- User asks a price or labor question phrased as a vehicle+problem
- Estimate pipeline fires on messages starting with "what does", "how long", "what's it cost"
- Frequent cleanup requests after estimate deliveries

**Prevention:**
Strengthen the system prompt: add explicit examples of questions that sound like estimate requests but are NOT (price checks, time estimates, hypotheticals). Add a "intent check" sentence: "Only call run_estimate if the vehicle is physically present at the shop." Consider a pre-tool confirmation: Claude sends "I'll run an estimate for that — go ahead?" before calling the tool, giving the tech a chance to say "no, just asking."

**Phase to address:** Conversational layer / system prompt refinement phase.

---

### Pitfall C3: In-Memory Conversation State Lost on Service Restart Breaks Ongoing Jobs

**What goes wrong:**
A tech sends a vehicle + problem. SAM responds "I need the customer name and phone." The `sam-telegram.service` restarts (OOM kill on Pi, systemd watchdog, or manual deployment). The tech sends the customer name. Now `conversations.get(chatId)` is empty — Claude has no history, doesn't know a vehicle was mentioned, and asks "What vehicle are we working on?" The tech has to restart the conversation from scratch. Worse: `sessions.get(chatId)` is also gone, so "order parts" and "customer approved" after a restart silently return "No recent estimate."

**Why it happens:**
Both `sessions` and `conversations` are JavaScript `Map` objects in process memory, initialized fresh on startup. Explicitly identified in `CONCERNS.md` under "In-memory Telegram session and conversation stores" and "Scaling Limits." The Pi is an embedded device that restarts more frequently than a managed server.

**Consequences:**
- Technician frustration — repeating information they already gave
- "customer approved" after restart does nothing — order never placed
- Lost context mid-collection (customer name collected but vehicle forgotten, or vice versa)

**Warning signs:**
- `sam-telegram.service` restart in `journalctl` logs
- Tech complains "I already told you the car"
- "No recent estimate to order from" after an estimate was built

**Prevention:**
Persist `sessions` (last estimate JSON) to Supabase on every write — a `telegram_sessions` table with `chat_id` + `last_estimate_json` + `updated_at`. This is the higher priority than conversations because it gates the approval/order flow. Conversation history is less critical — a brief "I restarted, can you re-send the vehicle info?" fallback is acceptable. Do not persist the full Claude message history to Supabase — it is too large and stale history confuses Claude more than it helps.

**Phase to address:** Session persistence phase, or as part of the queue phase since both require gateway refactoring.

---

### Pitfall C4: Claude History Grows Until Context Window Forces Truncation Mid-Estimate

**What goes wrong:**
A busy shop sends 30+ messages in a session. The `conversations` map for that chatId accumulates history. The `MAX_HISTORY = 20` limit trims messages from the front by count, not by token count. Each estimate pipeline result, when added as a `tool_result` message, can be 300-500 tokens (the `resultSummary` in `server.js` line 571). After enough turns, the context sent to Claude crosses the 200k token limit — or more practically, the system prompt + tool definitions + 20 turns of estimate-heavy history exceeds 20k tokens, causing Claude to lose the early part of the conversation and misfire.

**Why it happens:**
`MAX_HISTORY` trims by message count, not token budget. A single tool result containing a full estimate summary is 10x larger than a normal chat turn. The system prompt itself is ~700 tokens, and the 4 tool definitions add ~800 more. History management is naive.

**Consequences:**
- Claude forgets what vehicle/customer was being discussed
- Tool calls fire with wrong or missing parameters
- Claude re-asks for information the tech already provided

**Warning signs:**
- Sessions longer than 20 messages
- Claude starts asking "What vehicle are we working on?" mid-conversation
- `max_tokens` errors from the Anthropic API

**Prevention:**
Switch from message-count trimming to token-budget trimming. Keep the last 6k tokens of history (leaving room for system prompt + tools + response). Truncate tool result content when adding to history — a 30-word summary of the estimate outcome is enough for continuity. Never include the full formatted estimate text in the tool_result message; just include RO number, total, and outcome status.

**Phase to address:** Conversational layer / token budget phase.

---

## Moderate Pitfalls

Mistakes that degrade quality or reliability but don't cause data corruption.

---

### Pitfall M1: Progress Updates and the 60-Second ACK Message Desync

**What goes wrong:**
The `ackMessageId` from the "On it! Building estimate..." message is used to edit progress updates in place via `editMessage()`. If Telegram rate-limits the edit (it allows 20 edits/minute per bot, globally) or if the message ID expires (Telegram deletes old messages), the `editMessage()` call silently fails. The tech sees the original "On it!" message frozen for 10 minutes with no updates, then a burst of results arrives. Looks broken even when it isn't.

**Why it happens:**
`editMessage()` failures are caught with `catch (_) {}` (swallowed silently, `server.js` line 301). Telegram's edit API returns an error if the message is too old or already deleted, but the code ignores it.

**Consequences:**
- Progress updates appear frozen or missing
- Tech sends follow-up messages (which trigger Claude re-processing mid-pipeline)

**Warning signs:**
- No progress message edits visible in Telegram despite `TELEGRAM_PROGRESS_UPDATES=true`
- Log shows `editMessage error:` lines

**Prevention:**
Log edit failures (don't swallow them). Fall back to a new progress message (`sendMessage`) if edit fails. Rate-limit progress edits to at most 1 per 15 seconds. Accept that Telegram's edit rate limit is a ceiling — don't promise more granular updates than the API allows.

**Phase to address:** Progress update phase.

---

### Pitfall M2: Customer Info Collection Loop Can Get Stuck in Claude's Multi-Turn Logic

**What goes wrong:**
Claude is instructed to ask for customer name + phone before calling `run_estimate`. In a noisy shop conversation, the tech gives the name in one message and the phone number in a separate message 30 seconds later. Between those two messages, Claude is uncertain whether it has enough info — it may ask "And the phone number?" then receive the number, then ask again "Got it — just to confirm, what's the phone?" Claude gets into a confirmation loop, asking the same question twice due to uncertainty about whether the previous answer was complete.

**Why it happens:**
Claude's reasoning in multi-turn collection is sequential but not stateful in a structured sense — it relies on reading back its own conversation history to infer what has been collected. If history is trimmed, or if the previous assistant turn was a question rather than an affirmation, Claude re-asks. LLM multi-turn degradation (documented: 39% performance drop in multi-turn vs. single-turn tasks) compounds this.

**Consequences:**
- Tech frustrated by repeated questions
- Estimate delayed by 1-2 extra round trips (significant when pipeline is 10+ minutes)

**Warning signs:**
- Multiple "What's the customer's phone number?" messages in one session
- Tech sends the same info twice in quick succession

**Prevention:**
In the system prompt, add a structured slot-filling summary: "Once you have name + phone, confirm with one message: 'Got it — [Name] at [phone]. Running the estimate now.' Then call the tool." This forces Claude to commit to what it has before confirming. Do NOT use a separate state machine for slot-filling — Claude handles it fine with clear instructions; over-engineering creates more bugs than it solves.

**Phase to address:** Conversational layer / system prompt refinement phase.

---

### Pitfall M3: Multi-Platform Session Isolation — WhatsApp and Telegram Share No State

**What goes wrong:**
A tech sends the estimate request via Telegram. The shop owner then messages via WhatsApp: "Did we ever run that RAV4?" SAM has no memory of the Telegram conversation in the WhatsApp gateway — sessions are stored per-gateway, per-chatId, in-process. WhatsApp returns "No recent estimate." This is confusing because from the shop's perspective, SAM is one assistant.

**Why it happens:**
`sessions` and `conversations` are per-process Maps. The Telegram server is a separate process from the WhatsApp server. There is no shared session store. Identified in `CONCERNS.md` under "Scaling Limits."

**Consequences:**
- Cross-channel queries return wrong "no estimate" answers
- Shop staff confused about which channel to use for follow-up
- WhatsApp PDF delivery is already broken (TODO in code) — this compounds it

**Warning signs:**
- Shop uses both channels in the same day
- "No recent estimate" response on WhatsApp after a Telegram estimate was built

**Prevention:**
The Supabase session persistence fix (see C3) also solves this: if `sessions` are stored by a composite key of platform + chatId, any gateway can look up the last estimate for a user across platforms. Short-term: document which channel to use for follow-up. Long-term: unified session store in Supabase.

**Phase to address:** Multi-platform gateway / session persistence phase.

---

### Pitfall M4: Polling Loop Processes Multiple Updates Serially But Blocks on Each

**What goes wrong:**
The polling loop calls `handleMessage()` with `await` for each update in the batch. If two messages arrive in the same 30-second poll window, the second message waits for `handleMessage()` to finish on the first — which includes the full 10-minute pipeline if the first was an estimate request. The second message appears to receive no response for 10 minutes, then both responses arrive together.

**Why it happens:**
`for (const update of result.result)` with `await handleMessage(...)` inside is sequential. The loop doesn't fire the next message handler until the previous one completes. This is the current design — it prevents concurrent Chrome access — but it also means chat responses (which should be instant) queue behind 10-minute pipelines.

**Consequences:**
- Instant chat responses (general questions) delayed by pipeline jobs
- Tech thinks bot is unresponsive

**Warning signs:**
- "what does P0420 mean?" sent while an estimate is running — answer arrives 10 minutes later

**Prevention:**
Route messages through two paths: pipeline requests (which go to the serial queue) and chat requests (which bypass the queue and respond immediately). Claude's classification is the gate: if `toolCall.name === "run_estimate"`, enqueue; otherwise respond immediately. This requires detecting whether Claude will call a tool before committing to the queue — use Claude's `stop_reason` and tool detection from `processMessage()` before deciding which path to take.

**Phase to address:** Queue and concurrency phase.

---

### Pitfall M5: Tool Result History Breaks Conversation Format for Claude

**What goes wrong:**
After a tool call, the server pushes a `tool_result` message into history:
```js
{ role: "user", content: [{ type: "tool_result", tool_use_id: toolCall.id, content: resultSummary }] }
```
This is correct format for a single-step tool call. But if the pipeline fails midway and the tool is never "completed" from Claude's perspective, subsequent calls will have a dangling `tool_use` in the assistant turn with no matching `tool_result` in the next user turn — which is an API error from Anthropic (the message array is malformed). The pipeline error handler returns early without adding the tool_result, leaving the history corrupt.

**Why it happens:**
`handleToolCall()` `catch` blocks return `{ messages: [errorText] }` but the calling code in `handleMessage()` only pushes `tool_result` to history inside the `if (toolCall)` branch — after `handleToolCall()` returns. If `handleToolCall()` throws (not just returns an error), the history push is skipped. This is the code in `server.js` lines 566-576.

**Consequences:**
- Subsequent Claude calls throw "Invalid message format" API errors
- The Telegram session becomes permanently broken until restart
- All further messages get "Sorry, had a brain glitch. Try again."

**Warning signs:**
- `Claude error: invalid message` in logs after a pipeline exception
- Session permanently returning "brain glitch" errors

**Prevention:**
Wrap the `tool_result` history push in a `finally` block, not an inline push after `handleToolCall()`. Always push a tool_result (even if it's `"Pipeline error: [msg]"`) after any tool_use appears in the assistant's message. This is a correctness requirement of the Anthropic messages API.

**Phase to address:** Conversational layer / error handling phase.

---

## Minor Pitfalls

Mistakes that create friction or technical debt without causing failures.

---

### Pitfall N1: Hardcoded Model IDs Will Silently Use Deprecated Claude Versions

**What goes wrong:**
`claude-sonnet-4-5-20250929` is hardcoded in `server.js` and `diagnose.js`. Anthropic deprecates specific dated model versions on a rolling schedule — typically 6-12 months after release. When Anthropic deprecates the model, API calls return a 400 error with "model deprecated." There is no env var override to route to the new model without a code change.

**Prevention:**
Move all model IDs to `CLAUDE_SONNET_MODEL` and `CLAUDE_HAIKU_MODEL` env vars with the hardcoded IDs as fallback defaults. Already identified in `CONCERNS.md` — fix it in the same pass as the conversational layer refactor.

**Phase to address:** First available phase — cheap fix with high long-term value.

---

### Pitfall N2: Progress Message Typing Indicator Expires During Long Pipeline

**What goes wrong:**
`sendTyping()` is called once per message handler invocation. Telegram's "typing..." indicator expires after 5 seconds. For a 10-minute pipeline, the typing indicator disappears 5 seconds in and the chat looks idle. The tech doesn't know if SAM is working or crashed.

**Prevention:**
Run a `setInterval` that re-sends `sendChatAction("typing")` every 4 seconds while the pipeline is running. Clear the interval when the pipeline completes. This is a one-liner wrapper around `FEAT_PROGRESS`.

**Phase to address:** Progress update phase.

---

### Pitfall N3: Markdown Parse Failures Silently Drop Messages

**What goes wrong:**
`sendMessage()` retries without Markdown if parse fails (`if result.description?.includes("can't")`). But the retry uses the raw original text, which may contain unescaped characters that caused the failure. The message sends but looks garbled (raw asterisks, underscores, backticks visible). On WhatsApp, the formatter uses a completely different format — sending Telegram Markdown to WhatsApp renders as punctuation noise.

**Prevention:**
Add a proper Telegram MarkdownV2 sanitizer (escape all `_`, `*`, `[`, `]`, `(`, `)`, `` ` ``, `.`, `!`, `+`, `-`, `=` outside intended formatting). Or switch to HTML parse_mode which is strictly additive and has fewer edge cases. Never mix platform formatters — the gateway should own formatting, not reuse `formatForWhatsApp` in the Telegram server.

**Phase to address:** Conversational layer / formatting phase.

---

### Pitfall N4: OOM Kill on Pi Silently Restarts Service Mid-Estimate

**What goes wrong:**
The Pi has 8GB RAM but Chrome is already holding ~300-400MB. A long estimate run (ProDemand puppeteer + AutoLeap playbook + PartsTech tab) can peak at 600-700MB for the browser alone, plus 100-150MB for the Node.js process. If another process spikes memory at the same time, the OOM killer terminates the `sam` process mid-pipeline. The estimate is abandoned, Chrome tabs remain open, and AutoLeap is left with a partial RO. The tech receives no notification.

**Prevention:**
Add a `--max-old-space-size=256` flag to the Node.js process (cap heap before OOM fires). Add `RestartSec=5` and `StartLimitIntervalSec=60` to the systemd service so restarts are rate-limited, not infinite loops. Emit a startup message on each service start: "SAM restarted — if you were mid-estimate, please re-send the job." Close Chrome tabs explicitly in a shutdown handler (`process.on("SIGTERM", cleanup)`).

**Phase to address:** Deployment / reliability phase or alongside queue work.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Queue system | C1 (concurrent Chrome corruption) | Serial queue (concurrency 1) before buildEstimate |
| Queue system | M4 (chat blocked behind pipeline) | Separate fast-path for non-tool Claude responses |
| Conversational layer | C2 (tool trigger on shop-talk questions) | Intent examples + "vehicle in the bay" guard in prompt |
| Conversational layer | M2 (customer info re-ask loop) | Slot-fill confirmation sentence in system prompt |
| Conversational layer | M5 (tool_result history corruption) | Always push tool_result in finally block |
| Conversational layer | C4 (token budget exhaustion) | Token-based history trimming, slim tool_result summaries |
| Progress updates | M1 (edit rate-limit desync) | Log failures, fall back to sendMessage if edit fails |
| Progress updates | N2 (typing indicator expiry) | setInterval re-send every 4s during pipeline |
| Session persistence | C3 (state lost on restart) | Persist sessions Map to Supabase on every write |
| Session persistence | M3 (cross-platform state gap) | Supabase key = platform:chatId composite |
| Multi-platform gateway | N3 (Markdown/format bleed) | Platform-specific formatters, no cross-import |
| All phases | N1 (hardcoded model IDs) | Move to env vars — cheap, do it early |
| All phases | N4 (OOM kill mid-estimate) | Node.js heap cap + systemd restart rate-limit |

---

## Sources

- Codebase analysis: `.planning/codebase/CONCERNS.md` (2026-03-15) — HIGH confidence
- Codebase analysis: `skills/telegram-gateway/scripts/server.js` — HIGH confidence
- LLM multi-turn degradation research: [LLMs Get Lost In Multi-Turn Conversation (arXiv 2505.06120)](https://arxiv.org/abs/2505.06120) — MEDIUM confidence
- LLM agentic failure modes: [How Do LLMs Fail In Agentic Scenarios?](https://arxiv.org/html/2512.07497v1) — MEDIUM confidence
- Claude tool use context window: [How to implement tool use — Claude API Docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/implement-tool-use) — HIGH confidence
- Node.js serial queue patterns: [p-queue on GitHub (sindresorhus/p-queue)](https://github.com/sindresorhus/p-queue) — HIGH confidence
- In-memory session persistence: [Building a persistent conversational AI chatbot with Temporal](https://temporal.io/blog/building-a-persistent-conversational-ai-chatbot-with-temporal) — MEDIUM confidence
- Node.js memory on Pi: [Node-RED on Raspberry Pi — memory flags](https://nodered.org/docs/getting-started/raspberrypi) — MEDIUM confidence
