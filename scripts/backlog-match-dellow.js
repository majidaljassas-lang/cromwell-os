// Dellow Centre backlog: match unmatched ticket lines to unmatched invoice lines
// Usage: node scripts/backlog-match-dellow.js [--dry-run]
const { Client } = require("pg");

const CASE_ID = "58ebd22e-1101-4d56-a672-7cf635be9339";
const CONN = "postgres://postgres:postgres@localhost:51214/cromwell_os?sslmode=disable";
const DRY_RUN = process.argv.includes("--dry-run");
const MODE = process.argv[2] || "report";

// --- utils ---
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
  "x","mm","m","ea","pack","pk","no","per"
]);

function tokens(s) {
  return normalize(s)
    .split(" ")
    .filter(t => t && !STOPWORDS.has(t) && t.length > 1);
}

function tokenOverlapScore(orderTokens, invTokens) {
  if (!orderTokens.length) return 0;
  const invSet = new Set(invTokens);
  let hits = 0;
  for (const t of orderTokens) if (invSet.has(t)) hits++;
  return (hits / orderTokens.length) * 50;
}

// Extract size tokens like "15mm", "22mm", "100mm", "3m", "600x600"
function extractSizes(rawText) {
  if (!rawText) return { sizes: new Set(), dims: new Set() };
  const lower = String(rawText).toLowerCase();
  const sizes = new Set();
  // Match Nmm — followed by non-letter, OR by 'x' (for dimensions like 100mmx88)
  // This catches 100mmx, 40mm , 50mm. end, 205mmm (reject this 3rd m), but allows 50mmx
  for (const m of lower.matchAll(/(\d+(?:\.\d+)?)\s*mm(?=[^a-z]|x|$)/g)) sizes.add(m[1] + "mm");
  for (const m of lower.matchAll(/(\d+(?:\.\d+)?)\s*m(?![a-z0-9])/g)) {
    // only accept short integers like 3m, 4m
    if (!/\.\d/.test(m[1]) && parseInt(m[1]) <= 12) sizes.add(m[1] + "m");
  }
  const dims = new Set();
  for (const m of lower.matchAll(/(\d{2,4})\s*x\s*(\d{2,4})/g)) dims.add(`${m[1]}x${m[2]}`);
  return { sizes, dims };
}

// Fitting/product-type classes. If both order and invoice mention a class
// (i.e. they ARE different fitting types like tee vs elbow vs coupler),
// they must match on the class.
const PRODUCT_CLASSES = [
  // plumbing fittings (specific first)
  { name: "reducer", rx: /\breduc(?:er|ing|ed)\b/ },
  { name: "tee", rx: /\b(?:equal\s+)?tee(?:s)?\b|\btee\b|\b(?:reduced\s+)?tee\b/ },
  { name: "elbow", rx: /\belbow(?:s)?\b/ },
  { name: "coupler", rx: /\b(?:straight\s+)?(?:coupling|coupler)s?\b/ },
  { name: "bend", rx: /\bbend(?:s)?\b/ },
  { name: "branch", rx: /\bbranch(?:es)?\b/ },
  // valves & controls
  { name: "check_valve", rx: /\b(?:double\s+)?check\s+valve/ },
  { name: "ball_valve", rx: /\b(?:lever\s+)?ball\s+valve/ },
  { name: "gate_valve", rx: /\bgate\s+valve/ },
  { name: "air_admittance_valve", rx: /\baav\b|\bair\s+admittance/ },
  { name: "valve_generic", rx: /\bvalve(?:s)?\b/ },
  // pipe-like
  { name: "pipe_support", rx: /\b(?:smart\s*sleeve|smartsleeve|pipe\s+support|pipe\s+liner|pipe\s+clip|pipe\s+bracket|pipe\s+clips)\b/ },
  { name: "pipe", rx: /\bpipe\b/ },
  // paint
  { name: "paint_white", rx: /\b(?:supermatt|brilliant\s+white|pbw|pure\s+brilliant)\b/ },
  { name: "paint_magnolia", rx: /\bmagnolia\b/ },
  // fasteners
  { name: "screw", rx: /(?:^|[^a-z])(?:wood)?screw(?:s)?\b/ },
  { name: "nail", rx: /\bnail(?:s)?\b|\bbrad(?:s)?\b/ },
  { name: "anchor", rx: /\banchor(?:s)?\b/ },
  { name: "bolt", rx: /\bbolt(?:s)?\b/ },
  // misc
  { name: "clip", rx: /\bclip(?:s)?\b/ },
  { name: "bracket", rx: /\bbracket(?:s)?\b/ },
  { name: "solder", rx: /\bsolder\b/ },
  { name: "wire_wool", rx: /\bwire\s+wool\b/ },
  { name: "shovel", rx: /\bshovel\b/ },
  { name: "cistern", rx: /\bcistern\b/ },
  { name: "basin", rx: /\bbasin\b/ },
  { name: "toilet_pan", rx: /\b(?:toilet\s+pan|wc\s+pan|close\s*coupled\s+pan|btw\b|pan\b)/ },
  { name: "flush_plate", rx: /\b(?:flush\s+(?:plate|button)|toilet\s+flush\b|wall\s+flush)\b/ },
  { name: "mixer", rx: /\bmixer\b/ },
  { name: "tap", rx: /\btap\b/ },
  // materials
  { name: "mat_cast_iron", rx: /\bcast\s+iron\b|(?:^|\W)ci\s+\w/ },
  { name: "mat_copper", rx: /\bcopper\b|\bendfeed\b|\bcompression\b/ },
  { name: "mat_plastic", rx: /\bupvc\b|\bpvc\b|\bpb\b|\bpushfit\b|\bpush\s*fit\b|\baquaflow\b|\bhep2o\b|\btetraflow\b|\bplastic\b/ },
];

function detectClasses(text) {
  if (!text) return [];
  const lower = String(text).toLowerCase();
  const found = [];
  for (const c of PRODUCT_CLASSES) {
    if (c.rx.test(lower)) found.push(c.name);
  }
  return found;
}

// Related-class graph: if order is class X and invoice is class Y, pairs in this
// map are EXPLICITLY compatible; otherwise a hard class-mismatch rejects the match.
const RELATED_CLASSES = {
  paint_white: new Set(["paint_white"]),
  paint_magnolia: new Set(["paint_magnolia"]),
  // Mutual exclusives (paint colours)
};

function classesCompatible(orderClasses, invClasses) {
  if (!orderClasses.length || !invClasses.length) return true;
  const oSet = new Set(orderClasses);
  const iSet = new Set(invClasses);

  // If both sides mention a paint colour and they differ -> reject
  const orderPaintClasses = orderClasses.filter(c => c.startsWith("paint_"));
  const invPaintClasses = invClasses.filter(c => c.startsWith("paint_"));
  if (orderPaintClasses.length && invPaintClasses.length) {
    const shared = orderPaintClasses.filter(c => iSet.has(c));
    if (!shared.length) return false;
  }

  // If both sides mention a fitting class (tee/elbow/bend/coupler/branch/reducer),
  // at least one must overlap
  const FITTING = new Set(["tee","elbow","coupler","bend","branch","reducer"]);
  const oFit = orderClasses.filter(c => FITTING.has(c));
  const iFit = invClasses.filter(c => FITTING.has(c));
  if (oFit.length && iFit.length) {
    const shared = oFit.filter(c => iSet.has(c));
    if (!shared.length) return false;
  }

  // Reducer specificity: if one side mentions reducer and the other mentions
  // coupler/tee/elbow/bend WITHOUT reducer, reject
  if (oSet.has("reducer") !== iSet.has("reducer")) {
    const nonReducerSide = oSet.has("reducer") ? invClasses : orderClasses;
    if (nonReducerSide.some(c => ["coupler","tee","elbow","bend","branch"].includes(c))) {
      return false;
    }
  }

  // Valves
  const VALVES = new Set(["check_valve", "ball_valve", "gate_valve"]);
  const oV = orderClasses.filter(c => VALVES.has(c));
  const iV = invClasses.filter(c => VALVES.has(c));
  if (oV.length && iV.length) {
    const shared = oV.filter(c => iSet.has(c));
    if (!shared.length) return false;
  }

  // pipe vs pipe_support (accessory) — if order says pipe but invoice says only pipe_support, reject
  if (oSet.has("pipe") && !iSet.has("pipe") && iSet.has("pipe_support")) return false;
  if (iSet.has("pipe") && !oSet.has("pipe") && oSet.has("pipe_support")) return false;

  // One side says bracket/clip/pipe_support, other says plain pipe — reject
  const ACCESSORIES_ONLY = new Set(["bracket", "clip", "pipe_support"]);
  const oAcc = orderClasses.some(c => ACCESSORIES_ONLY.has(c));
  const iAcc = invClasses.some(c => ACCESSORIES_ONLY.has(c));
  if (oSet.has("pipe") && !oAcc && iAcc) return false;
  if (iSet.has("pipe") && !iAcc && oAcc) return false;

  // Order asks for pipe but invoice is a fitting (bend/elbow/tee/coupler/branch/reducer) AND not also pipe -> reject
  const FITTING_ONLY = new Set(["tee","elbow","coupler","bend","branch","reducer"]);
  const oHasFit = orderClasses.some(c => FITTING_ONLY.has(c));
  const iHasFit = invClasses.some(c => FITTING_ONLY.has(c));
  if (oSet.has("pipe") && !oHasFit && iHasFit && !iSet.has("pipe")) return false;
  if (iSet.has("pipe") && !iHasFit && oHasFit && !oSet.has("pipe")) return false;

  // pipe vs valve (valve_generic, check_valve, ball_valve, gate_valve, aav) — reject
  const ANY_VALVE = new Set(["check_valve","ball_valve","gate_valve","air_admittance_valve","valve_generic"]);
  const oValve = orderClasses.some(c => ANY_VALVE.has(c));
  const iValve = invClasses.some(c => ANY_VALVE.has(c));
  if (oSet.has("pipe") && !oValve && iValve && !iSet.has("pipe")) return false;
  if (iSet.has("pipe") && !iValve && oValve && !oSet.has("pipe")) return false;

  // valve vs fitting — reject
  if (oValve && !oHasFit && iHasFit && !iValve) return false;
  if (iValve && !iHasFit && oHasFit && !oValve) return false;

  // wire_wool must match wire_wool; don't confuse with solder
  if ((oSet.has("wire_wool") || oSet.has("solder")) || (iSet.has("wire_wool") || iSet.has("solder"))) {
    if (oSet.has("wire_wool") !== iSet.has("wire_wool")) return false;
    if (oSet.has("solder") !== iSet.has("solder")) {
      // solder vs wire_wool mismatch already covered; if one has solder and other has nothing recognized, don't reject here
      if (oSet.has("wire_wool") || iSet.has("wire_wool")) return false;
    }
  }

  // sanitaryware mutual exclusives: basin vs pan vs cistern vs mixer/tap
  const SANI = new Set(["basin","toilet_pan","cistern","mixer","tap","flush_plate"]);
  const oS = orderClasses.filter(c => SANI.has(c));
  const iS = invClasses.filter(c => SANI.has(c));
  if (oS.length && iS.length) {
    const shared = oS.filter(c => iSet.has(c));
    if (!shared.length) return false;
  }

  // fasteners
  const FAS = new Set(["screw","nail","anchor"]);
  const oF = orderClasses.filter(c => FAS.has(c));
  const iF = invClasses.filter(c => FAS.has(c));
  if (oF.length && iF.length) {
    const shared = oF.filter(c => iSet.has(c));
    if (!shared.length) return false;
  }

  // clip vs bracket vs branch — tighten for waste-pipe accessories
  const ACC = new Set(["clip","bracket","branch"]);
  const oA = orderClasses.filter(c => ACC.has(c));
  const iA = invClasses.filter(c => ACC.has(c));
  if (oA.length && iA.length) {
    const shared = oA.filter(c => iSet.has(c));
    if (!shared.length) return false;
  }

  // Fastener vs fitting/valve — reject (e.g. metal nail anchor vs aquaflow bend)
  const FAS_SET = new Set(["screw","nail","anchor","bolt"]);
  const oFas = orderClasses.some(c => FAS_SET.has(c));
  const iFas = invClasses.some(c => FAS_SET.has(c));
  if (oFas && !iFas && (iHasFit || iValve)) return false;
  if (iFas && !oFas && (oHasFit || oValve)) return false;

  // Material mismatch: cast iron vs copper vs plastic
  const MAT = ["mat_cast_iron", "mat_copper", "mat_plastic"];
  const oMat = orderClasses.filter(c => MAT.includes(c));
  const iMat = invClasses.filter(c => MAT.includes(c));
  if (oMat.length && iMat.length) {
    const shared = oMat.filter(c => iSet.has(c));
    if (!shared.length) return false;
  }

  return true;
}

// Returns penalty (0..1 multiplier) — 1 = OK, 0 = hard reject
function sizeCompatibility(orderRaw, invRaw) {
  const o = extractSizes(orderRaw);
  const i = extractSizes(invRaw);
  // If order specifies sizes and invoice has sizes with NO overlap, penalize heavily
  if (o.sizes.size > 0 && i.sizes.size > 0) {
    let overlap = 0;
    for (const s of o.sizes) if (i.sizes.has(s)) overlap++;
    if (overlap === 0) return 0; // hard size mismatch
  }
  if (o.dims.size > 0 && i.dims.size > 0) {
    let overlap = 0;
    for (const d of o.dims) if (i.dims.has(d)) overlap++;
    if (overlap === 0) return 0;
  }
  return 1;
}

function qtyScore(orderQty, invQty) {
  const a = Number(orderQty);
  const b = Number(invQty);
  if (!a || !b) return 0;
  if (a === b) return 30;
  const diff = Math.abs(a - b) / Math.max(a, b);
  if (diff <= 0.1) return 15;
  return 0;
}

function dateScore(orderDate, invDate) {
  if (!orderDate || !invDate) return 0;
  const diff = (new Date(invDate) - new Date(orderDate)) / (1000 * 60 * 60 * 24);
  // Invoice should be AT or AFTER order, but allow small backwards slack
  if (diff < -3) return 0;
  const absDays = Math.abs(diff);
  if (absDays <= 7) return 20;
  if (absDays <= 30) return 10;
  if (absDays <= 60) return 5;
  return 0;
}

// --- rawText parsing: extract per-line descriptions ---
// The raw text has lines like:
//   #Item & DescriptionQtyRateVAT %VATAmount
//   1 Materials
//   <description lines>
//   50.0015.7620.00157.60788.00
// We locate the numbers row (ends with amount) and use qty/rate/amount as anchors.

function parseInvoiceLineDescriptions(rawText, lines) {
  // lines = array of BacklogInvoiceLine (with qty, rate, amount)
  // Strategy: walk rawText, find lines that look like number-concat lines, collect
  // the preceding text as description, match against line-items by qty+rate+amount.
  if (!rawText) return {};
  const rows = rawText.split(/\r?\n/);
  const result = {}; // key: `${qty}|${rate}|${amount}` -> description text

  // Regex for concatenated numbers row: qtyN.N.rateN.N.vat%.vatAmt.amount
  // Example "50.0015.7620.00157.60788.00"
  // Pattern: ^\d+(?:\.\d{1,4})?\d+\.\d{2}\d+\.\d{2}\d+\.\d{2}\d+\.\d{2}$
  const numLinePattern = /^\s*(\d{1,6}(?:\.\d{1,4})?)(\d{1,6}\.\d{2})(\d{1,3}\.\d{2})(\d{1,6}\.\d{2})(\d{1,7}\.\d{2})\s*$/;
  // Also try space-separated
  const numLineSpaced = /^\s*(\d{1,6}(?:\.\d{1,4})?)\s+(\d{1,6}\.\d{2})\s+(\d{1,3}\.\d{2})\s+(\d{1,6}\.\d{2})\s+(\d{1,7}\.\d{2})\s*$/;

  let descBuf = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    let m = row.match(numLinePattern) || row.match(numLineSpaced);
    if (m) {
      const qty = parseFloat(m[1]);
      const rate = parseFloat(m[2]);
      // const vatPct = parseFloat(m[3]);
      // const vatAmt = parseFloat(m[4]);
      const amount = parseFloat(m[5]);
      // Join description lines, stripping leading "N Materials" marker
      const desc = descBuf
        .map(r => r.trim())
        .filter(r => r.length > 0)
        .filter(r => !/^\d+\s+Materials\s*$/i.test(r))
        .filter(r => !/^#Item/i.test(r))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      const key = `${qty.toFixed(2)}|${rate.toFixed(2)}|${amount.toFixed(2)}`;
      if (!result[key]) result[key] = desc;
      descBuf = [];
    } else {
      // only buffer short-ish lines, clear on obvious non-desc tokens
      if (row.trim().length > 0) descBuf.push(row);
      // Clear buffer if it gets too long (safety)
      if (descBuf.length > 8) descBuf.shift();
    }
  }
  return result;
}

// Fallback: try also matching by qty+amount (rate sometimes null)
function lookupDesc(map, qty, rate, amount) {
  const q = Number(qty);
  const r = rate == null ? null : Number(rate);
  const a = amount == null ? null : Number(amount);
  // exact
  if (r != null && a != null) {
    const k = `${q.toFixed(2)}|${r.toFixed(2)}|${a.toFixed(2)}`;
    if (map[k]) return map[k];
  }
  // scan tolerant
  for (const [k, v] of Object.entries(map)) {
    const [kq, kr, ka] = k.split("|").map(Number);
    if (Math.abs(kq - q) < 0.0001) {
      if (r != null && Math.abs(kr - r) < 0.01) {
        if (a != null && Math.abs(ka - a) < 0.02) return v;
      }
      if (a != null && Math.abs(ka - a) < 0.02) return v;
    }
  }
  return null;
}

async function main() {
  const client = new Client({ connectionString: CONN });
  await client.connect();
  console.log(`Connected. MODE=${MODE} DRY_RUN=${DRY_RUN}`);

  try {
    // --- Stats
    const stats = await client.query(`
      SELECT
        (SELECT COUNT(*) FROM "BacklogTicketLine" WHERE "caseId"=$1) AS ticket_total,
        (SELECT COUNT(*) FROM "BacklogTicketLine" WHERE "caseId"=$1 AND status='UNMATCHED') AS ticket_unmatched,
        (SELECT COUNT(*) FROM "BacklogTicketLine" WHERE "caseId"=$1 AND status='INVOICED') AS ticket_invoiced,
        (SELECT COUNT(*) FROM "BacklogInvoiceLine" WHERE "caseId"=$1) AS inv_total,
        (SELECT COUNT(*) FROM "BacklogInvoiceMatch" bim JOIN "BacklogInvoiceLine" il ON bim."invoiceLineId"=il.id WHERE il."caseId"=$1) AS match_total
    `, [CASE_ID]);
    console.log("Stats:", stats.rows[0]);

    if (MODE === "report") {
      // sample ticket lines
      const sample = await client.query(`
        SELECT id, date, "normalizedProduct", "requestedQty", "requestedUnit", status
        FROM "BacklogTicketLine"
        WHERE "caseId"=$1 AND status='UNMATCHED'
        ORDER BY date
        LIMIT 5
      `, [CASE_ID]);
      console.log("Sample UNMATCHED ticket lines:", sample.rows);

      const sampleInv = await client.query(`
        SELECT il.id, il."invoiceNumber", il."invoiceDate", il."productDescription", il."normalizedProduct", il.qty, il.rate, il.amount
        FROM "BacklogInvoiceLine" il
        LEFT JOIN "BacklogInvoiceMatch" bim ON bim."invoiceLineId"=il.id
        WHERE il."caseId"=$1 AND bim.id IS NULL
        ORDER BY il."invoiceDate"
        LIMIT 5
      `, [CASE_ID]);
      console.log("Sample unmatched invoice lines:", sampleInv.rows);

      // sample raw text
      const rawSample = await client.query(`
        SELECT id, "invoiceNumber", "invoiceDate", "lineCount", LEFT("rawText", 2000) as raw_preview
        FROM "BacklogInvoiceDocument"
        WHERE "caseId"=$1 AND "rawText" IS NOT NULL
        ORDER BY "invoiceDate"
        LIMIT 1
      `, [CASE_ID]);
      console.log("Sample doc rawText preview:");
      if (rawSample.rows[0]) {
        console.log(rawSample.rows[0].invoice_preview);
        console.log("---");
        console.log(rawSample.rows[0].raw_preview);
      }
      return;
    }

    if (MODE === "parse") {
      await parseDescriptions(client);
      return;
    }

    if (MODE === "match") {
      await runMatching(client);
      return;
    }

    if (MODE === "all") {
      await parseDescriptions(client);
      await runMatching(client);
      return;
    }

    console.log("Unknown MODE. Use: report | parse | match | all");
  } finally {
    await client.end();
  }
}

async function parseDescriptions(client) {
  console.log("\n=== STEP 1: Parse descriptions from rawText ===");
  const docs = await client.query(`
    SELECT id, "invoiceNumber", "rawText"
    FROM "BacklogInvoiceDocument"
    WHERE "caseId"=$1 AND "rawText" IS NOT NULL
  `, [CASE_ID]);
  console.log(`Docs with rawText: ${docs.rows.length}`);

  let updatedCount = 0;
  let docsWithAnyMatch = 0;
  for (const doc of docs.rows) {
    const lines = await client.query(`
      SELECT id, qty, rate, amount, "productDescription"
      FROM "BacklogInvoiceLine"
      WHERE "documentId"=$1
      ORDER BY "invoiceDate", id
    `, [doc.id]);
    const descMap = parseInvoiceLineDescriptions(doc.rawText, lines.rows);
    let thisDoc = 0;
    for (const line of lines.rows) {
      // Only update if current productDescription is empty/NULL
      if (line.productDescription && line.productDescription.length > 2) continue;
      const d = lookupDesc(descMap, line.qty, line.rate, line.amount);
      if (d && d.length >= 3) {
        if (!DRY_RUN) {
          await client.query(
            `UPDATE "BacklogInvoiceLine" SET "productDescription"=$1, "normalizedProduct"=$2 WHERE id=$3`,
            [d, normalize(d), line.id]
          );
        }
        updatedCount++;
        thisDoc++;
      }
    }
    if (thisDoc > 0) docsWithAnyMatch++;
  }
  console.log(`productDescription updates: ${updatedCount} across ${docsWithAnyMatch} docs${DRY_RUN ? " (DRY RUN)" : ""}`);
}

async function runMatching(client) {
  console.log("\n=== STEP 2: Match unmatched ticket lines to unmatched invoice lines ===");

  const ticketLines = await client.query(`
    SELECT id, date, "normalizedProduct", "requestedQty", "requestedUnit", "rawText"
    FROM "BacklogTicketLine"
    WHERE "caseId"=$1 AND status='UNMATCHED'
  `, [CASE_ID]);
  console.log(`UNMATCHED ticket lines: ${ticketLines.rows.length}`);

  const invLines = await client.query(`
    SELECT il.id, il."invoiceNumber", il."invoiceDate", il."productDescription", il."normalizedProduct",
           il.qty, il.unit, il.rate, il.amount
    FROM "BacklogInvoiceLine" il
    LEFT JOIN "BacklogInvoiceMatch" bim ON bim."invoiceLineId"=il.id
    WHERE il."caseId"=$1 AND bim.id IS NULL
  `, [CASE_ID]);
  console.log(`Unmatched invoice lines: ${invLines.rows.length}`);

  // Precompute tokens for invoice lines
  const invIndex = invLines.rows.map(il => ({
    ...il,
    _tokens: tokens(il.productDescription || il.normalizedProduct || "")
  }));

  const takenInvIds = new Set(); // prevent double-matching during this run
  const autoMatches = [];   // score >=60
  const suggestedMatches = []; // 40-60

  for (const tl of ticketLines.rows) {
    const orderTokens = tokens(tl.normalizedProduct || tl.rawText || "");
    if (!orderTokens.length) continue;

    const orderRawForSize = `${tl.normalizedProduct || ""} ${tl.rawText || ""}`;

    let best = null;
    for (const il of invIndex) {
      if (takenInvIds.has(il.id)) continue;

      const ds = dateScore(tl.date, il.invoiceDate);
      if (ds === 0) continue; // must be within 60 days and not too far before order

      // Hard size/dimension gate
      const invRawForSize = `${il.productDescription || ""} ${il.normalizedProduct || ""}`;
      const sizeOk = sizeCompatibility(orderRawForSize, invRawForSize);
      if (sizeOk === 0) continue;

      // Hard product-class gate
      const orderClasses = detectClasses(orderRawForSize);
      const invClasses = detectClasses(invRawForSize);
      if (!classesCompatible(orderClasses, invClasses)) continue;

      const ts = tokenOverlapScore(orderTokens, il._tokens);
      const qs = qtyScore(tl.requestedQty, il.qty);

      // Require a minimum token overlap — reject if nothing semantic matches
      if (ts < 15 && qs < 30) continue;
      if (ts < 10) continue; // reject matches with effectively no product-description evidence

      const score = ts + qs + ds;

      if (!best || score > best.score) {
        best = { score, ts, qs, ds, il };
      }
    }

    if (!best) continue;

    if (best.score >= 60) {
      autoMatches.push({ tl, il: best.il, score: best.score, breakdown: best });
      takenInvIds.add(best.il.id);
    } else if (best.score >= 40) {
      suggestedMatches.push({ tl, il: best.il, score: best.score, breakdown: best });
      // don't reserve inv line for suggestions; still allow auto-match for others
    }
  }

  console.log(`\nCandidates: AUTO >=60: ${autoMatches.length}  SUGGESTED 40-59: ${suggestedMatches.length}`);

  // Show auto-matches
  autoMatches.sort((a, b) => b.score - a.score);
  const SHOW_ALL = process.argv.includes("--verbose");
  const autoSlice = SHOW_ALL ? autoMatches : autoMatches.slice(0, 10);
  console.log(`\n${SHOW_ALL ? "All" : "Top 10"} auto matches:`);
  for (const m of autoSlice) {
    const orderD = tokens(m.tl.normalizedProduct).slice(0, 6).join(" ");
    const invD = tokens(m.il.productDescription || m.il.normalizedProduct).slice(0, 8).join(" ");
    console.log(`  [${m.score.toFixed(0)}] ${m.tl.date.toISOString().slice(0,10)} qty ${m.tl.requestedQty} "${orderD}" -> ${m.il.invoiceNumber} ${m.il.invoiceDate.toISOString().slice(0,10)} qty ${m.il.qty} "${invD}" (t=${m.breakdown.ts.toFixed(0)} q=${m.breakdown.qs} d=${m.breakdown.ds})`);
  }

  // Show top 10 suggested
  suggestedMatches.sort((a, b) => b.score - a.score);
  console.log("\nTop 10 suggested matches:");
  for (const m of suggestedMatches.slice(0, 10)) {
    const orderD = tokens(m.tl.normalizedProduct).slice(0, 6).join(" ");
    const invD = tokens(m.il.productDescription || m.il.normalizedProduct).slice(0, 8).join(" ");
    console.log(`  [${m.score.toFixed(0)}] ${m.tl.date.toISOString().slice(0,10)} qty ${m.tl.requestedQty} "${orderD}" -> ${m.il.invoiceNumber} ${m.il.invoiceDate.toISOString().slice(0,10)} qty ${m.il.qty} "${invD}" (t=${m.breakdown.ts.toFixed(0)} q=${m.breakdown.qs} d=${m.breakdown.ds})`);
  }

  if (DRY_RUN) {
    console.log("\nDRY RUN — no writes.");
    return;
  }

  // --- Write auto matches
  let written = 0;
  for (const m of autoMatches) {
    await client.query(
      `INSERT INTO "BacklogInvoiceMatch" (id, "ticketLineId", "invoiceLineId", "matchConfidence", "matchMethod")
       VALUES (gen_random_uuid(), $1, $2, $3, $4)`,
      [m.tl.id, m.il.id, m.score.toFixed(2), "BACKLOG_AUTO"]
    );
    await client.query(
      `UPDATE "BacklogTicketLine" SET status='INVOICED' WHERE id=$1`,
      [m.tl.id]
    );
    written++;
  }
  console.log(`\nWrote ${written} auto-match rows and set ticket lines to INVOICED.`);

  // --- Write suggestions as notes (no match row, no status change) — we only
  //     store them as notes on the ticket line so the user can review.
  let noted = 0;
  for (const m of suggestedMatches) {
    const note = `Possible match: ${m.il.invoiceNumber} (${m.il.invoiceDate.toISOString().slice(0,10)}) qty ${m.il.qty} score ${m.score.toFixed(0)}`;
    await client.query(
      `UPDATE "BacklogTicketLine"
       SET notes = COALESCE(notes || E'\n', '') || $2
       WHERE id=$1 AND (notes IS NULL OR notes NOT LIKE $3)`,
      [m.tl.id, note, `%${m.il.invoiceNumber}%`]
    );
    noted++;
  }
  console.log(`Annotated ${noted} ticket lines with SUGGESTED notes.`);

  // Final stats
  const finalStats = await client.query(`
    SELECT
      (SELECT COUNT(*) FROM "BacklogTicketLine" WHERE "caseId"=$1 AND status='INVOICED') AS invoiced,
      (SELECT COUNT(*) FROM "BacklogTicketLine" WHERE "caseId"=$1 AND status='UNMATCHED') AS unmatched,
      (SELECT COUNT(*) FROM "BacklogInvoiceMatch" bim JOIN "BacklogInvoiceLine" il ON bim."invoiceLineId"=il.id WHERE il."caseId"=$1) AS matches
  `, [CASE_ID]);
  console.log("\nFinal stats:", finalStats.rows[0]);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
