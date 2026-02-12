/**
 * Telegram Gateway Server
 *
 * Long-polling bot that receives Telegram messages, runs the SAM estimate
 * pipeline, and sends back formatted responses + PDF attachment.
 *
 * Usage:
 *   node skills/telegram-gateway/scripts/server.js
 *
 * Environment:
 *   TELEGRAM_BOT_TOKEN=...
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

const { parseMessage, detectCommand } = require("../../whatsapp-gateway/scripts/parser");
const { formatForWhatsApp, formatHelp, formatStatus } = require("../../whatsapp-gateway/scripts/formatter");
const { buildEstimate, handleOrderRequest, handleApprovalAndOrder } = require("../../estimate-builder/scripts/orchestrator");

const LOG = "[telegram]";
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!BOT_TOKEN) {
  console.error(`${LOG} ERROR: TELEGRAM_BOT_TOKEN not set`);
  process.exit(1);
}

const API_BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;

// In-memory session store (last estimate per chat)
const sessions = new Map();

// Track last update ID for polling
let lastUpdateId = 0;

// ── Telegram API Helpers ──

async function telegramAPI(method, body = {}) {
  const fetch = (await import("node-fetch")).default;
  const response = await fetch(`${API_BASE}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return response.json();
}

async function sendMessage(chatId, text, options = {}) {
  // Telegram has 4096 char limit per message
  const chunks = splitMessage(text, 4000);
  for (const chunk of chunks) {
    console.log(`${LOG} Sending message to ${chatId}: "${chunk.substring(0, 50)}..."`);
    const result = await telegramAPI("sendMessage", {
      chat_id: chatId,
      text: chunk,
      parse_mode: "Markdown",
      ...options,
    });
    if (!result.ok) {
      console.error(`${LOG} Send failed:`, result.description);
    }
  }
}

async function sendDocument(chatId, filePath, caption) {
  const fetch = (await import("node-fetch")).default;
  const FormData = (await import("form-data")).default;

  const form = new FormData();
  form.append("chat_id", chatId);
  form.append("document", fs.createReadStream(filePath));
  if (caption) form.append("caption", caption);

  await fetch(`${API_BASE}/sendDocument`, {
    method: "POST",
    body: form,
  });
}

function splitMessage(text, maxLength) {
  if (text.length <= maxLength) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    let chunk = remaining.slice(0, maxLength);
    // Try to split at newline
    const lastNewline = chunk.lastIndexOf("\n");
    if (lastNewline > maxLength / 2) {
      chunk = remaining.slice(0, lastNewline + 1);
    }
    chunks.push(chunk);
    remaining = remaining.slice(chunk.length);
  }
  return chunks;
}

// ── Core Message Handler ──

async function handleMessage(chatId, messageText, username) {
  console.log(`${LOG} Message from ${username || chatId}: "${messageText.substring(0, 80)}..."`);

  // Check for commands
  const command = detectCommand(messageText);

  if (command?.type === "help") {
    return { messages: [formatHelp()] };
  }

  if (command?.type === "status") {
    return { messages: [formatStatus()] };
  }

  if (command?.type === "order") {
    const lastResults = sessions.get(chatId);
    if (!lastResults) {
      return { messages: ["No recent estimate found. Send a vehicle + problem first."] };
    }
    try {
      const orderResult = await handleOrderRequest(lastResults);
      if (orderResult.success) {
        return { messages: [`*Order placed!* ${orderResult.added?.length || 0} parts ordered.\nTotal: $${orderResult.cart_summary?.total || "?"}`] };
      } else {
        return { messages: [`Order failed: ${orderResult.error}`] };
      }
    } catch (err) {
      return { messages: [`Order error: ${err.message}`] };
    }
  }

  if (command?.type === "approved") {
    const lastResults = sessions.get(chatId);
    if (!lastResults) {
      return { messages: ["No recent estimate found. Send a vehicle + problem first."] };
    }
    try {
      const orderResult = await handleApprovalAndOrder(lastResults);
      if (orderResult.success) {
        return { messages: [
          `*Customer approved! Parts ordered.*\n` +
          `Order: ${orderResult.orderId || "confirmed"}\n` +
          `Parts: ${orderResult.partsOrdered || "?"} items\n` +
          `Total: $${orderResult.total || "?"}\n\n` +
          `Parts will be delivered to the shop.`,
        ] };
      } else {
        const fallbackResult = await handleOrderRequest(lastResults);
        if (fallbackResult.success) {
          return { messages: [`*Parts ordered!* ${fallbackResult.added?.length || 0} parts.\nTotal: $${fallbackResult.cart_summary?.total || "?"}`] };
        }
        return { messages: [`Order failed: ${orderResult.error || fallbackResult.error}`] };
      }
    } catch (err) {
      return { messages: [`Order error: ${err.message}`] };
    }
  }

  // Parse as estimate request
  const params = parseMessage(messageText);

  if (!params.year && !params.vin && !params.make) {
    return {
      messages: [
        "I couldn't find vehicle info in your message. Please include year, make, model, and the problem.\n\nExample: \"2019 Civic 2.0L P0420\"\n\nReply *HELP* for more examples.",
      ],
    };
  }

  // Run the pipeline
  console.log(`${LOG} Running estimate pipeline...`);
  const startTime = Date.now();

  try {
    const results = await buildEstimate(params);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`${LOG} Pipeline complete in ${elapsed}s`);

    // Store session for follow-up commands
    sessions.set(chatId, results);

    // Format for Telegram (same as WhatsApp)
    const messages = formatForWhatsApp(results);
    return { messages, pdfPath: results.pdfPath };
  } catch (err) {
    console.error(`${LOG} Pipeline error: ${err.message}`);
    return {
      messages: [`Error building estimate: ${err.message}\n\nPlease try again or reply *HELP*.`],
    };
  }
}

// ── Long Polling Loop ──

async function pollUpdates() {
  try {
    const result = await telegramAPI("getUpdates", {
      offset: lastUpdateId + 1,
      timeout: 30,
      allowed_updates: ["message"],
    });

    if (!result.ok) {
      console.error(`${LOG} Telegram API error:`, result.description);
      return;
    }

    for (const update of result.result || []) {
      lastUpdateId = update.update_id;

      const message = update.message;
      if (!message?.text) continue;

      const chatId = message.chat.id;
      const text = message.text;
      const username = message.from?.username || message.from?.first_name;

      try {
        const response = await handleMessage(chatId, text, username);

        // Send text messages
        for (const msg of response.messages) {
          await sendMessage(chatId, msg);
        }

        // Send PDF if available
        if (response.pdfPath && fs.existsSync(response.pdfPath)) {
          await sendDocument(chatId, response.pdfPath, "Estimate PDF");
        }
      } catch (err) {
        console.error(`${LOG} Error handling message:`, err.message);
        await sendMessage(chatId, `Error: ${err.message}`);
      }
    }
  } catch (err) {
    console.error(`${LOG} Poll error:`, err.message);
  }
}

async function startPolling() {
  console.log(`${LOG} Starting Telegram bot...`);

  // Get bot info
  const me = await telegramAPI("getMe");
  if (me.ok) {
    console.log(`${LOG} Bot: @${me.result.username}`);
  }

  console.log(`${LOG} Listening for messages...`);

  // Poll forever
  while (true) {
    await pollUpdates();
  }
}

// Start
startPolling().catch((err) => {
  console.error(`${LOG} Fatal error:`, err);
  process.exit(1);
});
