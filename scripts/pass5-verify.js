// Verify certain invoice lines mentioned in the duplicate reports
const { Client } = require("pg");

const CONN = "postgres://postgres:postgres@localhost:51214/cromwell_os?sslmode=disable";

async function main() {
  const c = new Client({ connectionString: CONN });
  await c.connect();
  const ids = [
    // The targets in DUP output
    "INV-003867", "INV-003870", "INV-003865", "INV-003776",
  ];
  // Get invoice lines from those invoices and their match state
  const q = await c.query(
    `SELECT il.id, il."invoiceNumber", il."invoiceDate", il."productDescription",
            il.qty, il.amount,
            (SELECT json_agg(json_build_object('tlId', bim."ticketLineId",
                                                'method', bim."matchMethod"))
               FROM "BacklogInvoiceMatch" bim WHERE bim."invoiceLineId"=il.id) AS matchers
     FROM "BacklogInvoiceLine" il
     WHERE il."invoiceNumber" = ANY($1)
     ORDER BY il."invoiceNumber", il.id`,
    [ids],
  );
  for (const r of q.rows) {
    console.log(`${r.invoiceNumber} ${r.invoiceDate.toISOString().slice(0,10)} qty=${r.qty} £${r.amount} — ${r.productDescription}`);
    if (r.matchers) for (const m of r.matchers) console.log(`    -> TL ${m.tlId} (${m.method})`);
  }
  await c.end();
}
main().catch(e => { console.error(e); process.exit(1); });
