// Task 5 — Match unmatched invoice lines to MESSAGE_LINKED ticket lines
// created by the recovery pass (or earlier passes). When strong match found:
//   - elevate ticket line status -> INVOICED
//   - insert BacklogInvoiceMatch row
//
// Uses the same scoring logic as pass3-reorder (token Jaccard on high-signal
// tokens + class compatibility + size gate + qty closeness).
//
// Usage:
//   node scripts/recovery-pass-match.js --dry-run
//   node scripts/recovery-pass-match.js

const { Client } = require("pg");

const CASE_ID = "58ebd22e-1101-4d56-a672-7cf635be9339";
const CONN =
  "postgres://postgres:postgres@localhost:51214/cromwell_os?sslmode=disable";
const DRY_RUN = process.argv.includes("--dry-run");

// --- tokeniser + scoring (borrowed from pass2/pass3) ---
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
  "kindly","regards","morning","hello","hi","hey",
]);
function tokens(s) {
  return normalize(s).split(" ").filter((t) => t && !STOPWORDS.has(t) && t.length > 1);
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
  const o = extractSizes(a), i = extractSizes(b);
  if (o.sizes.size > 0 && i.sizes.size > 0) {
    let ok = 0;
    for (const s of o.sizes) if (i.sizes.has(s)) ok++;
    if (ok === 0) return 0;
  }
  if (o.dims.size > 0 && i.dims.size > 0) {
    let ok = 0;
    for (const d of o.dims) if (i.dims.has(d)) ok++;
    if (ok === 0) return 0;
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
  { name: "air_admittance_valve", rx: /\baav\b|\bair\s+admittance|admittance\s+valve/ },
  { name: "valve_generic", rx: /\bvalve(?:s)?\b/ },
  { name: "pipe", rx: /\bpipe\b/ },
  { name: "paint_white", rx: /\b(?:supermatt|brilliant\s+white|pbw|pure\s+brilliant)\b/ },
  { name: "paint_magnolia", rx: /\bmagnolia\b/ },
  { name: "screw", rx: /(?:^|[^a-z])(?:wood)?screw(?:s)?\b/ },
  { name: "nail", rx: /\bnail(?:s)?\b|\bbrad(?:s)?\b/ },
  { name: "anchor", rx: /\banchor(?:s)?\b/ },
  { name: "clip", rx: /\bclip(?:s)?\b/ },
  { name: "bracket", rx: /\bbracket(?:s)?\b/ },
  { name: "cistern", rx: /\bcistern\b/ },
  { name: "basin", rx: /\bbasin\b/ },
  { name: "toilet_pan", rx: /\b(?:toilet\s+pan|wc\s+pan|close\s*coupled\s+pan|btw\b|pan\b)/ },
  { name: "flush_plate", rx: /\b(?:flush\s+(?:plate|button|pipe)|toilet\s+flush\b|wall\s+flush)\b/ },
  { name: "mixer", rx: /\bmixer\b/ },
  { name: "tap", rx: /\btap\b/ },
  { name: "shower_tray", rx: /\b(?:shower\s+)?tray\b/ },
  { name: "shower", rx: /\bshower\b/ },
  { name: "cable", rx: /\bcable\b|lszh|6242y|6491x/ },
  { name: "conduit", rx: /\bconduit\b/ },
  { name: "mat_cast_iron", rx: /\bcast\s+iron\b/ },
  { name: "mat_copper", rx: /\bcopper\b|\bendfeed\b|\bend\s+feed\b|\bcompression\b/ },
  { name: "mat_plastic", rx: /\bupvc\b|\bpvc\b|\bpushfit\b|\bpush\s*fit\b|\baquaflow\b|\bhep2o\b|\btetraflow\b/ },
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
  const aSet = new Set(a), bSet = new Set(b);
  const ap = a.filter((c) => c.startsWith("paint_"));
  const bp = b.filter((c) => c.startsWith("paint_"));
  if (ap.length && bp.length && !ap.some((c) => bSet.has(c))) return false;
  const FITTING = new Set(["tee","elbow","coupler","bend","branch","reducer"]);
  const aF = a.filter((c) => FITTING.has(c));
  const bF = b.filter((c) => FITTING.has(c));
  if (aF.length && bF.length && !aF.some((c) => bSet.has(c))) return false;
  const VALVES = new Set(["check_valve","ball_valve","gate_valve","air_admittance_valve"]);
  const aV = a.filter((c) => VALVES.has(c));
  const bV = b.filter((c) => VALVES.has(c));
  if (aV.length && bV.length && !aV.some((c) => bSet.has(c))) return false;
  const SANI = new Set(["basin","toilet_pan","cistern","mixer","tap","flush_plate","shower_tray"]);
  const aS = a.filter((c) => SANI.has(c));
  const bS = b.filter((c) => SANI.has(c));
  if (aS.length && bS.length && !aS.some((c) => bSet.has(c))) return false;
  const MAT = ["mat_cast_iron","mat_copper","mat_plastic"];
  const aM = a.filter((c) => MAT.includes(c));
  const bM = b.filter((c) => MAT.includes(c));
  if (aM.length && bM.length && !aM.some((c) => bSet.has(c))) return false;
  return true;
}

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

function scoreTLvsInvoice(tl, il) {
  const tlText = (tl.normalizedProduct || "") + " " + (tl.rawText || "");
  const invDesc = il.productDescription || il.normalizedProduct || "";
  const tlHigh = new Set(highSignalTokens(tlText));
  const invHigh = new Set(highSignalTokens(invDesc));
  if (tlHigh.size === 0 || invHigh.size === 0)
    return { score: 0, reason: "no-high-signal" };
  let inter = 0;
  for (const t of invHigh) if (tlHigh.has(t)) inter++;
  const denom = Math.max(tlHigh.size, invHigh.size);
  const overlap = inter / denom;
  if (overlap < 0.30) return { score: 0, reason: "low-overlap", overlap };

  const tc = detectClasses(tlText);
  const ic = detectClasses(invDesc);
  if (!classesCompatible(tc, ic)) return { score: 0, reason: "class-incompat", overlap };
  if (tc.length && ic.length) {
    if (!tc.some((c) => ic.includes(c))) return { score: 0, reason: "no-shared-class", overlap };
  }
  if (sizeCompatibility(tlText, invDesc) === 0)
    return { score: 0, reason: "size-mismatch", overlap };

  const qc = qtyCloseness(tl.requestedQty, il.qty);
  // Require qty closeness >= 0.55 (within 25%) OR overlap >= 0.6 — else reject
  if (qc < 0.55 && overlap < 0.6) return { score: 0, reason: "qty+overlap-both-weak", overlap, qc };

  const score = 30 + overlap * 45 + inter * 3 + qc * 25;
  return { score, reason: "ok", overlap, inter, qtyCloseness: qc };
}

function isNonProductLine(desc) {
  if (!desc) return true;
  const d = normalize(desc);
  if (!d || d.length < 4) return true;
  if (/^(delivery|carriage|site delivery|lwb|service charge|shipping)\b/i.test(desc)) return true;
  if (/^(dellow centre|e1 7sa|site)\b/i.test(desc)) return true;
  return false;
}

async function main() {
  const client = new Client({ connectionString: CONN });
  await client.connect();
  console.log(`Connected. DRY_RUN=${DRY_RUN}`);

  const invLines = (await client.query(
    `SELECT il.id, il."invoiceNumber", il."invoiceDate", il."productDescription",
            il."normalizedProduct", il.qty, il.rate, il.amount, il.unit
     FROM "BacklogInvoiceLine" il
     LEFT JOIN "BacklogInvoiceMatch" bim ON bim."invoiceLineId"=il.id
     WHERE il."caseId"=$1 AND bim.id IS NULL
     ORDER BY il."invoiceDate", il.id`,
    [CASE_ID],
  )).rows;
  console.log("Unmatched invoice lines:", invLines.length);

  const tls = (await client.query(
    `SELECT tl.id, tl.date, tl."orderThreadId", tl.sender,
            tl."normalizedProduct", tl."rawText", tl."requestedQty", tl."requestedUnit"
     FROM "BacklogTicketLine" tl
     WHERE tl."caseId"=$1 AND tl.status='MESSAGE_LINKED'
       AND tl."orderThreadId" IS NOT NULL
     ORDER BY tl.date`,
    [CASE_ID],
  )).rows;
  console.log("MESSAGE_LINKED TLs (candidates):", tls.length);

  const STRONG = 60;
  const WEAK = 45;

  // For each invoice line, find best MESSAGE_LINKED TL within date window.
  // Restrict window: TL.date <= invoice.invoiceDate + 3d and >= invoice.invoiceDate - 60d
  // (orders placed up to 60 days before invoice).
  const decisions = [];
  const usedTlIds = new Set(); // one TL can only match one invoice line
  let processed = 0, nonProd = 0;

  for (const il of invLines) {
    processed++;
    if (isNonProductLine(il.productDescription)) { nonProd++; continue; }
    const invT = new Date(il.invoiceDate).getTime();
    const from = invT - 60 * 24 * 3600 * 1000;
    const to   = invT + 3 * 24 * 3600 * 1000;

    let best = null;
    for (const tl of tls) {
      if (usedTlIds.has(tl.id)) continue;
      if (tl.date) {
        const tlT = new Date(tl.date).getTime();
        if (tlT < from || tlT > to) continue;
      }
      const s = scoreTLvsInvoice(tl, il);
      if (s.score < WEAK) continue;
      if (!best || s.score > best.score) best = { ...s, tl };
    }
    if (best) {
      decisions.push({ il, tl: best.tl, score: best.score, overlap: best.overlap, qtyCloseness: best.qtyCloseness, strong: best.score >= STRONG });
      usedTlIds.add(best.tl.id);
    }
  }

  decisions.sort((a, b) => b.score - a.score);
  const strong = decisions.filter((d) => d.strong);
  const weak = decisions.filter((d) => !d.strong);
  console.log(`Candidates: ${decisions.length} total (${strong.length} strong >=${STRONG}, ${weak.length} weak ${WEAK}-${STRONG-1})`);

  console.log("\nTop 30 strong matches:");
  for (const d of strong.slice(0, 30)) {
    const invD = (d.il.productDescription || "").slice(0, 55);
    const tlD  = (d.tl.normalizedProduct || "").slice(0, 55);
    console.log(`  [${d.score.toFixed(0)} ov=${(d.overlap*100).toFixed(0)}% qc=${(d.qtyCloseness*100).toFixed(0)}%] ` +
      `inv ${new Date(d.il.invoiceDate).toISOString().slice(0,10)} ${d.il.invoiceNumber} qty=${d.il.qty} "${invD}" <- ` +
      `tl ${d.tl.id.slice(0,8)} qty=${d.tl.requestedQty} "${tlD}"`);
  }

  // Write phase — only strong matches become INVOICED
  let elevated = 0, errors = 0;
  for (const d of strong) {
    if (DRY_RUN) { elevated++; continue; }
    try {
      await client.query(`UPDATE "BacklogTicketLine" SET status='INVOICED' WHERE id=$1`, [d.tl.id]);
      await client.query(
        `INSERT INTO "BacklogInvoiceMatch" (id, "ticketLineId", "invoiceLineId", "matchConfidence", "matchMethod")
         VALUES (gen_random_uuid(), $1, $2, $3, 'RECOVERY_TL_MATCH')`,
        [d.tl.id, d.il.id, Math.min(99, Math.max(0, d.score)).toFixed(2)],
      );
      elevated++;
    } catch (e) {
      errors++;
      console.error(`  ERR tl=${d.tl.id.slice(0,8)} il=${d.il.id.slice(0,8)} :: ${e.message}`);
    }
  }
  console.log(`\nElevated ${elevated} TLs to INVOICED${DRY_RUN ? " (DRY RUN)" : ""}${errors ? `, ${errors} errors` : ""}`);

  // Final state
  const stats = (await client.query(
    `SELECT
       (SELECT COUNT(*) FROM "BacklogTicketLine" WHERE "caseId"=$1) AS tl_total,
       (SELECT COUNT(*) FROM "BacklogTicketLine" WHERE "caseId"=$1 AND status='INVOICED') AS tl_invoiced,
       (SELECT COUNT(*) FROM "BacklogTicketLine" WHERE "caseId"=$1 AND status='UNMATCHED') AS tl_unmatched,
       (SELECT COUNT(*) FROM "BacklogTicketLine" WHERE "caseId"=$1 AND status='MESSAGE_LINKED') AS tl_msg_linked,
       (SELECT COUNT(*) FROM "BacklogInvoiceLine" il LEFT JOIN "BacklogInvoiceMatch" bim ON bim."invoiceLineId"=il.id
         WHERE il."caseId"=$1 AND bim.id IS NULL) AS inv_unmatched,
       (SELECT COALESCE(SUM(amount),0) FROM "BacklogInvoiceLine" il LEFT JOIN "BacklogInvoiceMatch" bim ON bim."invoiceLineId"=il.id
         WHERE il."caseId"=$1 AND bim.id IS NULL) AS unmatched_value,
       (SELECT COUNT(*) FROM "BacklogOrderThread" WHERE "caseId"=$1) AS threads`,
    [CASE_ID],
  )).rows[0];
  console.log("\n=== FINAL STATE ===");
  console.log(stats);

  await client.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
