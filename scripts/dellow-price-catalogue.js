// Dellow Centre backlog — PRICE CATALOGUE BUILDER + UNBILLED PRICER
//
// Steps:
// 1. Scan BacklogInvoiceLine for the Dellow case
// 2. Keep only lines from PAID invoices (Payment Made / Balance Due £0.00)
// 3. Build a normalised product key catalogue with per-key rate history
// 4. Walk every BacklogTicketLine (MESSAGE_LINKED, UNMATCHED) and price it
//    via exact / similar / partial / unknown matches
// 5. Write the catalogue and the draft-invoice grouping JSON files
// 6. Print a summary
//
// Usage:
//   node scripts/dellow-price-catalogue.js
//
// Inputs (none — all hard-coded for this case).
// Outputs:
//   /Users/majidaljassas/cromwell-os/scripts/dellow-price-catalogue.json
//   /Users/majidaljassas/cromwell-os/scripts/dellow-draft-invoice-groups.json
//   Writes estimatedRate / estimatedAmount / pricingSource / pricingConfidence
//   / pricingNotes on BacklogTicketLine rows.

const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const CASE_ID = "58ebd22e-1101-4d56-a672-7cf635be9339";
const CONN =
  "postgres://postgres:postgres@localhost:51214/cromwell_os?sslmode=disable";

const CATALOGUE_PATH = path.join(__dirname, "dellow-price-catalogue.json");
const GROUPS_PATH = path.join(__dirname, "dellow-draft-invoice-groups.json");

// ---------- brand / noise stripping ----------
const BRAND_PREFIXES = new Set([
  "dulux","aquaflow","hep2o","keyplumb","siniat","gyproc","british","gypsum",
  "gtec","genbra","mapei","mapesil","everbuild","dewalt","pulsa","nabic",
  "builder","depot","gt","hd","hd12","rve15c","mf5","mf6a","mf7","ct1",
  "knauf","polycell","trend","spit","hilti","rawlplug","fischer","makita",
  "stanley","bosch","triton","crown","johnstones","albion","leyland",
  "thompsons","ronseal","bal","weber","screwfix","toolstation",
  "plumbfit","plumbase","plumbstation","wolseley","jewson","travis",
  "perkins","sr","mega","flow","knuckle","gtec","geberit","marley","osma",
  "polypipe","grundfos","myson","stelrad","wavin","reliance","rwc",
]);

const NOISE_TOKENS = new Set([
  "the","a","an","and","or","of","for","with","to","per","each","pcs","pcs.",
  "pc","pack","packs","pk","pks","box","boxes","no","no.","nos","nr","ea",
  "any","colour","color","standard","std","mixed","each","new","old","extra",
  "additional","pack","packs","bag","bags","qty","amt","amount","rate","site",
  "delivery","charge","charges","cost","price","item","items","p","pp","ppl",
  "ppk","tube","tubes","bottle","bottles","roll","rolls","sheet","sheets",
  "length","lengths","tin","tins","drum","drums","coil","coils","x","xx",
  "each","pair","pairs","ltr","l","litre","litres","kg","g","mm","cm","m","mtr",
  "mt","m2","sqm","sq","lm",
]);

// keep mm/cm/m/kg inside size tokens; above list just drops them when standalone.

function sizeTokens(text) {
  // extract patterns like 15mm, 22mm, 3.6m, 1500x700x40, 310ml, 500ml, 750ml, 2.4m
  const tokens = [];
  const re =
    /\b(\d+(?:\.\d+)?(?:\s*x\s*\d+(?:\.\d+)?){0,3})\s*(mm|cm|m|ml|l|ltr|kg|g|in|inch|")\b/gi;
  let m;
  while ((m = re.exec(text))) {
    const size = m[1].replace(/\s*x\s*/gi, "x").replace(/\s+/g, "");
    const unit = m[2].toLowerCase();
    tokens.push(`${size}${unit}`);
  }
  return tokens;
}

function normaliseKey(raw) {
  if (!raw) return { full: "", core: "", type: "", sizes: [] };
  const text = String(raw).toLowerCase();

  const sizes = sizeTokens(text);

  // strip everything except letters/digits/space
  const stripped = text
    .replace(/\(.*?\)/g, " ") // drop parenthetical
    .replace(/\[.*?\]/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const rawTokens = stripped.split(" ").filter(Boolean);

  const meaningful = [];
  for (const tok of rawTokens) {
    if (!tok) continue;
    if (NOISE_TOKENS.has(tok)) continue;
    if (BRAND_PREFIXES.has(tok)) continue;
    if (/^\d+$/.test(tok) && tok.length <= 4) continue; // drop bare small ints
    meaningful.push(tok);
  }

  // dedupe + sort
  const tokens = Array.from(new Set(meaningful)).sort();
  const full = tokens.join(" ");
  const type = tokens.filter((t) => /^[a-z]+$/.test(t)).join(" ");
  return { full, core: full, type, sizes };
}

function tokenOverlap(aTokens, bTokens) {
  if (!aTokens.length || !bTokens.length) return 0;
  const A = new Set(aTokens);
  const B = new Set(bTokens);
  let hit = 0;
  for (const t of A) if (B.has(t)) hit++;
  return hit / Math.min(A.size, B.size);
}

function modeOf(nums) {
  const counts = new Map();
  for (const n of nums) {
    const k = Number(n).toFixed(4);
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  let best = null;
  let bestCount = -1;
  for (const [k, c] of counts) {
    if (c > bestCount) {
      best = k;
      bestCount = c;
    }
  }
  return best ? Number(best) : null;
}

function mean(nums) {
  if (!nums.length) return null;
  return nums.reduce((s, x) => s + Number(x), 0) / nums.length;
}

// ISO week: year-Www
function isoWeek(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

function fmtGBP(n) {
  if (n === null || n === undefined) return "—";
  return "£" + Number(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ---------- main ----------
(async () => {
  const client = new Client(CONN);
  await client.connect();

  // ---- 1. Detect PAID invoice documents from rawText ----
  const docs = await client.query(
    `
      SELECT id,
             "invoiceNumber",
             "invoiceDate",
             "totalAmount",
             "rawText"
      FROM "BacklogInvoiceDocument"
      WHERE "caseId" = $1
    `,
    [CASE_ID]
  );

  const paidInvoiceNumbers = new Set();
  const statusByInvoiceNumber = new Map();
  for (const d of docs.rows) {
    const rt = d.rawText || "";
    const isPaid =
      /payment\s+made/i.test(rt) ||
      /balance\s+due\s*£\s*0\.00/i.test(rt) ||
      /balance\s+due\s*gbp\s*0\.00/i.test(rt);
    const status = isPaid ? "PAID" : "DRAFT";
    if (d.invoiceNumber) {
      statusByInvoiceNumber.set(d.invoiceNumber, status);
      if (isPaid) paidInvoiceNumbers.add(d.invoiceNumber);
    }
  }
  console.log(
    `[1] Invoices: ${docs.rows.length} total, ${paidInvoiceNumbers.size} PAID, ${
      docs.rows.length - paidInvoiceNumbers.size
    } DRAFT`
  );

  // ---- 2. Pull invoice lines (PAID only) and build catalogue ----
  const linesRes = await client.query(
    `
      SELECT "id", "invoiceNumber", "invoiceDate", "productDescription",
             "normalizedProduct", qty, unit, rate, amount
      FROM "BacklogInvoiceLine"
      WHERE "caseId" = $1
        AND rate IS NOT NULL
        AND qty > 0
    `,
    [CASE_ID]
  );

  const paidLines = linesRes.rows.filter((l) => paidInvoiceNumbers.has(l.invoiceNumber));
  const droppedLines = linesRes.rows.length - paidLines.length;
  console.log(`[2] Invoice lines: ${linesRes.rows.length} total, ${paidLines.length} from PAID, ${droppedLines} dropped (draft)`);

  const catalogue = new Map(); // fullKey -> entry
  const typeSizeIndex = new Map(); // "type|sizes" -> [fullKey...]
  const typeIndex = new Map(); // type -> [fullKey...]

  for (const l of paidLines) {
    const { full, type, sizes } = normaliseKey(l.productDescription);
    if (!full) continue;
    if (!catalogue.has(full)) {
      catalogue.set(full, {
        key: full,
        type,
        sizes,
        descriptions: new Set(),
        rates: [], // {rate, qty, date, invoiceNumber, description}
      });
    }
    const entry = catalogue.get(full);
    entry.descriptions.add(l.productDescription);
    entry.rates.push({
      rate: Number(l.rate),
      qty: Number(l.qty),
      date: l.invoiceDate,
      invoiceNumber: l.invoiceNumber,
      description: l.productDescription,
    });

    const ts = `${type}|${sizes.slice().sort().join(",")}`;
    if (!typeSizeIndex.has(ts)) typeSizeIndex.set(ts, new Set());
    typeSizeIndex.get(ts).add(full);

    if (type) {
      if (!typeIndex.has(type)) typeIndex.set(type, new Set());
      typeIndex.get(type).add(full);
    }
  }

  // compute summary stats per entry
  const catalogueArr = [];
  for (const entry of catalogue.values()) {
    const rates = entry.rates.map((r) => r.rate).filter((x) => Number.isFinite(x));
    const totalQty = entry.rates.reduce((s, r) => s + r.qty, 0);
    const sortedByDate = entry.rates.slice().sort((a, b) => new Date(b.date) - new Date(a.date));
    const mostRecent = sortedByDate[0] || null;
    catalogueArr.push({
      key: entry.key,
      type: entry.type,
      sizes: entry.sizes,
      descriptions: Array.from(entry.descriptions),
      historyCount: entry.rates.length,
      totalQtyBilled: totalQty,
      mostRecentRate: mostRecent ? mostRecent.rate : null,
      mostRecentInvoice: mostRecent ? mostRecent.invoiceNumber : null,
      mostRecentDate: mostRecent ? mostRecent.date : null,
      modalRate: modeOf(rates),
      avgRate: mean(rates),
      minRate: rates.length ? Math.min(...rates) : null,
      maxRate: rates.length ? Math.max(...rates) : null,
      history: entry.rates
        .slice()
        .sort((a, b) => new Date(a.date) - new Date(b.date))
        .map((r) => ({
          date: r.date,
          invoiceNumber: r.invoiceNumber,
          qty: r.qty,
          rate: r.rate,
          description: r.description,
        })),
    });
  }

  // index for partial lookups
  const typeSizeIdx = {};
  for (const [k, v] of typeSizeIndex) typeSizeIdx[k] = Array.from(v);
  const typeIdx = {};
  for (const [k, v] of typeIndex) typeIdx[k] = Array.from(v);

  console.log(`[3] Catalogue built: ${catalogueArr.length} distinct keys`);

  // ---- 3. Save catalogue JSON ----
  fs.writeFileSync(
    CATALOGUE_PATH,
    JSON.stringify(
      {
        caseId: CASE_ID,
        generatedAt: new Date().toISOString(),
        totals: {
          invoicesAnalysed: paidInvoiceNumbers.size,
          linesAnalysed: paidLines.length,
          distinctKeys: catalogueArr.length,
        },
        catalogue: catalogueArr,
        typeSizeIndex: typeSizeIdx,
        typeIndex: typeIdx,
      },
      null,
      2
    )
  );
  console.log(`[4] Wrote catalogue → ${CATALOGUE_PATH}`);

  // ---- 4. Price unbilled ticket lines ----
  const ticketRes = await client.query(
    `
      SELECT tl.id,
             tl."caseId",
             tl."orderThreadId",
             tl."sourceMessageId",
             tl.date,
             tl.sender,
             tl."rawText",
             tl."normalizedProduct",
             tl."requestedQty",
             tl."requestedUnit",
             tl.status,
             tl."requestedQtyBase",
             tl."baseUnit",
             ot.label AS "threadKey"
      FROM "BacklogTicketLine" tl
      LEFT JOIN "BacklogOrderThread" ot ON ot.id = tl."orderThreadId"
      WHERE tl."caseId" = $1
        AND tl.status IN ('MESSAGE_LINKED','UNMATCHED')
    `,
    [CASE_ID]
  );
  console.log(`[5] Unbilled ticket lines to price: ${ticketRes.rows.length}`);

  // index by key
  const catByKey = new Map();
  for (const entry of catalogueArr) catByKey.set(entry.key, entry);

  // helper: tokens of a key
  function tokensOfKey(k) {
    return k ? k.split(" ").filter(Boolean) : [];
  }

  function findMatch(tl) {
    const combined = `${tl.normalizedProduct || ""} ${tl.rawText || ""}`;
    const { full, type, sizes } = normaliseKey(combined);
    if (!full) {
      return { source: "UNKNOWN", confidence: "LOW", rate: null, notes: "No tokens after normalisation" };
    }

    // EXACT
    if (catByKey.has(full)) {
      const e = catByKey.get(full);
      if (e.mostRecentRate !== null) {
        const d = e.mostRecentDate ? new Date(e.mostRecentDate).toISOString().slice(0, 10) : "—";
        return {
          source: "CATALOGUE_EXACT",
          confidence: "HIGH",
          rate: e.mostRecentRate,
          matchedKey: full,
          notes: `Matched to invoice ${e.mostRecentInvoice} (qty ${e.history[e.history.length - 1].qty} @ £${e.mostRecentRate.toFixed(2)}) on ${d}`,
        };
      }
    }

    // SIMILAR — token overlap scan across full catalogue.
    // Accept ≥70% overlap of ticket tokens (min-size denominator) AND at least
    // one meaningful content token matches AND (if ticket has sizes, sizes overlap).
    const tlTokens = tokensOfKey(full);
    const tlSizes = new Set(sizes);

    let bestSim = null;
    for (const cand of catalogueArr) {
      if (cand.key === full) continue;
      const cTokens = tokensOfKey(cand.key);
      const overlap = tokenOverlap(tlTokens, cTokens);
      if (overlap < 0.7) continue;

      // if ticket has explicit sizes, candidate must share at least one
      if (tlSizes.size > 0) {
        const cSizes = new Set(cand.sizes || []);
        let sizeHit = false;
        for (const s of tlSizes) if (cSizes.has(s)) { sizeHit = true; break; }
        if (!sizeHit) continue;
      }

      // must share at least one letters-only content token (not just sizes)
      let contentHit = false;
      const tSet = new Set(tlTokens.filter((t) => /^[a-z]+$/.test(t)));
      for (const ct of cTokens) if (/^[a-z]+$/.test(ct) && tSet.has(ct)) { contentHit = true; break; }
      if (!contentHit) continue;

      if (!bestSim || overlap > bestSim.overlap || (overlap === bestSim.overlap && cand.historyCount > bestSim.entry.historyCount)) {
        bestSim = { entry: cand, overlap };
      }
    }
    if (bestSim) {
      const e = bestSim.entry;
      const chosen = e.modalRate ?? e.mostRecentRate ?? e.avgRate;
      if (chosen !== null) {
        return {
          source: "CATALOGUE_SIMILAR",
          confidence: "MEDIUM",
          rate: chosen,
          matchedKey: e.key,
          notes: `Closest match: "${e.descriptions[0]}" @ £${chosen.toFixed(2)} based on ${e.historyCount} similar invoices (overlap ${(bestSim.overlap * 100).toFixed(0)}%)`,
        };
      }
    }

    // PARTIAL — share at least one content-word token AND (if ticket has size,
    // share a size). Use median of matches' most-recent rate.
    const contentTokens = tlTokens.filter((t) => /^[a-z]+$/.test(t) && t.length >= 4);
    if (contentTokens.length) {
      const candRates = [];
      const candCount = { n: 0, label: null };
      for (const cand of catalogueArr) {
        const cTokens = tokensOfKey(cand.key);
        let tokenHit = false;
        for (const t of contentTokens) if (cTokens.includes(t)) { tokenHit = true; break; }
        if (!tokenHit) continue;
        if (tlSizes.size > 0) {
          const cSizes = new Set(cand.sizes || []);
          let sizeHit = false;
          for (const s of tlSizes) if (cSizes.has(s)) { sizeHit = true; break; }
          if (!sizeHit) continue;
        }
        if (cand.mostRecentRate !== null) {
          candRates.push(cand.mostRecentRate);
          candCount.n++;
          if (!candCount.label) candCount.label = cand.type || contentTokens[0];
        }
      }
      if (candRates.length) {
        candRates.sort((a, b) => a - b);
        const median = candRates[Math.floor(candRates.length / 2)];
        return {
          source: "CATALOGUE_PARTIAL",
          confidence: "LOW",
          rate: Number(median.toFixed(4)),
          notes: `Estimated from ${candRates.length} catalogue items sharing "${contentTokens.slice(0, 2).join("/")}"${tlSizes.size ? ` + size ${Array.from(tlSizes).join(",")}` : ""} (median rate)`,
        };
      }
    }

    return { source: "UNKNOWN", confidence: "LOW", rate: null, notes: "No catalogue match — needs manual price" };
  }

  // ---- 5. Write back to DB ----
  const priced = [];
  const confCounts = { HIGH: 0, MEDIUM: 0, LOW: 0, UNKNOWN: 0 };
  const sourceCounts = { CATALOGUE_EXACT: 0, CATALOGUE_SIMILAR: 0, CATALOGUE_PARTIAL: 0, UNKNOWN: 0 };
  let totalEstimated = 0;
  const estByConf = { HIGH: 0, MEDIUM: 0, LOW: 0, UNKNOWN: 0 };

  await client.query("BEGIN");
  try {
    for (const tl of ticketRes.rows) {
      const m = findMatch(tl);
      const qty = Number(tl.requestedQty || 0);
      const rate = m.rate;
      const amount = rate !== null ? Number((qty * Number(rate)).toFixed(2)) : null;

      await client.query(
        `
          UPDATE "BacklogTicketLine"
          SET "estimatedRate" = $1,
              "estimatedAmount" = $2,
              "pricingSource" = $3,
              "pricingConfidence" = $4,
              "pricingNotes" = $5
          WHERE id = $6
        `,
        [rate, amount, m.source, m.confidence, m.notes, tl.id]
      );

      // count by confidence (UNKNOWN source gets its own bucket, not LOW)
      const confBucket = m.source === "UNKNOWN" ? "UNKNOWN" : m.confidence;
      confCounts[confBucket] = (confCounts[confBucket] || 0) + 1;
      sourceCounts[m.source] = (sourceCounts[m.source] || 0) + 1;
      if (amount !== null) {
        totalEstimated += amount;
        estByConf[confBucket] = (estByConf[confBucket] || 0) + amount;
      }

      priced.push({
        id: tl.id,
        date: tl.date,
        sender: tl.sender,
        threadKey: tl.threadKey,
        rawText: tl.rawText,
        normalizedProduct: tl.normalizedProduct,
        qty,
        unit: tl.requestedUnit,
        estimatedRate: rate,
        estimatedAmount: amount,
        pricingSource: m.source,
        pricingConfidence: confBucket,
        pricingNotes: m.notes,
        matchedKey: m.matchedKey || null,
      });
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  }
  console.log(`[6] Priced ${priced.length} ticket lines`);
  console.log(`    source: EXACT=${sourceCounts.CATALOGUE_EXACT}, SIMILAR=${sourceCounts.CATALOGUE_SIMILAR}, PARTIAL=${sourceCounts.CATALOGUE_PARTIAL}, UNKNOWN=${sourceCounts.UNKNOWN}`);
  console.log(`    confidence: HIGH=${confCounts.HIGH}, MEDIUM=${confCounts.MEDIUM}, LOW=${confCounts.LOW}, UNKNOWN=${confCounts.UNKNOWN}`);

  // ---- 6. Group into draft invoice candidates ----
  const groups = new Map();
  for (const p of priced) {
    const week = isoWeek(new Date(p.date));
    const threadKey = p.threadKey || "(no-thread)";
    const sender = p.sender || "(no-sender)";
    const gKey = `${week}|${threadKey}|${sender}`;
    if (!groups.has(gKey)) {
      groups.set(gKey, {
        groupKey: gKey,
        week,
        threadKey,
        sender,
        dateFrom: p.date,
        dateTo: p.date,
        lines: [],
      });
    }
    const g = groups.get(gKey);
    g.lines.push(p);
    if (new Date(p.date) < new Date(g.dateFrom)) g.dateFrom = p.date;
    if (new Date(p.date) > new Date(g.dateTo)) g.dateTo = p.date;
  }

  const groupsArr = [];
  for (const g of groups.values()) {
    let net = 0;
    const confBreak = { HIGH: 0, MEDIUM: 0, LOW: 0, UNKNOWN: 0 };
    let pricedCount = 0;
    for (const l of g.lines) {
      confBreak[l.pricingConfidence] = (confBreak[l.pricingConfidence] || 0) + 1;
      if (l.estimatedAmount !== null) {
        net += Number(l.estimatedAmount);
        pricedCount++;
      }
    }
    const vat = Number((net * 0.2).toFixed(2));
    const incVat = Number((net + vat).toFixed(2));
    const total = g.lines.length;
    groupsArr.push({
      ...g,
      lineCount: total,
      pricedLineCount: pricedCount,
      netEstimate: Number(net.toFixed(2)),
      vatEstimate: vat,
      totalIncVat: incVat,
      confidencePct: {
        HIGH: total ? Math.round((confBreak.HIGH / total) * 100) : 0,
        MEDIUM: total ? Math.round((confBreak.MEDIUM / total) * 100) : 0,
        LOW: total ? Math.round((confBreak.LOW / total) * 100) : 0,
        UNKNOWN: total ? Math.round((confBreak.UNKNOWN / total) * 100) : 0,
      },
    });
  }
  groupsArr.sort((a, b) => b.netEstimate - a.netEstimate);

  fs.writeFileSync(
    GROUPS_PATH,
    JSON.stringify(
      {
        caseId: CASE_ID,
        generatedAt: new Date().toISOString(),
        totals: {
          groups: groupsArr.length,
          linesPriced: priced.length,
          totalNet: Number(totalEstimated.toFixed(2)),
          highConf: Number(estByConf.HIGH.toFixed(2)),
          mediumConf: Number(estByConf.MEDIUM.toFixed(2)),
          lowConf: Number(estByConf.LOW.toFixed(2)),
          unknownConf: Number(estByConf.UNKNOWN.toFixed(2)),
        },
        groups: groupsArr,
      },
      null,
      2
    )
  );
  console.log(`[7] Wrote groups → ${GROUPS_PATH}`);

  // ---- 7. Final report ----
  console.log("");
  console.log("================ DELLOW PRICE CATALOGUE REPORT ================");
  console.log(`Catalogue: ${catalogueArr.length} distinct products, ${paidInvoiceNumbers.size} paid invoices, ${paidLines.length} invoice lines analysed`);
  console.log("");
  console.log("Top 20 most-frequent products (by history count):");
  const topFreq = catalogueArr.slice().sort((a, b) => b.historyCount - a.historyCount).slice(0, 20);
  for (const e of topFreq) {
    console.log(
      `  [${String(e.historyCount).padStart(3)} x] modal=${fmtGBP(e.modalRate)} recent=${fmtGBP(e.mostRecentRate)} avg=${fmtGBP(e.avgRate)}  ::  ${e.descriptions[0]}`
    );
  }
  console.log("");
  console.log("Pricing:");
  console.log(`  Priced lines: ${priced.length}`);
  console.log(`  HIGH:    ${confCounts.HIGH} lines, ${fmtGBP(estByConf.HIGH)}`);
  console.log(`  MEDIUM:  ${confCounts.MEDIUM} lines, ${fmtGBP(estByConf.MEDIUM)}`);
  console.log(`  LOW:     ${confCounts.LOW} lines, ${fmtGBP(estByConf.LOW)}`);
  console.log(`  UNKNOWN: ${confCounts.UNKNOWN} lines, ${fmtGBP(estByConf.UNKNOWN)}`);
  const recoverable = (estByConf.HIGH || 0) + (estByConf.MEDIUM || 0);
  console.log(`  Total recoverable (HIGH+MEDIUM): ${fmtGBP(recoverable)}`);
  console.log(`  Total estimated (all): ${fmtGBP(totalEstimated)}`);
  console.log("");
  console.log("Top 30 highest-value unbilled lines:");
  const topVal = priced
    .filter((p) => p.estimatedAmount !== null)
    .sort((a, b) => b.estimatedAmount - a.estimatedAmount)
    .slice(0, 30);
  for (const p of topVal) {
    const d = new Date(p.date).toISOString().slice(0, 10);
    const rtShort = (p.rawText || "").replace(/\s+/g, " ").slice(0, 70);
    console.log(
      `  ${fmtGBP(p.estimatedAmount).padStart(11)} [${p.pricingConfidence.padEnd(7)}] ${d} ${p.qty}x @${fmtGBP(p.estimatedRate)}  ::  ${rtShort}`
    );
  }
  console.log("");
  console.log("Top 20 draft invoice groups (by net estimate):");
  for (const g of groupsArr.slice(0, 20)) {
    const df = new Date(g.dateFrom).toISOString().slice(0, 10);
    const dt = new Date(g.dateTo).toISOString().slice(0, 10);
    console.log(
      `  ${fmtGBP(g.netEstimate).padStart(11)} net  VAT ${fmtGBP(g.vatEstimate).padStart(9)}  inc ${fmtGBP(g.totalIncVat).padStart(11)}  ${g.lineCount}L  ${df}..${dt}  H${g.confidencePct.HIGH}%/M${g.confidencePct.MEDIUM}%/L${g.confidencePct.LOW}%/U${g.confidencePct.UNKNOWN}%  ${g.sender} | ${g.threadKey}`
    );
  }
  console.log("");
  console.log("===============================================================");

  await client.end();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
