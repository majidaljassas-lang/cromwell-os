/**
 * WhatsApp deep backfill — loads earlier messages per chat to get full
 * history back to CUTOVER_DATE (1 April 2026).
 *
 * Store.Msg only holds what's in memory. This script forces WhatsApp Web
 * to load earlier messages for each chat by calling the internal
 * loadEarlierMsgs API, then extracts everything since the cutover date.
 *
 * Kill whatsapp-listener.js before running — only one session at a time.
 */
const { Client, LocalAuth } = require("whatsapp-web.js");
const { CUTOVER_DATE } = require("../src/lib/sync-constants");

const API_BASE = "http://localhost:3000";
const SINCE = CUTOVER_DATE;
const SINCE_UNIX = Math.floor(SINCE.getTime() / 1000);

const client = new Client({
  authStrategy: new LocalAuth({ dataPath: ".wwebjs_auth" }),
  puppeteer: { headless: true, args: ["--no-sandbox"] },
});

client.on("qr", () => {
  console.log("❌ Not authenticated.");
  process.exit(1);
});

client.on("ready", async () => {
  console.log("✅ Connected. Starting deep backfill...\n");

  try {
    // Get all chats
    const chats = await client.getChats();
    console.log(`Found ${chats.length} chats. Loading history since ${SINCE.toLocaleDateString("en-GB")}...\n`);

    let totalIngested = 0;
    let totalSkipped = 0;
    let totalChatsWithMessages = 0;

    for (let ci = 0; ci < chats.length; ci++) {
      const chat = chats[ci];
      if (chat.id._serialized === "status@broadcast") continue;

      const chatLabel = chat.isGroup ? `[${chat.name}]` : (chat.name || chat.id._serialized);

      try {
        // Force-load earlier messages for this chat via Store internals
        const chatId = chat.id._serialized;
        const messages = await client.pupPage.evaluate(async (chatId, sinceUnix) => {
          const Store = window.Store;
          if (!Store || !Store.Chat || !Store.Msg) return { error: "Store unavailable", msgs: [] };

          const chat = Store.Chat.get(chatId);
          if (!chat) return { error: "chat not found", msgs: [] };

          // Load earlier messages — keep loading until we pass the since date
          // or run out of messages. Max 20 loads to prevent infinite loops.
          let loads = 0;
          const maxLoads = 20;
          while (loads < maxLoads) {
            const msgs = chat.msgs && chat.msgs.getModelsArray
              ? chat.msgs.getModelsArray()
              : (chat.msgs?.models || []);

            if (msgs.length === 0) break;

            // Check oldest message timestamp
            const oldestTs = msgs.reduce((min, m) => Math.min(min, m.t || Infinity), Infinity);
            if (oldestTs <= sinceUnix) break; // We've loaded far enough back

            // Try to load earlier messages
            try {
              if (typeof chat.loadEarlierMsgs === "function") {
                await chat.loadEarlierMsgs();
              } else if (Store.ConversationMsgs && typeof Store.ConversationMsgs.loadEarlierMsgs === "function") {
                await Store.ConversationMsgs.loadEarlierMsgs(chat);
              } else {
                break; // No way to load earlier
              }
            } catch {
              break;
            }

            loads++;

            // Check if we got new messages
            const newMsgs = chat.msgs && chat.msgs.getModelsArray
              ? chat.msgs.getModelsArray()
              : (chat.msgs?.models || []);
            if (newMsgs.length === msgs.length) break; // No new messages loaded
          }

          // Now extract all messages since the cutover date
          const allMsgs = chat.msgs && chat.msgs.getModelsArray
            ? chat.msgs.getModelsArray()
            : (chat.msgs?.models || []);

          const out = [];
          for (const m of allMsgs) {
            try {
              const t = m.t || 0;
              if (t < sinceUnix) continue;

              const msgId = m.id && m.id._serialized ? m.id._serialized : "";
              if (!msgId) continue;

              const remote = m.id && m.id.remote
                ? (typeof m.id.remote === "string" ? m.id.remote : m.id.remote._serialized || "")
                : chatId;
              if (remote === "status@broadcast") continue;

              const body = m.body || "";
              const type = m.type || "chat";
              const hasMedia = !!(m.mediaType || m.mediaObject || m.isMedia);
              if (!body && !hasMedia) continue;

              const isGroup = chatId.endsWith("@g.us");
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

              const chatObj = Store.Chat.get(chatId);
              const chatName = chatObj && chatObj.name ? chatObj.name : "";

              out.push({
                message_id: msgId,
                chat_id: chatId,
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
            } catch { /* skip */ }
          }
          return { error: null, msgs: out, loads };
        }, chatId, SINCE_UNIX);

        if (messages.error) {
          // Silent skip — many chats won't have loadEarlierMsgs
          continue;
        }

        if (messages.msgs.length === 0) continue;

        totalChatsWithMessages++;
        let chatIngested = 0;
        let chatSkipped = 0;

        for (const payload of messages.msgs) {
          try {
            const res = await fetch(`${API_BASE}/api/ingest/whatsapp/live`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok && !data.skipped) chatIngested++;
            else chatSkipped++;
          } catch {
            chatSkipped++;
          }
        }

        totalIngested += chatIngested;
        totalSkipped += chatSkipped;

        if (chatIngested > 0) {
          console.log(`${chatLabel}: ${messages.msgs.length} found, ${chatIngested} ingested, ${chatSkipped} skipped (loads: ${messages.loads})`);
        }
      } catch (err) {
        // Skip problematic chats silently
      }

      // Progress indicator every 50 chats
      if ((ci + 1) % 50 === 0) {
        console.log(`... ${ci + 1}/${chats.length} chats scanned`);
      }
    }

    console.log(`\n✅ Deep backfill complete!`);
    console.log(`   Chats with messages: ${totalChatsWithMessages}`);
    console.log(`   Ingested: ${totalIngested}`);
    console.log(`   Skipped: ${totalSkipped} (duplicates/personal)`);
  } catch (err) {
    console.error("Backfill failed:", err.message);
  }

  process.exit(0);
});

console.log("🔄 Connecting to WhatsApp...");
client.initialize().catch((e) => {
  console.error("❌ Failed:", e.message);
  process.exit(1);
});
