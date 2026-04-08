/**
 * WhatsApp backfill — pulls recent messages from all chats and sends to ingestion.
 * Run in a separate terminal while whatsapp-qr-server.js is running.
 *
 * Usage: node scripts/whatsapp-backfill.js
 */
const { Client, LocalAuth } = require("whatsapp-web.js");

const API_BASE = "http://localhost:3000";
const SINCE = new Date("2026-04-01"); // Pull from April 1st

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: ".wwebjs_auth3" }),
  puppeteer: { headless: true, args: ["--no-sandbox"] },
});

client.on("qr", () => {
  console.log("❌ Not authenticated. Run whatsapp-qr-server.js first and scan the QR code.");
  process.exit(1);
});

client.on("ready", async () => {
  console.log("✅ Connected. Pulling chats...\n");

  try {
    const chats = await client.getChats();
    console.log(`Found ${chats.length} chats. Scanning for messages since ${SINCE.toLocaleDateString("en-GB")}...\n`);

    let total = 0;
    let ingested = 0;
    let skipped = 0;

    for (const chat of chats) {
      try {
        const messages = await chat.fetchMessages({ limit: 100 });
        const recent = messages.filter((m) => new Date(m.timestamp * 1000) >= SINCE);

        if (recent.length === 0) continue;

        const label = chat.isGroup ? `[${chat.name}]` : chat.name || chat.id._serialized;
        console.log(`${label}: ${recent.length} messages`);

        for (const msg of recent) {
          if (msg.from === "status@broadcast") continue;
          if (!msg.body && !msg.hasMedia) continue;

          total++;
          const contact = await msg.getContact();

          const payload = {
            message_id: msg.id._serialized,
            chat_id: chat.id._serialized,
            chat_name: chat.name || "",
            sender_phone: msg.from,
            sender_name: contact.pushname || contact.name || msg.from,
            timestamp: new Date(msg.timestamp * 1000).toISOString(),
            message_text: msg.body || "",
            is_sent: msg.fromMe,
            is_group: chat.isGroup,
            has_media: msg.hasMedia,
            media_type: msg.type !== "chat" ? msg.type : null,
          };

          try {
            const res = await fetch(`${API_BASE}/api/ingest/whatsapp/live`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            });
            const data = await res.json();
            if (data.ok) ingested++;
            else skipped++;
          } catch {
            skipped++;
          }
        }
      } catch {
        // Some chats may fail to fetch — skip
      }
    }

    console.log(`\n✅ Done! ${total} messages scanned, ${ingested} ingested, ${skipped} skipped (personal/duplicate).`);
  } catch (err) {
    console.error("Backfill failed:", err.message);
  }

  process.exit(0);
});

console.log("🔄 Connecting to WhatsApp (using existing session)...");
client.initialize().catch((e) => {
  console.error("❌ Failed:", e.message);
  console.log("Make sure whatsapp-qr-server.js is NOT running (only one can use the session at a time).");
  console.log("Stop it first, then run this script.");
  process.exit(1);
});
