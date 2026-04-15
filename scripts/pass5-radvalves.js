// Pass 5 — look at all radiator valve lines (invoice + ticket)
const { Client } = require("pg");

const CASE_ID = "58ebd22e-1101-4d56-a672-7cf635be9339";
const CONN = "postgres://postgres:postgres@localhost:51214/cromwell_os?sslmode=disable";

async function main() {
  const c = new Client({ connectionString: CONN });
  await c.connect();

  // All invoice lines with rad valve in description
  const invRows = await c.query(
    `SELECT il.id, il."invoiceNumber", il."invoiceDate", il."productDescription",
            il.qty, il.amount,
            (EXISTS (SELECT 1 FROM "BacklogInvoiceMatch" bim WHERE bim."invoiceLineId"=il.id)) AS matched,
            (SELECT json_agg(json_build_object('tlId', bim."ticketLineId", 'method', bim."matchMethod"))
               FROM "BacklogInvoiceMatch" bim WHERE bim."invoiceLineId"=il.id) AS matchers
     FROM "BacklogInvoiceLine" il
     WHERE il."caseId"=$1 AND (
       il."productDescription" ILIKE '%radiator valve%' OR
       il."productDescription" ILIKE '%rad valve%' OR
       il."productDescription" ILIKE '%lockshield%' OR
       il."productDescription" ILIKE '%thermo head%' OR
       il."productDescription" ILIKE '%art 1551%' OR
       il."productDescription" ILIKE '%art 1560%' OR
       il."productDescription" ILIKE '%w/h%' OR
       il."productDescription" ILIKE '%rve15%'
     )
     ORDER BY il."invoiceDate", il."invoiceNumber"`,
    [CASE_ID],
  );
  console.log("Rad valve invoice lines:");
  for (const r of invRows.rows) {
    console.log(`  ${r.invoiceNumber} ${r.invoiceDate.toISOString().slice(0,10)} ${r.matched?'[M]':'[U]'} qty=${r.qty} £${r.amount} — ${r.productDescription.slice(0,90)}`);
    if (r.matchers) for (const m of r.matchers) console.log(`    -> TL ${m.tlId} (${m.method})`);
  }

  // Rad valve ticket lines
  const tlRows = await c.query(
    `SELECT id, date, "rawText", "normalizedProduct", "requestedQty", status, notes
     FROM "BacklogTicketLine"
     WHERE "caseId"=$1 AND (
       "rawText" ILIKE '%radiator valve%' OR
       "rawText" ILIKE '%rad valve%' OR
       "rawText" ILIKE '%lockshield%' OR
       "rawText" ILIKE '%thermostatic%' OR
       "rawText" ILIKE '%art 1551%' OR
       "rawText" ILIKE '%art 1560%' OR
       "normalizedProduct" ILIKE '%radiator valve%' OR
       "normalizedProduct" ILIKE '%art 1551%' OR
       "normalizedProduct" ILIKE '%art 1560%' OR
       "normalizedProduct" ILIKE '%lockshield%'
     )
     ORDER BY date`,
    [CASE_ID],
  );
  console.log("\nRad valve ticket lines:");
  for (const r of tlRows.rows) {
    console.log(`  TL ${r.id} ${r.date.toISOString().slice(0,10)} [${r.status}] qty=${r.requestedQty}  norm="${r.normalizedProduct.slice(0,80)}"`);
    console.log(`    raw: ${r.rawText.slice(0, 140).replace(/\n/g,' | ')}`);
  }

  await c.end();
}

main().catch(e => { console.error(e); process.exit(1); });
