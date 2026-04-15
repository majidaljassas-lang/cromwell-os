// Dellow Centre backlog — VERIFICATION PASS
// Verify no chat messages with order content have been missed.
//
// Read-only: reports orphaned messages, missed line items, multi-message
// orders, image messages with context, and forwarded/quoted content.
//
// Usage:
//   node scripts/backlog-verify-dellow.js

const { Client } = require("pg");

const CASE_ID = "58ebd22e-1101-4d56-a672-7cf635be9339";
const CONN =
  "postgres://postgres:postgres@localhost:51214/cromwell_os?sslmode=disable";
// Dellow Centre case timeframe: 13 Nov 2024 onwards
const CASE_DATE_FROM = new Date("2024-11-13T00:00:00Z");

// ---- order-placing senders (lowercased substrings) ----
const ORDER_SENDERS = [
  "catalyn",
  "ahmed",
  "adrian",
  "will zhao",
  "celine",
  "linda",
  "majid",
];

function isOrderSender(sender) {
  if (!sender) return false;
  const s = String(sender).toLowerCase();
  return ORDER_SENDERS.some((n) => s.includes(n));
}

// ---- order signal detection ----
const UNIT_RX =
  /\b(\d+(?:\.\d+)?)\s*(mm|cm|m|ea|no\.?|nos|nr|pcs?|pc|pack|packs|pk|pks|length|lengths|box|boxes|roll|rolls|bag|bags|pallet|pallets|tube|tubes|bottle|bottles|kg|ltr|l|litre|litres|sheet|sheets|tin|tins|drum|drums|coil|coils|x)\b/i;

const PRODUCT_KEYWORDS = [
  "pipe","valve","screw","board","paint","fitting","fittings","tee","elbow","bend","reducer",
  "coupler","coupling","branch","cistern","basin","toilet","pan","mixer","tap","shower","tray",
  "cable","conduit","socket","switch","panel","corner","bracket","clip","anchor","bolt","nail",
  "solder","flux","wire","wool","sleeve","sealant","silicone","grout","tile","tiles","adhesive",
  "plaster","cement","sand","plywood","mdf","timber","insulation","foam","membrane","felt",
  "boiler","radiator","pump","filter","trap","waste","gully","drain","manhole","cover","grate",
  "meter","ducting","duct","compression","pushfit","push fit","endfeed","copper","plastic","upvc",
  "pvc","cast iron","ci ","brass","chrome","tank","cylinder","flush","plate","button","handle",
  "hinge","lock","sealer","primer","emulsion","gloss","satin","matt","brilliant white","magnolia",
  "tetraflow","aquaflow","hep2o","supermatt","brilliant","light","fan","extractor","vent","grill",
  "thermostat","stat","manifold","actuator","motor","ufh","underfloor","skirting","architrave",
  "door","window","glazing","handle","glass","mirror","plug","chain","waste","overflow","u-bend",
  "ubend","flexi","flex","hose","tape","ptfe","jubilee","clamp","saddle","fixings","fixing",
  "rawl","rawlplug","masonry","drill","bit","blade","disc","sander","sandpaper","abrasive",
  "amazon","screwfix","toolstation","wickes","b&q","plumbcenter","plumbase","graham",
];

function hasProductKeyword(text) {
  if (!text) return false;
  const t = String(text).toLowerCase();
  return PRODUCT_KEYWORDS.some((k) => t.includes(k));
}

function hasUnitNumber(text) {
  if (!text) return false;
  return UNIT_RX.test(String(text));
}

function hasUrl(text) {
  if (!text) return false;
  return /\bhttps?:\/\/\S+/i.test(text) || /\bamazon\.|\bscrewfix\.|\btoolstation\.|\bwickes\.|\bdiy\.|\bbq\.|\bplumb/i.test(text.toLowerCase());
}

function isPureSystemMessage(text) {
  if (!text) return true;
  const t = String(text).trim();
  if (!t) return true;
  // Common WhatsApp system / media-only lines
  const sys = [
    /^image omitted$/i,
    /^video omitted$/i,
    /^audio omitted$/i,
    /^sticker omitted$/i,
    /^gif omitted$/i,
    /^document omitted$/i,
    /^missed voice call$/i,
    /^missed video call$/i,
    /^voice call$/i,
    /^video call$/i,
    /^you deleted this message$/i,
    /^this message was deleted$/i,
    /^messages and calls are end-to-end encrypted/i,
    /^.{0,80}\sadded\s.{0,80}$/i,
    /^.{0,80}\sleft$/i,
    /^.{0,80}\sjoined using this group/i,
    /^.{0,80}\schanged the (group description|subject|group icon)/i,
    /^.{0,80}\screated group/i,
    /^you removed/i,
    /^.{0,80}\swas added$/i,
    /^.{0,80}\screated this group/i,
    /^changed to /i,
  ];
  for (const rx of sys) if (rx.test(t)) return true;
  return false;
}

function shortText(text, n = 200) {
  if (!text) return "";
  return String(text).length > n ? String(text).slice(0, n) + "…" : String(text);
}

// Score how strong an order signal is in a message
function orderSignalScore(msg) {
  if (!msg || !msg.rawText) return 0;
  const text = msg.rawText;
  if (isPureSystemMessage(text)) return 0;
  let score = 0;
  if (hasUnitNumber(text)) score += 3;
  if (hasProductKeyword(text)) score += 3;
  if (hasUrl(text)) score += 2;
  if (isOrderSender(msg.sender)) score += 2;
  if (msg.hasMedia && msg.mediaType && msg.mediaType.toLowerCase().includes("image"))
    score += 1;
  // bullet-like or list pattern
  if (/(^|\n)\s*[-*•·]\s+\S/.test(text)) score += 1;
  // multiple newlines (likely a list)
  if ((text.match(/\n/g) || []).length >= 2) score += 1;
  // please/order/need verbiage
  if (/\b(please|need|order|kindly|send|deliver|require|requested)\b/i.test(text))
    score += 1;
  return score;
}

// crude product+qty extraction from a message
function extractItemMentions(text) {
  if (!text) return [];
  const items = new Set();
  const lines = String(text).split(/\n+/);
  for (const ln of lines) {
    const s = ln.trim();
    if (!s) continue;
    if (isPureSystemMessage(s)) continue;
    const hasNum = /\d/.test(s);
    const hasUnit = UNIT_RX.test(s);
    const hasKw = hasProductKeyword(s);
    if ((hasNum && hasKw) || (hasUnit && hasKw) || (hasUnit && hasNum && s.length < 120)) {
      items.add(s.replace(/\s+/g, " ").trim());
    }
  }
  return Array.from(items);
}

async function main() {
  const client = new Client({ connectionString: CONN });
  await client.connect();
  console.log(`Connected. CASE_ID=${CASE_ID}`);

  try {
    // -------- gather sources for the case --------
    const srcRows = await client.query(
      `SELECT s.id, s.label AS display_name
         FROM "BacklogSource" s
         JOIN "BacklogSourceGroup" g ON g.id = s."groupId"
         WHERE g."caseId" = $1`,
      [CASE_ID],
    );
    const sourceIds = srcRows.rows.map((r) => r.id);
    console.log(`Sources for case: ${sourceIds.length}`);
    if (!sourceIds.length) {
      console.log("No sources — aborting.");
      return;
    }

    // -------- all messages for the case --------
    const msgRows = await client.query(
      `SELECT m.id, m."sourceId", m.sender, m."rawText", m."parsedTimestamp",
              m."hasMedia", m."mediaType", m."mediaFilename", m."lineNumber",
              m."messageType", m."relationType", m."relatedMessageId",
              s.label AS source_name
         FROM "BacklogMessage" m
         JOIN "BacklogSource" s ON s.id = m."sourceId"
         WHERE m."sourceId" = ANY($1)
           AND m."parsedTimestamp" >= $2
         ORDER BY m."parsedTimestamp" ASC, m."lineNumber" ASC`,
      [sourceIds, CASE_DATE_FROM],
    );
    const allMessages = msgRows.rows;
    console.log(`Total messages: ${allMessages.length}`);

    // -------- threads + linked message ids --------
    const thRows = await client.query(
      `SELECT id, label, "messageIds"
         FROM "BacklogOrderThread"
         WHERE "caseId" = $1`,
      [CASE_ID],
    );
    const threads = thRows.rows;
    console.log(`Threads: ${threads.length}`);

    const linkedSet = new Set();
    const msgToThread = new Map();
    for (const t of threads) {
      for (const mid of t.messageIds || []) {
        linkedSet.add(mid);
        if (!msgToThread.has(mid)) msgToThread.set(mid, []);
        msgToThread.get(mid).push({ id: t.id, label: t.label });
      }
    }
    console.log(`Distinct messages in threads: ${linkedSet.size}`);

    // -------- ticket lines per thread / per message --------
    const tlRows = await client.query(
      `SELECT id, "orderThreadId", "sourceMessageId", "rawText",
              "normalizedProduct", "requestedQty", "requestedUnit", status
         FROM "BacklogTicketLine"
         WHERE "caseId" = $1`,
      [CASE_ID],
    );
    const ticketLines = tlRows.rows;
    console.log(`Ticket lines: ${ticketLines.length}`);

    const linesByThread = new Map();
    const linesByMessage = new Map();
    for (const tl of ticketLines) {
      if (tl.orderThreadId) {
        if (!linesByThread.has(tl.orderThreadId))
          linesByThread.set(tl.orderThreadId, []);
        linesByThread.get(tl.orderThreadId).push(tl);
      }
      if (tl.sourceMessageId) {
        if (!linesByMessage.has(tl.sourceMessageId))
          linesByMessage.set(tl.sourceMessageId, []);
        linesByMessage.get(tl.sourceMessageId).push(tl);
      }
    }

    // ============================================================
    // CHECK 1 — orphaned order-signal messages
    // ============================================================
    console.log("\n========== CHECK 1: Orphaned Order-Signal Messages ==========");
    const orphans = [];
    for (const m of allMessages) {
      if (linkedSet.has(m.id)) continue;
      const score = orderSignalScore(m);
      if (score >= 4) orphans.push({ msg: m, score });
    }
    orphans.sort((a, b) => b.score - a.score);
    console.log(`Orphaned messages with order-signal score >= 4: ${orphans.length}`);
    console.log("\nTop 20 most likely missed orders:");
    for (const { msg, score } of orphans.slice(0, 20)) {
      console.log(
        `  [score=${score}] ${msg.parsedTimestamp.toISOString().slice(0, 16)} ` +
        `<${msg.sender}> @${msg.source_name}\n    id=${msg.id}\n    "${shortText(msg.rawText, 280)}"`,
      );
    }

    // ============================================================
    // CHECK 2 — threads with likely missed line items
    // ============================================================
    console.log("\n========== CHECK 2: Threads With Likely Missed Lines ==========");
    const msgById = new Map(allMessages.map((m) => [m.id, m]));
    const gaps = [];
    for (const t of threads) {
      const tlForThread = linesByThread.get(t.id) || [];
      // Build a normalized-product lookup for the thread
      const normHave = new Set();
      for (const tl of tlForThread) {
        const np = (tl.normalizedProduct || "").toLowerCase();
        if (np) normHave.add(np);
        const rt = (tl.rawText || "").toLowerCase();
        if (rt) normHave.add(rt.slice(0, 80));
      }
      for (const mid of t.messageIds || []) {
        const msg = msgById.get(mid);
        if (!msg) continue;
        if (!isOrderSender(msg.sender)) continue;
        if (isPureSystemMessage(msg.rawText)) continue;
        const items = extractItemMentions(msg.rawText);
        if (items.length === 0) continue;
        // Items not represented in any extracted line for this message OR thread
        const linesForMsg = linesByMessage.get(mid) || [];
        const have = new Set(
          linesForMsg.map((tl) => (tl.normalizedProduct || tl.rawText || "").toLowerCase().slice(0, 80)),
        );
        const missed = [];
        for (const it of items) {
          const itLow = it.toLowerCase();
          // crude match — any extracted line shares >= 1 product keyword and number?
          const matched = [...have, ...normHave].some((h) => {
            if (!h) return false;
            // Quick token overlap
            const ah = h.split(/\W+/).filter((x) => x.length > 2);
            const bh = itLow.split(/\W+/).filter((x) => x.length > 2);
            if (!ah.length || !bh.length) return false;
            let o = 0;
            for (const a of ah) if (bh.includes(a)) o++;
            return o >= 2;
          });
          if (!matched) missed.push(it);
        }
        if (missed.length) {
          gaps.push({
            thread: t,
            msg,
            items,
            missed,
            extracted: linesForMsg.map((tl) => `${tl.requestedQty} ${tl.requestedUnit} ${tl.normalizedProduct || tl.rawText}`),
          });
        }
      }
    }
    // Sort by number of likely-missed items descending
    gaps.sort((a, b) => b.missed.length - a.missed.length);
    console.log(`Messages with potentially missed lines: ${gaps.length}`);
    console.log("\nTop 20 most concerning gaps:");
    for (const g of gaps.slice(0, 20)) {
      console.log(
        `\n  Thread: ${g.thread.label} (${g.thread.id.slice(0, 8)})\n` +
        `  ${g.msg.parsedTimestamp.toISOString().slice(0, 16)} <${g.msg.sender}>\n` +
        `  msg=${g.msg.id}\n` +
        `  Full text: "${shortText(g.msg.rawText, 600)}"\n` +
        `  Items mentioned (heuristic): ${g.items.length}\n` +
        `    ${g.items.slice(0, 12).map((s) => "- " + s).join("\n    ")}\n` +
        `  Already extracted (${g.extracted.length}):\n` +
        `    ${g.extracted.slice(0, 12).map((s) => "- " + s).join("\n    ") || "(none)"}\n` +
        `  Potentially missed (${g.missed.length}):\n` +
        `    ${g.missed.slice(0, 12).map((s) => "- " + s).join("\n    ")}`,
      );
    }

    // ============================================================
    // CHECK 3 — multi-message orders not joined
    // ============================================================
    console.log("\n========== CHECK 3: Multi-Message Orders Not Joined ==========");
    // Group messages by sender+source within 5 min windows
    const bySrcSender = new Map();
    for (const m of allMessages) {
      if (!isOrderSender(m.sender)) continue;
      if (isPureSystemMessage(m.rawText)) continue;
      const k = `${m.sourceId}::${m.sender}`;
      if (!bySrcSender.has(k)) bySrcSender.set(k, []);
      bySrcSender.get(k).push(m);
    }
    const sequences = [];
    for (const [, msgs] of bySrcSender) {
      msgs.sort((a, b) => a.parsedTimestamp - b.parsedTimestamp);
      let cur = [];
      for (const m of msgs) {
        if (!cur.length) {
          cur.push(m);
          continue;
        }
        const last = cur[cur.length - 1];
        const dt =
          (new Date(m.parsedTimestamp) - new Date(last.parsedTimestamp)) / 1000;
        if (dt <= 300) cur.push(m);
        else {
          if (cur.length >= 2) sequences.push(cur);
          cur = [m];
        }
      }
      if (cur.length >= 2) sequences.push(cur);
    }
    // Flag sequences with mixed linkage (some in thread, some not)
    // AND where unlinked one carries order-ish content
    const splitSeqs = [];
    for (const seq of sequences) {
      const linked = seq.filter((m) => linkedSet.has(m.id));
      const unlinked = seq.filter((m) => !linkedSet.has(m.id));
      if (linked.length === 0 || unlinked.length === 0) continue;
      // Only interesting if any unlinked has signal
      const interesting = unlinked.filter((m) => orderSignalScore(m) >= 2);
      if (!interesting.length) continue;
      splitSeqs.push({ seq, linked, unlinked: interesting });
    }
    splitSeqs.sort((a, b) => b.unlinked.length - a.unlinked.length);
    console.log(`Multi-message order sequences with mixed linkage: ${splitSeqs.length}`);
    console.log("\nTop 15 examples:");
    for (const s of splitSeqs.slice(0, 15)) {
      const first = s.seq[0];
      console.log(
        `\n  Sender=${first.sender}  ${first.parsedTimestamp.toISOString().slice(0, 16)}  ` +
        `seq=${s.seq.length} linked=${s.linked.length} unlinkedSignal=${s.unlinked.length}`,
      );
      for (const m of s.seq) {
        const tag = linkedSet.has(m.id) ? "LINKED  " : "UNLINKED";
        console.log(
          `    [${tag}] ${m.parsedTimestamp.toISOString().slice(11, 16)} id=${m.id.slice(0, 8)} ` +
          `"${shortText(m.rawText, 160)}"`,
        );
      }
    }

    // ============================================================
    // CHECK 4 — image messages with text context
    // ============================================================
    console.log("\n========== CHECK 4: Image Messages Needing Review ==========");
    const imageHits = [];
    for (let i = 0; i < allMessages.length; i++) {
      const m = allMessages[i];
      if (!m.hasMedia) continue;
      const mt = (m.mediaType || "").toLowerCase();
      if (!mt.includes("image") && !mt.includes("photo")) continue;
      if (!isOrderSender(m.sender)) continue;
      // Look at +/- 2 messages (within same source, within 10 min)
      const window = [];
      for (let j = Math.max(0, i - 3); j <= Math.min(allMessages.length - 1, i + 3); j++) {
        if (j === i) continue;
        const n = allMessages[j];
        if (n.sourceId !== m.sourceId) continue;
        const dt = Math.abs(new Date(n.parsedTimestamp) - new Date(m.parsedTimestamp)) / 1000;
        if (dt > 600) continue;
        window.push(n);
      }
      const ctx = window.some(
        (n) => hasProductKeyword(n.rawText) || hasUnitNumber(n.rawText) || hasUrl(n.rawText),
      );
      if (!ctx) continue;
      const inThread = linkedSet.has(m.id);
      // Has line tied to this image's message?
      const hasLine = (linesByMessage.get(m.id) || []).length > 0;
      imageHits.push({ msg: m, inThread, hasLine, window });
    }
    const needReview = imageHits.filter((h) => !h.hasLine);
    console.log(`Image messages from order senders with surrounding product context: ${imageHits.length}`);
    console.log(`  - in a thread: ${imageHits.filter((h) => h.inThread).length}`);
    console.log(`  - with extracted ticket line: ${imageHits.filter((h) => h.hasLine).length}`);
    console.log(`  - NEED REVIEW (no extracted line): ${needReview.length}`);
    console.log("\nTop 15 image messages needing user review:");
    for (const h of needReview.slice(0, 15)) {
      console.log(
        `\n  ${h.msg.parsedTimestamp.toISOString().slice(0, 16)} <${h.msg.sender}> @${h.msg.source_name}\n` +
        `    id=${h.msg.id}  inThread=${h.inThread}  media=${h.msg.mediaType} file=${h.msg.mediaFilename || "?"}\n` +
        `    caption: "${shortText(h.msg.rawText, 200) || "(no caption)"}"\n` +
        `    nearby context (${h.window.length}):` +
        h.window
          .map(
            (n) =>
              `\n      ${n.parsedTimestamp.toISOString().slice(11, 16)} <${n.sender}> "${shortText(n.rawText, 140)}"`,
          )
          .join(""),
      );
    }

    // ============================================================
    // CHECK 5 — forwarded / quoted messages
    // ============================================================
    console.log("\n========== CHECK 5: Forwarded / Quoted Messages ==========");
    const fwdHits = [];
    for (const m of allMessages) {
      if (!m.rawText) continue;
      const t = m.rawText;
      const isFwd =
        /^>{1,3}\s/m.test(t) ||
        /\bforwarded message\b/i.test(t) ||
        /\b---------- forwarded /i.test(t) ||
        /^begin forwarded message/im.test(t) ||
        m.relationType === "FORWARD" ||
        m.relationType === "QUOTE";
      if (!isFwd) continue;
      if (!hasProductKeyword(t) && !hasUnitNumber(t) && !hasUrl(t)) continue;
      const inThread = linkedSet.has(m.id);
      const hasLine = (linesByMessage.get(m.id) || []).length > 0;
      fwdHits.push({ msg: m, inThread, hasLine });
    }
    console.log(`Forwarded/quoted messages with product/qty/URL signals: ${fwdHits.length}`);
    const fwdNeedReview = fwdHits.filter((h) => !h.hasLine);
    console.log(`  - need review (no extracted line): ${fwdNeedReview.length}`);
    console.log("\nTop 10 forwarded/quoted needing review:");
    for (const h of fwdNeedReview.slice(0, 10)) {
      console.log(
        `\n  ${h.msg.parsedTimestamp.toISOString().slice(0, 16)} <${h.msg.sender}> @${h.msg.source_name}\n` +
        `    id=${h.msg.id}  inThread=${h.inThread}  relType=${h.msg.relationType}\n` +
        `    "${shortText(h.msg.rawText, 500)}"`,
      );
    }

    // ============================================================
    // SUMMARY
    // ============================================================
    console.log("\n========== SUMMARY ==========");
    console.log(`Total messages reviewed: ${allMessages.length}`);
    console.log(`Messages already in threads: ${linkedSet.size}`);
    console.log(`Threads: ${threads.length}`);
    console.log(`Existing ticket lines: ${ticketLines.length}`);
    console.log(`Orphan order-signal messages (score>=4): ${orphans.length}`);
    console.log(`Thread messages with likely missed lines: ${gaps.length}`);
    const missedItemCount = gaps.reduce((a, g) => a + g.missed.length, 0);
    console.log(`Total potentially missed item mentions: ${missedItemCount}`);
    console.log(`Multi-message order sequences with mixed linkage: ${splitSeqs.length}`);
    console.log(`Image messages needing review: ${needReview.length}`);
    console.log(`Forwarded/quoted messages needing review: ${fwdNeedReview.length}`);
    const estNewLines =
      Math.round(orphans.length * 0.5) + missedItemCount + fwdNeedReview.length;
    console.log(`\nEstimated new ticket lines that may be needed: ~${estNewLines}`);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
