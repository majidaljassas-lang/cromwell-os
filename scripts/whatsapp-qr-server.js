/**
 * WhatsApp QR code server — generates a scannable QR on localhost:3001
 * Run: node scripts/whatsapp-qr-server.js
 * Open: http://localhost:3001
 */
const { Client, LocalAuth } = require("whatsapp-web.js");
const QRCode = require("qrcode");
const http = require("http");
const fs = require("fs");
const { CUTOVER_DATE } = require("../src/lib/sync-constants");

let latestQR = null;
let connected = false;

// Backfill state — exposed via GET /backfill/status. Single-flight: only one
// backfill can run at a time (the puppeteer session is a shared resource).
const backfillState = {
  running: false,
  since: null,
  startedAt: null,
  finishedAt: null,
  chatsTotal: 0,
  chatsScanned: 0,
  currentChat: null,
  messagesFound: 0,
  messagesIngested: 0,
  messagesSkipped: 0,
  errors: 0,
  lastError: null,
};

const BACKFILL_PAGE_START = 100;
const BACKFILL_PAGE_CAP = 10_000;
const BACKFILL_PAGE_GROWTH = 4;

async function runBackfill(since) {
  backfillState.running = true;
  backfillState.since = since.toISOString();
  backfillState.startedAt = new Date().toISOString();
  backfillState.finishedAt = null;
  backfillState.chatsTotal = 0;
  backfillState.chatsScanned = 0;
  backfillState.currentChat = null;
  backfillState.messagesFound = 0;
  backfillState.messagesIngested = 0;
  backfillState.messagesSkipped = 0;
  backfillState.errors = 0;
  backfillState.lastError = null;

  console.log(`🔁 Backfill starting from ${since.toISOString()}`);
  try {
    const chats = await client.getChats();
    backfillState.chatsTotal = chats.length;
    console.log(`   ${chats.length} chats to scan`);

    for (const chat of chats) {
      const label = chat.isGroup ? `[${chat.name || chat.id._serialized}]` : (chat.name || chat.id._serialized);
      backfillState.currentChat = label;

      try {
        // Paginate: grow the fetch window until the oldest message is before
        // `since`, so we never miss messages in high-volume chats.
        let limit = BACKFILL_PAGE_START;
        let messages = [];
        while (true) {
          messages = await chat.fetchMessages({ limit });
          if (messages.length === 0) break;
          const oldest = messages[0];
          const oldestDate = new Date((oldest.timestamp || 0) * 1000);
          if (oldestDate < since) break;
          if (messages.length < limit) break; // chat exhausted
          if (limit >= BACKFILL_PAGE_CAP) {
            console.warn(`   ⚠ ${label}: reached page cap ${BACKFILL_PAGE_CAP}, oldest fetched ${oldestDate.toISOString()}`);
            break;
          }
          limit = Math.min(limit * BACKFILL_PAGE_GROWTH, BACKFILL_PAGE_CAP);
        }

        const recent = messages.filter((m) => new Date((m.timestamp || 0) * 1000) >= since);
        if (recent.length === 0) {
          backfillState.chatsScanned++;
          continue;
        }

        console.log(`   ${label}: ${recent.length} messages`);

        for (const msg of recent) {
          if (msg.from === "status@broadcast") continue;
          if (!msg.body && !msg.hasMedia) continue;

          backfillState.messagesFound++;

          let chatName = "";
          let chatId = "";
          let isGroup = false;
          let senderName = msg.from || "Unknown";

          try {
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
            is_sent: msg.fromMe,
            is_group: isGroup,
            has_media: msg.hasMedia || false,
            media_type: msg.type !== "chat" ? msg.type : null,
          };

          try {
            const res = await fetch("http://localhost:3000/api/ingest/whatsapp/live", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            });
            const data = await res.json().catch(() => ({}));
            if (res.ok && !data.skipped) backfillState.messagesIngested++;
            else backfillState.messagesSkipped++;
          } catch (err) {
            backfillState.messagesSkipped++;
            backfillState.errors++;
            backfillState.lastError = err.message;
          }
        }
      } catch (err) {
        backfillState.errors++;
        backfillState.lastError = `${label}: ${err.message}`;
        console.error(`   ❌ ${label}: ${err.message}`);
      }

      backfillState.chatsScanned++;
    }

    console.log(`✅ Backfill complete: ${backfillState.messagesIngested} ingested, ${backfillState.messagesSkipped} skipped, ${backfillState.errors} errors`);
  } catch (err) {
    backfillState.errors++;
    backfillState.lastError = err.message;
    console.error("❌ Backfill failed:", err.message);
  } finally {
    backfillState.running = false;
    backfillState.currentChat = null;
    backfillState.finishedAt = new Date().toISOString();
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => { data += chunk; if (data.length > 1e6) req.destroy(); });
    req.on("end", () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}

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

function sendJson(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

// HTTP server: QR/status HTML on GET /, plus backfill control endpoints.
const server = http.createServer(async (req, res) => {
  // Backfill control endpoints (loopback-only by virtue of binding below)
  if (req.method === "GET" && req.url === "/backfill/status") {
    return sendJson(res, 200, backfillState);
  }

  if (req.method === "POST" && req.url === "/backfill") {
    if (!connected) return sendJson(res, 503, { error: "whatsapp not ready" });
    if (backfillState.running) return sendJson(res, 409, { error: "backfill already running", state: backfillState });
    let body;
    try { body = await readJsonBody(req); }
    catch { return sendJson(res, 400, { error: "invalid json body" }); }

    let since;
    if (body && body.since) {
      const parsed = new Date(body.since);
      if (Number.isNaN(parsed.getTime())) return sendJson(res, 400, { error: "invalid `since` date" });
      since = parsed;
    } else {
      since = CUTOVER_DATE;
    }

    // Fire-and-forget; progress observable via GET /backfill/status
    runBackfill(since).catch((e) => console.error("backfill crashed:", e));
    return sendJson(res, 202, { accepted: true, since: since.toISOString() });
  }

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

server.listen(3001, "127.0.0.1", () => {
  console.log("🌐 QR server at http://localhost:3001");
  console.log("🔄 Initializing WhatsApp...");
  client.initialize().catch((e) => console.error("Init error:", e.message));
});
