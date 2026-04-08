/**
 * WhatsApp Web listener — feeds messages into Cromwell OS ingestion pipeline.
 *
 * Run: node scripts/whatsapp-listener.js
 * Scan QR code on first run. Session persists after that.
 */

const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");

const API_BASE = process.env.API_BASE || "http://localhost:3000";
const POLL_BATCH_SIZE = 50;

// Session stored in .wwebjs_auth so you don't re-scan every time
const client = new Client({
  authStrategy: new LocalAuth({ dataPath: ".wwebjs_auth" }),
  puppeteer: {
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  },
});

client.on("qr", (qr) => {
  console.log("\n📱 Scan this QR code with WhatsApp:\n");
  qrcode.generate(qr, { small: true });
});

client.on("ready", () => {
  console.log("✅ WhatsApp connected! Listening for messages...\n");
});

client.on("authenticated", () => {
  console.log("🔐 Authenticated — session saved.");
});

client.on("auth_failure", (msg) => {
  console.error("❌ Auth failed:", msg);
});

// Listen for ALL messages (incoming + outgoing)
client.on("message_create", async (msg) => {
  try {
    const chat = await msg.getChat();
    const contact = await msg.getContact();
    const isSent = msg.fromMe;
    const isGroup = chat.isGroup;

    const payload = {
      message_id: msg.id._serialized,
      chat_id: chat.id._serialized,
      chat_name: chat.name || "",
      sender_phone: msg.from,
      sender_name: contact.pushname || contact.name || msg.from,
      timestamp: new Date(msg.timestamp * 1000).toISOString(),
      message_text: msg.body || "",
      is_sent: isSent,
      is_group: isGroup,
      has_media: msg.hasMedia,
      media_type: msg.type !== "chat" ? msg.type : null,
    };

    // Skip status updates and empty messages
    if (msg.from === "status@broadcast") return;
    if (!msg.body && !msg.hasMedia) return;

    // Send to ingestion API
    const res = await fetch(`${API_BASE}/api/ingest/whatsapp/live`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const direction = isSent ? "→ SENT" : "← RECV";
    const chatLabel = isGroup ? `[${chat.name}]` : contact.pushname || msg.from;
    console.log(`${direction} ${chatLabel}: ${(msg.body || "[media]").substring(0, 80)}`);

    if (!res.ok) {
      console.error("  ⚠ API error:", res.status);
    }
  } catch (err) {
    console.error("Error processing message:", err.message);
  }
});

client.on("disconnected", (reason) => {
  console.log("⚠ Disconnected:", reason);
  console.log("Reconnecting in 10s...");
  setTimeout(() => client.initialize(), 10000);
});

console.log("🔄 Initializing WhatsApp Web...");
process.stdout.write("Starting puppeteer...\n");
client.initialize().catch((err) => {
  console.error("❌ Init failed:", err.message);
  process.exit(1);
});
