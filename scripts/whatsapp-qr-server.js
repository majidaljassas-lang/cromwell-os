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
      if (msg.from === "status@broadcast") return;
      if (!msg.body && !msg.hasMedia) return;

      const isSent = msg.fromMe;
      let chatName = "";
      let senderName = msg.from || "Unknown";
      let chatId = "";
      let isGroup = false;

      try {
        const chat = await msg.getChat();
        chatName = chat.name || "";
        chatId = chat.id?._serialized || "";
        isGroup = chat.isGroup || false;
      } catch {}

      try {
        const contact = await msg.getContact();
        senderName = contact.pushname || contact.name || msg.from || "Unknown";
      } catch {}

      const payload = {
        message_id: msg.id?._serialized || `${Date.now()}`,
        chat_id: chatId,
        chat_name: chatName,
        sender_phone: msg.from || "",
        sender_name: senderName,
        timestamp: new Date((msg.timestamp || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
        message_text: msg.body || "",
        is_sent: isSent,
        is_group: isGroup,
        has_media: msg.hasMedia || false,
        media_type: msg.type !== "chat" ? msg.type : null,
      };

      const res = await fetch("http://localhost:3000/api/ingest/whatsapp/live", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      const dir = isSent ? "→" : "←";
      const label = isGroup ? `[${chatName}]` : senderName;
      const status = data.skipped ? `(${data.reason})` : "✓";
      console.log(`${dir} ${label}: ${(msg.body || "[media]").substring(0, 60)} ${status}`);
    } catch (err) {
      console.error("❌ Message handler error:", err.message);
    }
  });
  console.log("📩 Message listener registered — waiting for messages...");
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
