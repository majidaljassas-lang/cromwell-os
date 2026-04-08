/**
 * WhatsApp QR code server — generates a scannable QR on localhost:3001
 * Run: node scripts/whatsapp-qr-server.js
 * Open: http://localhost:3001
 */
const { Client, LocalAuth } = require("whatsapp-web.js");
const QRCode = require("qrcode");
const http = require("http");
const fs = require("fs");

let latestQR = null;
let connected = false;

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: ".wwebjs_auth3" }),
  puppeteer: { headless: true, args: ["--no-sandbox"] },
});

client.on("qr", async (qr) => {
  latestQR = await QRCode.toDataURL(qr, { width: 400, margin: 2 });
  console.log("QR code ready — open http://localhost:3001");
});

client.on("ready", () => {
  connected = true;
  console.log("✅ WHATSAPP CONNECTED!");
  // Now start the real listener
  client.on("message_create", async (msg) => {
    try {
      const chat = await msg.getChat();
      const contact = await msg.getContact();
      const isSent = msg.fromMe;
      if (msg.from === "status@broadcast") return;
      if (!msg.body && !msg.hasMedia) return;

      const payload = {
        message_id: msg.id._serialized,
        chat_id: chat.id._serialized,
        chat_name: chat.name || "",
        sender_phone: msg.from,
        sender_name: contact.pushname || contact.name || msg.from,
        timestamp: new Date(msg.timestamp * 1000).toISOString(),
        message_text: msg.body || "",
        is_sent: isSent,
        is_group: chat.isGroup,
        has_media: msg.hasMedia,
        media_type: msg.type !== "chat" ? msg.type : null,
      };

      const res = await fetch("http://localhost:3000/api/ingest/whatsapp/live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      const dir = isSent ? "→" : "←";
      const label = chat.isGroup ? `[${chat.name}]` : contact.pushname || msg.from;
      const status = data.skipped ? `(${data.reason})` : "✓";
      console.log(`${dir} ${label}: ${(msg.body || "[media]").substring(0, 60)} ${status}`);
    } catch (err) {
      // silent
    }
  });
});

client.on("authenticated", () => console.log("🔐 Authenticated"));
client.on("auth_failure", (msg) => console.error("❌ Auth failed:", msg));

// Simple HTTP server to show QR code
const server = http.createServer((req, res) => {
  if (connected) {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end('<html><body style="display:flex;justify-content:center;align-items:center;height:100vh;background:#000;color:#0f0;font-family:sans-serif;font-size:40px">✅ WhatsApp Connected!</body></html>');
  } else if (latestQR) {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(`<html><head><meta http-equiv="refresh" content="5"></head><body style="display:flex;flex-direction:column;justify-content:center;align-items:center;height:100vh;background:#000;color:#fff;font-family:sans-serif"><h2>Scan with WhatsApp</h2><img src="${latestQR}" style="width:400px;height:400px;margin:20px"/><p style="color:#888">Auto-refreshes every 5 seconds</p></body></html>`);
  } else {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end('<html><head><meta http-equiv="refresh" content="2"></head><body style="display:flex;justify-content:center;align-items:center;height:100vh;background:#000;color:#ff9900;font-family:sans-serif;font-size:24px">Loading WhatsApp... please wait</body></html>');
  }
});

server.listen(3001, () => {
  console.log("🌐 QR server at http://localhost:3001");
  console.log("🔄 Initializing WhatsApp...");
  client.initialize().catch((e) => console.error("Init error:", e.message));
});
