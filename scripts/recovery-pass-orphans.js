// Find orphan messages with order signals + multi-message order sequences.
// READ ONLY — outputs JSON to /tmp/recovery-orphans.json for downstream script.

const { Client } = require("pg");
const fs = require("fs");

const CASE_ID = "58ebd22e-1101-4d56-a672-7cf635be9339";
const CONN =
  "postgres://postgres:postgres@localhost:51214/cromwell_os?sslmode=disable";

// Order-signal heuristic: message looks like a product request.
// Positive signals: qty patterns (Xno, X pcs, X units, X pack, X mm, -X).
// Negative signals: pure chat ("ok", "thanks", delivery chatter without qty).
function looksLikeOrder(rawText) {
  if (!rawText) return false;
  const t = rawText.toLowerCase();
  if (t.length < 15) return false;
  // Skip WhatsApp system
  if (/^(‎|)?image omitted$/i.test(rawText.trim())) return false;
  if (/^(‎|)?video omitted$/i.test(rawText.trim())) return false;
  if (/^(‎|)?sticker omitted$/i.test(rawText.trim())) return false;
  if (/^(‎|)?audio omitted$/i.test(rawText.trim())) return false;
  if (/^(‎|)?document omitted$/i.test(rawText.trim())) return false;
  if (/messages and calls are end-to-end/i.test(t)) return false;
  if (/joined using this group/i.test(t)) return false;
  if (/you created group/i.test(t)) return false;

  // Quick-out: single-line chat (<=40 chars) with no numbers and no product words
  const lines = rawText.split(/\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 1 && lines[0].length < 40) {
    if (!/\d/.test(lines[0])) return false;
  }

  // Positive signals
  const signals = [
    /\b\d+\s*(?:no\.?|nos|pcs|pieces|units?|pack(?:s|ets?)?|bags?|boxes?|rolls?|bottles?|buckets?|sheets?|bundles?|l(?:itres?)?|m(?:etres?)?|mm|metres?)\b/i,
    /-\s*\d+\s*(?:no|pcs|pack)/i,
    /\b\d+\s*x\s*\d+/,
    /\b\d+\s*mm\b/i,
    /\b(?:please|pls|need|order|required|send|deliver|add)\b.*\d/is,
    /\d+\s*(?:\/|per)\s*(?:bundle|pack|b\b|pk)/i,
    /[\n•\-*]\s*[A-Za-z].{3,}\s+\d+/, // list with quantities
  ];
  let score = 0;
  for (const rx of signals) if (rx.test(rawText)) score++;

  // Keyword presence of product families increases confidence
  const productWords = [
    "pipe","elbow","tee","copper","valve","screw","paint","timber","cable",
    "radiator","toilet","basin","cistern","sink","tap","tile","plaster","foam",
    "silicone","nail","bracket","clip","bolt","nut","washer","coupling","reducer",
    "trunking","conduit","lights","sensor","sensor","shower","waste","trap","socket",
    "flush","connector","bend","collar","boss","solder","solvent","board","ply",
    "mdf","mortar","cement","glue","anchor","plug","cleaner","sandpaper","grinder",
    "disc","bit","hinge","lock","door","window","gutter","downpipe","roof","felt",
    "plasterboard","batten","joist","skirting","architrave","panel","wood","battens",
    "insulation","ptfe","cistern","bath","basin","flush","brace","bar","tube",
    "switch","plug","fuse","rail","chain","hose","clip","washer","bolt",
  ];
  let productHits = 0;
  for (const w of productWords) {
    const rx = new RegExp(`\\b${w}\\b`, "i");
    if (rx.test(rawText)) productHits++;
  }

  // Decision: score>=2 OR (score>=1 && productHits>=1)
  if (score >= 2) return true;
  if (score >= 1 && productHits >= 1) return true;
  return false;
}

async function main() {
  const client = new Client({ connectionString: CONN });
  await client.connect();

  // All messages in scope (all BacklogMessages whose source is part of the case;
  // but the pipeline uses messages referenced by threads/tickets, so broaden by
  // grabbing all messages with timestamp >= 2024-11-13).
  // A simpler scoping: all messages referenced by any BacklogOrderThread, plus
  // any message in same source group. Use the sources linked to tickets.
  const srcs = await client.query(
    `SELECT DISTINCT m."sourceId"
     FROM "BacklogTicketLine" tl
     JOIN "BacklogMessage" m ON m.id = tl."sourceMessageId"
     WHERE tl."caseId"=$1`,
    [CASE_ID],
  );
  const sourceIds = srcs.rows.map((r) => r.sourceId);
  console.log("Distinct sources used by case tickets:", sourceIds.length);

  if (!sourceIds.length) {
    console.log("No sources found, abort");
    await client.end();
    return;
  }

  // Messages in those sources from 2024-11-13 onwards
  const allMsgs = await client.query(
    `SELECT id, sender, "parsedTimestamp" AS ts, "rawText", "hasMedia", "sourceId"
     FROM "BacklogMessage"
     WHERE "sourceId" = ANY($1::text[])
       AND "parsedTimestamp" >= '2024-11-13'
     ORDER BY "parsedTimestamp" ASC`,
    [sourceIds],
  );
  console.log("Total messages in scope:", allMsgs.rows.length);

  // Map of msgId -> linked? (has TL or is in a thread)
  const linked = new Set();
  const hasTl = await client.query(
    `SELECT DISTINCT "sourceMessageId" FROM "BacklogTicketLine" WHERE "caseId"=$1 AND "sourceMessageId" IS NOT NULL`,
    [CASE_ID],
  );
  for (const r of hasTl.rows) linked.add(r.sourceMessageId);

  const threadMsgs = await client.query(
    `SELECT "messageIds" FROM "BacklogOrderThread" WHERE "caseId"=$1`,
    [CASE_ID],
  );
  for (const row of threadMsgs.rows) {
    for (const m of row.messageIds || []) linked.add(m);
  }

  console.log("Messages linked (TL or thread):", linked.size);

  // Orphans with order signals
  const orphans = [];
  for (const m of allMsgs.rows) {
    if (linked.has(m.id)) continue;
    if (!looksLikeOrder(m.rawText)) continue;
    orphans.push({
      id: m.id,
      sender: m.sender,
      ts: m.ts,
      rawText: m.rawText,
      hasMedia: m.hasMedia,
      sourceId: m.sourceId,
    });
  }
  console.log("Orphan messages with order signals:", orphans.length);

  // Multi-message sequences: same sender, 5-minute window spanning linked + unlinked
  const byTime = [...allMsgs.rows].sort((a, b) => new Date(a.ts) - new Date(b.ts));
  const sequences = [];
  // Group consecutive same-sender messages within 5 min
  let group = [];
  for (const m of byTime) {
    if (!group.length) { group = [m]; continue; }
    const prev = group[group.length - 1];
    const dt = (new Date(m.ts) - new Date(prev.ts)) / 60000;
    if (m.sender === prev.sender && dt <= 5) {
      group.push(m);
    } else {
      if (group.length >= 2) sequences.push(group);
      group = [m];
    }
  }
  if (group.length >= 2) sequences.push(group);

  const mixedSeqs = sequences.filter((g) => {
    const anyLinked = g.some((m) => linked.has(m.id));
    const anyUnlinked = g.some((m) => !linked.has(m.id));
    return anyLinked && anyUnlinked;
  });
  console.log("Mixed linked+unlinked same-sender sequences (<=5min):", mixedSeqs.length);

  // Write results
  fs.writeFileSync("/tmp/recovery-orphans.json", JSON.stringify({
    orphans,
    mixedSeqs: mixedSeqs.map((g) => g.map((m) => ({
      id: m.id, sender: m.sender, ts: m.ts,
      linked: linked.has(m.id),
      rawText: m.rawText,
    }))),
  }, null, 2));
  console.log("Wrote /tmp/recovery-orphans.json");

  await client.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
