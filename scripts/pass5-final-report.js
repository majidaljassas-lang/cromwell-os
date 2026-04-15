// Pass 5 final report: top 20 newly matched items + final stats
const { Client } = require("pg");
const CASE_ID = "58ebd22e-1101-4d56-a672-7cf635be9339";
const CONN = "postgres://postgres:postgres@localhost:51214/cromwell_os?sslmode=disable";

async function main() {
  const c = new Client({ connectionString: CONN });
  await c.connect();

  // Pass 5 matches
  const matches = await c.query(
    `SELECT bim.id, bim."matchMethod", bim."createdAt",
            tl.id AS tl_id, tl.date AS tl_date, tl."rawText",
            tl."requestedQty" AS tl_qty, tl."requestedUnit" AS tl_unit,
            il."invoiceNumber", il."invoiceDate", il."productDescription",
            il.qty, il.unit, il.amount
     FROM "BacklogInvoiceMatch" bim
     JOIN "BacklogTicketLine" tl ON tl.id = bim."ticketLineId"
     JOIN "BacklogInvoiceLine" il ON il.id = bim."invoiceLineId"
     WHERE tl."caseId"=$1 AND bim."matchMethod" LIKE 'PASS5_%'
     ORDER BY bim."createdAt"`,
    [CASE_ID],
  );
  console.log(`Pass 5 matches (${matches.rows.length}):`);
  for (const r of matches.rows) {
    console.log(`  ${r.invoiceDate.toISOString().slice(0,10)}  ${r.invoiceNumber}  qty=${r.qty} £${r.amount}  [${r.matchMethod}]  — ${r.productDescription.slice(0,70)}`);
  }

  // Compare totals to pass 4
  const stats = await c.query(
    `SELECT status, COUNT(*)::int AS n FROM "BacklogTicketLine" WHERE "caseId"=$1 GROUP BY status ORDER BY status`,
    [CASE_ID],
  );
  console.log("\nTicket line status:");
  for (const r of stats.rows) console.log(`  ${r.status}: ${r.n}`);

  const matchCount = await c.query(
    `SELECT COUNT(*)::int AS n FROM "BacklogInvoiceMatch" bim
       JOIN "BacklogInvoiceLine" il ON il.id=bim."invoiceLineId"
       WHERE il."caseId"=$1`,
    [CASE_ID],
  );
  console.log(`\nTotal invoice match rows: ${matchCount.rows[0].n}`);

  const t = await c.query(
    `SELECT
       (SELECT COUNT(*)::int FROM "BacklogInvoiceLine" WHERE "caseId"=$1) AS total_il,
       (SELECT COALESCE(SUM(amount),0)::float FROM "BacklogInvoiceLine" WHERE "caseId"=$1) AS total_val,
       (SELECT COUNT(DISTINCT bim."invoiceLineId")::int FROM "BacklogInvoiceMatch" bim
          JOIN "BacklogInvoiceLine" il ON il.id=bim."invoiceLineId"
          WHERE il."caseId"=$1) AS matched_il,
       (SELECT COALESCE(SUM(il.amount),0)::float FROM "BacklogInvoiceLine" il WHERE il."caseId"=$1
          AND EXISTS (SELECT 1 FROM "BacklogInvoiceMatch" bim WHERE bim."invoiceLineId"=il.id)) AS matched_val,
       (SELECT COUNT(*)::int FROM "BacklogInvoiceLine" il WHERE il."caseId"=$1
          AND NOT EXISTS (SELECT 1 FROM "BacklogInvoiceMatch" bim WHERE bim."invoiceLineId"=il.id)) AS unmatched_il,
       (SELECT COALESCE(SUM(il.amount),0)::float FROM "BacklogInvoiceLine" il WHERE il."caseId"=$1
          AND NOT EXISTS (SELECT 1 FROM "BacklogInvoiceMatch" bim WHERE bim."invoiceLineId"=il.id)) AS unmatched_val`,
    [CASE_ID],
  );
  const r = t.rows[0];
  console.log(`\nInvoice totals: ${r.total_il} lines, £${r.total_val.toFixed(2)}`);
  console.log(`  matched:   ${r.matched_il} lines (£${r.matched_val.toFixed(2)})`);
  console.log(`  unmatched: ${r.unmatched_il} lines (£${r.unmatched_val.toFixed(2)})`);
  console.log(`  match rate: ${((r.matched_val / r.total_val) * 100).toFixed(1)}% of value`);

  // Delivery/carriage breakdown (unavoidable unmatched)
  const dc = await c.query(
    `SELECT COUNT(*)::int AS n, COALESCE(SUM(amount),0)::float AS v
     FROM "BacklogInvoiceLine" il
     WHERE il."caseId"=$1
     AND NOT EXISTS (SELECT 1 FROM "BacklogInvoiceMatch" bim WHERE bim."invoiceLineId"=il.id)
     AND (il."productDescription" ILIKE '%delivery%' OR il."productDescription" ILIKE '%carriage%'
          OR il."productDescription" ILIKE '%lwb%')`,
    [CASE_ID],
  );
  console.log(`\nOf unmatched, delivery/carriage (unavoidable): ${dc.rows[0].n} lines, £${dc.rows[0].v.toFixed(2)}`);
  const productUnmatched = r.unmatched_val - dc.rows[0].v;
  console.log(`Product-level unmatched: £${productUnmatched.toFixed(2)}`);

  await c.end();
}

main().catch(e => { console.error(e); process.exit(1); });
