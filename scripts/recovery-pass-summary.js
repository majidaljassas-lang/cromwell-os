// Final summary for recovery pass
const { Client } = require("pg");
const CASE_ID = "58ebd22e-1101-4d56-a672-7cf635be9339";
const CONN = "postgres://postgres:postgres@localhost:51214/cromwell_os?sslmode=disable";

async function main() {
  const client = new Client({ connectionString: CONN });
  await client.connect();

  const stats = (await client.query(
    `SELECT
       (SELECT COUNT(*) FROM "BacklogTicketLine" WHERE "caseId"=$1) AS tl_total,
       (SELECT COUNT(*) FROM "BacklogTicketLine" WHERE "caseId"=$1 AND status='INVOICED') AS tl_invoiced,
       (SELECT COUNT(*) FROM "BacklogTicketLine" WHERE "caseId"=$1 AND status='UNMATCHED') AS tl_unmatched,
       (SELECT COUNT(*) FROM "BacklogTicketLine" WHERE "caseId"=$1 AND status='MESSAGE_LINKED') AS tl_msg_linked,
       (SELECT COUNT(*) FROM "BacklogOrderThread" WHERE "caseId"=$1) AS threads,
       (SELECT COUNT(*) FROM "BacklogInvoiceLine" WHERE "caseId"=$1) AS inv_total,
       (SELECT COUNT(*) FROM "BacklogInvoiceLine" il LEFT JOIN "BacklogInvoiceMatch" bim ON bim."invoiceLineId"=il.id
         WHERE il."caseId"=$1 AND bim.id IS NULL) AS inv_unmatched,
       (SELECT COALESCE(SUM(amount),0) FROM "BacklogInvoiceLine" WHERE "caseId"=$1) AS inv_total_value,
       (SELECT COALESCE(SUM(amount),0) FROM "BacklogInvoiceLine" il JOIN "BacklogInvoiceMatch" bim ON bim."invoiceLineId"=il.id
         WHERE il."caseId"=$1) AS inv_matched_value,
       (SELECT COALESCE(SUM(amount),0) FROM "BacklogInvoiceLine" il LEFT JOIN "BacklogInvoiceMatch" bim ON bim."invoiceLineId"=il.id
         WHERE il."caseId"=$1 AND bim.id IS NULL) AS inv_unmatched_value`,
    [CASE_ID],
  )).rows[0];

  console.log("=== FINAL COUNTS ===");
  for (const [k, v] of Object.entries(stats)) console.log(`  ${k.padEnd(22)} ${v}`);

  // Top 30 newly captured orders (Recovery Pass notes)
  const tops = (await client.query(
    `SELECT tl.date, tl.sender, tl."requestedQty", tl."requestedUnit",
            tl."normalizedProduct", tl."orderThreadId", ot.label
     FROM "BacklogTicketLine" tl
     LEFT JOIN "BacklogOrderThread" ot ON ot.id=tl."orderThreadId"
     WHERE tl."caseId"=$1 AND tl.notes LIKE 'Recovery Pass%'
     ORDER BY tl.date ASC
     LIMIT 30`,
    [CASE_ID],
  )).rows;

  console.log("\n=== TOP 30 NEWLY CAPTURED (Recovery Pass) ===");
  for (const r of tops) {
    const d = new Date(r.date).toISOString().slice(0, 10);
    console.log(`  [${d}] ${r.sender.padEnd(18)} qty=${r.requestedQty}${r.requestedUnit.padEnd(5)} ${r.normalizedProduct.slice(0, 55).padEnd(55)} thr=${(r.orderThreadId||"").slice(0,8)}`);
  }

  // Count by task
  const byTask = (await client.query(
    `SELECT
       SUM(CASE WHEN notes LIKE '%Task 1%' THEN 1 ELSE 0 END) AS task1,
       SUM(CASE WHEN notes LIKE '%Task 2%' THEN 1 ELSE 0 END) AS task2,
       SUM(CASE WHEN notes LIKE '%Task 3%' THEN 1 ELSE 0 END) AS task3
     FROM "BacklogTicketLine"
     WHERE "caseId"=$1 AND notes LIKE 'Recovery Pass%'`,
    [CASE_ID],
  )).rows[0];
  console.log("\n=== RECOVERY PASS TLs BY TASK ===");
  console.log(byTask);

  // Threads created by recovery pass
  const recoverThreads = (await client.query(
    `SELECT COUNT(*) AS n FROM "BacklogOrderThread" WHERE "caseId"=$1 AND label LIKE '[Recovery]%'`,
    [CASE_ID],
  )).rows[0];
  console.log(`Recovery threads: ${recoverThreads.n}`);

  // Invoice match counts by method
  const methods = (await client.query(
    `SELECT bim."matchMethod", COUNT(*) AS n
     FROM "BacklogInvoiceMatch" bim
     JOIN "BacklogInvoiceLine" il ON il.id=bim."invoiceLineId"
     WHERE il."caseId"=$1
     GROUP BY bim."matchMethod"
     ORDER BY n DESC`,
    [CASE_ID],
  )).rows;
  console.log("\n=== INVOICE MATCHES BY METHOD ===");
  for (const m of methods) console.log(`  ${(m.matchMethod||"NULL").padEnd(22)} ${m.n}`);

  await client.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
