/**
 * Telegram Gateway Server
 *
 * Every message goes to Claude. Claude decides whether to chat
 * or trigger the estimate pipeline using tool_use.
 *
 * Usage:
 *   node skills/telegram-gateway/scripts/server.js
 *
 * Environment:
 *   TELEGRAM_BOT_TOKEN=...
 *   ANTHROPIC_API_KEY=...
 */

const fs = require("fs");
const path = require("path");

// Load env
const envPath = path.join(__dirname, "../../../config/.env");
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx);
    const val = trimmed.slice(eqIdx + 1);
    if (!process.env[key]) process.env[key] = val;
  }
}

const { validateEnv, checkHealth, cleanupArtifacts } = require("../../shared/health");
const { createLogger } = require("../../shared/logger");
const log = createLogger("telegram-gateway");

// Validate required env vars
const envCheck = validateEnv(["TELEGRAM_BOT_TOKEN", "SUPABASE_URL", "SUPABASE_ANON_KEY"]);
if (!envCheck.valid) {
  log.error("Missing required env vars", { missing: envCheck.missing });
  process.exit(1);
}

// Run cleanup on startup
const cleaned = cleanupArtifacts();
if (cleaned.artifacts > 0 || cleaned.screenshots > 0) {
  log.info("startup cleanup", cleaned);
}

// Schedule periodic cleanup (every 6 hours)
setInterval(() => {
  const c = cleanupArtifacts();
  if (c.artifacts > 0 || c.screenshots > 0) log.info("periodic cleanup", c);
}, 6 * 60 * 60 * 1000);

const { formatForWhatsApp, formatHelp, formatStatus } = require("../../whatsapp-gateway/scripts/formatter");
const { buildEstimate, handleOrderRequest, handleApprovalAndOrder } = require("../../estimate-builder/scripts/orchestrator");

const LOG = "[telegram]";
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const FEAT_PROGRESS = process.env.TELEGRAM_PROGRESS_UPDATES === "true";

const API_BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;

// In-memory stores per chat
const sessions = new Map();     // last estimate results
const conversations = new Map(); // Claude message history
const MAX_HISTORY = 20;

let lastUpdateId = 0;

// ── Claude Tool Definition ──

const ESTIMATE_TOOL = {
  name: "run_estimate",
  description: "Run the SAM diagnostic and estimate pipeline for a vehicle problem. Call this when the user describes a specific vehicle with a specific problem, symptom, or DTC code. Do NOT call this for general automotive questions — only when they want an actual repair estimate built.",
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
      customer_name: { type: "string", description: "Customer name if mentioned" },
      customer_phone: { type: "string", description: "Customer phone if mentioned" },
    },
    required: ["make", "model", "symptoms"],
  },
};

const ORDER_TOOL = {
  name: "order_parts",
  description: "Order parts from the most recent estimate. Call when user says to order parts, go ahead with the order, etc.",
  input_schema: {
    type: "object",
    properties: {},
  },
};

const APPROVE_TOOL = {
  name: "customer_approved",
  description: "Customer has approved the estimate — trigger parts ordering and AutoLeap estimate creation. Call when user says customer approved, go ahead, approved, greenlit, etc.",
  input_schema: {
    type: "object",
    properties: {},
  },
};

const TOOLS = [ESTIMATE_TOOL, ORDER_TOOL, APPROVE_TOOL];

// ── SAM System Prompt ──

const SAM_SYSTEM = `You are SAM, an AI Service Advisor for auto repair shops. Technicians and shop owners text you throughout the day.

PERSONALITY:
- Professional but friendly — like a sharp, knowledgeable coworker
- Concise — this is text messaging, not email. 2-4 sentences max for chat.
- Confident about automotive knowledge
- Light humor when it fits

WHAT YOU DO:
- Build full repair estimates: diagnosis, parts pricing, labor times, PDF
- Research across pro platforms: AllData, Identifix Direct-Hit, ProDemand
- Answer any automotive question: DTCs, common failures, procedures, specs
- Help with shop workflow: ordering parts, sending estimates to customers

WHEN TO USE run_estimate TOOL:
- User describes a SPECIFIC vehicle + SPECIFIC problem/symptom/DTC code, OR mentions a specific part/service needed
- Examples that SHOULD trigger it:
  "2019 Civic P0420"
  "got a silverado in the bay, rough idle, throwing P0300"
  "customer brought in a 2020 camry, brakes grinding"
  "honda accord 2018 AC not blowing cold"
  "Toyota RAV4 2002 needs new catalytic converter"
  "2015 F150 oil change and inspection"
- You need at MINIMUM: make + model + some problem OR service description
- If they give a problem but no vehicle, ASK what vehicle — don't guess
- If they give a vehicle but no problem, ASK what's going on with it
- IMPORTANT: When you have year + make + model + ANY problem or service, call run_estimate IMMEDIATELY. Engine size, mileage, and exact codes are optional — run with what you have. Do NOT ask clarifying questions before running.

AFTER SHOWING AN ESTIMATE:
- If no customer_name was provided, ask: "Want this built in AutoLeap? Just send me the customer's name."
- If the user then sends a name, call run_estimate again with that customer_name filled in

WHEN TO JUST CHAT (no tool):
- General questions: "what does P0420 mean?" "what causes rough idle?"
- Greetings: "hey" "what's up" "good morning"
- Questions about you: "what can you do?" "how does this work?"
- Follow-up discussion about a previous estimate
- Non-automotive chat

FORMATTING (Telegram Markdown):
- *bold* for emphasis
- _italic_ for vehicle names or examples
- Keep chat responses SHORT — you're texting, not writing an essay
- Line breaks for readability`;

// ── Claude Conversation Engine ──

async function processMessage(chatId, userMessage) {
  if (!ANTHROPIC_API_KEY) {
    return { text: "My AI brain isn't connected. Send a vehicle + problem and I'll try the estimate pipeline directly.", toolCall: null };
  }

  // Get or init history
  if (!conversations.has(chatId)) conversations.set(chatId, []);
  const history = conversations.get(chatId);
  history.push({ role: "user", content: userMessage });
  while (history.length > MAX_HISTORY) history.shift();

  // Build system prompt with estimate context
  let system = SAM_SYSTEM;
  const lastEstimate = sessions.get(chatId);
  if (lastEstimate) {
    const v = lastEstimate.vehicle || {};
    const topCause = lastEstimate.diagnosis?.ai?.diagnoses?.[0]?.cause;
    system += `\n\nCONTEXT — Most recent estimate in this chat:
- Vehicle: ${v.year || "?"} ${v.make || "?"} ${v.model || "?"}
- Problem: ${lastEstimate._runCtx?.symptom || "?"}
- Diagnosis: ${topCause || "?"}
- Pricing: ${lastEstimate.pricing_source || "unknown"} (gate: ${lastEstimate.pricing_gate || "?"})
User can say "order parts" or "customer approved" to take action on it.`;
  }

  try {
    const Anthropic = require("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

    const response = await client.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 600,
      system,
      tools: TOOLS,
      messages: history,
    });

    // Process response — could be text, tool_use, or both
    let text = "";
    let toolCall = null;

    for (const block of response.content) {
      if (block.type === "text") {
        text += block.text;
      } else if (block.type === "tool_use") {
        toolCall = { name: block.name, input: block.input, id: block.id };
      }
    }

    // Add assistant response to history
    history.push({ role: "assistant", content: response.content });

    return { text, toolCall, stopReason: response.stop_reason };
  } catch (err) {
    console.error(`${LOG} Claude error: ${err.message}`);
    return { text: "Sorry, had a brain glitch. Try again.", toolCall: null };
  }
}

// ── Handle Tool Calls ──

async function handleToolCall(chatId, toolCall) {
  if (toolCall.name === "run_estimate") {
    const input = toolCall.input;
    console.log(`${LOG} Claude triggered estimate: ${input.year || "?"} ${input.make} ${input.model} — ${input.symptoms}`);

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
    };

    // Immediate acknowledgment — no parse_mode so vehicle name can't break Markdown
    const vehicleLabel = [input.year, input.make, input.model].filter(Boolean).join(" ");
    const ackResult = await telegramAPI("sendMessage", {
      chat_id: chatId,
      text: `On it! Building estimate for ${vehicleLabel}... Takes about 60 seconds.`,
    });
    const ackMessageId = ackResult.ok ? ackResult.result.message_id : null;

    // Progress updates (behind feature flag)
    if (FEAT_PROGRESS && ackMessageId) {
      const PROGRESS_MESSAGES = {
        diagnosis_done: `On it! ${vehicleLabel}\n\nGot vehicle specs. Checking repair data...`,
        research_done: `On it! ${vehicleLabel}\n\nFound repair data. Looking up parts pricing...`,
        building_estimate: `On it! ${vehicleLabel}\n\nBuilding your estimate...`,
      };
      params.progressCallback = async (stage) => {
        const text = PROGRESS_MESSAGES[stage];
        if (text) {
          try {
            await editMessage(chatId, ackMessageId, text);
          } catch (_) {}
        }
      };
    }

    const startTime = Date.now();
    try {
      const results = await buildEstimate(params);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`${LOG} Pipeline complete in ${elapsed}s`);

      sessions.set(chatId, results);

      // Add tool result to conversation
      const history = conversations.get(chatId);
      history.push({
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: toolCall.id,
          content: `Estimate built successfully for ${input.year || ""} ${input.make} ${input.model}. Diagnosis: ${results.diagnosis?.ai?.diagnoses?.[0]?.cause || "completed"}. Pricing: ${results.pricing_source || "unknown"} (gate: ${results.pricing_gate || "?"}). Results sent to user.`,
        }],
      });

      const messages = formatForWhatsApp(results);
      return { messages, pdfPath: results.pdfPath, wiringDiagrams: results.wiringDiagrams || [] };
    } catch (err) {
      console.error(`${LOG} Pipeline error: ${err.message}`);
      return { messages: [`Error building estimate: ${err.message}\n\nTry rephrasing or check the vehicle info.`] };
    }
  }

  if (toolCall.name === "order_parts") {
    const lastResults = sessions.get(chatId);
    if (!lastResults) return { messages: ["No recent estimate to order from. Send me a vehicle + problem first."] };
    try {
      const result = await handleOrderRequest(lastResults);
      if (result.success) {
        return { messages: [`*Parts ordered!* ${result.added?.length || 0} items.\nTotal: $${result.cart_summary?.total || "?"}`] };
      }
      return { messages: [`Order failed: ${result.error}`] };
    } catch (err) {
      return { messages: [`Order error: ${err.message}`] };
    }
  }

  if (toolCall.name === "customer_approved") {
    const lastResults = sessions.get(chatId);
    if (!lastResults) return { messages: ["No recent estimate. Send me a vehicle + problem first."] };
    try {
      const result = await handleApprovalAndOrder(lastResults);
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
      const fallback = await handleOrderRequest(lastResults);
      if (fallback.success) {
        return { messages: [`*Parts ordered!* ${fallback.added?.length || 0} items.\nTotal: $${fallback.cart_summary?.total || "?"}`] };
      }
      return { messages: [`Order failed: ${result.error || fallback.error}`] };
    } catch (err) {
      return { messages: [`Order error: ${err.message}`] };
    }
  }

  return { messages: ["Unknown action."] };
}

// ── Telegram API Helpers ──

async function telegramAPI(method, body = {}) {
  const fetch = (await import("node-fetch")).default;
  const resp = await fetch(`${API_BASE}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return resp.json();
}

async function sendMessage(chatId, text, options = {}) {
  const formatted = toTelegramMarkdown(text);
  const chunks = splitMessage(formatted, 4000);
  for (const chunk of chunks) {
    console.log(`${LOG} → ${chatId}: "${chunk.substring(0, 60)}..."`);
    const result = await telegramAPI("sendMessage", {
      chat_id: chatId,
      text: chunk,
      parse_mode: "Markdown",
      ...options,
    });
    if (!result.ok) {
      if (result.description?.includes("parse") || result.description?.includes("can't")) {
        // Retry without Markdown
        await telegramAPI("sendMessage", { chat_id: chatId, text: chunk, ...options });
      } else {
        console.error(`${LOG} Send failed:`, result.description);
      }
    }
  }
}

async function editMessage(chatId, messageId, text) {
  try {
    const formatted = toTelegramMarkdown(text);
    const result = await telegramAPI("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text: formatted,
      parse_mode: "Markdown",
    });
    if (!result.ok) {
      // Retry without Markdown if parse fails
      if (result.description?.includes("parse") || result.description?.includes("can't")) {
        await telegramAPI("editMessageText", {
          chat_id: chatId,
          message_id: messageId,
          text: text,
        });
      }
    }
  } catch (err) {
    console.error(`${LOG} editMessage error: ${err.message}`);
  }
}

async function sendDocument(chatId, filePath, caption) {
  const fetch = (await import("node-fetch")).default;
  const FormData = (await import("form-data")).default;
  const form = new FormData();
  form.append("chat_id", chatId);
  form.append("document", fs.createReadStream(filePath));
  if (caption) form.append("caption", caption);
  await fetch(`${API_BASE}/sendDocument`, { method: "POST", body: form });
}

async function sendPhoto(chatId, imagePath, caption) {
  try {
    const fetch = (await import("node-fetch")).default;
    const FormData = (await import("form-data")).default;
    const form = new FormData();
    form.append("chat_id", chatId);
    form.append("photo", fs.createReadStream(imagePath));
    if (caption) form.append("caption", caption);
    const resp = await fetch(`${API_BASE}/sendPhoto`, { method: "POST", body: form });
    const result = await resp.json();
    if (!result.ok) {
      console.error(`${LOG} sendPhoto failed: ${result.description}`);
    }
  } catch (err) {
    console.error(`${LOG} sendPhoto error: ${err.message}`);
  }
}

async function sendTyping(chatId) {
  await telegramAPI("sendChatAction", { chat_id: chatId, action: "typing" });
}

// Convert standard Markdown to Telegram Markdown
function toTelegramMarkdown(text) {
  // **bold** → *bold* (Telegram uses single asterisks)
  return text.replace(/\*\*(.+?)\*\*/g, "*$1*");
}

function splitMessage(text, maxLength) {
  if (text.length <= maxLength) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    let chunk = remaining.slice(0, maxLength);
    const nl = chunk.lastIndexOf("\n");
    if (nl > maxLength / 2) chunk = remaining.slice(0, nl + 1);
    chunks.push(chunk);
    remaining = remaining.slice(chunk.length);
  }
  return chunks;
}

// ── Core Message Handler ──

async function handleMessage(chatId, messageText, username) {
  console.log(`${LOG} From ${username || chatId}: "${messageText.substring(0, 100)}"`);

  // Quick commands that don't need Claude
  const textLower = messageText.trim().toLowerCase();
  if (textLower === "help" || textLower === "?") return { messages: [formatHelp()] };
  if (textLower === "status" || textLower === "ping") return { messages: [formatStatus()] };
  if (textLower === "/health") {
    const health = await checkHealth();
    const statusEmoji = health.cdp ? "\u2705" : "\u274C";
    const msg = [
      `*SAM Health Check*`,
      `Chrome: ${health.chrome ? "running" : "stopped"}`,
      `CDP (port 18800): ${statusEmoji}`,
      `Disk: ${health.disk_free_mb}MB free${health.disk_warning ? " \u26A0 LOW" : ""}`,
      `Uptime: ${Math.round(health.uptime_s / 60)}min`,
    ].join("\n");
    return { messages: [msg] };
  }

  // Everything else → Claude decides
  const { text, toolCall, stopReason } = await processMessage(chatId, messageText.trim());

  const allMessages = [];

  // If Claude wrote a chat message, send it
  if (text && text.trim()) {
    allMessages.push(text.trim());
  }

  // If Claude called a tool, execute it
  if (toolCall) {
    // Send Claude's intro text first (e.g. "Let me run that diagnosis for you...")
    if (allMessages.length > 0) {
      // We'll send these before the pipeline results
    }

    const toolResult = await handleToolCall(chatId, toolCall);

    if (toolResult.messages) {
      allMessages.push(...toolResult.messages);
    }

    return { messages: allMessages, pdfPath: toolResult.pdfPath, wiringDiagrams: toolResult.wiringDiagrams || [] };
  }

  // Pure chat response
  if (allMessages.length === 0) {
    allMessages.push("Sorry, I blanked out. Say that again?");
  }

  return { messages: allMessages };
}

// ── Polling Loop ──

async function pollUpdates() {
  try {
    const result = await telegramAPI("getUpdates", {
      offset: lastUpdateId + 1,
      timeout: 30,
      allowed_updates: ["message"],
    });

    if (!result.ok) {
      console.error(`${LOG} API error:`, result.description);
      return;
    }

    for (const update of result.result || []) {
      lastUpdateId = update.update_id;
      const msg = update.message;
      if (!msg?.text) continue;

      const chatId = msg.chat.id;
      const text = msg.text;
      const username = msg.from?.username || msg.from?.first_name;

      try {
        await sendTyping(chatId);
        const response = await handleMessage(chatId, text, username);

        for (const m of response.messages) {
          await sendMessage(chatId, m);
        }

        // Send wiring diagrams as photos
        if (response.wiringDiagrams?.length > 0) {
          for (let i = 0; i < response.wiringDiagrams.length; i++) {
            const diagram = response.wiringDiagrams[i];
            const imgPath = diagram.screenshotPath || diagram;
            if (imgPath && fs.existsSync(imgPath)) {
              const caption = diagram.name ? `Wiring: ${diagram.name}` : `Wiring Diagram ${i + 1}`;
              await sendPhoto(chatId, imgPath, caption);
            }
          }
        }

        if (response.pdfPath && fs.existsSync(response.pdfPath)) {
          await sendDocument(chatId, response.pdfPath, "Estimate PDF");
        }
      } catch (err) {
        console.error(`${LOG} Error:`, err.message);
        await sendMessage(chatId, "Something went wrong. Try again.");
      }
    }
  } catch (err) {
    console.error(`${LOG} Poll error:`, err.message);
  }
}

async function startPolling() {
  console.log(`${LOG} Starting SAM (Claude-powered)...`);
  const me = await telegramAPI("getMe");
  if (me.ok) console.log(`${LOG} Bot: @${me.result.username}`);
  console.log(`${LOG} Claude: ${ANTHROPIC_API_KEY ? "enabled" : "DISABLED"}`);
  console.log(`${LOG} Listening...`);

  while (true) {
    await pollUpdates();
  }
}

startPolling().catch((err) => {
  console.error(`${LOG} Fatal:`, err);
  process.exit(1);
});
