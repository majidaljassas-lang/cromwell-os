// Pass 5 — Inspect current state of Dellow backlog
const { Client } = require("pg");

const CASE_ID = "58ebd22e-1101-4d56-a672-7cf635be9339";
const CONN =
  "postgres://postgres:postgres@localhost:51214/cromwell_os?sslmode=disable";

async function main() {
  const c = new Client({ connectionString: CONN });
  await c.connect();

  const statusCount = await c.query(
    `SELECT status, COUNT(*)::int AS n FROM "BacklogTicketLine" WHERE "caseId"=$1 GROUP BY status ORDER BY status`,
    [CASE_ID],
  );
  console.log("Ticket line status counts:");
  for (const r of statusCount.rows) console.log(`  ${r.status}: ${r.n}`);

  const totalTL = await c.query(
    `SELECT COUNT(*)::int AS n FROM "BacklogTicketLine" WHERE "caseId"=$1`,
    [CASE_ID],
  );
  console.log(`  TOTAL: ${totalTL.rows[0].n}`);

  const totalIL = await c.query(
    `SELECT COUNT(*)::int AS n, COALESCE(SUM(amount),0)::float AS v FROM "BacklogInvoiceLine" WHERE "caseId"=$1`,
    [CASE_ID],
  );
  console.log(
    `Invoice lines: ${totalIL.rows[0].n}, total value £${totalIL.rows[0].v.toFixed(2)}`,
  );

  const matchedIL = await c.query(
    `SELECT COUNT(DISTINCT bim."invoiceLineId")::int AS n,
            COALESCE(SUM(il.amount),0)::float AS v
     FROM "BacklogInvoiceMatch" bim
     JOIN "BacklogInvoiceLine" il ON il.id = bim."invoiceLineId"
     WHERE il."caseId"=$1`,
    [CASE_ID],
  );
  console.log(
    `Matched invoice lines: ${matchedIL.rows[0].n}, value £${matchedIL.rows[0].v.toFixed(2)}`,
  );

  const unmatchedIL = await c.query(
    `SELECT COUNT(*)::int AS n, COALESCE(SUM(amount),0)::float AS v
     FROM "BacklogInvoiceLine" il
     WHERE il."caseId"=$1
     AND NOT EXISTS (
       SELECT 1 FROM "BacklogInvoiceMatch" bim WHERE bim."invoiceLineId"=il.id
     )`,
    [CASE_ID],
  );
  console.log(
    `Unmatched invoice lines: ${unmatchedIL.rows[0].n}, value £${unmatchedIL.rows[0].v.toFixed(2)}`,
  );

  // Suggested matches
  const suggested = await c.query(
    `SELECT id, "rawText", "normalizedProduct", "requestedQty", "requestedUnit", date, status, notes
     FROM "BacklogTicketLine"
     WHERE "caseId"=$1 AND notes LIKE '%Possible match (PRODUCT_NORMALIZATION):%'
     ORDER BY date`,
    [CASE_ID],
  );
  console.log(`\nSuggested matches: ${suggested.rows.length}`);
  for (const r of suggested.rows) {
    console.log(`\n  TL ${r.id}`);
    console.log(`    status=${r.status}  date=${r.date.toISOString().slice(0,10)}  qty=${r.requestedQty} ${r.requestedUnit}`);
    console.log(`    rawText: ${r.rawText.slice(0, 160)}`);
    console.log(`    notes: ${r.notes}`);
  }

  await c.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
