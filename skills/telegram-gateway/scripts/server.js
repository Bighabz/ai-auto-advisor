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
const sessionStore = require("../../shared/session-store");
const { queue } = require("../../shared/job-queue");
const conversation = require("../../shared/conversation");

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

// Session cleanup on startup
sessionStore.cleanupExpiredSessions().then(({ deleted }) => {
  if (deleted > 0) log.info("startup session cleanup", { deleted });
});

// Periodic session cleanup (every 6 hours)
setInterval(() => {
  sessionStore.cleanupExpiredSessions().catch(err =>
    log.error("session cleanup error", { error: err.message })
  );
}, 6 * 60 * 60 * 1000);

// Graceful shutdown — wait for active job to finish before exiting
process.on("SIGTERM", async () => {
  log.info("SIGTERM received — waiting for active job to finish...");
  queue.pause();
  await queue.onIdle();
  log.info("Queue drained — exiting");
  process.exit(0);
});

const { formatHelp, formatStatus } = require("../../whatsapp-gateway/scripts/formatter");

const LOG = "[telegram]";
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

const API_BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;

let lastUpdateId = 0;

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

  // Delegate to shared conversation engine
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
  console.log(`${LOG} Claude: ${process.env.ANTHROPIC_API_KEY ? "enabled" : "DISABLED"}`);
  console.log(`${LOG} Listening...`);

  while (true) {
    await pollUpdates();
  }
}

startPolling().catch((err) => {
  console.error(`${LOG} Fatal:`, err);
  process.exit(1);
});
