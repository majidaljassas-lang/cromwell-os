/**
 * WhatsApp backfill — pulls recent messages via Store.Msg direct read.
 *
 * The high-level chat.fetchMessages() API is broken in whatsapp-web.js@1.34.6
 * (waitForChatLoading no longer exists). This script reads Store.Msg directly
 * from the Puppeteer page context — same approach as whatsapp-qr-server.js.
 *
 * Usage: node scripts/whatsapp-backfill.js
 * NOTE: Kill the whatsapp-listener.js process first — only one session at a time.
 */
const { Client, LocalAuth } = require("whatsapp-web.js");
const { CUTOVER_DATE } = require("../src/lib/sync-constants");

const API_BASE = "http://localhost:3000";
const SINCE = CUTOVER_DATE;

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: ".wwebjs_auth" }),
  puppeteer: { headless: true, args: ["--no-sandbox"] },
});

client.on("qr", () => {
  console.log("❌ Not authenticated. Run whatsapp-qr-server.js first and scan the QR code.");
  process.exit(1);
});

client.on("ready", async () => {
  console.log("✅ Connected. Reading Store.Msg...\n");

  try {
    // Store.Msg direct read — bypasses broken chat.fetchMessages() which
    // calls waitForChatLoading (no longer exists in current WhatsApp Web).
    // See commits c90bfdf and 4f1b15c.
    const sinceUnix = Math.floor(SINCE.getTime() / 1000);
    const extracted = await client.pupPage.evaluate((sinceUnix) => {
      const Store = window.Store;
      if (!Store || !Store.Msg) return { error: "Store.Msg unavailable", messages: [] };
      const msgs = typeof Store.Msg.getModelsArray === "function"
        ? Store.Msg.getModelsArray()
        : (Store.Msg.models || []);

      const out = [];
      for (const m of msgs) {
        try {
          const t = m.t || 0;
          if (t < sinceUnix) continue;

          const remote = m.id && m.id.remote
            ? (typeof m.id.remote === "string" ? m.id.remote : m.id.remote._serialized || "")
            : "";
          const msgId = m.id && m.id._serialized ? m.id._serialized : "";
          if (!msgId || !remote) continue;
          if (remote === "status@broadcast") continue;

          const body = m.body || "";
          const type = m.type || "chat";
          const hasMedia = !!(m.mediaType || m.mediaObject || m.isMedia);
          if (!body && !hasMedia) continue;

          const chat = Store.Chat && typeof Store.Chat.get === "function" ? Store.Chat.get(remote) : null;
          const chatName = chat && chat.name ? chat.name : "";
          const isGroup = remote.endsWith("@g.us");

          const fromField = m.from && typeof m.from !== "string" && m.from._serialized
            ? m.from._serialized
            : (m.from || "");

          let senderName = "";
          try {
            const senderJid = isGroup && m.author
              ? (typeof m.author === "string" ? m.author : m.author._serialized || "")
              : fromField;
            if (senderJid && Store.Contact && typeof Store.Contact.get === "function") {
              const contact = Store.Contact.get(senderJid);
              if (contact) senderName = contact.pushname || contact.name || contact.formattedName || "";
            }
          } catch {}

          out.push({
            message_id: msgId,
            chat_id: remote,
            chat_name: chatName,
            sender_phone: fromField,
            sender_name: senderName || fromField,
            timestamp: new Date(t * 1000).toISOString(),
            message_text: body,
            is_sent: !!m.fromMe,
            is_group: isGroup,
            has_media: hasMedia,
            media_type: type !== "chat" ? type : null,
          });
        } catch { /* skip malformed */ }
      }
      return { error: null, messages: out };
    }, sinceUnix);

    if (extracted.error) {
      console.warn(`⚠ Store.Msg extraction error: ${extracted.error}`);
    }

    const payloads = extracted.messages || [];
    const distinctChats = new Set(payloads.map((p) => p.chat_id));
    console.log(`Extracted ${payloads.length} messages across ${distinctChats.size} chats since ${SINCE.toLocaleDateString("en-GB")}\n`);

    let ingested = 0;
    let skipped = 0;

    for (const payload of payloads) {
      try {
        const res = await fetch(`${API_BASE}/api/ingest/whatsapp/live`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && !data.skipped) ingested++;
        else skipped++;
      } catch {
        skipped++;
      }
    }

    console.log(`\n✅ Done! ${payloads.length} messages found, ${ingested} ingested, ${skipped} skipped.`);
  } catch (err) {
    console.error("Backfill failed:", err.message);
  }

  process.exit(0);
});

console.log("🔄 Connecting to WhatsApp (using existing session)...");
client.initialize().catch((e) => {
  console.error("❌ Failed:", e.message);
  console.log("Make sure whatsapp-listener.js is NOT running (only one can use the session at a time).");
  console.log("Stop it first, then run this script.");
  process.exit(1);
});
