// Reconnaissance for surgical recovery pass — READ ONLY
// Dumps full rawText of all source messages referenced in the recovery task,
// plus existing ticket-line counts per affected thread.

const { Client } = require("pg");

const CASE_ID = "58ebd22e-1101-4d56-a672-7cf635be9339";
const CONN =
  "postgres://postgres:postgres@localhost:51214/cromwell_os?sslmode=disable";

// Messages we need to re-read
const TASK1_MSG_IDS = {
  "08ab6ac4": "be599813", // AQUAFLOW 40MM WASTE — Adrian 2025-01-11
  "a9c2cabb": "4fe518b2", // MSTR28 RUBBER LINED — Adrian 2025-01-03
  "932025ac": "16105344", // STANDARD D SHAPE — Adrian 2025-01-09
  "d96a352c": "b21bdec4", // REGINOX ST STEEL — Catalyn 2025-02-10
};

const TASK2_MSG_IDS = [
  "16105cd4-3ffe-4aaa-b15c-bf456443b5f3",
  "dae01271-c6ce-4d76-b895-6bd2e2fbf31b",
  "e06df122-8e3e-4450-a7a1-56b31710ed2c",
  "6981fdbe-61f3-4965-b37e-67ff78701f25",
  "b4733f5f-dacb-43c6-b942-90f8fbd581f2",
  "46595b66-cde6-4dc8-a2d7-5a308dff377f",
  "227677d5-63e7-4741-8f91-94ab064e25fe",
  "afb8b165-6023-4ff4-8cdc-d1749f2aee42",
];

async function main() {
  const client = new Client({ connectionString: CONN });
  await client.connect();

  console.log("=== STATE ===");
  const stats = await client.query(
    `SELECT
       (SELECT COUNT(*) FROM "BacklogTicketLine" WHERE "caseId"=$1) AS tl_total,
       (SELECT COUNT(*) FROM "BacklogTicketLine" WHERE "caseId"=$1 AND status='INVOICED') AS tl_invoiced,
       (SELECT COUNT(*) FROM "BacklogTicketLine" WHERE "caseId"=$1 AND status='UNMATCHED') AS tl_unmatched,
       (SELECT COUNT(*) FROM "BacklogTicketLine" WHERE "caseId"=$1 AND status='MESSAGE_LINKED') AS tl_msg_linked,
       (SELECT COUNT(*) FROM "BacklogInvoiceLine" WHERE "caseId"=$1) AS inv_total,
       (SELECT COUNT(*) FROM "BacklogInvoiceLine" il
         LEFT JOIN "BacklogInvoiceMatch" bim ON bim."invoiceLineId"=il.id
         WHERE il."caseId"=$1 AND bim.id IS NULL) AS inv_unmatched,
       (SELECT COUNT(*) FROM "BacklogOrderThread" WHERE "caseId"=$1) AS threads`,
    [CASE_ID],
  );
  console.log(stats.rows[0]);

  console.log("\n=== TASK 1: MEGA-THREAD SOURCE MESSAGES ===");
  for (const [threadPrefix, msgPrefix] of Object.entries(TASK1_MSG_IDS)) {
    const t = await client.query(
      `SELECT id, label, array_length("messageIds", 1) as msg_count
       FROM "BacklogOrderThread" WHERE "caseId"=$1 AND id LIKE $2`,
      [CASE_ID, threadPrefix + "%"],
    );
    const m = await client.query(
      `SELECT id, sender, "parsedTimestamp", "rawText", "hasMedia"
       FROM "BacklogMessage" WHERE id LIKE $1`,
      [msgPrefix + "%"],
    );
    console.log("\n--- Thread", threadPrefix, "---");
    if (t.rows[0]) console.log("  Thread:", t.rows[0].id, "|", t.rows[0].label, "| msgs:", t.rows[0].msg_count);
    if (m.rows[0]) {
      const row = m.rows[0];
      console.log("  Msg ID:", row.id);
      console.log("  Sender:", row.sender, "| Time:", row.parsedTimestamp);
      console.log("  Raw text (full):");
      console.log("----BEGIN----");
      console.log(row.rawText);
      console.log("----END----");

      // Count existing ticket lines already tied to this message
      const tl = await client.query(
        `SELECT id, "requestedQty", "requestedUnit", "normalizedProduct", status
         FROM "BacklogTicketLine"
         WHERE "caseId"=$1 AND "sourceMessageId"=$2
         ORDER BY "createdAt"`,
        [CASE_ID, row.id],
      );
      console.log(`  Existing TLs on this msg: ${tl.rows.length}`);
      for (const r of tl.rows) {
        console.log(`    [${r.status}] qty=${r.requestedQty}${r.requestedUnit} ${r.normalizedProduct}`);
      }
    } else {
      console.log("  NO MESSAGE FOUND for prefix", msgPrefix);
    }
  }

  console.log("\n\n=== TASK 2: NEW-THREAD SOURCE MESSAGES ===");
  for (const msgId of TASK2_MSG_IDS) {
    const m = await client.query(
      `SELECT id, sender, "parsedTimestamp", "rawText", "hasMedia"
       FROM "BacklogMessage" WHERE id=$1`,
      [msgId],
    );
    if (!m.rows[0]) {
      console.log("\n--- MSG", msgId, "NOT FOUND ---");
      continue;
    }
    const row = m.rows[0];
    console.log(`\n--- ${row.sender} @ ${row.parsedTimestamp} [${row.id}] ---`);
    console.log("----BEGIN----");
    console.log(row.rawText);
    console.log("----END----");
    const tl = await client.query(
      `SELECT id, "requestedQty", "requestedUnit", "normalizedProduct", status, "orderThreadId"
       FROM "BacklogTicketLine"
       WHERE "caseId"=$1 AND "sourceMessageId"=$2`,
      [CASE_ID, row.id],
    );
    console.log(`  Existing TLs: ${tl.rows.length}`);
    for (const r of tl.rows) {
      console.log(`    [${r.status}] thr=${(r.orderThreadId||"").slice(0,8)} qty=${r.requestedQty}${r.requestedUnit} ${r.normalizedProduct}`);
    }
    // Check if message is already in any thread
    const th = await client.query(
      `SELECT id, label FROM "BacklogOrderThread"
       WHERE "caseId"=$1 AND $2 = ANY("messageIds")`,
      [CASE_ID, row.id],
    );
    if (th.rows.length) {
      for (const t of th.rows) console.log(`  ALREADY in thread ${t.id.slice(0,8)} "${t.label}"`);
    }
  }

  await client.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
