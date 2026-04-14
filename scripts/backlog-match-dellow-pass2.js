// Dellow Centre backlog — SECOND PASS order reconstruction
//
// First pass produced:
//   381 ticket lines (169 INVOICED, 206 UNMATCHED, 1 MESSAGE_LINKED)
//   355 BacklogInvoiceLine rows with no BacklogInvoiceMatch row
//
// This script works the problem BACKWARDS from every unmatched invoice line:
//
//   PHASE A  Wire notes-only INVOICED ticket lines to their invoice lines
//            (first pass wrote `notes = "INV-003707 line 1: 6 x £35 = £210"`
//             but never inserted the BacklogInvoiceMatch row — ~69 quick wins)
//
//   PHASE B  Reverse match: for every still-unmatched invoice line, search
//            BacklogMessage in (invoiceDate - 45d .. invoiceDate + 3d) for the
//            product by normalized tokens + classes + sizes. If a candidate
//            message is found:
//              - if in an existing thread: ADD a new BacklogTicketLine on that
//                thread, wire a BacklogInvoiceMatch, set status=INVOICED
//              - if not in any thread: CREATE a new thread and do the same
//            If no candidate → mark as OFF_CHAT_ORDER (notes only, no TL).
//
//   PHASE C  Forward re-sweep of existing threads: re-read source messages on
//            each thread and surface obvious line items that were never turned
//            into BacklogTicketLine rows. These are written as MESSAGE_LINKED
//            (user review) — never auto-wired to invoices.
//
// Usage:
//   node scripts/backlog-match-dellow-pass2.js report
//   node scripts/backlog-match-dellow-pass2.js a --dry-run
//   node scripts/backlog-match-dellow-pass2.js b --dry-run
//   node scripts/backlog-match-dellow-pass2.js c --dry-run
//   node scripts/backlog-match-dellow-pass2.js all            (writes to DB)
//
// Conventions follow scripts/backlog-match-dellow.js
// (normalize / tokens / classes / size gate).

const { Client } = require("pg");

const CASE_ID = "58ebd22e-1101-4d56-a672-7cf635be9339";
const CONN =
  "postgres://postgres:postgres@localhost:51214/cromwell_os?sslmode=disable";
const DRY_RUN = process.argv.includes("--dry-run");
const VERBOSE = process.argv.includes("--verbose");
const MODE = (process.argv[2] || "report").toLowerCase();

// Case window (from spec) — chat messages from 13 Nov 2024 onwards
const CASE_START = new Date("2024-11-13T00:00:00Z");

// Order-placing senders on the DC orders group (spec)
const ORDER_SENDERS = new Set([
  "Catalyn",
  "Adrian Koverok",
  "Ahmed Al Samarai",
  "~ Will Zhao",
  "Celine", // Celine places some panel/mixer orders (~63 messages)
  "Majid Al Jassas", // Majid often re-lists the order for confirmation
  "DC orders",
]);

// ---------- utils (mirror backlog-match-dellow.js) ----------
function normalize(s) {
  if (!s) return "";
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOPWORDS = new Set([
  "a","an","the","of","and","or","to","for","with","in","on","at","by","from",
  "x","mm","m","ea","pack","pk","no","per","please","pls","thanks","thank","you",
  "need","needed","want","order","site","yes","ok","can","get","send","deliver",
  "kindly","regards","pls","morning","hello","hi","hey",
]);

function tokens(s) {
  return normalize(s)
    .split(" ")
    .filter((t) => t && !STOPWORDS.has(t) && t.length > 1);
}

// High-signal tokens: tokens that are unusual enough to anchor a match
// (not simple shape/material words). Used for chat-side scoring.
const LOW_SIGNAL = new Set([
  "white","black","chrome","grey","gray","yellow","red","blue","green","clear",
  "metal","steel","brass","copper","pvc","upvc","plastic","rubber","pine",
  "box","boxes","piece","pieces","pcs","pack","packs","roll","rolls",
  "big","small","large","medium","short","long","new","old",
  "heavy","light","duty","grade","standard",
]);

function highSignalTokens(text) {
  return tokens(text).filter((t) => !LOW_SIGNAL.has(t));
}

function extractSizes(rawText) {
  if (!rawText) return { sizes: new Set(), dims: new Set() };
  const lower = String(rawText).toLowerCase();
  const sizes = new Set();
  for (const m of lower.matchAll(/(\d+(?:\.\d+)?)\s*mm(?=[^a-z]|x|$)/g))
    sizes.add(m[1] + "mm");
  for (const m of lower.matchAll(/(\d+(?:\.\d+)?)\s*m(?![a-z0-9])/g)) {
    if (!/\.\d/.test(m[1]) && parseInt(m[1]) <= 12) sizes.add(m[1] + "m");
  }
  const dims = new Set();
  for (const m of lower.matchAll(/(\d{2,4})\s*x\s*(\d{2,4})/g))
    dims.add(`${m[1]}x${m[2]}`);
  return { sizes, dims };
}

function sizeCompatibility(orderRaw, invRaw) {
  const o = extractSizes(orderRaw);
  const i = extractSizes(invRaw);
  if (o.sizes.size > 0 && i.sizes.size > 0) {
    let overlap = 0;
    for (const s of o.sizes) if (i.sizes.has(s)) overlap++;
    if (overlap === 0) return 0;
  }
  if (o.dims.size > 0 && i.dims.size > 0) {
    let overlap = 0;
    for (const d of o.dims) if (i.dims.has(d)) overlap++;
    if (overlap === 0) return 0;
  }
  return 1;
}

const PRODUCT_CLASSES = [
  { name: "reducer", rx: /\breduc(?:er|ing|ed)\b/ },
  { name: "tee", rx: /\btee(?:s)?\b/ },
  { name: "elbow", rx: /\belbow(?:s)?\b/ },
  { name: "coupler", rx: /\b(?:straight\s+)?(?:coupling|coupler)s?\b/ },
  { name: "bend", rx: /\bbend(?:s)?\b/ },
  { name: "branch", rx: /\bbranch(?:es)?\b/ },
  { name: "check_valve", rx: /\b(?:double\s+)?check\s+valve/ },
  { name: "ball_valve", rx: /\b(?:lever\s+)?ball\s+valve/ },
  { name: "gate_valve", rx: /\bgate\s+valve/ },
  { name: "air_admittance_valve", rx: /\baav\b|\bair\s+admittance/ },
  { name: "valve_generic", rx: /\bvalve(?:s)?\b/ },
  { name: "pipe_support", rx: /\b(?:smart\s*sleeve|smartsleeve|pipe\s+support|pipe\s+liner|pipe\s+clip|pipe\s+bracket)\b/ },
  { name: "pipe", rx: /\bpipe\b/ },
  { name: "paint_white", rx: /\b(?:supermatt|brilliant\s+white|pbw|pure\s+brilliant)\b/ },
  { name: "paint_magnolia", rx: /\bmagnolia\b/ },
  { name: "screw", rx: /(?:^|[^a-z])(?:wood)?screw(?:s)?\b/ },
  { name: "nail", rx: /\bnail(?:s)?\b|\bbrad(?:s)?\b/ },
  { name: "anchor", rx: /\banchor(?:s)?\b/ },
  { name: "bolt", rx: /\bbolt(?:s)?\b/ },
  { name: "clip", rx: /\bclip(?:s)?\b/ },
  { name: "bracket", rx: /\bbracket(?:s)?\b/ },
  { name: "solder", rx: /\bsolder\b/ },
  { name: "wire_wool", rx: /\bwire\s+wool\b|\bsteel\s+wool\b/ },
  { name: "cistern", rx: /\bcistern\b/ },
  { name: "basin", rx: /\bbasin\b/ },
  { name: "toilet_pan", rx: /\b(?:toilet\s+pan|wc\s+pan|close\s*coupled\s+pan|btw\b|pan\b)/ },
  { name: "flush_plate", rx: /\b(?:flush\s+(?:plate|button)|toilet\s+flush\b|wall\s+flush)\b/ },
  { name: "mixer", rx: /\bmixer\b/ },
  { name: "tap", rx: /\btap\b/ },
  { name: "shower_tray", rx: /\b(?:shower\s+)?tray\b/ },
  { name: "shower", rx: /\bshower\b/ },
  { name: "cable", rx: /\bcable\b|6242y|6491x/ },
  { name: "conduit", rx: /\bconduit\b/ },
  { name: "meter_electric", rx: /\belectricity\s+meter\b|ob115/ },
  { name: "socket_elec", rx: /\bsocket\b(?!.*basin)/ },
  { name: "mat_cast_iron", rx: /\bcast\s+iron\b|(?:^|\W)ci\s+\w/ },
  { name: "mat_copper", rx: /\bcopper\b|\bendfeed\b|\bcompression\b/ },
  { name: "mat_plastic", rx: /\bupvc\b|\bpvc\b|\bpb\b|\bpushfit\b|\bpush\s*fit\b|\baquaflow\b|\bhep2o\b|\btetraflow\b|\bplastic\b/ },
];

function detectClasses(text) {
  if (!text) return [];
  const lower = String(text).toLowerCase();
  const found = [];
  for (const c of PRODUCT_CLASSES) if (c.rx.test(lower)) found.push(c.name);
  return found;
}

function classesCompatible(orderClasses, invClasses) {
  if (!orderClasses.length || !invClasses.length) return true;
  const oSet = new Set(orderClasses);
  const iSet = new Set(invClasses);

  // Paint colour exclusivity
  const op = orderClasses.filter((c) => c.startsWith("paint_"));
  const ip = invClasses.filter((c) => c.startsWith("paint_"));
  if (op.length && ip.length && !op.some((c) => iSet.has(c))) return false;

  // Fitting shape must overlap if both sides mention one
  const FITTING = new Set(["tee","elbow","coupler","bend","branch","reducer"]);
  const oF = orderClasses.filter((c) => FITTING.has(c));
  const iF = invClasses.filter((c) => FITTING.has(c));
  if (oF.length && iF.length && !oF.some((c) => iSet.has(c))) return false;

  // Valves
  const VALVES = new Set(["check_valve","ball_valve","gate_valve"]);
  const oV = orderClasses.filter((c) => VALVES.has(c));
  const iV = invClasses.filter((c) => VALVES.has(c));
  if (oV.length && iV.length && !oV.some((c) => iSet.has(c))) return false;

  // Sanitaryware mutual exclusives
  const SANI = new Set(["basin","toilet_pan","cistern","mixer","tap","flush_plate","shower_tray"]);
  const oS = orderClasses.filter((c) => SANI.has(c));
  const iS = invClasses.filter((c) => SANI.has(c));
  if (oS.length && iS.length && !oS.some((c) => iSet.has(c))) return false;

  // Fasteners
  const FAS = new Set(["screw","nail","anchor"]);
  const oFa = orderClasses.filter((c) => FAS.has(c));
  const iFa = invClasses.filter((c) => FAS.has(c));
  if (oFa.length && iFa.length && !oFa.some((c) => iSet.has(c))) return false;

  // Cable vs fitting — hard reject
  if (oSet.has("cable") && !iSet.has("cable") && (iF.length || iV.length))
    return false;
  if (iSet.has("cable") && !oSet.has("cable") && (oF.length || oV.length))
    return false;

  // Material mismatch
  const MAT = ["mat_cast_iron","mat_copper","mat_plastic"];
  const oMat = orderClasses.filter((c) => MAT.includes(c));
  const iMat = invClasses.filter((c) => MAT.includes(c));
  if (oMat.length && iMat.length && !oMat.some((c) => iSet.has(c)))
    return false;

  return true;
}

// ---------- data access helpers ----------
async function fetchUnmatchedInvoiceLines(client) {
  const r = await client.query(
    `SELECT il.id, il."invoiceNumber", il."invoiceDate", il."productDescription",
            il."normalizedProduct", il.qty, il.rate, il.amount, il.unit
     FROM "BacklogInvoiceLine" il
     LEFT JOIN "BacklogInvoiceMatch" bim ON bim."invoiceLineId"=il.id
     WHERE il."caseId"=$1 AND bim.id IS NULL
     ORDER BY il."invoiceDate", il.id`,
    [CASE_ID],
  );
  return r.rows;
}

async function fetchMessagesInWindow(client, fromDate, toDate) {
  const r = await client.query(
    `SELECT bm.id, bm.sender, bm."parsedTimestamp", bm."rawText",
            bm."hasMedia", bm."mediaType"
     FROM "BacklogMessage" bm
     JOIN "BacklogSource" bs ON bm."sourceId"=bs.id
     JOIN "BacklogSourceGroup" bsg ON bs."groupId"=bsg.id
     WHERE bsg."caseId"=$1
       AND bm."parsedTimestamp" >= $2
       AND bm."parsedTimestamp" <= $3
     ORDER BY bm."parsedTimestamp"`,
    [CASE_ID, fromDate, toDate],
  );
  return r.rows;
}

async function fetchCaseMessages(client) {
  const r = await client.query(
    `SELECT bm.id, bm.sender, bm."parsedTimestamp", bm."rawText",
            bm."hasMedia", bm."mediaType"
     FROM "BacklogMessage" bm
     JOIN "BacklogSource" bs ON bm."sourceId"=bs.id
     JOIN "BacklogSourceGroup" bsg ON bs."groupId"=bsg.id
     WHERE bsg."caseId"=$1 AND bm."parsedTimestamp" >= $2
     ORDER BY bm."parsedTimestamp"`,
    [CASE_ID, CASE_START],
  );
  return r.rows;
}

async function fetchThreadsByMessage(client) {
  // returns Map<messageId, Array<{id,label}>>
  const r = await client.query(
    `SELECT id, label, "messageIds" FROM "BacklogOrderThread" WHERE "caseId"=$1`,
    [CASE_ID],
  );
  const map = new Map();
  for (const row of r.rows) {
    for (const mid of row.messageIds || []) {
      if (!map.has(mid)) map.set(mid, []);
      map.get(mid).push({ id: row.id, label: row.label });
    }
  }
  return map;
}

// ---------- PHASE A: wire notes-only INVOICED ----------
async function phaseA(client) {
  log("\n=== PHASE A: wire notes-only INVOICED ticket lines to invoice lines ===");

  const tls = await client.query(
    `SELECT tl.id, tl.notes, tl."requestedQty", tl."normalizedProduct"
     FROM "BacklogTicketLine" tl
     LEFT JOIN "BacklogInvoiceMatch" m ON m."ticketLineId"=tl.id
     WHERE tl."caseId"=$1 AND tl.notes IS NOT NULL
       AND tl.notes ~ 'INV-[0-9]+ line [0-9]+' AND m.id IS NULL`,
    [CASE_ID],
  );
  log(`Candidate ticket lines: ${tls.rows.length}`);

  let wired = 0;
  let failed = 0;
  const usedInvLineIds = new Set();

  for (const tl of tls.rows) {
    // Parse patterns in notes:
    //   "INV-003707 line 1: 6 x £35 = £210"
    //   "INV-003714 line 1: 50 x £15.76 = £788. 1 pallet = 50 boards."
    //   "INV-003714 line 11: 1 x £11.31"   (single-qty lines have no '= £X')
    //   "INV-003716 line 1: 1 x £166.66 (amount shows £66 — ANOMALY)."
    let inv, qty, rate, amt;
    const mFull = tl.notes.match(
      /INV-(\d+)\s+line\s+\d+\s*:\s*(\d+(?:\.\d+)?)\s*x\s*£?(\d+(?:\.\d+)?)\s*=\s*£?(\d+(?:\.\d+)?)/,
    );
    const mShort = tl.notes.match(
      /INV-(\d+)\s+line\s+\d+\s*:\s*(\d+(?:\.\d+)?)\s*x\s*£?(\d+(?:\.\d+)?)/,
    );
    if (mFull) {
      inv = "INV-" + mFull[1];
      qty = parseFloat(mFull[2]);
      rate = parseFloat(mFull[3]);
      amt = parseFloat(mFull[4]);
    } else if (mShort) {
      inv = "INV-" + mShort[1];
      qty = parseFloat(mShort[2]);
      rate = parseFloat(mShort[3]);
      // amount defaults to qty * rate — 1 x £11.31 => £11.31
      amt = qty * rate;
    } else {
      failed++;
      continue;
    }

    const il = await client.query(
      `SELECT id, qty, rate, amount, "productDescription"
       FROM "BacklogInvoiceLine"
       WHERE "caseId"=$1 AND "invoiceNumber"=$2
         AND ABS(qty::numeric - $3::numeric) < 0.01
         AND (rate IS NULL OR ABS(rate::numeric - $4::numeric) < 0.01)
         AND (amount IS NULL OR ABS(amount::numeric - $5::numeric) < 0.05)`,
      [CASE_ID, inv, qty, rate, amt],
    );
    let pick = null;
    for (const row of il.rows) {
      if (!usedInvLineIds.has(row.id)) {
        pick = row;
        break;
      }
    }
    if (!pick) {
      failed++;
      if (VERBOSE)
        log(`  MISS ${inv} qty=${qty} rate=${rate} amt=${amt} (${tl.normalizedProduct.slice(0, 40)}) — ${il.rows.length} cand`);
      continue;
    }

    if (!DRY_RUN) {
      await client.query(
        `INSERT INTO "BacklogInvoiceMatch"
           (id, "ticketLineId", "invoiceLineId", "matchConfidence", "matchMethod")
         VALUES (gen_random_uuid(), $1, $2, 100, 'PASS2_NOTES_EXACT')`,
        [tl.id, pick.id],
      );
    }
    usedInvLineIds.add(pick.id);
    wired++;
  }

  log(`PHASE A: wired ${wired} matches, ${failed} unparseable/notfound${DRY_RUN ? " (DRY RUN)" : ""}`);
  return { wired, failed, wiredInvoiceLineIds: usedInvLineIds };
}

// ---------- PHASE B: reverse match from invoice → messages ----------

function qtyCloseness(a, b) {
  const A = Number(a), B = Number(b);
  if (!A || !B) return 0;
  if (A === B) return 1;
  const diff = Math.abs(A - B) / Math.max(A, B);
  if (diff <= 0.01) return 0.95;
  if (diff <= 0.1) return 0.8;
  if (diff <= 0.25) return 0.55;
  if (diff <= 0.5) return 0.3;
  return 0;
}

// Look for qty mention in a message, returns list of {qty, unit, hint}
function extractQtysFromMessage(rawText) {
  if (!rawText) return [];
  const lower = String(rawText).toLowerCase();
  const found = [];
  // patterns: "50 no", "50no", "qty 50", "x 50", "- 50", "50 pieces", "50pcs", "50 boxes"
  //   also "50 x 50mm" -- the first number is qty, skip if followed by x + number
  for (const m of lower.matchAll(/(?<!\d)(\d{1,4})\s*(?:no\.?|nos\.?|pcs|pieces|pc|pack|packs|pk|each|ea|box|boxes|pairs)\b/g)) {
    found.push({ qty: parseFloat(m[1]), hint: "unit-suffix" });
  }
  for (const m of lower.matchAll(/\bqty\s*[:\-]?\s*(\d{1,4})\b/g)) {
    found.push({ qty: parseFloat(m[1]), hint: "qty-label" });
  }
  // "Waste pipe 40mm-10no" / "Valve 22mm -20"
  for (const m of lower.matchAll(/[-–]\s*(\d{1,4})(?=\s|$|no|pcs|\b)/g)) {
    found.push({ qty: parseFloat(m[1]), hint: "dash-qty" });
  }
  // Lines like "40mm - 10"
  // Plain trailing numbers at end of short list line:
  for (const m of lower.matchAll(/\b(\d{1,4})\s*(?:please|pls)\b/g)) {
    found.push({ qty: parseFloat(m[1]), hint: "qty-please" });
  }
  return found;
}

function scoreInvoiceToMessage(invLine, msg) {
  const invDesc = invLine.productDescription || invLine.normalizedProduct || "";
  const invHigh = new Set(highSignalTokens(invDesc));
  if (invHigh.size === 0) return { score: 0, reason: "invoice-no-tokens" };

  const rt = msg.rawText || "";
  if (!rt) return { score: 0, reason: "empty" };

  const msgTokens = new Set(tokens(rt));
  const msgHigh = new Set(highSignalTokens(rt));

  // count high-signal hits
  let highHits = 0;
  for (const t of invHigh) if (msgTokens.has(t)) highHits++;
  const highRatio = highHits / invHigh.size;
  if (highHits === 0) return { score: 0, reason: "no-high-signal-hit" };

  // class compatibility
  const oc = detectClasses(rt);
  const ic = detectClasses(invDesc);
  if (!classesCompatible(oc, ic))
    return { score: 0, reason: "class-incompatible" };

  // size gate — if both sides specify sizes, must overlap
  const sz = sizeCompatibility(rt, invDesc);
  if (sz === 0) return { score: 0, reason: "size-mismatch" };

  // qty closeness — bonus only
  const qtys = extractQtysFromMessage(rt);
  let bestQty = 0;
  for (const q of qtys) {
    const c = qtyCloseness(q.qty, invLine.qty);
    if (c > bestQty) bestQty = c;
  }

  // classic score
  let score = highRatio * 60 + highHits * 4;
  if (bestQty > 0) score += bestQty * 25;

  // sender boost — order-placing senders
  if (ORDER_SENDERS.has(msg.sender)) score += 5;

  return { score, reason: "ok", highRatio, highHits, bestQty };
}

async function phaseB(client, wiredByPhaseA = new Set()) {
  log("\n=== PHASE B: reverse match unmatched invoice lines -> messages ===");

  const allUnmatched = await fetchUnmatchedInvoiceLines(client);
  // In dry-run mode Phase A did not write, but its would-be matches should be
  // excluded here so Phase B only targets lines that need reverse-matching.
  const invLines = allUnmatched.filter((il) => !wiredByPhaseA.has(il.id));
  log(`Unmatched invoice lines: ${allUnmatched.length} (excluded ${allUnmatched.length - invLines.length} wired by phase A)`);

  const messages = await fetchCaseMessages(client);
  log(`Case messages (from ${CASE_START.toISOString().slice(0, 10)}): ${messages.length}`);

  // Pre-index messages by timestamp (array already sorted)
  // Helper: for given invoice date, return [start, end] window indexes
  function windowMessages(invDate) {
    const t = new Date(invDate).getTime();
    const from = t - 45 * 24 * 3600 * 1000;
    const to = t + 3 * 24 * 3600 * 1000;
    return messages.filter((m) => {
      const mt = new Date(m.parsedTimestamp).getTime();
      return mt >= from && mt <= to;
    });
  }

  const threadByMsg = await fetchThreadsByMessage(client);

  // Track used message ids for invoice line association (so we don't pin the
  // same message to five different invoice lines without need)
  // Actually — multiple invoice lines CAN all come from a single list message.
  // So we do NOT exclude; we reuse.

  const results = {
    matchedToExistingThread: 0,
    matchedWithNewThread: 0,
    offChatOrder: 0,
    truly_unmatched: 0,
    examples: [],
  };

  // For reporting: which invoice lines landed where
  const decisions = []; // {il, outcome, msg?, thread?, score?}

  // Cache of new threads created for reuse during a run
  // key: `${sender}|${dateISO10}|${labelHint}` -> threadId
  const newThreadCache = new Map();

  async function ensureThreadForMessage(msg, invLine) {
    // If message is already in a thread, use that
    const existing = threadByMsg.get(msg.id);
    if (existing && existing.length) return existing[0];

    // else create/reuse a new thread
    const dateIso = new Date(msg.parsedTimestamp).toISOString().slice(0, 10);
    const labelHint = normalize(invLine.productDescription || "")
      .split(" ")
      .slice(0, 3)
      .join(" ")
      .toUpperCase() || "ORDER";
    const key = `${msg.sender}|${dateIso}|${labelHint}`;
    if (newThreadCache.has(key)) {
      const tid = newThreadCache.get(key);
      // ensure message is linked
      if (!DRY_RUN) {
        await client.query(
          `UPDATE "BacklogOrderThread"
           SET "messageIds" = CASE WHEN $2 = ANY("messageIds") THEN "messageIds" ELSE array_append("messageIds", $2) END,
               "updatedAt" = NOW()
           WHERE id=$1`,
          [tid, msg.id],
        );
      }
      return { id: tid, label: `[Pass 2] ${labelHint} — ${msg.sender} ${dateIso}` };
    }

    const label = `[Pass 2] ${labelHint} — ${msg.sender} ${dateIso}`;
    const description =
      `Created by Pass 2 reverse-matching from invoice ${invLine.invoiceNumber} (${new Date(invLine.invoiceDate).toISOString().slice(0, 10)}).`;

    let threadId = null;
    if (!DRY_RUN) {
      const r = await client.query(
        `INSERT INTO "BacklogOrderThread" (id, "caseId", label, description, "messageIds", "createdAt", "updatedAt")
         VALUES (gen_random_uuid(), $1, $2, $3, ARRAY[$4], NOW(), NOW())
         RETURNING id`,
        [CASE_ID, label, description, msg.id],
      );
      threadId = r.rows[0].id;
    } else {
      threadId = `DRY-${newThreadCache.size + 1}`;
    }
    newThreadCache.set(key, threadId);

    // Update threadByMsg cache for subsequent invoice lines
    if (!threadByMsg.has(msg.id)) threadByMsg.set(msg.id, []);
    threadByMsg.get(msg.id).push({ id: threadId, label });

    results.matchedWithNewThread++;
    return { id: threadId, label };
  }

  async function linkMsgToThread(thread, msgId) {
    if (!thread || !msgId) return;
    if (DRY_RUN) return;
    await client.query(
      `UPDATE "BacklogOrderThread"
       SET "messageIds" = CASE WHEN $2 = ANY("messageIds") THEN "messageIds" ELSE array_append("messageIds", $2) END,
           "updatedAt" = NOW()
       WHERE id=$1`,
      [thread.id, msgId],
    );
  }

  async function createTicketLineAndMatch({ msg, invLine, thread, score }) {
    const qty = Number(invLine.qty);
    const desc = invLine.productDescription || invLine.normalizedProduct || "(no description)";
    const norm = normalize(desc);

    const insertTl = await client.query(
      DRY_RUN
        ? `SELECT gen_random_uuid() AS id`
        : `INSERT INTO "BacklogTicketLine"
             (id, "caseId", "orderThreadId", "sourceMessageId", date, sender,
              "rawText", "normalizedProduct", "requestedQty", "requestedUnit",
              status, notes)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, 'INVOICED', $10)
           RETURNING id`,
      DRY_RUN
        ? []
        : [
            CASE_ID,
            thread.id,
            msg.id,
            msg.parsedTimestamp,
            msg.sender,
            (msg.rawText || "").slice(0, 2000),
            desc,
            qty,
            invLine.unit || "EA",
            `Pass 2 reverse-match: ${invLine.invoiceNumber} (${new Date(invLine.invoiceDate).toISOString().slice(0, 10)}), score=${score.toFixed(0)} invLineId=${invLine.id}`,
          ],
    );
    const tlId = insertTl.rows[0].id;
    if (!DRY_RUN) {
      await client.query(
        `INSERT INTO "BacklogInvoiceMatch"
           (id, "ticketLineId", "invoiceLineId", "matchConfidence", "matchMethod")
         VALUES (gen_random_uuid(), $1, $2, $3, 'PASS2_REVERSE')`,
        [tlId, invLine.id, Math.min(99, Math.max(0, score)).toFixed(2)],
      );
    }
    return tlId;
  }

  // Scores for logging
  const THRESH_STRONG = 45;
  const THRESH_WEAK = 30;

  // Skip pure transport/service lines — these are invoice add-ons, not chat orders
  function isNonProductLine(desc) {
    const d = normalize(desc || "");
    if (!d) return true;
    if (/^(delivery|carriage|site delivery|lwb|service charge|shipping)\b/i.test(desc || "")) return true;
    if (/^(dellow centre|e1 7sa|site)\b/i.test(desc || "")) return true;
    if (d.length < 4) return true;
    return false;
  }

  // Re-entrancy guard: precisely key MESSAGE_LINKED Pass 2 TLs by invoiceLineId
  // embedded in the notes string.
  const priorWeak = await client.query(
    `SELECT notes FROM "BacklogTicketLine"
     WHERE "caseId"=$1 AND status='MESSAGE_LINKED'
       AND notes LIKE 'Pass 2 weak reverse-match:%'`,
    [CASE_ID],
  );
  const priorWeakInvLineIds = new Set();
  for (const r of priorWeak.rows) {
    const m = r.notes.match(/invLineId=([0-9a-f-]{36})/);
    if (m) priorWeakInvLineIds.add(m[1]);
  }

  let processed = 0;
  let skippedNonProduct = 0;
  let skippedPriorHandled = 0;
  for (const il of invLines) {
    processed++;
    if (processed % 50 === 0) log(`  ..processed ${processed}/${invLines.length}`);

    if (isNonProductLine(il.productDescription)) {
      skippedNonProduct++;
      decisions.push({ il, outcome: "OFF_CHAT_ORDER", score: 0, reason: "non-product (delivery/service/site)" });
      continue;
    }

    if (priorWeakInvLineIds.has(il.id)) {
      skippedPriorHandled++;
      continue;
    }

    const window = windowMessages(il.invoiceDate);
    let best = null;
    for (const msg of window) {
      if (!msg.rawText) continue;
      if (!ORDER_SENDERS.has(msg.sender)) continue;
      const s = scoreInvoiceToMessage(il, msg);
      if (s.score <= 0) continue;
      if (!best || s.score > best.score) best = { ...s, msg };
    }

    if (!best || best.score < THRESH_WEAK) {
      // Mark as OFF_CHAT_ORDER — attach a note to the invoice line? There's no
      // notes column on BacklogInvoiceLine, so we can't annotate in-row.
      // Instead: track in memory and write a synthetic MESSAGE_LINKED TL so
      // the user can see it in the UI. We do NOT wire a match (no TL paired).
      // Per spec: "mark invoice line as OFF_CHAT_ORDER". Best we can do with
      // current schema is create a sentinel TL linked to no message, with a
      // note. Skip creating if already has a matching note-only TL.
      decisions.push({ il, outcome: "OFF_CHAT_ORDER", score: best ? best.score : 0 });
      continue;
    }

    // Ensure a thread
    const thread = await ensureThreadForMessage(best.msg, il);
    await linkMsgToThread(thread, best.msg.id);

    const isStrong = best.score >= THRESH_STRONG;
    if (isStrong) {
      await createTicketLineAndMatch({
        msg: best.msg,
        invLine: il,
        thread,
        score: best.score,
      });
      // Count existing vs new thread: a thread is "new" iff it's in newThreadCache
      const wasNew = [...newThreadCache.values()].includes(thread.id);
      if (!wasNew) results.matchedToExistingThread++;
      decisions.push({ il, outcome: "MATCHED_STRONG", thread, msg: best.msg, score: best.score, newThread: wasNew });
    } else {
      // Weak candidate — create MESSAGE_LINKED TL (no invoice match row)
      if (!DRY_RUN) {
        await client.query(
          `INSERT INTO "BacklogTicketLine"
             (id, "caseId", "orderThreadId", "sourceMessageId", date, sender,
              "rawText", "normalizedProduct", "requestedQty", "requestedUnit",
              status, notes)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9,
             'MESSAGE_LINKED',
             $10)`,
          [
            CASE_ID,
            thread.id,
            best.msg.id,
            best.msg.parsedTimestamp,
            best.msg.sender,
            (best.msg.rawText || "").slice(0, 2000),
            il.productDescription || il.normalizedProduct || "(no description)",
            Number(il.qty),
            il.unit || "EA",
            `Pass 2 weak reverse-match: ${il.invoiceNumber} (${new Date(il.invoiceDate).toISOString().slice(0, 10)}), score=${best.score.toFixed(0)} invLineId=${il.id} — review`,
          ],
        );
      }
      decisions.push({ il, outcome: "WEAK_SUGGEST", thread, msg: best.msg, score: best.score });
    }
  }

  // Aggregate
  const strong = decisions.filter((d) => d.outcome === "MATCHED_STRONG");
  const weak = decisions.filter((d) => d.outcome === "WEAK_SUGGEST");
  const off = decisions.filter((d) => d.outcome === "OFF_CHAT_ORDER");
  results.truly_unmatched = off.length;

  log(`\nPHASE B results:`);
  log(`  STRONG (>= ${THRESH_STRONG}): ${strong.length}`);
  log(`  WEAK   (>= ${THRESH_WEAK}): ${weak.length}`);
  log(`  OFF_CHAT_ORDER (no msg candidate): ${off.length}`);
  log(`  new threads created: ${newThreadCache.size}`);

  // Top 20 strong matches for verification
  log("\nTop 20 STRONG reverse matches:");
  const topStrong = [...strong].sort((a, b) => b.score - a.score).slice(0, 20);
  for (const d of topStrong) {
    const invD = (d.il.productDescription || d.il.normalizedProduct || "").slice(0, 60);
    const msgSnip = (d.msg.rawText || "").replace(/\n/g, " | ").slice(0, 80);
    log(
      `  [${d.score.toFixed(0)}] ${new Date(d.il.invoiceDate).toISOString().slice(0,10)} ${d.il.invoiceNumber} qty=${d.il.qty} "${invD}" | <- ${d.msg.sender} ${new Date(d.msg.parsedTimestamp).toISOString().slice(0,10)} "${msgSnip}"`,
    );
  }

  // Sample WEAK
  log("\nSample 10 WEAK suggestions:");
  for (const d of weak.slice(0, 10)) {
    const invD = (d.il.productDescription || d.il.normalizedProduct || "").slice(0, 60);
    const msgSnip = (d.msg.rawText || "").replace(/\n/g, " | ").slice(0, 80);
    log(
      `  [${d.score.toFixed(0)}] ${new Date(d.il.invoiceDate).toISOString().slice(0,10)} ${d.il.invoiceNumber} qty=${d.il.qty} "${invD}" | <- ${d.msg.sender} "${msgSnip}"`,
    );
  }

  // Sample OFF_CHAT_ORDER
  log("\nSample 10 OFF_CHAT_ORDER (no chat candidate found):");
  for (const d of off.slice(0, 10)) {
    const invD = (d.il.productDescription || "").slice(0, 60);
    log(
      `  ${new Date(d.il.invoiceDate).toISOString().slice(0,10)} ${d.il.invoiceNumber} qty=${d.il.qty} amt=£${d.il.amount} "${invD}"`,
    );
  }

  return { decisions, newThreads: newThreadCache.size, strong: strong.length, weak: weak.length, off: off.length };
}

// ---------- PHASE C: forward sweep of existing threads for missed items ----------
async function phaseC(client) {
  log("\n=== PHASE C: forward sweep — surface items mentioned in threads but not extracted ===");

  const threads = await client.query(
    `SELECT t.id, t.label, t."messageIds",
       (SELECT array_agg("normalizedProduct")
         FROM "BacklogTicketLine" tl WHERE tl."orderThreadId"=t.id) AS products
     FROM "BacklogOrderThread" t
     WHERE t."caseId"=$1`,
    [CASE_ID],
  );
  log(`Threads: ${threads.rows.length}`);

  // Common lineitem patterns we want to surface if not present as TL:
  // - "Basin Waste - 40 no." / "Mapei Silicone White - 24 no."
  // - "Tek Screw - 2 Box" / "10 box of each dewalt screws"
  // This phase is intentionally conservative — we only write MESSAGE_LINKED rows
  // for STRONG textual line-item patterns that produce a product name + qty.

  const lineItemRx =
    /^\s*([A-Za-z][A-Za-z0-9 \-\/\.'’,&+()]{2,80}?)\s*[-–:]\s*(\d{1,4})\s*(?:no\.?|nos\.?|pcs|pieces|pc|pack|packs|pk|each|ea|box|boxes|bags?|pairs)?\s*$/i;

  let surfaced = 0;
  for (const t of threads.rows) {
    if (!t.messageIds || !t.messageIds.length) continue;
    const existing = new Set((t.products || []).map((p) => normalize(p)));
    const msgs = await client.query(
      `SELECT id, sender, "parsedTimestamp", "rawText"
       FROM "BacklogMessage" WHERE id = ANY($1)`,
      [t.messageIds],
    );
    for (const msg of msgs.rows) {
      if (!msg.rawText) continue;
      const lines = msg.rawText.split(/\r?\n/);
      for (const raw of lines) {
        const line = raw.trim();
        if (!line || line.length < 6) continue;
        const m = line.match(lineItemRx);
        if (!m) continue;
        const productName = m[1].trim();
        const qty = parseFloat(m[2]);
        if (!qty || qty > 5000) continue;
        // Skip junk lines
        if (/^image|^sticker|^omitted|^message edited|^audio|^video/i.test(productName))
          continue;
        if (productName.length < 4) continue;
        const normP = normalize(productName);
        // Already on thread? skip
        let already = false;
        for (const p of existing)
          if (p.includes(normP.slice(0, 12)) || normP.includes(p.slice(0, 12))) {
            already = true;
            break;
          }
        if (already) continue;

        if (VERBOSE)
          log(`  THREAD "${t.label}" — new line candidate: "${productName}" qty ${qty}`);

        if (!DRY_RUN) {
          await client.query(
            `INSERT INTO "BacklogTicketLine"
               (id, "caseId", "orderThreadId", "sourceMessageId", date, sender,
                "rawText", "normalizedProduct", "requestedQty", "requestedUnit",
                status, notes)
             VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, 'EA',
               'MESSAGE_LINKED',
               'Pass 2 forward sweep — surfaced from thread message, review')`,
            [
              CASE_ID,
              t.id,
              msg.id,
              msg.parsedTimestamp,
              msg.sender,
              line.slice(0, 500),
              productName,
              qty,
            ],
          );
        }
        existing.add(normP);
        surfaced++;
      }
    }
  }

  log(`PHASE C: surfaced ${surfaced} MESSAGE_LINKED lines${DRY_RUN ? " (DRY RUN)" : ""}`);
  return { surfaced };
}

// ---------- report ----------
async function report(client) {
  const stats = await client.query(
    `SELECT
       (SELECT COUNT(*) FROM "BacklogTicketLine" WHERE "caseId"=$1) AS tl_total,
       (SELECT COUNT(*) FROM "BacklogTicketLine" WHERE "caseId"=$1 AND status='INVOICED') AS tl_invoiced,
       (SELECT COUNT(*) FROM "BacklogTicketLine" WHERE "caseId"=$1 AND status='UNMATCHED') AS tl_unmatched,
       (SELECT COUNT(*) FROM "BacklogTicketLine" WHERE "caseId"=$1 AND status='MESSAGE_LINKED') AS tl_msg_linked,
       (SELECT COUNT(*) FROM "BacklogInvoiceLine" WHERE "caseId"=$1) AS inv_total,
       (SELECT COUNT(*)
         FROM "BacklogInvoiceLine" il
         LEFT JOIN "BacklogInvoiceMatch" bim ON bim."invoiceLineId"=il.id
         WHERE il."caseId"=$1 AND bim.id IS NULL) AS inv_unmatched,
       (SELECT COUNT(*) FROM "BacklogInvoiceMatch" m
         JOIN "BacklogInvoiceLine" il ON m."invoiceLineId"=il.id
         WHERE il."caseId"=$1) AS matches,
       (SELECT COUNT(*) FROM "BacklogOrderThread" WHERE "caseId"=$1) AS threads,
       (SELECT COUNT(*)
         FROM "BacklogTicketLine" tl
         LEFT JOIN "BacklogInvoiceMatch" m ON m."ticketLineId"=tl.id
         WHERE tl."caseId"=$1 AND tl.status='INVOICED' AND m.id IS NULL
           AND tl.notes ~ 'INV-[0-9]+ line') AS invoiced_no_match_row`,
    [CASE_ID],
  );
  log("\n=== Current state ===");
  log(JSON.stringify(stats.rows[0], null, 2));
}

// ---------- main ----------
function log(...args) {
  console.log(...args);
}

async function main() {
  const client = new Client({ connectionString: CONN });
  await client.connect();
  log(`Connected. MODE=${MODE} DRY_RUN=${DRY_RUN} VERBOSE=${VERBOSE}`);
  try {
    if (MODE === "report") {
      await report(client);
      return;
    }
    if (MODE === "a") {
      await report(client);
      await phaseA(client);
      await report(client);
      return;
    }
    if (MODE === "b") {
      await report(client);
      await phaseB(client, new Set());
      await report(client);
      return;
    }
    if (MODE === "c") {
      await report(client);
      await phaseC(client);
      await report(client);
      return;
    }
    if (MODE === "all") {
      await report(client);
      const a = await phaseA(client);
      await phaseB(client, a.wiredInvoiceLineIds);
      await phaseC(client);
      await report(client);
      return;
    }
    log("Unknown MODE. Use: report | a | b | c | all   [--dry-run] [--verbose]");
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
