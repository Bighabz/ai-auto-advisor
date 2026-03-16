/**
 * WhatsApp Gateway Server — thin adapter
 *
 * Wire protocol only. All routing delegated to conversation.handleMessage().
 * Supports Twilio WhatsApp and Meta WhatsApp Business API.
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
 *   WHATSAPP_PDF_BASE_URL=...         (public URL base for PDF delivery via Twilio MMS)
 *   PORT=3000
 */

"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

// ── Load env ──────────────────────────────────────────────────────────────────

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

// ── Shared modules ────────────────────────────────────────────────────────────

let conversation;
try {
  conversation = require("../../shared/conversation");
} catch (_) {
  conversation = { handleMessage: null };
}

const sessionStore = require("../../shared/session-store");
const { queue } = require("../../shared/job-queue");

const LOG = "[wa-gateway]";
const PORT = parseInt(process.env.PORT, 10) || 3000;
const PROVIDER = process.env.WHATSAPP_PROVIDER || "twilio";

// ── Startup side effects (only when run directly, not when required by tests) ──

if (require.main === module) {
  // Session cleanup on startup
  sessionStore.cleanupExpiredSessions().catch(() => {});
  setInterval(() => sessionStore.cleanupExpiredSessions().catch(() => {}), 6 * 60 * 60 * 1000);

  // Graceful shutdown — wait for active job to finish before exiting
  process.on("SIGTERM", async () => {
    console.log(`${LOG} SIGTERM — draining queue...`);
    queue.pause();
    await queue.onIdle();
    process.exit(0);
  });
}

// ── Phone normalization ───────────────────────────────────────────────────────

/**
 * Strip "whatsapp:" prefix and ensure "+" prefix on phone numbers.
 * Exported for test assertions.
 *
 * @param {string} raw
 * @returns {string}
 */
function normalizeWaPhone(raw) {
  let phone = String(raw || "").replace(/^whatsapp:/i, "").trim();
  if (phone && !phone.startsWith("+")) phone = "+" + phone;
  return phone;
}

// ── Twilio helpers ────────────────────────────────────────────────────────────

function parseTwilioBody(body) {
  const params = new URLSearchParams(body);
  return {
    from: params.get("From") || "",
    to: params.get("To") || "",
    body: params.get("Body") || "",
    numMedia: parseInt(params.get("NumMedia") || "0", 10),
  };
}

/**
 * Send a WhatsApp message via Twilio REST API (outbound).
 * Logs on failure but does not throw.
 *
 * @param {string} to       Normalized +E.164 phone number
 * @param {string} body     Message text
 * @param {string} [mediaUrl] Public URL to attach as MMS media
 */
async function sendWhatsAppMessage(to, body, mediaUrl) {
  if (!process.env.TWILIO_ACCOUNT_SID) {
    console.warn(`${LOG} TWILIO_ACCOUNT_SID not set — skipping outbound message`);
    return;
  }
  try {
    const fetch = (await import("node-fetch")).default;
    const url = `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`;
    const params = new URLSearchParams({
      From: process.env.TWILIO_WHATSAPP_NUMBER,
      To: to,
      Body: body,
    });
    if (mediaUrl) params.append("MediaUrl", mediaUrl);
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization:
          "Basic " +
          Buffer.from(
            `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`
          ).toString("base64"),
      },
      body: params,
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      console.error(`${LOG} Twilio send error ${resp.status}: ${text.substring(0, 200)}`);
    }
  } catch (err) {
    console.error(`${LOG} sendWhatsAppMessage failed: ${err.message}`);
  }
}

// ── Meta WhatsApp helpers ─────────────────────────────────────────────────────

async function sendMetaMessages(to, messages) {
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
}

/**
 * Upload a document to Meta and send it as a WhatsApp document message.
 *
 * @param {string} to        Recipient phone number
 * @param {string} filePath  Local path to the file
 * @param {string} caption   Caption for the document
 */
async function sendMetaDocument(to, filePath, caption) {
  if (!process.env.META_WHATSAPP_TOKEN || !process.env.META_PHONE_NUMBER_ID) return;
  try {
    const fetch = (await import("node-fetch")).default;
    const FormData = (await import("form-data")).default;
    const token = process.env.META_WHATSAPP_TOKEN;
    const phoneNumberId = process.env.META_PHONE_NUMBER_ID;

    // Step 1: upload media
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("file", fs.createReadStream(filePath), {
      contentType: "application/pdf",
      filename: path.basename(filePath),
    });
    const uploadResp = await fetch(
      `https://graph.facebook.com/v18.0/${phoneNumberId}/media`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, ...form.getHeaders() },
        body: form,
      }
    );
    const uploadData = await uploadResp.json();
    if (!uploadData.id) {
      console.error(`${LOG} Meta media upload failed:`, uploadData);
      return;
    }

    // Step 2: send document message
    await fetch(`https://graph.facebook.com/v18.0/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "document",
        document: { id: uploadData.id, caption: caption || "Estimate PDF" },
      }),
    });
  } catch (err) {
    console.error(`${LOG} sendMetaDocument failed: ${err.message}`);
  }
}

// ── Empty TwiML constant ──────────────────────────────────────────────────────

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>';

// ── HTTP Server ───────────────────────────────────────────────────────────────

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
  if (
    req.method === "POST" &&
    (url.pathname === "/webhook" ||
      url.pathname === "/sms" ||
      url.pathname === "/whatsapp")
  ) {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      let from, messageText;

      try {
        if (PROVIDER === "twilio") {
          const parsed = parseTwilioBody(body);
          from = normalizeWaPhone(parsed.from);
          messageText = parsed.body;
        } else {
          // Meta WhatsApp
          const data = JSON.parse(body);
          const entry = data.entry?.[0]?.changes?.[0]?.value;
          const msg = entry?.messages?.[0];
          if (!msg) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ status: "ok" }));
            return;
          }
          from = normalizeWaPhone(msg.from);
          messageText = msg.text?.body || "";
        }
      } catch (err) {
        console.error(`${LOG} Parse error: ${err.message}`);
        res.writeHead(400);
        res.end("Bad Request");
        return;
      }

      if (!messageText) {
        if (PROVIDER === "twilio") {
          res.writeHead(200, { "Content-Type": "text/xml" });
          res.end(EMPTY_TWIML);
        } else {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "ok" }));
        }
        return;
      }

      // Respond immediately — before any async pipeline work
      if (PROVIDER === "twilio") {
        res.writeHead(200, { "Content-Type": "text/xml" });
        res.end(EMPTY_TWIML);
      } else {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
      }

      // Run the pipeline async after response is flushed
      setImmediate(async () => {
        if (!conversation.handleMessage) {
          console.warn(`${LOG} conversation.handleMessage not available`);
          return;
        }

        const capturedFrom = from;
        const capturedText = messageText;

        try {
          const response = await conversation.handleMessage(
            "whatsapp",
            capturedFrom,
            capturedText,
            {
              sendAck: async () => {
                if (PROVIDER === "twilio") {
                  await sendWhatsAppMessage(
                    capturedFrom,
                    "On it — building the estimate now."
                  );
                } else {
                  await sendMetaMessages(capturedFrom, [
                    "On it — building the estimate now.",
                  ]);
                }
              },
              notifyPosition: async (pos, waitMin) => {
                const msg = `You're #${pos} in queue (~${waitMin} min). I'll send results when it's your turn.`;
                if (PROVIDER === "twilio") {
                  await sendWhatsAppMessage(capturedFrom, msg);
                } else {
                  await sendMetaMessages(capturedFrom, [msg]);
                }
              },
            }
          );

          if (PROVIDER === "twilio") {
            // Send each result message via outbound Twilio REST
            for (const msg of response.messages || []) {
              await sendWhatsAppMessage(capturedFrom, msg);
            }
            // PDF delivery via MediaUrl if base URL is configured
            if (response.pdfPath) {
              if (process.env.WHATSAPP_PDF_BASE_URL) {
                const filename = path.basename(response.pdfPath);
                const mediaUrl = process.env.WHATSAPP_PDF_BASE_URL.replace(
                  /\/$/,
                  ""
                ) + "/" + filename;
                await sendWhatsAppMessage(
                  capturedFrom,
                  "Estimate PDF attached.",
                  mediaUrl
                );
              } else {
                await sendWhatsAppMessage(
                  capturedFrom,
                  "PDF available — view estimate in AutoLeap."
                );
              }
            }
          } else {
            // Meta: send messages
            await sendMetaMessages(capturedFrom, response.messages || []);
            // PDF delivery via document upload
            if (response.pdfPath && process.env.META_WHATSAPP_TOKEN) {
              await sendMetaDocument(capturedFrom, response.pdfPath, "Estimate PDF");
            } else if (response.pdfPath) {
              await sendMetaMessages(capturedFrom, [
                "PDF available — view estimate in AutoLeap.",
              ]);
            }
          }
        } catch (err) {
          console.error(`${LOG} Pipeline error: ${err.message}`);
          // Attempt to notify the user
          try {
            if (PROVIDER === "twilio") {
              await sendWhatsAppMessage(
                capturedFrom,
                "Something went wrong — try sending the job again."
              );
            } else {
              await sendMetaMessages(capturedFrom, [
                "Something went wrong — try sending the job again.",
              ]);
            }
          } catch (_) {}
        }
      });
    });
    return;
  }

  // 404
  res.writeHead(404);
  res.end("Not Found");
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`${LOG} WhatsApp gateway running on port ${PORT}`);
    console.log(`${LOG} Provider: ${PROVIDER}`);
    console.log(`${LOG} Webhook URL: http://0.0.0.0:${PORT}/webhook`);
    console.log(`${LOG} Health check: http://0.0.0.0:${PORT}/health`);
  });
}

// ── Exports (test hooks) ──────────────────────────────────────────────────────

module.exports = { normalizeWaPhone }; // test export
