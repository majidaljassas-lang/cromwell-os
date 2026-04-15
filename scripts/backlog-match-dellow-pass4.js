// Dellow Centre backlog — PASS 4: PRODUCT NORMALISATION matching
//
// Closes the chat-shorthand ↔ supplier-SKU gap:
//
//   chat        : "Pipe Clip 15mm"
//   invoice SKU : "TALON ROUND PIPE CLIP 15MM WHITE"
//
// Approach:
//   1. Tokenise both sides, strip supplier BRAND prefixes, strip generic
//      SKU / chat noise words.
//   2. Require product TYPE class overlap (pipe, tee, elbow, clip, paint…).
//   3. Require SIZE exact match when both sides carry a size.
//   4. Require COLOUR / MATERIAL compatibility (no black↔white, copper↔plastic).
//   5. Score:
//        + 30 product type match
//        + 30 size match (exact)
//        + 15 colour / finish overlap (or neutral)
//        + 25 qty exact         (12 for ±10%)
//        +  0-20 date proximity (0..60 days from order → invoice)
//   6. Auto-match when score ≥ 70, suggest 50-69, leave <50 untouched.
//   7. One invoice line can only match one ticket line.
//
// Candidate pool: MESSAGE_LINKED and UNMATCHED ticket lines (both represent
// order intent that hasn't been wired to an invoice).
//
// Writes:
//   - BacklogInvoiceMatch (method "PRODUCT_NORMALIZATION") for each strong match
//   - Updates BacklogTicketLine.status: MESSAGE_LINKED / UNMATCHED → INVOICED
//   - Appends a note: "Matched via product normalisation: [chat] ↔ [SKU]"
//   - For 50-69 suggestions: appends note on ticket line only, no match row.
//
// Usage:
//   node scripts/backlog-match-dellow-pass4.js report
//   node scripts/backlog-match-dellow-pass4.js run --dry-run
//   node scripts/backlog-match-dellow-pass4.js run

const { Client } = require("pg");

const CASE_ID = "58ebd22e-1101-4d56-a672-7cf635be9339";
const CONN =
  "postgres://postgres:postgres@localhost:51214/cromwell_os?sslmode=disable";
const DRY_RUN = process.argv.includes("--dry-run");
const VERBOSE = process.argv.includes("--verbose");
const MODE = (process.argv[2] || "report").toLowerCase();

const STRONG_THRESHOLD = 70;
const SUGGEST_THRESHOLD = 50;

// ---------- supplier brand prefixes (strip from both sides) ----------
// These words are descriptive prefixes on supplier SKUs and should not
// count as evidence FOR or AGAINST a match.
const SUPPLIER_BRANDS = new Set([
  // Plumbing
  "aquaflow", "hep2o", "hep20", "endfeed", "end-feed", "keyplumb", "kp",
  "talon", "mcalpine", "reginox", "apollo", "macdee", "mapesil", "mapei",
  "loctite", "fernox", "inta", "salamander", "tetraflow", "genbra",
  "ensign", "agilium",
  // Drylining
  "siniat", "gyproc", "gypframe", "gypsum", "knauf", "british",
  "touprent", "toupret", "larsen", "bondit", "bond-it", "evo-stik",
  "evostik", "dow",
  // Paint
  "dulux", "leyland", "crown", "johnstones", "johnstone", "zinsser",
  "jotun", "armstead",
  // Electrical
  "thrion", "hager", "nexus",
  // Timber
  "sawn", "easi", "easiedge", "easi-edge",
  // Tool/fasteners
  "dewalt", "bosch", "pulsa", "oakey", "monument", "salvus", "krobahn",
  "kb", "werner", "fluid", "scan", "draw", "astro",
  // Catalogue prefixes / codes
  "made4trade", "mstr22", "misdm10", "asa10v", "aqs111",
]);

// Generic SKU / chat-line noise to strip after brand removal.
const SKU_NOISE = new Set([
  "materials", "material", "item", "line", "no", "each", "ea", "pk", "pack",
  "box", "boxes", "tub", "roll", "rolls", "pc", "pcs", "piece", "pieces",
  "new", "old", "standard", "std", "grade", "heavy", "light", "duty",
  "trade", "pro", "professional", "please", "pls", "thanks", "thank",
  "regards", "order", "deliver", "delivery", "carriage",
  "mm", "m", "mtr", "metre", "mtrs", "metres", "cm", "ft", "in",
  "kg", "g", "ml", "l", "ltr", "litre", "litres",
  "x", "inc", "incl", "excl", "vat",
]);

// ---------- utils ----------
function normalize(s) {
  if (!s) return "";
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripBrandsAndNoise(s) {
  return normalize(s)
    .split(" ")
    .filter(
      (t) =>
        t &&
        t.length > 1 &&
        !SUPPLIER_BRANDS.has(t) &&
        !SKU_NOISE.has(t) &&
        !/^\d+$/.test(t), // pure numbers handled by size extractor
    );
}

function sizesInText(text) {
  if (!text) return { mm: new Set(), m: new Set(), dim: new Set() };
  const lower = String(text).toLowerCase();
  const mm = new Set();
  const m = new Set();
  const dim = new Set();
  // NNNmm
  for (const mt of lower.matchAll(/(\d+(?:\.\d+)?)\s*mm\b/g)) mm.add(mt[1]);
  // N.Nm / Nm length (but only when not part of another number)
  for (const mt of lower.matchAll(/(\d+(?:\.\d+)?)\s*m(?![a-z0-9])/g)) {
    const val = parseFloat(mt[1]);
    if (val > 0 && val <= 12) m.add(mt[1]);
  }
  // WxH or WxHxD dims
  for (const mt of lower.matchAll(/(\d{2,5})\s*x\s*(\d{2,5})(?:\s*x\s*(\d{1,5}(?:\.\d+)?))?/g)) {
    const key = mt[3] ? `${mt[1]}x${mt[2]}x${mt[3]}` : `${mt[1]}x${mt[2]}`;
    dim.add(key);
  }
  return { mm, m, dim };
}

function sizeScore(a, b) {
  // +30 if any concrete size overlaps on either axis
  // 0 if both have sizes and none overlap
  // +5 if only one side has sizes (neutral)
  const A = sizesInText(a);
  const B = sizesInText(b);
  const aHas = A.mm.size + A.m.size + A.dim.size;
  const bHas = B.mm.size + B.m.size + B.dim.size;
  if (aHas === 0 && bHas === 0) return { score: 5, status: "no-size" };
  if (aHas === 0 || bHas === 0) return { score: 5, status: "single-size" };

  let overlap = 0;
  for (const s of A.mm) if (B.mm.has(s)) overlap++;
  for (const s of A.m) if (B.m.has(s)) overlap++;
  for (const s of A.dim) if (B.dim.has(s)) overlap++;
  if (overlap > 0) return { score: 30, status: "ok" };
  // Incompatible sizes — hard block (we return negative so caller can bail).
  return { score: -999, status: "size-mismatch" };
}

// ---------- product type classes (stronger than pass 2/3) ----------
// Order matters: first match wins when building "primary" type.
const TYPE_CLASSES = [
  { name: "reducer",           rx: /\breduc(?:er|ing|ed)\b/ },
  { name: "tee",               rx: /\b(?:t[\-\s]?connector|tee)s?\b/ },
  { name: "elbow",             rx: /\belbow(?:s)?\b/ },
  { name: "bend",              rx: /\bbend(?:s)?\b/ },
  { name: "coupler",           rx: /\b(?:straight\s+)?(?:coupling|coupler|connector)s?\b/ },
  { name: "branch",            rx: /\bbranch(?:es)?\b/ },
  { name: "check_valve",       rx: /\b(?:double\s+)?check\s+valve\b/ },
  { name: "ball_valve",        rx: /\b(?:lever\s+)?ball\s+valve\b/ },
  { name: "gate_valve",        rx: /\bgate\s+valve\b/ },
  { name: "radiator_valve",    rx: /\bradiator\s+valve\b|\brad\s+valve\b|\bthermostatic\b|\blockshield\b/ },
  { name: "service_valve",     rx: /\bservice\s+valve\b/ },
  { name: "aav",               rx: /\baav\b|\bair\s+admittance\b/ },
  { name: "valve",             rx: /\bvalve(?:s)?\b/ },
  { name: "clip",              rx: /\b(?:pipe\s+)?clip(?:s)?\b/ },
  { name: "bracket",           rx: /\bbracket(?:s)?\b/ },
  { name: "saddle",            rx: /\bsaddle(?:s)?\b/ },
  { name: "insert",            rx: /\binsert(?:s)?\b|\bsmart\s*sleeve\b|\bsleeve(?:s)?\b/ },
  { name: "stop_end",          rx: /\bstop\s+end\b|\bblank\s+nut\b|\bblanking\b/ },
  { name: "trap",              rx: /\btrap\b/ },
  { name: "waste",             rx: /\bwaste\b(?!\s+pipe)/ },
  { name: "pipe",              rx: /\b(?:pipe|tube)\b/ },
  { name: "plasterboard",      rx: /\bplasterboard\b|\bwallboard\b|\bfireline\b|\bsoundboard\b/ },
  { name: "cement_board",      rx: /\bcement\s+board\b/ },
  { name: "u_track",           rx: /\bu\s*track\b|\bu\-track\b/ },
  { name: "track",             rx: /\btrack\b|\bchannel\b/ },
  { name: "stud",              rx: /\bstud(?:s)?\b/ },
  { name: "screw",             rx: /\bscrew(?:s)?\b|\bwoodscrew(?:s)?\b/ },
  { name: "nail",              rx: /\bnail(?:s)?\b|\bbrad(?:s)?\b|\bpin(?:s)?\b/ },
  { name: "anchor",            rx: /\banchor(?:s)?\b/ },
  { name: "bolt",              rx: /\bbolt(?:s)?\b/ },
  { name: "paint",             rx: /\bpaint\b|\bemulsion\b|\bmatt\b|\bsatinwood\b|\bundercoat\b|\bgloss\b|\bvinyl\b/ },
  { name: "filler",            rx: /\bfiller\b|\beasi\s*fill\b|\beasifill\b|\bcaulk\b/ },
  { name: "sealant",           rx: /\bsealant\b|\bsilicone\b|\bptfe\b/ },
  { name: "adhesive",          rx: /\badhesive\b|\bglue\b|\binsta\s*stik\b|\binstastik\b|\bsticks\s+like\b/ },
  { name: "cistern",           rx: /\bcistern\b/ },
  { name: "basin",             rx: /\bbasin\b/ },
  { name: "toilet_pan",        rx: /\b(?:toilet\s+pan|wc\s+pan|close\s*coupled\s+pan|btw\b|pan\b)/ },
  { name: "flush_plate",       rx: /\bflush\s+(?:plate|button)\b|\bflushpipe\b/ },
  { name: "mixer",             rx: /\bmixer\b/ },
  { name: "tap",               rx: /\btap\b|\bdraw\s+off\s+cock\b/ },
  { name: "shower_tray",       rx: /\bshower\s+tray\b|\btray\b/ },
  { name: "shower",            rx: /\bshower\b/ },
  { name: "cable",             rx: /\bcable\b|6242y|6491x/ },
  { name: "conduit",           rx: /\bconduit\b/ },
  { name: "meter_electric",    rx: /\belectricity\s+meter\b|ob115/ },
  { name: "socket_elec",       rx: /\bsocket\b(?!.*basin)/ },
  { name: "panel_pvc",         rx: /\b(?:pvc\s+)?panel\b|\belite\s+shine\b|\belite\s+(?:avocado|ivory|stone|marble)\b/ },
  { name: "corner_pvc",        rx: /\b(?:inside|outside|internal|external)\s+corner\b|\bdivision\s+bar\b/ },
  { name: "disc",              rx: /\b(?:cutting|sanding)\s+discs?\b/ },
  { name: "mask",              rx: /\bmask\b|\bffp2\b|\bffp3\b/ },
  { name: "ladder",            rx: /\bladder\b|\bstepladder\b/ },
  { name: "timber",            rx: /\btimber\b|\bc16\b|\bc24\b|\bsawn\b/ },
  { name: "tape",              rx: /\btape\b/ },
  { name: "wire_wool",         rx: /\bwire\s+wool\b|\bsteel\s+wool\b/ },
];

// Material classes — conflict => no match
const MATERIAL_CLASSES = [
  { name: "mat_copper",    rx: /\bcopper\b|\bendfeed\b|\bend\s*feed\b|\bcompression\b/ },
  { name: "mat_plastic",   rx: /\bupvc\b|\bpvc\b|\bpushfit\b|\bpush\s*fit\b|\baquaflow\b|\bhep2o\b|\btetraflow\b|\bplastic\b|\bpoly\b/ },
  { name: "mat_cast_iron", rx: /\bcast\s+iron\b|\bensign\s+agilium\b|\bci\b/ },
  { name: "mat_brass",     rx: /\bbrass\b/ },
  { name: "mat_chrome",    rx: /\bchrome\b|\bcp\b/ },
  { name: "mat_stainless", rx: /\bstainless\b/ },
  { name: "mat_galv",      rx: /\bgalv\b|\bgalvanised\b/ },
  { name: "mat_zinc",      rx: /\bzinc\b/ },
  { name: "mat_timber",    rx: /\btimber\b|\bwood\b|\bpine\b|\bmdf\b/ },
];

const COLOUR_CLASSES = [
  { name: "col_white",     rx: /\bwhite\b|\bpbw\b|\bbrilliant\s+white\b|\bivory\b/ },
  { name: "col_black",     rx: /\bblack\b/ },
  { name: "col_magnolia",  rx: /\bmagnolia\b/ },
  { name: "col_avocado",   rx: /\bavocado\b/ },
  { name: "col_grey",      rx: /\bgrey\b|\bgray\b/ },
  { name: "col_chrome",    rx: /\bchrome\b/ },
  { name: "col_green",     rx: /\bgreen\b/ },
];

function detectFromClasses(text, list) {
  if (!text) return [];
  const lower = String(text).toLowerCase();
  const found = [];
  for (const c of list) if (c.rx.test(lower)) found.push(c.name);
  return found;
}

const FITTING = new Set(["tee","elbow","bend","coupler","branch","reducer"]);
const VALVES  = new Set(["check_valve","ball_valve","gate_valve","radiator_valve","service_valve","aav","valve"]);
const SANI    = new Set(["basin","toilet_pan","cistern","mixer","tap","flush_plate","shower_tray","shower"]);
const FIX     = new Set(["screw","nail","anchor","bolt"]);
const BOARD   = new Set(["plasterboard","cement_board"]);

function typeCompatibility(aTypes, bTypes) {
  // Returns { score, shared, reason }
  if (!aTypes.length || !bTypes.length)
    return { score: 0, shared: [], reason: "no-type" };
  const bSet = new Set(bTypes);
  const shared = aTypes.filter((c) => bSet.has(c));
  if (shared.length > 0)
    return { score: 30, shared, reason: "shared-type" };

  // Hard block: both sides classified into types, zero overlap -> different
  // product class (clip vs branch, waste vs tray, reducer vs branch, etc.).
  return { score: -999, shared: [], reason: "type-mismatch" };
}

// Part-number suffix extractor: looks for grit codes (P60/P80/P120/P240),
// degree angles (45/88/92/135 deg or ') and numeric SKU trailing codes to
// catch "same family different part" false positives.
function partSignature(text) {
  if (!text) return {};
  const lower = String(text).toLowerCase();
  const sig = {};
  // Grit designation (sandpaper / abrasive). Only match in contexts that
  // actually look like a grit (roll/paper/sanding nearby or end-of-string).
  const grit = lower.match(/\bp(\d{2,4})\b/);
  if (grit && /(roll|paper|abrasive|disc|pad|sanding)/.test(lower)) sig.grit = grit[1];
  // Angle: "92'", "135'", "88deg", "45°", "45 deg". Ignore 8ft/8tread etc.
  const angle = lower.match(/\b(\d{2,3})\s*(?:'|deg\b|°)/);
  if (angle) sig.angle = angle[1];
  // SKU code families: 992001xx, 992003xx, 410000xx
  const sku = lower.match(/\b(9920\d{4}|4100\d{4})\b/);
  if (sku) sig.sku = sku[1];
  // "Art 1551" / "Art 1560" — fitting reference numbers
  const art = lower.match(/\bart\s*(\d{3,5})\b/);
  if (art) sig.art = art[1];
  // Valve family discriminators: lockshield vs w/h / thermo
  if (/\block\s*shield\b/.test(lower)) sig.valveFam = "lockshield";
  else if (/\bw\s*\/\s*h\b|\bthermo\b|\bwheel\s*head\b/.test(lower)) sig.valveFam = "wh";
  // Thread/size ratio e.g. 22x15 — capture ALL ratios as a set so
  // "22x22x15" and "22x15" differ only if disjoint.
  const ratios = new Set();
  for (const m of lower.matchAll(/\b(\d{1,3})\s*x\s*(\d{1,3})\b/g)) {
    ratios.add(`${m[1]}x${m[2]}`);
  }
  if (ratios.size) sig.ratios = ratios;
  return sig;
}

function partCompatible(aSig, bSig) {
  // Scalar discriminators: same kind both sides => must agree.
  for (const k of ["grit", "angle", "sku", "art", "valveFam"]) {
    if (aSig[k] && bSig[k] && aSig[k] !== bSig[k]) return { ok: false, field: k };
  }
  // Ratios: if both carry ratios, require at least one shared.
  if (aSig.ratios && bSig.ratios) {
    let shared = false;
    for (const r of aSig.ratios) if (bSig.ratios.has(r)) { shared = true; break; }
    if (!shared) return { ok: false, field: "ratios" };
  }
  return { ok: true };
}

function materialCompatibility(aMats, bMats) {
  if (!aMats.length || !bMats.length) return { score: 0, ok: true };
  const aSet = new Set(aMats), bSet = new Set(bMats);
  const shared = aMats.filter((m) => bSet.has(m));
  if (shared.length > 0) return { score: 5, ok: true, shared };
  return { score: -999, ok: false, shared: [] };
}

function colourCompatibility(aCols, bCols) {
  if (!aCols.length || !bCols.length) return { score: 0, ok: true };
  const bSet = new Set(bCols);
  const shared = aCols.filter((c) => bSet.has(c));
  if (shared.length > 0) return { score: 15, ok: true, shared };
  return { score: -999, ok: false, shared: [] };
}

function tokenOverlapScore(aText, bText) {
  // small secondary signal: stripped-brand token overlap, up to +15
  const A = stripBrandsAndNoise(aText);
  const B = new Set(stripBrandsAndNoise(bText));
  if (A.length === 0 || B.size === 0) return 0;
  let inter = 0;
  const aSet = new Set(A);
  for (const t of aSet) if (B.has(t)) inter++;
  const denom = Math.max(aSet.size, B.size);
  return Math.min(15, (inter / denom) * 25);
}

function qtyScore(a, b) {
  const qa = Number(a), qb = Number(b);
  if (!isFinite(qa) || !isFinite(qb) || qa <= 0 || qb <= 0) return 0;
  if (qa === qb) return 25;
  const diff = Math.abs(qa - qb) / Math.max(qa, qb);
  if (diff <= 0.1) return 12;
  return 0;
}

function dateProxScore(orderDate, invDate) {
  if (!orderDate || !invDate) return 0;
  const d1 = new Date(orderDate).getTime();
  const d2 = new Date(invDate).getTime();
  if (!isFinite(d1) || !isFinite(d2)) return 0;
  const daysAfter = (d2 - d1) / (1000 * 60 * 60 * 24);
  if (daysAfter < -3) return 0;                // invoice BEFORE order → skip
  if (daysAfter > 120) return 0;               // too far out
  if (daysAfter <= 14) return 20;
  if (daysAfter <= 30) return 15;
  if (daysAfter <= 60) return 10;
  if (daysAfter <= 90) return 5;
  return 0;
}

function isNonProductLine(desc) {
  if (!desc) return true;
  const d = normalize(desc);
  if (!d || d.length < 3) return true;
  if (/^(delivery|carriage|site delivery|lwb|service charge|shipping)\b/i.test(desc)) return true;
  if (/^(dellow centre|e1 7sa|site)\b/i.test(desc)) return true;
  return false;
}

// ---------- scoring ----------
function scorePair(tl, il) {
  const tlText = (tl.normalizedProduct || tl.rawText || "").toString();
  const ilText = (il.productDescription || il.normalizedProduct || "").toString();

  // date gate
  if (il.invoiceDate && tl.date) {
    const d1 = new Date(tl.date).getTime();
    const d2 = new Date(il.invoiceDate).getTime();
    if (d2 < d1 - 3 * 86400000) return { score: 0, reason: "invoice-before-order" };
    if (d2 - d1 > 120 * 86400000) return { score: 0, reason: "too-late" };
  }

  const tlTypes = detectFromClasses(tlText, TYPE_CLASSES);
  const ilTypes = detectFromClasses(ilText, TYPE_CLASSES);
  const typeR = typeCompatibility(tlTypes, ilTypes);
  if (typeR.score < 0) return { score: 0, reason: typeR.reason };

  const tlMat = detectFromClasses(tlText, MATERIAL_CLASSES);
  const ilMat = detectFromClasses(ilText, MATERIAL_CLASSES);
  const matR = materialCompatibility(tlMat, ilMat);
  if (!matR.ok) return { score: 0, reason: "material-conflict" };

  const tlCol = detectFromClasses(tlText, COLOUR_CLASSES);
  const ilCol = detectFromClasses(ilText, COLOUR_CLASSES);
  const colR = colourCompatibility(tlCol, ilCol);
  if (!colR.ok) return { score: 0, reason: "colour-conflict" };

  const sizeR = sizeScore(tlText, ilText);
  if (sizeR.score < 0) return { score: 0, reason: "size-mismatch" };

  // Discriminator check (grit, angle, SKU family, ratio)
  const partR = partCompatible(partSignature(tlText), partSignature(ilText));
  if (!partR.ok) return { score: 0, reason: `part-diff:${partR.field}` };

  const qtyR = qtyScore(tl.requestedQty, il.qty);
  const dateR = dateProxScore(tl.date, il.invoiceDate);
  const tokR = tokenOverlapScore(tlText, ilText);

  // Hard floor: must share a type OR have strong token overlap + size match.
  // Refuse matches where we have NO type anchor at all AND no size anchor
  // AND little token overlap.
  if (
    typeR.score === 0 &&
    sizeR.status !== "ok" &&
    tokR < 8
  ) {
    return { score: 0, reason: "too-weak" };
  }

  // Require some non-trivial lexical overlap before crediting a strong match.
  // Shared-type + identical qty + date can otherwise pull fly-bys to 70+
  // (e.g. "Pop Up Waste" ↔ "Rectangular Tray & Shower Waste") or into
  // "Reducing straight" ↔ "Branch Reduced Tee" with almost no textual
  // evidence beyond the shared class name. Demote to SUGGESTED when tokens
  // score is very low.
  const lowEvidence = tokR < 4;

  const score =
    typeR.score +
    sizeR.score +
    colR.score +
    matR.score +
    qtyR +
    dateR +
    tokR;

  return {
    score,
    reason: "ok",
    breakdown: {
      type: typeR.score, size: sizeR.score, colour: colR.score,
      material: matR.score, qty: qtyR, date: dateR, tokens: tokR,
    },
    sharedType: typeR.shared,
    sharedColour: colR.shared || [],
    sharedMaterial: matR.shared || [],
    sizeStatus: sizeR.status,
    lowEvidence,
  };
}

// ---------- main ----------
function log(...a) { console.log(...a); }

async function report(client) {
  const stats = await client.query(
    `SELECT
       (SELECT COUNT(*) FROM "BacklogTicketLine" WHERE "caseId"=$1) AS tl_total,
       (SELECT COUNT(*) FROM "BacklogTicketLine" WHERE "caseId"=$1 AND status='INVOICED') AS tl_invoiced,
       (SELECT COUNT(*) FROM "BacklogTicketLine" WHERE "caseId"=$1 AND status='UNMATCHED') AS tl_unmatched,
       (SELECT COUNT(*) FROM "BacklogTicketLine" WHERE "caseId"=$1 AND status='MESSAGE_LINKED') AS tl_msg_linked,
       (SELECT COUNT(*) FROM "BacklogTicketLine" WHERE "caseId"=$1 AND status='PARTIAL') AS tl_partial,
       (SELECT COUNT(*) FROM "BacklogInvoiceLine" WHERE "caseId"=$1) AS inv_total,
       (SELECT COUNT(*)
          FROM "BacklogInvoiceLine" il
          LEFT JOIN "BacklogInvoiceMatch" bim ON bim."invoiceLineId"=il.id
          WHERE il."caseId"=$1 AND bim.id IS NULL) AS inv_unmatched,
       (SELECT COALESCE(SUM(amount),0)
          FROM "BacklogInvoiceLine" il
          LEFT JOIN "BacklogInvoiceMatch" bim ON bim."invoiceLineId"=il.id
          WHERE il."caseId"=$1 AND bim.id IS NULL) AS unmatched_value,
       (SELECT COALESCE(SUM(amount),0) FROM "BacklogInvoiceLine" WHERE "caseId"=$1) AS total_value`,
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

async function fetchCandidateTicketLines(client) {
  // Chat/order-side lines that still need to be wired. Include MESSAGE_LINKED
  // (explicit target per spec) and UNMATCHED (unclosed chat orders).
  const r = await client.query(
    `SELECT id, date, "orderThreadId", sender,
            "normalizedProduct", "rawText",
            "requestedQty", "requestedUnit", status, notes
       FROM "BacklogTicketLine"
       WHERE "caseId"=$1 AND status IN ('MESSAGE_LINKED','UNMATCHED')`,
    [CASE_ID],
  );
  return r.rows;
}

async function run(client) {
  await report(client);
  log("\n=== PASS 4: product-normalisation matching ===");

  const invLines = await fetchUnmatchedInvoiceLines(client);
  log(`Unmatched invoice lines: ${invLines.length}`);

  const tlCands = await fetchCandidateTicketLines(client);
  log(`Candidate ticket lines (MESSAGE_LINKED+UNMATCHED): ${tlCands.length}`);

  // Build all candidate pairs above suggest threshold, sort by score desc,
  // then greedy-assign so each invoice line and each ticket line gets at
  // most one match.
  const pairs = [];
  let skippedNonProd = 0;
  for (const il of invLines) {
    if (isNonProductLine(il.productDescription)) { skippedNonProd++; continue; }
    for (const tl of tlCands) {
      const r = scorePair(tl, il);
      if (r.score >= SUGGEST_THRESHOLD) {
        pairs.push({ il, tl, ...r });
      }
    }
  }
  log(`Skipped non-product invoice lines: ${skippedNonProd}`);
  log(`Candidate pairs ≥${SUGGEST_THRESHOLD}: ${pairs.length}`);

  pairs.sort((a, b) => b.score - a.score);

  const usedTl = new Set();
  const usedIl = new Set();
  const strong = [];
  const suggest = [];
  for (const p of pairs) {
    if (usedTl.has(p.tl.id) || usedIl.has(p.il.id)) continue;
    if (p.score >= STRONG_THRESHOLD && !p.lowEvidence) {
      strong.push(p);
      usedTl.add(p.tl.id);
      usedIl.add(p.il.id);
    } else {
      // only suggest once per TL and once per IL (sorted desc — best first)
      suggest.push(p);
      usedTl.add(p.tl.id);
      usedIl.add(p.il.id);
    }
  }

  log(`\nStrong matches (score ≥ ${STRONG_THRESHOLD}): ${strong.length}`);
  log(`Suggested matches (${SUGGEST_THRESHOLD}-${STRONG_THRESHOLD - 1}): ${suggest.length}`);

  // ---- preview ----
  log("\nTop 30 strong matches preview:");
  for (const p of strong.slice(0, 30)) {
    const tl = (p.tl.normalizedProduct || p.tl.rawText || "").slice(0, 55);
    const il = (p.il.productDescription || "").slice(0, 60);
    log(
      `  [${p.score.toFixed(0)}] qty ${p.tl.requestedQty}→${p.il.qty}  ` +
      `"${tl}"  ↔  "${il}"  ` +
      `(${p.il.invoiceNumber} £${p.il.amount})`,
    );
  }

  // ---- write ----
  let wroteStrong = 0;
  let wroteSuggest = 0;
  const errors = [];

  for (const p of strong) {
    const tl = p.tl;
    const il = p.il;
    const chatTerm = (tl.normalizedProduct || tl.rawText || "").slice(0, 80);
    const skuTerm = (il.productDescription || "").slice(0, 80);
    const note =
      `Matched via product normalisation: "${chatTerm}" <-> "${skuTerm}" ` +
      `(score=${p.score.toFixed(0)}, inv=${il.invoiceNumber}, invLineId=${il.id})`;

    try {
      if (DRY_RUN) {
        wroteStrong++;
        continue;
      }
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO "BacklogInvoiceMatch"
           (id, "ticketLineId", "invoiceLineId", "matchConfidence", "matchMethod")
         VALUES (gen_random_uuid(), $1, $2, $3, 'PRODUCT_NORMALIZATION')`,
        [tl.id, il.id, Math.min(99, Math.max(0, p.score)).toFixed(2)],
      );
      await client.query(
        `UPDATE "BacklogTicketLine"
            SET status='INVOICED',
                notes = COALESCE(notes,'') ||
                        CASE WHEN COALESCE(notes,'')='' THEN '' ELSE E'\n' END ||
                        $2
          WHERE id=$1`,
        [tl.id, note],
      );
      await client.query("COMMIT");
      wroteStrong++;
    } catch (e) {
      try { await client.query("ROLLBACK"); } catch {}
      errors.push({ tlId: tl.id, ilId: il.id, err: e.message });
    }
  }

  for (const p of suggest) {
    const tl = p.tl;
    const il = p.il;
    const note =
      `Possible match (PRODUCT_NORMALIZATION): INV ${il.invoiceNumber} ` +
      `line ${il.id} qty=${il.qty} £${il.amount} ` +
      `"${(il.productDescription || "").slice(0, 80)}" (score=${p.score.toFixed(0)})`;
    try {
      if (DRY_RUN) { wroteSuggest++; continue; }
      await client.query(
        `UPDATE "BacklogTicketLine"
            SET notes = COALESCE(notes,'') ||
                        CASE WHEN COALESCE(notes,'')='' THEN '' ELSE E'\n' END ||
                        $2
          WHERE id=$1`,
        [tl.id, note],
      );
      wroteSuggest++;
    } catch (e) {
      errors.push({ tlId: tl.id, ilId: il.id, err: e.message });
    }
  }

  log(
    `\nWritten: ${wroteStrong} strong (INVOICED), ${wroteSuggest} suggest notes` +
    (DRY_RUN ? " (DRY RUN)" : ""),
  );
  if (errors.length) {
    log(`Errors: ${errors.length}`);
    for (const e of errors.slice(0, 10)) log("  ERR", e);
  }

  // ---- final summary ----
  const final = await client.query(
    `SELECT
       (SELECT COUNT(*) FROM "BacklogTicketLine" WHERE "caseId"=$1 AND status='INVOICED') AS tl_invoiced,
       (SELECT COUNT(*) FROM "BacklogTicketLine" WHERE "caseId"=$1 AND status='MESSAGE_LINKED') AS tl_msg_linked,
       (SELECT COUNT(*) FROM "BacklogTicketLine" WHERE "caseId"=$1 AND status='UNMATCHED') AS tl_unmatched,
       (SELECT COUNT(*)
          FROM "BacklogInvoiceLine" il
          LEFT JOIN "BacklogInvoiceMatch" bim ON bim."invoiceLineId"=il.id
          WHERE il."caseId"=$1 AND bim.id IS NULL) AS inv_unmatched_count,
       (SELECT COALESCE(SUM(il.amount),0)
          FROM "BacklogInvoiceLine" il
          LEFT JOIN "BacklogInvoiceMatch" bim ON bim."invoiceLineId"=il.id
          WHERE il."caseId"=$1 AND bim.id IS NULL) AS inv_unmatched_value,
       (SELECT COALESCE(SUM(il.amount),0)
          FROM "BacklogInvoiceLine" il
          JOIN "BacklogInvoiceMatch" bim ON bim."invoiceLineId"=il.id
          WHERE il."caseId"=$1) AS inv_matched_value,
       (SELECT COALESCE(SUM(amount),0) FROM "BacklogInvoiceLine" WHERE "caseId"=$1) AS inv_total_value`,
    [CASE_ID],
  );
  const f = final.rows[0];
  log("\n=== FINAL ===");
  log(`  Ticket lines INVOICED:       ${f.tl_invoiced}`);
  log(`  Ticket lines MESSAGE_LINKED: ${f.tl_msg_linked}`);
  log(`  Ticket lines UNMATCHED:      ${f.tl_unmatched}`);
  log(`  Invoice lines unmatched:     ${f.inv_unmatched_count} (£${Number(f.inv_unmatched_value).toFixed(2)})`);
  log(`  Invoice lines matched value: £${Number(f.inv_matched_value).toFixed(2)}`);
  log(`  Invoice total value:         £${Number(f.inv_total_value).toFixed(2)}`);

  // Product families with no matches
  log("\n=== Product types with NO new matches (of those that appeared in candidates) ===");
  const matchedTypes = new Set();
  for (const p of strong) for (const t of p.sharedType || []) matchedTypes.add(t);
  const allCandidateTypes = new Set();
  for (const tl of tlCands) {
    for (const t of detectFromClasses(tl.normalizedProduct || tl.rawText || "", TYPE_CLASSES))
      allCandidateTypes.add(t);
  }
  const untouched = [...allCandidateTypes].filter((t) => !matchedTypes.has(t));
  untouched.sort();
  log("  " + (untouched.join(", ") || "(none)"));

  // Top strong matches full listing
  log("\n=== Top 30 strong matches (full) ===");
  for (const p of strong.slice(0, 30)) {
    const tl = (p.tl.normalizedProduct || p.tl.rawText || "").slice(0, 70);
    const il = (p.il.productDescription || "").slice(0, 70);
    log(
      `  [${p.score.toFixed(0)}] ${p.il.invoiceNumber} ${new Date(p.il.invoiceDate).toISOString().slice(0,10)} ` +
      `qty ${p.tl.requestedQty}->${p.il.qty} £${p.il.amount}` +
      `\n      chat: "${tl}"` +
      `\n      sku : "${il}"` +
      `\n      type=${(p.sharedType||[]).join("/")||"-"} size=${p.sizeStatus} breakdown=${JSON.stringify(p.breakdown)}`,
    );
  }
}

async function main() {
  const client = new Client({ connectionString: CONN });
  await client.connect();
  log(`Connected. MODE=${MODE} DRY_RUN=${DRY_RUN}`);
  try {
    if (MODE === "report") return await report(client);
    if (MODE === "run") return await run(client);
    log("Unknown MODE. Use: report | run   [--dry-run]");
  } finally {
    await client.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
