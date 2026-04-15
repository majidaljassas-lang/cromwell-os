// Pass 5 — list all unmatched invoice lines
const { Client } = require("pg");

const CASE_ID = "58ebd22e-1101-4d56-a672-7cf635be9339";
const CONN = "postgres://postgres:postgres@localhost:51214/cromwell_os?sslmode=disable";

async function main() {
  const c = new Client({ connectionString: CONN });
  await c.connect();

  const unmatched = await c.query(
    `SELECT il.id, il."invoiceNumber", il."invoiceDate", il."productDescription",
            il.qty, il.amount
     FROM "BacklogInvoiceLine" il
     WHERE il."caseId"=$1
     AND NOT EXISTS (SELECT 1 FROM "BacklogInvoiceMatch" bim WHERE bim."invoiceLineId"=il.id)
     ORDER BY il."invoiceDate", il."invoiceNumber"`,
    [CASE_ID],
  );
  console.log(`Unmatched invoice lines: ${unmatched.rows.length}`);
  for (const r of unmatched.rows) {
    console.log(`  ${r.id}  ${r.invoiceNumber} ${r.invoiceDate.toISOString().slice(0,10)}  qty=${r.qty} £${r.amount} — ${r.productDescription}`);
  }

  await c.end();
}

main().catch(e => { console.error(e); process.exit(1); });
