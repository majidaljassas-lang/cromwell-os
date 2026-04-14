// Dellow Centre backlog — THIRD PASS order reconstruction
//
// Reorder detection: for each still-unmatched invoice line (OFF_CHAT_ORDER
// candidate), find a prior INVOICED BacklogTicketLine on the same case whose
// product matches with high token overlap / class / material / size
// compatibility. If one is found, materialise a new INVOICED BacklogTicketLine
// on the ORIGINAL thread, flagged as [REORDER], and wire a BacklogInvoiceMatch
// row so the invoice line is no longer unmatched.
//
// This is intentionally strict — false reorders are worse than a residual
// OFF_CHAT_ORDER bucket.
//
// Usage:
//   node scripts/backlog-match-dellow-pass3.js report
//   node scripts/backlog-match-dellow-pass3.js run --dry-run
//   node scripts/backlog-match-dellow-pass3.js run            (writes)
//
// Conventions follow backlog-match-dellow-pass2.js.

const { Client } = require("pg");

const CASE_ID = "58ebd22e-1101-4d56-a672-7cf635be9339";
const CONN =
  "postgres://postgres:postgres@localhost:51214/cromwell_os?sslmode=disable";
const DRY_RUN = process.argv.includes("--dry-run");
const VERBOSE = process.argv.includes("--verbose");
const MODE = (process.argv[2] || "report").toLowerCase();

// ---------- utils (mirror pass 2) ----------
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

function sizeCompatibility(a, b) {
  const o = extractSizes(a);
  const i = extractSizes(b);
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
  { name: "panel_pvc", rx: /\bpvc\s+panel|\belite\s+(?:shine\s+)?(?:avocado|white|ivory|stone|marble|grey)\b|\bwall\s+panel\b|\b2440x1220\b|\b3050x1220\b/ },
  { name: "corner_pvc", rx: /\b(?:inside|outside|internal|external)\s+corner\b/ },
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

function classesCompatible(a, b) {
  if (!a.length || !b.length) return true;
  const aSet = new Set(a);
  const bSet = new Set(b);

  const ap = a.filter((c) => c.startsWith("paint_"));
  const bp = b.filter((c) => c.startsWith("paint_"));
  if (ap.length && bp.length && !ap.some((c) => bSet.has(c))) return false;

  const FITTING = new Set(["tee","elbow","coupler","bend","branch","reducer"]);
  const aF = a.filter((c) => FITTING.has(c));
  const bF = b.filter((c) => FITTING.has(c));
  if (aF.length && bF.length && !aF.some((c) => bSet.has(c))) return false;

  const VALVES = new Set(["check_valve","ball_valve","gate_valve"]);
  const aV = a.filter((c) => VALVES.has(c));
  const bV = b.filter((c) => VALVES.has(c));
  if (aV.length && bV.length && !aV.some((c) => bSet.has(c))) return false;

  const SANI = new Set(["basin","toilet_pan","cistern","mixer","tap","flush_plate","shower_tray"]);
  const aS = a.filter((c) => SANI.has(c));
  const bS = b.filter((c) => SANI.has(c));
  if (aS.length && bS.length && !aS.some((c) => bSet.has(c))) return false;

  const FAS = new Set(["screw","nail","anchor"]);
  const aFa = a.filter((c) => FAS.has(c));
  const bFa = b.filter((c) => FAS.has(c));
  if (aFa.length && bFa.length && !aFa.some((c) => bSet.has(c))) return false;

  if (aSet.has("cable") && !bSet.has("cable") && (bF.length || bV.length))
    return false;
  if (bSet.has("cable") && !aSet.has("cable") && (aF.length || aV.length))
    return false;

  const MAT = ["mat_cast_iron","mat_copper","mat_plastic"];
  const aMat = a.filter((c) => MAT.includes(c));
  const bMat = b.filter((c) => MAT.includes(c));
  if (aMat.length && bMat.length && !aMat.some((c) => bSet.has(c)))
    return false;

  return true;
}

function isNonProductLine(desc) {
  if (!desc) return true;
  const d = normalize(desc);
  if (!d || d.length < 4) return true;
  if (/^(delivery|carriage|site delivery|lwb|service charge|shipping)\b/i.test(desc)) return true;
  if (/^(dellow centre|e1 7sa|site)\b/i.test(desc)) return true;
  return false;
}

// ---------- scoring: invoice line <-> candidate existing ticket line ----------
//
// Rule per spec:
//   tokens overlap >= 60%, same product class, same material/size, original
//   was INVOICED. High-signal only (ignore stopwords + low-signal colour/material
//   words) so a "white" + "box" overlap doesn't fake a match.

function scoreReorder(invLine, candTl) {
  const invDesc = invLine.productDescription || invLine.normalizedProduct || "";
  const candDesc =
    candTl.normalizedProduct || candTl.rawText || "";

  const invHigh = new Set(highSignalTokens(invDesc));
  const candHigh = new Set(highSignalTokens(candDesc));
  if (invHigh.size === 0 || candHigh.size === 0)
    return { score: 0, reason: "no-high-signal-tokens", overlap: 0 };

  // Jaccard on high-signal tokens
  let inter = 0;
  for (const t of invHigh) if (candHigh.has(t)) inter++;
  const denom = Math.max(invHigh.size, candHigh.size);
  const overlap = inter / denom;
  if (overlap < 0.6)
    return { score: 0, reason: "low-overlap", overlap };

  // Class compatibility
  const ic = detectClasses(invDesc);
  const cc = detectClasses(candDesc);
  if (!classesCompatible(ic, cc))
    return { score: 0, reason: "class-incompatible", overlap };

  // Require at least one class to appear on both sides when candidate has classes
  if (ic.length && cc.length) {
    const shared = ic.filter((c) => cc.includes(c));
    if (shared.length === 0)
      return { score: 0, reason: "no-shared-class", overlap };
  }

  // Size compatibility
  if (sizeCompatibility(invDesc, candDesc) === 0)
    return { score: 0, reason: "size-mismatch", overlap };

  // Score: overlap (0..1) -> 60..100, bonus for more high-signal hits.
  const score = 60 + overlap * 35 + Math.min(5, inter);
  return { score, reason: "ok", overlap, inter };
}

// ---------- main ----------
function log(...args) {
  console.log(...args);
}

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
       (SELECT COALESCE(SUM(amount),0)
         FROM "BacklogInvoiceLine" il
         LEFT JOIN "BacklogInvoiceMatch" bim ON bim."invoiceLineId"=il.id
         WHERE il."caseId"=$1 AND bim.id IS NULL) AS unmatched_value,
       (SELECT COALESCE(SUM(amount),0) FROM "BacklogInvoiceLine" WHERE "caseId"=$1) AS total_value,
       (SELECT COUNT(*) FROM "BacklogInvoiceMatch" m
         JOIN "BacklogInvoiceLine" il ON m."invoiceLineId"=il.id
         WHERE il."caseId"=$1) AS matches,
       (SELECT COUNT(*) FROM "BacklogOrderThread" WHERE "caseId"=$1) AS threads`,
    [CASE_ID],
  );
  log("=== State ===");
  log(JSON.stringify(stats.rows[0], null, 2));
}

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

async function fetchInvoicedTicketLines(client) {
  // Pull every prior INVOICED TL with its thread + first invoice date
  // (so we can prefer earlier "original" orders when picking).
  const r = await client.query(
    `SELECT tl.id, tl.date, tl."orderThreadId", tl.sender,
            tl."normalizedProduct", tl."rawText", tl."requestedQty",
            tl."requestedUnit",
            (SELECT MIN(il."invoiceDate")
               FROM "BacklogInvoiceMatch" bim
               JOIN "BacklogInvoiceLine" il ON il.id=bim."invoiceLineId"
               WHERE bim."ticketLineId"=tl.id) AS first_inv_date,
            (SELECT il."invoiceNumber"
               FROM "BacklogInvoiceMatch" bim
               JOIN "BacklogInvoiceLine" il ON il.id=bim."invoiceLineId"
               WHERE bim."ticketLineId"=tl.id
               ORDER BY il."invoiceDate" ASC
               LIMIT 1) AS first_inv_num
     FROM "BacklogTicketLine" tl
     WHERE tl."caseId"=$1 AND tl.status='INVOICED'
       AND tl."orderThreadId" IS NOT NULL`,
    [CASE_ID],
  );
  return r.rows;
}

async function run(client) {
  await report(client);
  log("\n=== PASS 3: reorder reconstruction ===");

  const invLines = await fetchUnmatchedInvoiceLines(client);
  log(`Unmatched invoice lines: ${invLines.length}`);

  const candTls = await fetchInvoicedTicketLines(client);
  log(`INVOICED ticket lines (reorder candidates): ${candTls.length}`);

  // Pre-score each invoice line against every candidate; pick best per invoice.
  const decisions = [];
  let processed = 0;
  let nonProd = 0;

  for (const il of invLines) {
    processed++;
    if (processed % 50 === 0) log(`  ..processed ${processed}/${invLines.length}`);

    if (isNonProductLine(il.productDescription)) {
      nonProd++;
      continue;
    }

    let best = null;
    for (const tl of candTls) {
      // Reorder must be LATER than the original order (invoiceDate > tl.date).
      if (tl.date && il.invoiceDate && new Date(il.invoiceDate) < new Date(tl.date))
        continue;

      const s = scoreReorder(il, tl);
      if (s.score <= 0) continue;
      if (!best || s.score > best.score) best = { ...s, tl };
    }

    if (best) {
      decisions.push({ il, tl: best.tl, score: best.score, overlap: best.overlap });
    }
  }

  // Group by invoice line id to ensure one decision per invoice line
  // (already one-per-line above).

  log(`\nReorder candidates found: ${decisions.length}`);
  log(`Non-product lines skipped: ${nonProd}`);
  log(`OFF_CHAT_ORDER (true, no reorder match): ${invLines.length - nonProd - decisions.length}`);

  if (decisions.length === 0) {
    log("No reorder decisions — done.");
    return;
  }

  // Sort for reporting
  decisions.sort((a, b) => b.score - a.score);

  // Show top 20 examples BEFORE writing — so dry-run view is useful.
  log("\nTop 20 reorder examples (candidate -> invoice):");
  for (const d of decisions.slice(0, 20)) {
    const invD = (d.il.productDescription || "").slice(0, 60);
    const tlD = (d.tl.normalizedProduct || d.tl.rawText || "").slice(0, 60);
    log(
      `  [${d.score.toFixed(0)} ov=${(d.overlap*100).toFixed(0)}%] ` +
      `inv ${new Date(d.il.invoiceDate).toISOString().slice(0,10)} ${d.il.invoiceNumber} ` +
      `qty=${d.il.qty} "${invD}" | orig ${d.tl.date ? new Date(d.tl.date).toISOString().slice(0,10) : "?"} ` +
      `thread=${d.tl.orderThreadId.slice(0, 8)} "${tlD}"`,
    );
  }

  // --- Write phase ---
  let createdLines = 0;
  let createdMatches = 0;
  const errors = [];
  const examples = []; // captured rich rows for final summary

  for (const d of decisions) {
    try {
      const { il, tl, score } = d;
      const desc = il.productDescription || il.normalizedProduct || "(no description)";
      const newDesc = "[REORDER] " + desc;
      const rawText =
        `Reorder — no fresh chat message. Original order: thread ${tl.orderThreadId} ` +
        `(${tl.date ? new Date(tl.date).toISOString().slice(0, 10) : "?"})` +
        (tl.first_inv_num ? `, first invoiced on ${tl.first_inv_num}` : "");
      const notes =
        `Pass 3 reorder (score=${score.toFixed(0)}, overlap=${(d.overlap * 100).toFixed(0)}%). ` +
        `Original line: ${tl.id}. ` +
        `Invoice: ${il.invoiceNumber} invLineId=${il.id}.`;

      let newTlId;
      if (DRY_RUN) {
        newTlId = "DRY";
      } else {
        const ins = await client.query(
          `INSERT INTO "BacklogTicketLine"
             (id, "caseId", "orderThreadId", "sourceMessageId", date, sender,
              "rawText", "normalizedProduct", "requestedQty", "requestedUnit",
              status, notes)
           VALUES (gen_random_uuid(), $1, $2, NULL, $3, $4, $5, $6, $7, $8, 'INVOICED', $9)
           RETURNING id`,
          [
            CASE_ID,
            tl.orderThreadId,
            il.invoiceDate,
            tl.sender || "System (Pass 3)",
            rawText,
            newDesc,
            Number(il.qty),
            il.unit || tl.requestedUnit || "EA",
            notes,
          ],
        );
        newTlId = ins.rows[0].id;

        await client.query(
          `INSERT INTO "BacklogInvoiceMatch"
             (id, "ticketLineId", "invoiceLineId", "matchConfidence", "matchMethod")
           VALUES (gen_random_uuid(), $1, $2, $3, 'PASS3_REORDER')`,
          [newTlId, il.id, Math.min(99, Math.max(0, score)).toFixed(2)],
        );
      }
      createdLines++;
      createdMatches++;
      examples.push({ il, tl, score, overlap: d.overlap, newTlId });
    } catch (e) {
      errors.push({ invLineId: d.il.id, err: e.message });
    }
  }

  log(
    `\nPass 3 writes: ${createdLines} new reorder TLs, ${createdMatches} invoice matches` +
    (DRY_RUN ? " (DRY RUN — nothing persisted)" : ""),
  );
  if (errors.length) log(`Errors: ${errors.length}`);
  for (const e of errors.slice(0, 10)) log("  ERR", e);

  // Final top 20 for user review
  log("\nTop 20 reorders created (original thread -> new reorder line -> invoice):");
  const topEx = [...examples].sort((a, b) => b.score - a.score).slice(0, 20);
  for (const ex of topEx) {
    const invD = (ex.il.productDescription || "").slice(0, 60);
    const tlD = (ex.tl.normalizedProduct || "").slice(0, 60);
    log(
      `  [${ex.score.toFixed(0)} ov=${(ex.overlap * 100).toFixed(0)}%] ` +
      `thread=${ex.tl.orderThreadId.slice(0, 8)} orig=${ex.tl.id.slice(0, 8)} "${tlD}" ` +
      `-> new TL ${ex.newTlId !== "DRY" ? ex.newTlId.slice(0, 8) : "DRY"} ` +
      `-> inv ${new Date(ex.il.invoiceDate).toISOString().slice(0, 10)} ${ex.il.invoiceNumber} qty=${ex.il.qty} £${ex.il.amount} "${invD}"`,
    );
  }

  log("");
  await report(client);

  // Additional final stats
  const final = await client.query(
    `SELECT
       (SELECT COALESCE(SUM(amount),0) FROM "BacklogInvoiceLine" WHERE "caseId"=$1) AS total_value,
       (SELECT COALESCE(SUM(il.amount),0)
         FROM "BacklogInvoiceLine" il
         JOIN "BacklogInvoiceMatch" bim ON bim."invoiceLineId"=il.id
         WHERE il."caseId"=$1) AS matched_value,
       (SELECT COALESCE(SUM(il.amount),0)
         FROM "BacklogInvoiceLine" il
         LEFT JOIN "BacklogInvoiceMatch" bim ON bim."invoiceLineId"=il.id
         WHERE il."caseId"=$1 AND bim.id IS NULL) AS unmatched_value,
       (SELECT COUNT(*)
         FROM "BacklogInvoiceLine" il
         LEFT JOIN "BacklogInvoiceMatch" bim ON bim."invoiceLineId"=il.id
         WHERE il."caseId"=$1 AND bim.id IS NULL) AS unmatched_count`,
    [CASE_ID],
  );
  const f = final.rows[0];
  const total = Number(f.total_value) || 0;
  const matched = Number(f.matched_value) || 0;
  const unmatched = Number(f.unmatched_value) || 0;
  log("\n=== FINAL SUMMARY ===");
  log(`  Total invoice value:    £${total.toFixed(2)}`);
  log(`  Matched value:          £${matched.toFixed(2)} (${total ? ((matched/total)*100).toFixed(1) : 0}%)`);
  log(`  Unmatched value:        £${unmatched.toFixed(2)} (${total ? ((unmatched/total)*100).toFixed(1) : 0}%)`);
  log(`  Unmatched line count:   ${f.unmatched_count}`);
  log(`  Remaining OFF_CHAT_ORDER: ${Number(f.unmatched_count) - nonProd} product + ${nonProd} non-product`);
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
    if (MODE === "run") {
      await run(client);
      return;
    }
    log("Unknown MODE. Use: report | run   [--dry-run] [--verbose]");
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
