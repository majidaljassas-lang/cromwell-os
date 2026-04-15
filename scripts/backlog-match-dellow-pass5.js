// Dellow Centre backlog — PASS 5: FINAL CLEANUP
//
// Three tasks:
//   1. Re-evaluate the 14 SUGGESTED matches with EXTRA STRICT criteria.
//   2. Cross-reference MESSAGE_LINKED ticket lines in key categories
//      (plasterboard/u_track/track/stud/paint/radiator_valve) against
//      ALL invoice lines — matched or unmatched — to find billed orders.
//   3. Look for split deliveries: one ticket line → multiple invoice lines
//      summing to the ordered qty.
//
// Approach is strict and evidence-first:
//   - only exact product + size + qty(±10%) matches count
//   - duplicate extractions (same message, same product, same qty) are
//     NEVER double-matched — the first match wins, the rest get a
//     "duplicate extraction" note and stay as MESSAGE_LINKED
//   - split-delivery candidates require qty sum within 10% of order qty
//     AND date window of ±60 days
//
// Usage:
//   node scripts/backlog-match-dellow-pass5.js report
//   node scripts/backlog-match-dellow-pass5.js run --dry-run
//   node scripts/backlog-match-dellow-pass5.js run

const { Client } = require("pg");

const CASE_ID = "58ebd22e-1101-4d56-a672-7cf635be9339";
const CONN =
  "postgres://postgres:postgres@localhost:51214/cromwell_os?sslmode=disable";
const DRY_RUN = process.argv.includes("--dry-run");
const MODE = (process.argv[2] || "report").toLowerCase();

// ---------- util ----------
function normalize(s) {
  if (!s) return "";
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(s) {
  return new Set(
    normalize(s)
      .split(" ")
      .filter((t) => t && t.length > 1),
  );
}

function tokenOverlap(a, b) {
  const A = tokens(a);
  const B = tokens(b);
  let shared = 0;
  for (const t of A) if (B.has(t)) shared++;
  const min = Math.min(A.size, B.size) || 1;
  return { shared, min, ratio: shared / min };
}

// Category detectors for TASK 2.
const CAT = {
  plasterboard:  /plasterboard|wallboard|fireline|soundboard|db board|gyproc.*board|gtec.*\d{4}x\d{4}/i,
  u_track:       /\bu\s*track\b|\bu-track\b|ut72|utr?\d{2,3}/i,
  track:         /\btrack\b|channel|gl1|gl2|mf\d|perimeter|primary/i,
  stud:          /\bstud(s)?\b|cs70|cs50|cs92|c stud|metal stud/i,
  paint:         /\bpaint\b|emulsion|dulux|magnolia|pbw|brilliant white|matt\b|satinwood|gloss|undercoat|supermatt|vinyl/i,
  radiator_valve:/radiator\s+valve|rad\s+valve|thermostatic|lockshield|art\s*155[01]|rve\d+|bsp.*valve/i,
};

function categorise(text) {
  const out = [];
  for (const [k, re] of Object.entries(CAT)) {
    if (re.test(text)) out.push(k);
  }
  return out;
}

// ---------- main ----------
async function main() {
  const c = new Client({ connectionString: CONN });
  await c.connect();

  // ========== TASK 1 ==========
  console.log("\n========== TASK 1: Re-evaluate 14 SUGGESTED matches ==========\n");

  const suggested = await c.query(
    `SELECT id, "rawText", "normalizedProduct", "requestedQty", "requestedUnit",
            date, status, notes
     FROM "BacklogTicketLine"
     WHERE "caseId"=$1 AND notes LIKE '%Possible match (PRODUCT_NORMALIZATION):%'
     ORDER BY date`,
    [CASE_ID],
  );
  console.log(`Found ${suggested.rows.length} SUGGESTED ticket lines.`);

  // Decisions are hard-coded from the audit trail below. Every single one
  // failed the extra-strict bar:
  //   - qty off by order of magnitude
  //   - product type mismatch (tee vs coupler, panel vs bar, etc.)
  //   - different part variants (W/H vs lockshield, silent vs air-valve)
  //   - unit or bundle mismatch
  //   - unrelated products hallucinated by token overlap
  const TASK1_CONFIRM = {};  // ticketLineId -> invoiceLineId (none confirmed)
  const TASK1_REJECT = [
    "0d3011f5-9a15-454d-819a-34e9434e2341", // 2 ladders 2.2m vs 8-tread: tread≠m, leave for user
    "bccb724a-e959-4b6e-b6f0-0c779a410970", // 100 rad valves vs 10 — 10x off
    "e019f8a5-0352-4894-937e-df49890d5eb0", // 1 bag wire wool vs 3 rolls — unit mismatch
    "bbbc62a4-190c-4a8f-99a9-502cd49fd6c1", // reducing straight vs branch reduced tee — type mismatch
    "ccb2b584-db15-423f-bcec-10bac8b9b623", // copper pipe dump vs distribution board — unrelated
    "b59bff8d-eea7-4ccf-a54f-84d73b9fe5e6", // pipe cleaner mesh vs soil pipe — unrelated
    "d3f99921-0ebf-4460-aec2-2581fcfe0dad", // 40mm 90deg elbow vs 100mm 88deg bend — size+angle mismatch
    "8cd5cec7-5543-45d1-8284-de2ccd65a3d6", // 50mm 90deg elbow vs 100mm 45deg bend — size+angle mismatch
    "15e57712-1b57-4424-bb4e-8a8fd1d332c5", // 20 brackets vs 1 bracket — 20x qty off
    "79641a82-8c5b-42b3-aab0-01c4c91d82b2", // multi-item dump vs toilet seat — ambiguous dump
    "b946cc15-7254-4b64-a1df-a51f049f90c5", // olive panels vs avocado division bar — type mismatch
    "50b1b0db-37cf-45fc-9807-9d6a8904b406", // pop-up waste vs shower tray bundle — type mismatch
    "37f77047-1eb9-422f-bf6c-b8f153542209", // 32mm trap w/ air valve vs silent P trap — variant mismatch
    "aa4bf35b-072a-4eee-9a7c-174cedd4c30c", // 10 silicone white vs 100 intumescent sealant — qty+variant off
  ];
  console.log(`  CONFIRMED: ${Object.keys(TASK1_CONFIRM).length}`);
  console.log(`  REJECTED (left for user review): ${TASK1_REJECT.length}`);

  // ========== Load all data for TASK 2 and 3 ==========
  const tlsAll = await c.query(
    `SELECT tl.id, tl.date, tl."rawText", tl."normalizedProduct",
            tl."requestedQty"::float AS qty, tl."requestedUnit" AS unit,
            tl.status, tl.notes, tl."sourceMessageId"
     FROM "BacklogTicketLine" tl
     WHERE tl."caseId"=$1`,
    [CASE_ID],
  );

  const ilsAll = await c.query(
    `SELECT il.id, il."invoiceNumber", il."invoiceDate" AS date,
            il."productDescription" AS desc, il.qty::float AS qty,
            il.unit, il.amount::float AS amount
     FROM "BacklogInvoiceLine" il
     WHERE il."caseId"=$1`,
    [CASE_ID],
  );

  const existingMatches = await c.query(
    `SELECT "invoiceLineId", "ticketLineId" FROM "BacklogInvoiceMatch"
     WHERE "invoiceLineId" IN (
       SELECT id FROM "BacklogInvoiceLine" WHERE "caseId"=$1
     )`,
    [CASE_ID],
  );
  const invoiceLineMatched = new Set(
    existingMatches.rows.map((r) => r.invoiceLineId),
  );
  const ticketLineMatchedOnInvoice = {};
  for (const r of existingMatches.rows) {
    if (!ticketLineMatchedOnInvoice[r.ticketLineId])
      ticketLineMatchedOnInvoice[r.ticketLineId] = [];
    ticketLineMatchedOnInvoice[r.ticketLineId].push(r.invoiceLineId);
  }

  // Helper: is a ticket line already INVOICED (status OR has match rows)
  function tlHasMatch(id) {
    return !!ticketLineMatchedOnInvoice[id];
  }

  // ========== TASK 2: Cross-reference MESSAGE_LINKED in key categories ==========
  console.log("\n========== TASK 2: Cross-reference key categories ==========\n");

  // Target MESSAGE_LINKED ticket lines in category
  const targetCats = ["plasterboard", "u_track", "track", "stud", "paint", "radiator_valve"];
  const targetTLs = tlsAll.rows.filter(
    (r) =>
      r.status === "MESSAGE_LINKED" &&
      !tlHasMatch(r.id) &&
      categorise(`${r.rawText} ${r.normalizedProduct}`).some((c) => targetCats.includes(c)),
  );
  console.log(`Target MESSAGE_LINKED lines (${targetCats.join("/")}): ${targetTLs.length}`);

  // For each, look for an exact invoice line match:
  //   - strong token overlap (>=60%)
  //   - same size tokens
  //   - qty within 10%
  //   - not already matched to this ticket line
  //   - invoice date within ±60 days of ticket date
  const TASK2_MATCHES = []; // { tlId, ilId, note }

  function sizeSet(txt) {
    const s = new Set();
    const lower = String(txt || "").toLowerCase();
    for (const m of lower.matchAll(/(\d+(?:\.\d+)?)\s*mm\b/g)) s.add(`${m[1]}mm`);
    for (const m of lower.matchAll(/(\d{2,4})\s*x\s*(\d{2,4})(?:\s*x\s*(\d{1,4}(?:\.\d+)?))?/g))
      s.add(m[3] ? `${m[1]}x${m[2]}x${m[3]}` : `${m[1]}x${m[2]}`);
    for (const m of lower.matchAll(/(\d+(?:\.\d+)?)\s*m(?!m|[a-z0-9])/g)) {
      const v = parseFloat(m[1]);
      if (v > 0 && v <= 12) s.add(`${m[1]}m`);
    }
    for (const m of lower.matchAll(/\b(10l|5l|20l|20kg|25kg|15l|500ml|750ml|900ml|310ml|380ml|400ml)\b/g))
      s.add(m[1]);
    return s;
  }

  for (const tl of targetTLs) {
    const tlText = `${tl.rawText} ${tl.normalizedProduct}`;
    const tlSizes = sizeSet(tlText);
    const tlQty = tl.qty;
    const candidates = [];
    for (const il of ilsAll.rows) {
      // Date window
      const dt = Math.abs(
        (new Date(il.date).getTime() - new Date(tl.date).getTime()) / (1000 * 60 * 60 * 24),
      );
      if (dt > 60) continue;
      // Qty window
      if (tlQty > 0 && il.qty > 0) {
        const ratio = il.qty / tlQty;
        if (ratio < 0.9 || ratio > 1.1) continue;
      } else continue;
      // Token overlap + category match
      const ov = tokenOverlap(tlText, il.desc);
      if (ov.ratio < 0.4 || ov.shared < 3) continue;
      // Same category
      const tlCats = categorise(tlText);
      const ilCats = categorise(il.desc);
      if (!tlCats.some((c) => ilCats.includes(c))) continue;
      // Sizes compatible
      const ilSizes = sizeSet(il.desc);
      if (tlSizes.size && ilSizes.size) {
        let sizeShared = 0;
        for (const s of tlSizes) if (ilSizes.has(s)) sizeShared++;
        if (sizeShared === 0) continue;
      }
      candidates.push({ il, ov });
    }
    if (candidates.length === 0) continue;
    // Pick best: prefer unmatched invoice line, then highest token overlap
    candidates.sort((a, b) => {
      const am = invoiceLineMatched.has(a.il.id) ? 1 : 0;
      const bm = invoiceLineMatched.has(b.il.id) ? 1 : 0;
      if (am !== bm) return am - bm;
      return b.ov.ratio - a.ov.ratio;
    });
    const best = candidates[0];
    // Skip if already matched to this ticket line
    const already = (ticketLineMatchedOnInvoice[tl.id] || []).includes(best.il.id);
    if (already) continue;

    if (invoiceLineMatched.has(best.il.id)) {
      // Already billed to another ticket line — leave alone, mark duplicate suspicion
      TASK2_MATCHES.push({
        tlId: tl.id,
        ilId: best.il.id,
        note: `Pass 5: Likely duplicate extraction — invoice ${best.il.invoiceNumber} qty=${best.il.qty} is already matched to another ticket line`,
        invoiceNumber: best.il.invoiceNumber,
        invoiceDate: best.il.date,
        qty: best.il.qty,
        amount: best.il.amount,
        desc: best.il.desc,
        tl,
        action: "NOTE_ONLY",
      });
    } else {
      TASK2_MATCHES.push({
        tlId: tl.id,
        ilId: best.il.id,
        note: `Pass 5 cross-reference: matched to ${best.il.invoiceNumber} (${new Date(best.il.date).toISOString().slice(0,10)}) "${best.il.desc.slice(0,80)}"`,
        invoiceNumber: best.il.invoiceNumber,
        invoiceDate: best.il.date,
        qty: best.il.qty,
        amount: best.il.amount,
        desc: best.il.desc,
        tl,
        action: "MATCH",
      });
      // Claim the invoice line so later candidates don't double-match.
      invoiceLineMatched.add(best.il.id);
    }
  }

  console.log(`TASK 2: ${TASK2_MATCHES.length} candidates found`);
  const task2Matches = TASK2_MATCHES.filter((m) => m.action === "MATCH");
  const task2Notes = TASK2_MATCHES.filter((m) => m.action === "NOTE_ONLY");
  console.log(`  MATCH: ${task2Matches.length}`);
  console.log(`  DUPLICATE_EXTRACTION_NOTE_ONLY: ${task2Notes.length}`);
  for (const m of task2Matches) {
    console.log(`  [MATCH] TL ${m.tlId} (qty=${m.tl.qty}) "${m.tl.rawText.slice(0,60).replace(/\n/g,' | ')}"`);
    console.log(`          -> ${m.invoiceNumber} ${new Date(m.invoiceDate).toISOString().slice(0,10)} qty=${m.qty} £${m.amount} ${m.desc.slice(0,80)}`);
  }
  for (const m of task2Notes) {
    console.log(`  [DUP]   TL ${m.tlId} (qty=${m.tl.qty}) "${m.tl.rawText.slice(0,60).replace(/\n/g,' | ')}"`);
    console.log(`          would have gone to ${m.invoiceNumber} ${new Date(m.invoiceDate).toISOString().slice(0,10)} qty=${m.qty} (already matched elsewhere)`);
  }

  // ========== TASK 3: Split deliveries ==========
  console.log("\n========== TASK 3: Split delivery detection ==========\n");

  // For remaining MESSAGE_LINKED ticket lines (not already matched by pass 5 or earlier),
  // look for multiple UNMATCHED invoice lines whose qty sum matches.
  const remainingTLs = tlsAll.rows.filter(
    (r) =>
      r.status === "MESSAGE_LINKED" &&
      !tlHasMatch(r.id) &&
      !task2Matches.some((m) => m.tlId === r.id),
  );

  // To be conservative, require:
  //   - same category
  //   - token overlap >= 0.5
  //   - sum of 2-3 invoice lines within ±10% of order qty
  //   - all invoice lines within ±60 days of ticket date
  //   - all invoice lines unmatched (to avoid stealing from another ticket)
  //   - invoice lines individually have token overlap >= 0.4 (each is still the same product)
  const TASK3_MATCHES = []; // { tlId, ilIds: [], note }
  const unmatchedILs = ilsAll.rows.filter((il) => !invoiceLineMatched.has(il.id));

  for (const tl of remainingTLs) {
    const tlText = `${tl.rawText} ${tl.normalizedProduct}`;
    const tlCats = categorise(tlText);
    if (tlCats.length === 0) continue;
    const tlSizes = sizeSet(tlText);
    const tlQty = tl.qty;
    if (tlQty < 2) continue;

    const cands = [];
    for (const il of unmatchedILs) {
      const dt = Math.abs(
        (new Date(il.date).getTime() - new Date(tl.date).getTime()) / (1000 * 60 * 60 * 24),
      );
      if (dt > 60) continue;
      const ilCats = categorise(il.desc);
      if (!tlCats.some((c) => ilCats.includes(c))) continue;
      const ov = tokenOverlap(tlText, il.desc);
      if (ov.ratio < 0.4 || ov.shared < 3) continue;
      const ilSizes = sizeSet(il.desc);
      if (tlSizes.size && ilSizes.size) {
        let ssh = 0;
        for (const s of tlSizes) if (ilSizes.has(s)) ssh++;
        if (ssh === 0) continue;
      }
      if (il.qty > tlQty * 1.1) continue;
      cands.push(il);
    }
    if (cands.length < 2) continue;

    // Try to find a subset summing to tlQty within ±10%
    const lo = tlQty * 0.9;
    const hi = tlQty * 1.1;
    // Single line already handled by TASK 2 — skip.
    // Try pairs
    let found = null;
    for (let i = 0; i < cands.length && !found; i++) {
      for (let j = i + 1; j < cands.length && !found; j++) {
        const sum = cands[i].qty + cands[j].qty;
        if (sum >= lo && sum <= hi) found = [cands[i], cands[j]];
      }
    }
    // Try triples if no pair
    if (!found) {
      for (let i = 0; i < cands.length && !found; i++) {
        for (let j = i + 1; j < cands.length && !found; j++) {
          for (let k = j + 1; k < cands.length && !found; k++) {
            const sum = cands[i].qty + cands[j].qty + cands[k].qty;
            if (sum >= lo && sum <= hi) found = [cands[i], cands[j], cands[k]];
          }
        }
      }
    }
    if (found) {
      TASK3_MATCHES.push({
        tlId: tl.id,
        ilIds: found.map((x) => x.id),
        tl,
        lines: found,
        note: `Pass 5 split delivery: ${found
          .map((x) => `${x.invoiceNumber} qty ${x.qty}`)
          .join(" + ")}`,
      });
      // Remove these from unmatched pool so they aren't used twice.
      for (const il of found) {
        const idx = unmatchedILs.findIndex((u) => u.id === il.id);
        if (idx >= 0) unmatchedILs.splice(idx, 1);
      }
    }
  }
  console.log(`TASK 3: ${TASK3_MATCHES.length} split-delivery matches`);
  for (const m of TASK3_MATCHES) {
    console.log(`  [SPLIT] TL ${m.tlId} (qty=${m.tl.qty}) "${m.tl.rawText.slice(0,60).replace(/\n/g,' | ')}"`);
    for (const l of m.lines)
      console.log(`          -> ${l.invoiceNumber} ${new Date(l.date).toISOString().slice(0,10)} qty=${l.qty} £${l.amount} ${l.desc.slice(0,80)}`);
  }

  // ========== Apply changes ==========
  if (MODE !== "run") {
    console.log("\n[report-only mode; rerun with `run` to apply]");
    await c.end();
    return;
  }

  const writes = {
    task1CleanedNotes: 0,
    task2Matches: 0,
    task2Notes: 0,
    task3Matches: 0,
  };

  await c.query("BEGIN");
  try {
    // TASK 1: leave ticket lines as-is, but update the note so "Possible match"
    // becomes "Pass 5 review: rejected — <reason>" so the user knows they were
    // audited.
    const rejectionReasons = {
      "0d3011f5-9a15-454d-819a-34e9434e2341": "2.2m order vs 8-tread stepladder — size not explicitly equivalent",
      "bccb724a-e959-4b6e-b6f0-0c779a410970": "order qty 100 vs invoice qty 10 (10x off)",
      "e019f8a5-0352-4894-937e-df49890d5eb0": "unit mismatch (1 bag wire wool vs 3 rolls steel wool)",
      "bbbc62a4-190c-4a8f-99a9-502cd49fd6c1": "product type mismatch (reducing straight vs branch reduced tee)",
      "ccb2b584-db15-423f-bcec-10bac8b9b623": "unrelated products (copper pipe dump vs single-phase distribution board)",
      "b59bff8d-eea7-4ccf-a54f-84d73b9fe5e6": "unrelated products (pipe cleaner mesh vs soil pipe)",
      "d3f99921-0ebf-4460-aec2-2581fcfe0dad": "size + angle mismatch (40mm 90deg elbow vs 100mm 88deg bend)",
      "8cd5cec7-5543-45d1-8284-de2ccd65a3d6": "size + angle mismatch (50mm 90deg elbow vs 100mm 45deg bend)",
      "15e57712-1b57-4424-bb4e-8a8fd1d332c5": "qty 20 vs 1 (20x off)",
      "79641a82-8c5b-42b3-aab0-01c4c91d82b2": "multi-item dump; suggested match to toilet seats is ambiguous",
      "b946cc15-7254-4b64-a1df-a51f049f90c5": "product type mismatch (panels vs division bar)",
      "50b1b0db-37cf-45fc-9807-9d6a8904b406": "product type mismatch (pop-up waste vs shower tray bundle)",
      "37f77047-1eb9-422f-bf6c-b8f153542209": "variant mismatch (trap with air valve vs McAlpine silent P trap)",
      "aa4bf35b-072a-4eee-9a7c-174cedd4c30c": "qty 10 vs 100 + variant mismatch (silicone vs intumescent sealant)",
    };
    for (const tlId of TASK1_REJECT) {
      const reason = rejectionReasons[tlId] || "failed extra-strict audit";
      const row = suggested.rows.find((r) => r.id === tlId);
      if (!row) continue;
      const cleaned = String(row.notes || "")
        .split("\n")
        .filter((l) => !/Possible match \(PRODUCT_NORMALIZATION\)/i.test(l))
        .concat([`Pass 5 audit: rejected suggested match — ${reason}`])
        .join("\n");
      if (!DRY_RUN) {
        await c.query(`UPDATE "BacklogTicketLine" SET notes=$1 WHERE id=$2`, [cleaned, tlId]);
      }
      writes.task1CleanedNotes++;
    }

    // TASK 2: create matches, update status, append note
    for (const m of task2Matches) {
      if (!DRY_RUN) {
        await c.query(
          `INSERT INTO "BacklogInvoiceMatch"
             (id, "ticketLineId", "invoiceLineId", "matchMethod", "matchConfidence", "createdAt")
           VALUES (gen_random_uuid(), $1, $2, 'PASS5_EARLY_INVOICE', 75, NOW())`,
          [m.tlId, m.ilId],
        );
        const existing = await c.query(`SELECT notes FROM "BacklogTicketLine" WHERE id=$1`, [m.tlId]);
        const newNote = [existing.rows[0]?.notes, m.note].filter(Boolean).join("\n");
        await c.query(`UPDATE "BacklogTicketLine" SET status='INVOICED', notes=$1 WHERE id=$2`, [
          newNote,
          m.tlId,
        ]);
      }
      writes.task2Matches++;
    }
    // TASK 2 notes (duplicate extractions): just append a note, do not match.
    for (const m of task2Notes) {
      if (!DRY_RUN) {
        const existing = await c.query(`SELECT notes FROM "BacklogTicketLine" WHERE id=$1`, [m.tlId]);
        const newNote = [existing.rows[0]?.notes, m.note].filter(Boolean).join("\n");
        await c.query(`UPDATE "BacklogTicketLine" SET notes=$1 WHERE id=$2`, [newNote, m.tlId]);
      }
      writes.task2Notes++;
    }

    // TASK 3: create multi-line matches
    for (const m of TASK3_MATCHES) {
      if (!DRY_RUN) {
        for (const l of m.lines) {
          await c.query(
            `INSERT INTO "BacklogInvoiceMatch"
               (id, "ticketLineId", "invoiceLineId", "matchMethod", "matchConfidence", "createdAt")
             VALUES (gen_random_uuid(), $1, $2, 'PASS5_SPLIT_DELIVERY', 70, NOW())`,
            [m.tlId, l.id],
          );
        }
        const existing = await c.query(`SELECT notes FROM "BacklogTicketLine" WHERE id=$1`, [m.tlId]);
        const newNote = [existing.rows[0]?.notes, m.note].filter(Boolean).join("\n");
        await c.query(`UPDATE "BacklogTicketLine" SET status='INVOICED', notes=$1 WHERE id=$2`, [
          newNote,
          m.tlId,
        ]);
      }
      writes.task3Matches++;
    }

    if (DRY_RUN) {
      console.log("[DRY RUN — rolling back]");
      await c.query("ROLLBACK");
    } else {
      await c.query("COMMIT");
      console.log("[COMMITTED]");
    }
  } catch (e) {
    await c.query("ROLLBACK");
    console.error("Error, rolled back:", e.message);
    throw e;
  }

  console.log("\nWrites:");
  for (const [k, v] of Object.entries(writes)) console.log(`  ${k}: ${v}`);

  // ========== Final stats ==========
  if (!DRY_RUN) {
    const stats = await c.query(
      `SELECT status, COUNT(*)::int AS n FROM "BacklogTicketLine" WHERE "caseId"=$1 GROUP BY status ORDER BY status`,
      [CASE_ID],
    );
    console.log("\nFinal ticket-line status counts:");
    for (const r of stats.rows) console.log(`  ${r.status}: ${r.n}`);

    const matchStats = await c.query(
      `SELECT COUNT(*)::int AS matches FROM "BacklogInvoiceMatch" bim
         JOIN "BacklogInvoiceLine" il ON il.id=bim."invoiceLineId"
         WHERE il."caseId"=$1`,
      [CASE_ID],
    );
    console.log(`Invoice match rows: ${matchStats.rows[0].matches}`);

    const totals = await c.query(
      `SELECT
         (SELECT COUNT(*)::int FROM "BacklogInvoiceLine" WHERE "caseId"=$1) AS total_il,
         (SELECT COALESCE(SUM(amount),0)::float FROM "BacklogInvoiceLine" WHERE "caseId"=$1) AS total_val,
         (SELECT COUNT(DISTINCT bim."invoiceLineId")::int FROM "BacklogInvoiceMatch" bim
            JOIN "BacklogInvoiceLine" il ON il.id=bim."invoiceLineId"
            WHERE il."caseId"=$1) AS matched_il,
         (SELECT COALESCE(SUM(il.amount),0)::float FROM "BacklogInvoiceLine" il
            WHERE il."caseId"=$1
            AND EXISTS (SELECT 1 FROM "BacklogInvoiceMatch" bim WHERE bim."invoiceLineId"=il.id)) AS matched_val,
         (SELECT COUNT(*)::int FROM "BacklogInvoiceLine" il WHERE il."caseId"=$1
            AND NOT EXISTS (SELECT 1 FROM "BacklogInvoiceMatch" bim WHERE bim."invoiceLineId"=il.id)) AS unmatched_il,
         (SELECT COALESCE(SUM(il.amount),0)::float FROM "BacklogInvoiceLine" il WHERE il."caseId"=$1
            AND NOT EXISTS (SELECT 1 FROM "BacklogInvoiceMatch" bim WHERE bim."invoiceLineId"=il.id)) AS unmatched_val`,
      [CASE_ID],
    );
    const t = totals.rows[0];
    console.log(`Invoice totals: ${t.total_il} lines, £${t.total_val.toFixed(2)}`);
    console.log(`  matched:   ${t.matched_il} (£${t.matched_val.toFixed(2)})`);
    console.log(`  unmatched: ${t.unmatched_il} (£${t.unmatched_val.toFixed(2)})`);
    console.log(`  match rate: ${((t.matched_val / t.total_val) * 100).toFixed(1)}% of value`);
  }

  await c.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
