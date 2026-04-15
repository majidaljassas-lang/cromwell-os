import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

function banner(s) {
  console.log("\n" + "=".repeat(78) + "\n" + s + "\n" + "=".repeat(78));
}

async function main() {
  banner("Backfill execution — TicketLine, OrderGroup, OrderEvent");

  const tlUpdated = await prisma.$executeRaw`
    UPDATE "TicketLine" tl
    SET "siteId" = t."siteId"
    FROM "Ticket" t
    WHERE tl."ticketId" = t.id
      AND tl."siteId" IS NULL
      AND t."siteId" IS NOT NULL
  `;
  console.log(`Step 2 — TicketLine.siteId ← Ticket.siteId : ${tlUpdated} row(s) updated`);

  const ogUpdated = await prisma.$executeRaw`
    UPDATE "OrderGroup" og
    SET "customerId" = sub."customerId"
    FROM (
      SELECT DISTINCT ON (scl."siteId") scl."siteId", scl."customerId"
      FROM "SiteCommercialLink" scl
      WHERE scl."isActive" = true
        AND scl."defaultBillingCustomer" = true
        AND scl."billingAllowed" = true
    ) sub
    WHERE og."siteId" = sub."siteId"
      AND og."customerId" IS NULL
  `;
  console.log(`Step 3 — OrderGroup.customerId ← default billing link : ${ogUpdated} row(s) updated`);

  const oeUpdated = await prisma.$executeRaw`
    UPDATE "OrderEvent" oe
    SET "customerId" = og."customerId"
    FROM "OrderGroup" og
    WHERE oe."orderGroupId" = og.id
      AND oe."customerId" IS NULL
      AND og."customerId" IS NOT NULL
  `;
  console.log(`Step 4 — OrderEvent.customerId ← OrderGroup.customerId : ${oeUpdated} row(s) updated`);

  banner("Post-backfill null audit");

  const checks = [
    ["TicketLine.siteId NULL",        `SELECT count(*)::int AS n FROM "TicketLine" WHERE "siteId" IS NULL`],
    ["  └─ with parent Ticket.siteId NOT NULL", `SELECT count(*)::int AS n FROM "TicketLine" tl JOIN "Ticket" t ON t.id = tl."ticketId" WHERE tl."siteId" IS NULL AND t."siteId" IS NOT NULL`],
    ["  └─ with parent Ticket.siteId NULL (quote-phase, allowed)", `SELECT count(*)::int AS n FROM "TicketLine" tl JOIN "Ticket" t ON t.id = tl."ticketId" WHERE tl."siteId" IS NULL AND t."siteId" IS NULL`],
    ["Ticket.siteId NULL (quote-phase OK)",        `SELECT count(*)::int AS n FROM "Ticket" WHERE "siteId" IS NULL`],
    ["  └─ status NOT QUOTED",        `SELECT count(*)::int AS n FROM "Ticket" WHERE "siteId" IS NULL AND status::text <> 'QUOTED'`],
    ["OrderGroup.customerId NULL",    `SELECT count(*)::int AS n FROM "OrderGroup" WHERE "customerId" IS NULL`],
    ["OrderEvent.customerId NULL",    `SELECT count(*)::int AS n FROM "OrderEvent" WHERE "customerId" IS NULL`],
    ["Quote.siteId NULL (allowed)",   `SELECT count(*)::int AS n FROM "Quote" WHERE "siteId" IS NULL`],
    ["CustomerPO.siteId NULL",        `SELECT count(*)::int AS n FROM "CustomerPO" WHERE "siteId" IS NULL`],
    ["SalesInvoice.siteId NULL",      `SELECT count(*)::int AS n FROM "SalesInvoice" WHERE "siteId" IS NULL`],
    ["SupplierBillLine.siteId NULL",  `SELECT count(*)::int AS n FROM "SupplierBillLine" WHERE "siteId" IS NULL`],
    ["SupplierBillLine.customerId NULL", `SELECT count(*)::int AS n FROM "SupplierBillLine" WHERE "customerId" IS NULL`],
    ["BacklogCase.customerId NULL",   `SELECT count(*)::int AS n FROM "BacklogCase" WHERE "customerId" IS NULL`],
    ["InquiryWorkItem.siteId NULL",   `SELECT count(*)::int AS n FROM "InquiryWorkItem" WHERE "siteId" IS NULL`],
  ];

  const pad = (s, n) => String(s).padEnd(n);
  console.log(pad("Check", 62), "NULL");
  console.log("-".repeat(72));
  for (const [label, sql] of checks) {
    const [row] = await prisma.$queryRawUnsafe(sql);
    console.log(pad(label, 62), row.n);
  }

  banner("Status of the 7 Ticket.siteId NULL — confirm all still in QUOTED/pre-activity");
  const tstatus = await prisma.$queryRaw`
    SELECT status::text AS status, count(*)::int AS n
    FROM "Ticket" WHERE "siteId" IS NULL GROUP BY status::text ORDER BY n DESC
  `;
  for (const r of tstatus) console.log(`  ${r.status.padEnd(20)} ${r.n}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
