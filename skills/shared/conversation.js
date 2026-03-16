"use strict";

// skills/shared/conversation.js
// Shared conversation engine — used by Telegram and WhatsApp gateways.
// Extracts Claude tool_use routing, system prompt, and pipeline wiring into
// a single module so both gateways share identical logic.
//
// Dependency injection: all external services (Claude client, session store,
// job queue, pipeline functions) are injectable via the `deps` parameter so
// tests can run without real API calls or configured services.

const sessionStore = require("./session-store");
const { enqueueEstimate, getStatus } = require("./job-queue");
const { createLogger } = require("./logger");

const log = createLogger("conversation");
const LOG = "[conversation]";

const MAX_HISTORY = 20;
const HISTORY_SUMMARY_MAX = 200;

// ── Conditional imports for pipeline / autoleap ──────────────────────────────
// Same guard pattern used by other browser skills — prevents require errors
// in test environments where AUTOLEAP_EMAIL is not set.

let buildEstimate, handleOrderRequest, handleApprovalAndOrder;
try {
  if (process.env.AUTOLEAP_EMAIL) {
    const orch = require("../estimate-builder/scripts/orchestrator");
    buildEstimate = orch.buildEstimate;
    handleOrderRequest = orch.handleOrderRequest;
    handleApprovalAndOrder = orch.handleApprovalAndOrder;
  }
} catch (_) {}

let getToken, getEstimate, cleanupTestRun;
try {
  if (process.env.AUTOLEAP_EMAIL) {
    const api = require("../autoleap-browser/scripts/autoleap-api");
    getToken = api.getToken;
    getEstimate = api.getEstimate;
    cleanupTestRun = api.cleanupTestRun;
  }
} catch (_) {}

let formatForWhatsApp, getErrorMessage;
try {
  const fmt = require("../whatsapp-gateway/scripts/formatter");
  formatForWhatsApp = fmt.formatForWhatsApp;
  getErrorMessage = fmt.getErrorMessage;
} catch (_) {
  // Formatter not available — graceful degradation
  formatForWhatsApp = (results) => [`Estimate complete. Check AutoLeap for details.`];
  getErrorMessage = () => null;
}

// ── Session store adapter ─────────────────────────────────────────────────────
// The real session store uses (platform, chatId) two-arg API.
// Test mocks use a single composite key API.
// This adapter normalises both behind a consistent internal interface.

function makeSessionAdapter(injectedStore) {
  if (injectedStore) {
    // Test mock: single-key interface.  Key convention: "platform::chatId"
    return {
      async get(platform, chatId) {
        const key = `${platform}::${chatId}`;
        return injectedStore.getSession(key) || null;
      },
      async set(platform, chatId, data) {
        const key = `${platform}::${chatId}`;
        return injectedStore.setSession(key, data);
      },
      async del(platform, chatId) {
        const key = `${platform}::${chatId}`;
        return injectedStore.deleteSession(key);
      },
    };
  }
  // Real store: (platform, chatId) two-arg API
  return {
    async get(platform, chatId) { return sessionStore.getSession(platform, chatId); },
    async set(platform, chatId, data) { return sessionStore.setSession(platform, chatId, data); },
    async del(platform, chatId) { return sessionStore.deleteSession(platform, chatId); },
  };
}

// ── Error translation ─────────────────────────────────────────────────────────

const CHAT_ERROR_MESSAGES = {
  "no autoleap credentials": "AutoLeap isn't configured — set AUTOLEAP_EMAIL to enable estimate creation.",
  "autoleap_email": "AutoLeap isn't configured — set AUTOLEAP_EMAIL.",
  "timeout": "That took longer than expected. Try sending the job again.",
  "chrome not running": "Browser isn't ready — checking Chrome connection.",
  "econnrefused": "Can't reach a required service. Try again in a moment.",
  "network": "Network issue. Try again.",
};

/**
 * Translate a raw error string into plain shop-language text.
 * Never exposes raw JavaScript error text, stack traces, or technical details.
 *
 * @param {string} rawError
 * @returns {string}
 */
function translateError(rawError) {
  const msg = (rawError || "").toLowerCase();
  for (const [key, friendly] of Object.entries(CHAT_ERROR_MESSAGES)) {
    if (msg.includes(key)) return friendly;
  }
  return "Something went wrong — try sending the job again.";
}

// ── System Prompt ─────────────────────────────────────────────────────────────

/**
 * Build the SAM system prompt.
 * Follows locked personality decisions from CONTEXT.md exactly.
 *
 * @param {object|null} lastEstimate - Most recent estimate from session (optional)
 * @returns {string}
 */
function buildSystemPrompt(lastEstimate) {
  let prompt = `You are SAM, an AI Service Advisor for auto repair shops. Technicians and shop owners text you throughout the day.

PERSONALITY:
- Professional advisor tone — knowledgeable, concise, direct
- No humor, no slang, no hedging language, no AI disclaimers of any kind
- Concise — this is text messaging. 2-3 sentences max for chat.
- Textbook-short technical explanations (P0420 = catalyst system efficiency below threshold)
- Confident and authoritative about automotive knowledge

GREETING RULE:
- If the ONLY content of a message is a greeting (hi, hey, hello, good morning, what's up) with no vehicle or question, respond with one sentence: briefly introduce SAM and what it does.
- Example: "SAM here — send me a vehicle and problem and I'll build the estimate, look up parts pricing, and have it ready in AutoLeap."
- Only when a greeting is the entire message. Do not repeat this intro on every message. Do not give a long introduction every time.
- All other messages: jump straight to business. No intro.

INTENT ROUTING:
There are 3 categories. Pick the right one.

1. ESTIMATE REQUEST — call run_estimate after collecting customer info:
   Triggers: explicit language ("build an estimate", "I need a quote", "customer needs", "write up"); vehicle present in shop ("got a [vehicle] in the bay", "customer brought in", "working on"); specific service + vehicle with any request intent ("RAV4 needs new catalytic converter").
   Action: Collect customer name + phone if missing, then call run_estimate.

2. AMBIGUOUS — confirm first, do NOT trigger estimate or collect info yet:
   Triggers: vehicle + problem described but no explicit request → sounds like they're sharing a situation, not asking for an estimate.
   Examples: "got a Camry in the bay, brakes are shot" / "customer's Civic is running rough"
   Action: Confirm first — "Sounds like [service] on the [year] [make] [model]. Want me to build the estimate?" Wait for YES before collecting info or running.

3. KNOWLEDGE QUESTION — answer directly, no tool:
   Triggers: "what does P0420 mean?", "what causes X?", "how long does X take?", "what's the going rate for Y?"
   Action: 2-3 sentence authoritative answer. No pipeline. No tool call.

CUSTOMER INFO COLLECTION:
- Ask inline: "Got it — [year] [make] [model], [service]. Customer name and phone so I can build it in AutoLeap?"
- Require BOTH name and phone before calling run_estimate — no exceptions.
- Commit sentence (say this, then immediately call run_estimate): "Got it — [Name] at [phone]. Running the estimate now."
- If only name or only phone provided: "I need a name and number to build the estimate. Send it when you have it."
- If new request arrives while waiting for customer info: "Got the [vehicle] too — still need customer info for the [first vehicle] first, then I'll do the [second vehicle]."

ERROR TONE:
- Never show raw errors or technical details to shop staff.
- If a step failed, note the fallback: "Labor based on AI estimate — MOTOR data wasn't available."
- Never say "I'm sorry" or use apologetic language.

FORMATTING:
- *bold* for key numbers and headers (Telegram/WhatsApp Markdown)
- Keep chat responses SHORT
- Line breaks for readability`;

  // Append last estimate context when available
  if (lastEstimate) {
    const v = lastEstimate.vehicle || {};
    const topCause = lastEstimate.diagnosis?.ai?.diagnoses?.[0]?.cause;
    prompt += `\n\nCONTEXT — Most recent estimate in this chat:
- Vehicle: ${v.year || "?"} ${v.make || "?"} ${v.model || "?"}
- Problem: ${lastEstimate._runCtx?.symptom || "?"}
- Diagnosis: ${topCause || "?"}
- Pricing: ${lastEstimate.pricing_source || "unknown"} (gate: ${lastEstimate.pricing_gate || "?"})
User can say "order parts" or "customer approved" to take action on it.`;
  }

  return prompt;
}

// ── Tool Definitions ──────────────────────────────────────────────────────────

/**
 * Build the Claude tool definitions array.
 * These are verbatim from server.js — do NOT change names, descriptions, or required fields.
 *
 * @returns {object[]} Array of 4 tool definitions
 */
function buildTools() {
  return [
    {
      name: "run_estimate",
      description: "Run the SAM diagnostic and estimate pipeline for a vehicle problem. IMPORTANT: Do NOT call this until you have the customer's name AND phone number. If missing, ask the user first.",
      input_schema: {
        type: "object",
        properties: {
          year: { type: "integer", description: "Vehicle model year (e.g. 2019)" },
          make: { type: "string", description: "Vehicle make (e.g. Honda, Toyota, Ford)" },
          model: { type: "string", description: "Vehicle model (e.g. Civic, Camry, F-150)" },
          engine: { type: "string", description: "Engine size if mentioned (e.g. 2.0L, 5.3L, V6)" },
          vin: { type: "string", description: "17-character VIN if provided" },
          symptoms: { type: "string", description: "The problem description, symptoms, or complaint" },
          dtc_codes: {
            type: "array",
            items: { type: "string" },
            description: "Any DTC/trouble codes mentioned (e.g. P0420, P0300)",
          },
          mileage: { type: "integer", description: "Vehicle mileage if mentioned" },
          customer_name: { type: "string", description: "Customer's full name — REQUIRED before running" },
          customer_phone: { type: "string", description: "Customer's phone number — REQUIRED before running" },
        },
        required: ["make", "model", "symptoms", "customer_name", "customer_phone"],
      },
    },
    {
      name: "order_parts",
      description: "Order parts from the most recent estimate. Call when user says to order parts, go ahead with the order, etc.",
      input_schema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "customer_approved",
      description: "Customer has approved the estimate — trigger parts ordering and AutoLeap estimate creation. Call when user says customer approved, go ahead, approved, greenlit, etc.",
      input_schema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "cleanup_estimate",
      description: "Delete the most recent estimate from AutoLeap. IMPORTANT: Before calling this, you MUST first tell the user exactly what will be deleted (customer name, vehicle, RO#) and ask them to confirm with YES. Only call this AFTER they confirm. Use confirmed=true only after explicit user confirmation.",
      input_schema: {
        type: "object",
        properties: {
          confirmed: { type: "boolean", description: "Set to true ONLY after user explicitly confirmed the deletion. If false or missing, returns what WOULD be deleted without actually deleting." },
          delete_customer_vehicle: { type: "boolean", description: "Also delete the customer and vehicle records (default false)" },
        },
        required: ["confirmed"],
      },
    },
  ];
}

// ── Process Message ───────────────────────────────────────────────────────────

/**
 * Call Claude with the current session history and return the response.
 * Handles session persistence and history trimming.
 *
 * @param {string} platform   "telegram" | "whatsapp"
 * @param {string} chatId     Platform-native chat identifier
 * @param {string} userText   The user's message text
 * @param {object} [deps={}]  Dependency injection for testing
 * @returns {Promise<{ text: string, toolCall: object|null, stopReason: string }>}
 */
async function processMessage(platform, chatId, userText, deps = {}) {
  // API key guard — catch early before constructing Anthropic client
  if (!process.env.ANTHROPIC_API_KEY && !deps.claudeClient) {
    return { text: "AI not configured — set ANTHROPIC_API_KEY.", toolCall: null };
  }

  let claudeClient;
  try {
    claudeClient = deps.claudeClient || new (require("@anthropic-ai/sdk"))({ apiKey: process.env.ANTHROPIC_API_KEY });
  } catch (_) {
    return { text: "AI not configured — set ANTHROPIC_API_KEY.", toolCall: null };
  }

  const store = makeSessionAdapter(deps.sessionStore || null);

  // Get or init session
  const session = await store.get(platform, chatId) || {
    lastEstimate: null,
    history: [],
    stage: "idle",
    collectedData: {},
  };

  const history = session.history || [];

  // Append user message and trim history
  history.push({ role: "user", content: userText });
  while (history.length > MAX_HISTORY) history.shift();

  try {
    const response = await claudeClient.messages.create({
      model: process.env.CLAUDE_SONNET_MODEL || "claude-sonnet-4-6",
      max_tokens: 600,
      system: buildSystemPrompt(session.lastEstimate),
      tools: buildTools(),
      messages: history,
    });

    // Parse response content — may contain text block, tool_use block, or both
    let text = "";
    let toolCall = null;

    for (const block of response.content) {
      if (block.type === "text") {
        text += block.text;
      } else if (block.type === "tool_use") {
        toolCall = { name: block.name, input: block.input, id: block.id };
      }
    }

    // Push assistant response to history
    history.push({ role: "assistant", content: response.content });

    // Persist updated history
    await store.set(platform, chatId, { ...session, history });

    return { text, toolCall, stopReason: response.stop_reason };
  } catch (err) {
    log.error(`Claude error: ${err.message}`);
    return { text: "Sorry, had a brain glitch. Try again.", toolCall: null };
  }
}

// ── Handle Tool Call ──────────────────────────────────────────────────────────

/**
 * Execute a Claude tool call and return the result messages.
 *
 * @param {string} platform
 * @param {string} chatId
 * @param {{ name: string, input: object, id: string }} toolCall
 * @param {object} [deps={}]
 * @returns {Promise<{ messages: string[], pdfPath?: string, wiringDiagrams?: object[] }>}
 */
async function handleToolCall(platform, chatId, toolCall, deps = {}) {
  const store = makeSessionAdapter(deps.sessionStore || null);

  // Resolve injectable dependencies with production fallbacks
  const enqueueEstimate_ = deps.enqueueEstimate || enqueueEstimate;
  const buildEstimate_ = deps.buildEstimate_ || buildEstimate;
  const handleOrderRequest_ = deps.handleOrderRequest_ || handleOrderRequest;
  const handleApprovalAndOrder_ = deps.handleApprovalAndOrder_ || handleApprovalAndOrder;
  const getToken_ = deps.getToken_ || getToken;
  const getEstimate_ = deps.getEstimate_ || getEstimate;
  const cleanupTestRun_ = deps.cleanupTestRun_ || cleanupTestRun;

  // ── run_estimate ────────────────────────────────────────────────────────────
  if (toolCall.name === "run_estimate") {
    const input = toolCall.input;

    // Hard gate: refuse to run without customer name + phone
    if (!input.customer_name || !input.customer_phone) {
      const missing = [];
      if (!input.customer_name) missing.push("customer name");
      if (!input.customer_phone) missing.push("phone number");
      log.info(`Blocked estimate — missing: ${missing.join(", ")}`);
      return { messages: [`I need the customer's ${missing.join(" and ")} before I can build the estimate. What's their info?`] };
    }

    log.info(`Claude triggered estimate: ${input.year || "?"} ${input.make} ${input.model} — ${input.symptoms}`);

    // Build params for the pipeline
    const params = {
      year: input.year || null,
      make: input.make,
      model: input.model,
      engine: input.engine || null,
      vin: input.vin || null,
      mileage: input.mileage || null,
      query: [
        ...(input.dtc_codes || []),
        input.symptoms,
      ].filter(Boolean).join(" "),
      dtcCodes: input.dtc_codes || [],
      customer: input.customer_name ? {
        name: input.customer_name,
        phone: input.customer_phone || null,
      } : null,
      // No progressCallback — just ACK + result (CONV-04 simplified)
      progressCallback: async () => {},
    };

    // Check if this user already has an active/queued job
    const userId = `${platform}:${chatId}`;
    const existing = getStatus(userId);
    if (existing) {
      const pos = existing.position;
      const waitMin = pos * 15;
      return { messages: [`Already working on an estimate for you — you're #${pos} in queue (~${waitMin} min). I'll send results when it's your turn.`] };
    }

    try {
      const results = await enqueueEstimate_(
        userId,
        () => (buildEstimate_ ? buildEstimate_(params) : Promise.reject(new Error("buildEstimate not configured"))),
        {
          notifyPosition: async (pos, waitMin) => {
            if (deps.notifyPosition) await deps.notifyPosition(pos, waitMin);
          },
        }
      );

      // Persist estimate result in session
      const currentSession = await store.get(platform, chatId) || { lastEstimate: null, history: [], stage: "idle", collectedData: {} };
      await store.set(platform, chatId, { ...currentSession, lastEstimate: results, stage: "done" });

      let messages;
      try {
        messages = formatForWhatsApp(results);
      } catch (_) {
        // Fallback when results don't have full estimate shape (partial results)
        messages = ["Estimate complete. Check AutoLeap for details."];
      }

      // Append warning notes in plain language (ERR-01)
      if (results.warnings && results.warnings.length > 0) {
        for (const w of results.warnings) {
          // warnings may be strings (like "NO_MOTOR_LABOR") or objects with .code
          const code = typeof w === "string" ? w : w.code;
          const friendly = getErrorMessage(code);
          if (friendly) {
            // Append as a note on the last message
            if (messages.length > 0) {
              messages[messages.length - 1] += `\n\nNote: ${friendly}`;
            } else {
              messages.push(`Note: ${friendly}`);
            }
          }
        }
      }

      return { messages, pdfPath: results.pdfPath, wiringDiagrams: results.wiringDiagrams || [] };
    } catch (err) {
      log.error(`Pipeline error: ${err.message}`);
      return { messages: [translateError(err.message)] };
    }
  }

  // ── order_parts ─────────────────────────────────────────────────────────────
  if (toolCall.name === "order_parts") {
    const lastResults = (await store.get(platform, chatId))?.lastEstimate || null;
    if (!lastResults) return { messages: ["No recent estimate to order from. Send me a vehicle + problem first."] };
    if (!handleOrderRequest_) return { messages: [translateError("no autoleap credentials")] };
    try {
      const result = await handleOrderRequest_(lastResults);
      if (result.success) {
        return { messages: [`*Parts ordered!* ${result.added?.length || 0} items.\nTotal: $${result.cart_summary?.total || "?"}`] };
      }
      return { messages: [translateError(result.error)] };
    } catch (err) {
      return { messages: [translateError(err.message)] };
    }
  }

  // ── customer_approved ───────────────────────────────────────────────────────
  if (toolCall.name === "customer_approved") {
    const lastResults = (await store.get(platform, chatId))?.lastEstimate || null;
    if (!lastResults) return { messages: ["No recent estimate. Send me a vehicle + problem first."] };
    if (!handleApprovalAndOrder_) return { messages: [translateError("no autoleap credentials")] };
    try {
      const result = await handleApprovalAndOrder_(lastResults);
      if (result.success) {
        return { messages: [
          `*Customer approved! Parts ordered.*\n` +
          `Order: ${result.orderId || "confirmed"}\n` +
          `Parts: ${result.partsOrdered || "?"} items\n` +
          `Total: $${result.total || "?"}\n\n` +
          `Parts on the way.`,
        ] };
      }
      // Fallback to just ordering
      const fallback = await handleOrderRequest_(lastResults);
      if (fallback.success) {
        return { messages: [`*Parts ordered!* ${fallback.added?.length || 0} items.\nTotal: $${fallback.cart_summary?.total || "?"}`] };
      }
      return { messages: [translateError(result.error || fallback.error)] };
    } catch (err) {
      return { messages: [translateError(err.message)] };
    }
  }

  // ── cleanup_estimate ────────────────────────────────────────────────────────
  if (toolCall.name === "cleanup_estimate") {
    const lastResults = (await store.get(platform, chatId))?.lastEstimate || null;
    if (!lastResults || !lastResults.autoLeapEstimate?.estimateId) {
      return { messages: ["No recent estimate to delete."] };
    }
    const alEst = lastResults.autoLeapEstimate;
    const confirmed = toolCall.input?.confirmed === true;
    const delCustVeh = toolCall.input?.delete_customer_vehicle || false;

    if (!getToken_ || !getEstimate_ || !cleanupTestRun_) {
      return { messages: [translateError("no autoleap credentials")] };
    }

    try {
      const token = await getToken_();

      // Step 1: Preview — show what would be deleted
      if (!confirmed) {
        let preview = `RO#${lastResults.estimate?.estimateCode || "?"} — `;
        preview += `${alEst.customerName || lastResults.estimate?.customerName || "Unknown customer"}, `;
        preview += `${alEst.vehicleDesc || lastResults.estimate?.vehicleDesc || "Unknown vehicle"}`;
        preview += ` ($${lastResults.estimate?.total || "?"})`;
        try {
          const estData = await getEstimate_(token, alEst.estimateId);
          if (!estData || estData.error) {
            return { messages: ["That estimate no longer exists in AutoLeap."] };
          }
          const custName = estData.customer?.fullName || estData.customer?.firstName || alEst.customerName || "Unknown";
          const vehDesc = estData.vehicleId?.name || estData.vehicleId?.vehicleName || alEst.vehicleDesc || "Unknown";
          preview = `RO#${estData.code || lastResults.estimate?.estimateCode || "?"} — ${custName}, ${vehDesc}`;
          if (estData.grandTotal) preview += ` ($${estData.grandTotal})`;
        } catch { /* use cached info */ }

        let willDelete = "estimate";
        if (delCustVeh) willDelete += " + customer + vehicle";
        return { messages: [`Will delete ${willDelete}: ${preview}. Reply YES to confirm.`] };
      }

      // Step 2: Confirmed — actually delete
      const cleanup = await cleanupTestRun_(token, alEst, delCustVeh);
      // Use platform-aware delete
      await store.del(platform, chatId);
      const parts = [];
      if (cleanup.estimate?.success) parts.push(`estimate RO#${lastResults.estimate?.estimateCode || "?"}`);
      if (cleanup.vehicle?.success) parts.push("vehicle");
      if (cleanup.customer?.success) parts.push("customer");
      const custName = alEst.customerName || lastResults.estimate?.customerName || "";
      return { messages: [`*Deleted:* ${parts.join(", ") || "nothing"}${custName ? ` (${custName})` : ""} from AutoLeap.`] };
    } catch (err) {
      return { messages: [translateError(err.message)] };
    }
  }

  return { messages: ["Unknown action."] };
}

// ── Handle Message ────────────────────────────────────────────────────────────

/**
 * Main entry point for processing an incoming message.
 * Calls Claude, handles fast-path for non-tool responses, and executes
 * tool calls through the pipeline with proper ACK ordering.
 *
 * @param {string} platform       "telegram" | "whatsapp"
 * @param {string} chatId         Platform-native chat identifier
 * @param {string} messageText    The user's message text
 * @param {object} [deps={}]      Dependency injection for testing
 * @returns {Promise<{ messages: string[], pdfPath?: string, wiringDiagrams?: object[] }>}
 */
async function handleMessage(platform, chatId, messageText, deps = {}) {
  const store = makeSessionAdapter(deps.sessionStore || null);

  const { text, toolCall } = await processMessage(platform, chatId, messageText, deps);

  // ── FAST PATH: no tool call — return immediately without touching job queue ──
  if (!toolCall) {
    return { messages: [text || "Say that again?"] };
  }

  // ── TOOL CALL PATH ──────────────────────────────────────────────────────────

  const allMessages = [];

  // Prefix: if Claude wrote text before the tool call, include it
  if (text && text.trim()) {
    allMessages.push(text.trim());
  }

  // Send ACK before awaiting pipeline — plain text, no Markdown (CONV-04)
  if (deps.sendAck) {
    deps.sendAck("Working on it...");
  }

  // Safe fallback if everything goes wrong
  let toolResult = { messages: [translateError("")] };

  try {
    toolResult = await handleToolCall(platform, chatId, toolCall, deps);
  } catch (err) {
    log.error(`handleToolCall threw: ${err.message}`);
    toolResult = { messages: [translateError(err.message)] };
  } finally {
    // ERR-03: ALWAYS push tool_result to history even if pipeline threw
    try {
      const session = await store.get(platform, chatId) || {};
      const history = session.history || [];
      const summary = (toolResult.messages || []).join(" ").substring(0, HISTORY_SUMMARY_MAX);
      history.push({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: toolCall.id, content: summary }],
      });
      await store.set(platform, chatId, { ...session, history });
    } catch (histErr) {
      log.error(`Failed to persist tool_result to history: ${histErr.message}`);
    }
  }

  if (toolResult.messages) {
    allMessages.push(...toolResult.messages);
  }

  return {
    messages: allMessages,
    pdfPath: toolResult.pdfPath,
    wiringDiagrams: toolResult.wiringDiagrams || [],
  };
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  processMessage,
  handleMessage,
  buildSystemPrompt,
  buildTools,
  translateError,
};
