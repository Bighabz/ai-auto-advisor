/**
 * WhatsApp Gateway Server
 *
 * HTTP webhook server that receives WhatsApp messages (via Twilio or
 * Meta WhatsApp Business API), runs the SAM estimate pipeline, and
 * sends back formatted responses + PDF attachment.
 *
 * Supports:
 *   - Twilio WhatsApp Sandbox (for demo)
 *   - Meta WhatsApp Business API (for production)
 *
 * Usage:
 *   node skills/whatsapp-gateway/scripts/server.js
 *
 * Environment:
 *   WHATSAPP_PROVIDER=twilio|meta     (default: twilio)
 *   TWILIO_ACCOUNT_SID=...
 *   TWILIO_AUTH_TOKEN=...
 *   TWILIO_WHATSAPP_NUMBER=...        (e.g. whatsapp:+14155238886)
 *   META_WHATSAPP_TOKEN=...
 *   META_PHONE_NUMBER_ID=...
 *   META_VERIFY_TOKEN=...             (for webhook verification)
 *   PORT=3000
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

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

const { parseMessage, detectCommand } = require("./parser");
const { formatForWhatsApp, formatHelp, formatStatus } = require("./formatter");
const { buildEstimate, handleOrderRequest, handleApprovalAndOrder } = require("../../estimate-builder/scripts/orchestrator");
const sessionStore = require("../../shared/session-store");
const { enqueueEstimate, getStatus, queue } = require("../../shared/job-queue");

const LOG = "[wa-gateway]";
const PORT = parseInt(process.env.PORT, 10) || 3000;
const PROVIDER = process.env.WHATSAPP_PROVIDER || "twilio";

// Session cleanup on startup
sessionStore.cleanupExpiredSessions().catch(() => {});
setInterval(() => sessionStore.cleanupExpiredSessions().catch(() => {}), 6 * 60 * 60 * 1000);

// Graceful shutdown — wait for active job to finish before exiting
process.on("SIGTERM", async () => {
  console.log("[whatsapp] SIGTERM — draining queue...");
  queue.pause();
  await queue.onIdle();
  process.exit(0);
});

// ── Twilio Helpers ──

function parseTwilioBody(body) {
  const params = new URLSearchParams(body);
  return {
    from: params.get("From") || "",
    to: params.get("To") || "",
    body: params.get("Body") || "",
    numMedia: parseInt(params.get("NumMedia") || "0", 10),
  };
}

function twilioResponse(messages, mediaUrl) {
  let twiml = '<?xml version="1.0" encoding="UTF-8"?><Response>';
  for (const msg of messages) {
    twiml += `<Message>`;
    twiml += `<Body>${escapeXml(msg)}</Body>`;
    twiml += `</Message>`;
  }
  // Send PDF as media on last message if available
  if (mediaUrl) {
    twiml = twiml.replace(/<\/Message>$/, `<Media>${escapeXml(mediaUrl)}</Media></Message>`);
  }
  twiml += "</Response>";
  return twiml;
}

function escapeXml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ── Meta WhatsApp Helpers ──

async function sendMetaMessages(to, messages, pdfPath) {
  const fetch = (await import("node-fetch")).default;
  const token = process.env.META_WHATSAPP_TOKEN;
  const phoneNumberId = process.env.META_PHONE_NUMBER_ID;
  const baseUrl = `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`;

  for (const msg of messages) {
    await fetch(baseUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: msg },
      }),
    });
  }

  // TODO: Upload and send PDF as document if pdfPath exists
}

// ── Core Message Handler ──

async function handleMessage(from, messageText) {
  console.log(`${LOG} Message from ${from}: "${messageText.substring(0, 80)}..."`);

  // Check for commands
  const command = detectCommand(messageText);

  if (command?.type === "help") {
    return { messages: [formatHelp()] };
  }

  if (command?.type === "status") {
    return { messages: [formatStatus()] };
  }

  if (command?.type === "order") {
    const lastResults = (await sessionStore.getSession("whatsapp", from))?.lastEstimate || null;
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
    const lastResults = (await sessionStore.getSession("whatsapp", from))?.lastEstimate || null;
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
        // Fall back to standard order flow
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

  if (command?.type === "send_estimate") {
    const lastResults = (await sessionStore.getSession("whatsapp", from))?.lastEstimate || null;
    if (!lastResults) {
      return { messages: ["No recent estimate found. Send a vehicle + problem first."] };
    }
    if (lastResults.estimateSent?.success) {
      return { messages: [`Estimate already sent via ${lastResults.estimateSent.sentVia}.`] };
    }
    return { messages: ["Estimate sending coming soon. For now, the PDF is attached above."] };
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

  // Run the pipeline (serialised through job queue to prevent concurrent Chrome corruption)
  console.log(`${LOG} Running estimate pipeline...`);
  const startTime = Date.now();

  const userId = `whatsapp:${from}`;
  const existing = getStatus(userId);
  if (existing) {
    const pos = existing.position;
    const waitMin = pos * 15;
    return { messages: [`Got it! You're #${pos} in queue (~${waitMin} min). I'll send results when it's your turn.`] };
  }

  try {
    const results = await enqueueEstimate(userId, () => buildEstimate(params), {
      notifyPosition: async (pos, waitMin) => {
        // WhatsApp doesn't have easy mid-request messaging — log it for now
        // Phase 3 will wire progress events properly via the gateway-core dispatcher
        console.log(`${LOG} ${from} queued at position ${pos}, ~${waitMin} min wait`);
      },
    });
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`${LOG} Pipeline complete in ${elapsed}s`);

    // Persist estimate in session store for follow-up commands
    const whSession = await sessionStore.getSession("whatsapp", from) || { lastEstimate: null, history: [], stage: "idle", collectedData: {} };
    await sessionStore.setSession("whatsapp", from, { ...whSession, lastEstimate: results, stage: "done" });

    // Format for WhatsApp
    const messages = formatForWhatsApp(results);
    return { messages, pdfPath: results.pdfPath };
  } catch (err) {
    console.error(`${LOG} Pipeline error: ${err.message}`);
    return {
      messages: [`Error building estimate: ${err.message}\n\nPlease try again or reply *HELP*.`],
    };
  }
}

// ── HTTP Server ──

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // Health check
  if (url.pathname === "/health" || url.pathname === "/") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", provider: PROVIDER }));
    return;
  }

  // Meta webhook verification (GET)
  if (req.method === "GET" && url.pathname === "/webhook") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (mode === "subscribe" && token === process.env.META_VERIFY_TOKEN) {
      console.log(`${LOG} Webhook verified`);
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(challenge);
    } else {
      res.writeHead(403);
      res.end("Forbidden");
    }
    return;
  }

  // Incoming message (POST)
  if (req.method === "POST" && (url.pathname === "/webhook" || url.pathname === "/sms" || url.pathname === "/whatsapp")) {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      try {
        let from, messageText;

        if (PROVIDER === "twilio") {
          const parsed = parseTwilioBody(body);
          from = parsed.from;
          messageText = parsed.body;
        } else {
          // Meta WhatsApp
          const data = JSON.parse(body);
          const entry = data.entry?.[0]?.changes?.[0]?.value;
          const msg = entry?.messages?.[0];
          if (!msg) {
            res.writeHead(200);
            res.end("OK");
            return;
          }
          from = msg.from;
          messageText = msg.text?.body || "";
        }

        if (!messageText) {
          res.writeHead(200);
          res.end("OK");
          return;
        }

        const result = await handleMessage(from, messageText);

        if (PROVIDER === "twilio") {
          const twiml = twilioResponse(result.messages, null);
          res.writeHead(200, { "Content-Type": "text/xml" });
          res.end(twiml);
        } else {
          // Meta: send messages asynchronously
          sendMetaMessages(from, result.messages, result.pdfPath).catch((err) =>
            console.error(`${LOG} Meta send error: ${err.message}`)
          );
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "ok" }));
        }
      } catch (err) {
        console.error(`${LOG} Webhook error: ${err.message}`);
        res.writeHead(500);
        res.end("Error");
      }
    });
    return;
  }

  // 404
  res.writeHead(404);
  res.end("Not Found");
});

server.listen(PORT, () => {
  console.log(`${LOG} WhatsApp gateway running on port ${PORT}`);
  console.log(`${LOG} Provider: ${PROVIDER}`);
  console.log(`${LOG} Webhook URL: http://0.0.0.0:${PORT}/webhook`);
  console.log(`${LOG} Health check: http://0.0.0.0:${PORT}/health`);
});
