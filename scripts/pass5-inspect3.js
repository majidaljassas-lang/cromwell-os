// Pass 5 — Dump all invoice lines for early family + matches that reference them
const { Client } = require("pg");

const CASE_ID = "58ebd22e-1101-4d56-a672-7cf635be9339";
const CONN =
  "postgres://postgres:postgres@localhost:51214/cromwell_os?sslmode=disable";

async function main() {
  const c = new Client({ connectionString: CONN });
  await c.connect();

  // Dump all invoice lines for early invoices
  const EARLY = [
    "INV-003707","INV-003714","INV-003715","INV-003716","INV-003721",
    "INV-003723","INV-003724","INV-003735","INV-003736","INV-003737",
    "INV-003738","INV-003746","INV-003754","INV-003766","INV-003767",
    "INV-003768","INV-003769","INV-003770","INV-003772","INV-003773",
  ];
  const rows = await c.query(
    `SELECT il.id, il."invoiceNumber", il."invoiceDate", il."productDescription",
            il.qty, il.unit, il.amount, il.rate,
            (EXISTS (SELECT 1 FROM "BacklogInvoiceMatch" bim WHERE bim."invoiceLineId"=il.id)) AS matched,
            (SELECT json_agg(json_build_object('tlId', bim."ticketLineId", 'method', bim."matchMethod"))
               FROM "BacklogInvoiceMatch" bim WHERE bim."invoiceLineId"=il.id) AS matchers
     FROM "BacklogInvoiceLine" il
     WHERE il."caseId"=$1 AND il."invoiceNumber" = ANY($2)
     ORDER BY il."invoiceDate", il."invoiceNumber", il.id`,
    [CASE_ID, EARLY],
  );
  for (const r of rows.rows) {
    console.log(`${r.invoiceNumber} ${r.invoiceDate.toISOString().slice(0,10)} ${r.matched?'[M]':'[U]'} qty=${r.qty} ${r.unit} £${r.amount} — ${r.productDescription.slice(0,100)}`);
    if (r.matchers) {
      for (const m of r.matchers) console.log(`    -> TL ${m.tlId} (${m.method})`);
    }
  }

  await c.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
