// Pass 5 — Inspect early invoices + MESSAGE_LINKED candidates for tasks 2 & 3
const { Client } = require("pg");

const CASE_ID = "58ebd22e-1101-4d56-a672-7cf635be9339";
const CONN =
  "postgres://postgres:postgres@localhost:51214/cromwell_os?sslmode=disable";

async function main() {
  const c = new Client({ connectionString: CONN });
  await c.connect();

  // Invoice families in Nov 2024
  const invs = await c.query(
    `SELECT "invoiceNumber", "invoiceDate", COUNT(*)::int AS n,
            COALESCE(SUM(amount),0)::float AS v
     FROM "BacklogInvoiceLine"
     WHERE "caseId"=$1
     GROUP BY "invoiceNumber", "invoiceDate"
     ORDER BY "invoiceDate" ASC LIMIT 20`,
    [CASE_ID],
  );
  console.log("Earliest invoices:");
  for (const r of invs.rows)
    console.log(`  ${r.invoiceNumber}  ${r.invoiceDate.toISOString().slice(0,10)}  ${r.n} lines  £${r.v.toFixed(2)}`);

  // MESSAGE_LINKED ticket lines in target categories
  const categories = [
    "plasterboard", "u_track", "track", "stud", "paint", "radiator_valve",
  ];
  const regex = {
    plasterboard: /plasterboard|wallboard|fireline|soundboard/i,
    u_track: /u\s*track|u-track/i,
    track: /\btrack\b|channel/i,
    stud: /\bstud/i,
    paint: /paint|emulsion|dulux|magnolia|pbw|brilliant white|matt|satinwood|gloss|undercoat/i,
    radiator_valve: /radiator\s+valve|rad\s+valve|thermostatic|lockshield/i,
  };

  const tls = await c.query(
    `SELECT id, date, "rawText", "normalizedProduct", "requestedQty", "requestedUnit", status, notes
     FROM "BacklogTicketLine"
     WHERE "caseId"=$1 AND status='MESSAGE_LINKED'
     ORDER BY date`,
    [CASE_ID],
  );
  console.log(`\nTotal MESSAGE_LINKED: ${tls.rows.length}`);

  const byCat = {};
  for (const cat of categories) byCat[cat] = [];
  for (const r of tls.rows) {
    for (const cat of categories) {
      if (regex[cat].test(r.rawText) || regex[cat].test(r.normalizedProduct)) {
        byCat[cat].push(r);
        break;
      }
    }
  }

  for (const cat of categories) {
    console.log(`\n=== ${cat} (${byCat[cat].length}) ===`);
    for (const r of byCat[cat]) {
      console.log(`  TL ${r.id}  ${r.date.toISOString().slice(0,10)}  qty=${r.requestedQty} ${r.requestedUnit}`);
      console.log(`    raw: ${r.rawText.slice(0, 140).replace(/\n/g, " | ")}`);
      console.log(`    norm: ${r.normalizedProduct}`);
    }
  }

  // UNMATCHED invoice lines summary by date
  const unmatchedByInv = await c.query(
    `SELECT il."invoiceNumber", il."invoiceDate",
            COUNT(*)::int AS n, COALESCE(SUM(il.amount),0)::float AS v
     FROM "BacklogInvoiceLine" il
     WHERE il."caseId"=$1
     AND NOT EXISTS (SELECT 1 FROM "BacklogInvoiceMatch" bim WHERE bim."invoiceLineId"=il.id)
     GROUP BY il."invoiceNumber", il."invoiceDate"
     ORDER BY il."invoiceDate"`,
    [CASE_ID],
  );
  console.log(`\nUnmatched invoice lines by invoice (${unmatchedByInv.rows.length} invoices):`);
  for (const r of unmatchedByInv.rows)
    console.log(`  ${r.invoiceNumber}  ${r.invoiceDate.toISOString().slice(0,10)}  ${r.n}×  £${r.v.toFixed(2)}`);

  await c.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
