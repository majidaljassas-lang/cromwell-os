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
  // ==========================================================================
  // 1. TicketLines — inherit siteId from parent Ticket
  // ==========================================================================
  banner("1) TicketLine.siteId backfill via parent Ticket");

  const rows = await prisma.$queryRaw`
    SELECT tl.id, tl."ticketId", t."siteId" AS "ticketSiteId"
    FROM "TicketLine" tl
    LEFT JOIN "Ticket" t ON t.id = tl."ticketId"
    WHERE tl."siteId" IS NULL
  `;
  let resolvable = 0;
  let parentAlsoNull = 0;
  const parentNullTickets = new Set();
  for (const r of rows) {
    if (r.ticketSiteId) resolvable++;
    else { parentAlsoNull++; parentNullTickets.add(r.ticketId); }
  }

  console.log(`TicketLines with siteId NULL               : ${rows.length}`);
  console.log(`  → Resolvable (parent Ticket HAS siteId)  : ${resolvable}`);
  console.log(`  → Unresolvable (parent Ticket also null) : ${parentAlsoNull}`);
  console.log(`  → Distinct parent tickets that are null  : ${parentNullTickets.size}`);
  const nullTicketLines = rows;

  // ==========================================================================
  // 2. OrderGroups — backfill customerId via Site's default billing customer
  // ==========================================================================
  banner("2a) OrderGroup.customerId backfill via Site → SiteCommercialLink");

  const ogRaw = await prisma.$queryRaw`
    SELECT og.id, og.label, og."siteId", s."siteName"
    FROM "OrderGroup" og
    LEFT JOIN "Site" s ON s.id = og."siteId"
    WHERE og."customerId" IS NULL
  `;
  const linkRaw = await prisma.$queryRaw`
    SELECT scl."siteId", scl."customerId", scl.role, scl."billingAllowed", scl."defaultBillingCustomer", c.name AS "customerName"
    FROM "SiteCommercialLink" scl
    LEFT JOIN "Customer" c ON c.id = scl."customerId"
    WHERE scl."isActive" = true
  `;
  const linksBySite = new Map();
  for (const l of linkRaw) {
    if (!linksBySite.has(l.siteId)) linksBySite.set(l.siteId, []);
    linksBySite.get(l.siteId).push(l);
  }
  const nullOrderGroups = ogRaw.map((og) => ({
    id: og.id,
    label: og.label,
    site: { siteName: og.siteName, siteCommercialLinks: linksBySite.get(og.siteId) ?? [] },
  }));

  let ogResolvableDefault = 0;
  let ogResolvableSingle = 0;
  let ogAmbiguous = 0;
  let ogNoLink = 0;
  const ogDetails = [];
  for (const og of nullOrderGroups) {
    const links = og.site?.siteCommercialLinks ?? [];
    const defaultLink = links.find((l) => l.defaultBillingCustomer && l.billingAllowed);
    const billableLinks = links.filter((l) => l.billingAllowed);
    let resolution;
    if (defaultLink) {
      ogResolvableDefault++;
      resolution = `DEFAULT → ${defaultLink.customerName}`;
    } else if (billableLinks.length === 1) {
      ogResolvableSingle++;
      resolution = `SINGLE BILLABLE → ${billableLinks[0].customerName}`;
    } else if (billableLinks.length > 1) {
      ogAmbiguous++;
      resolution = `AMBIGUOUS (${billableLinks.length} billable links)`;
    } else if (links.length === 1) {
      ogResolvableSingle++;
      resolution = `SINGLE LINK (non-billable) → ${links[0].customerName}`;
    } else if (links.length > 1) {
      ogAmbiguous++;
      resolution = `AMBIGUOUS (${links.length} links, none billable)`;
    } else {
      ogNoLink++;
      resolution = "NO LINKS on site";
    }
    ogDetails.push({ id: og.id, label: og.label, site: og.site?.siteName, links: links.length, resolution });
  }

  console.log(`OrderGroups with customerId NULL            : ${nullOrderGroups.length}`);
  console.log(`  → Resolvable via default billing customer : ${ogResolvableDefault}`);
  console.log(`  → Resolvable via single billable link     : ${ogResolvableSingle}`);
  console.log(`  → Ambiguous (multiple candidates)         : ${ogAmbiguous}`);
  console.log(`  → No SiteCommercialLink on site           : ${ogNoLink}`);
  console.log("\nPer-record detail:");
  for (const d of ogDetails) {
    console.log(`  [${d.id.slice(0, 8)}] ${d.label} — site="${d.site}" links=${d.links} ⇒ ${d.resolution}`);
  }

  // ==========================================================================
  // 2b. OrderEvents — backfill customerId via parent OrderGroup (or site)
  // ==========================================================================
  banner("2b) OrderEvent.customerId backfill via parent OrderGroup");

  const oeRaw = await prisma.$queryRaw`
    SELECT oe.id, oe."orderGroupId", oe."siteId" AS "oeSiteId",
           og."customerId" AS "ogCustomerId", og."siteId" AS "ogSiteId"
    FROM "OrderEvent" oe
    LEFT JOIN "OrderGroup" og ON og.id = oe."orderGroupId"
    WHERE oe."customerId" IS NULL
  `;
  const nullOrderEvents = oeRaw.map((oe) => ({
    id: oe.id,
    orderGroup: {
      customerId: oe.ogCustomerId,
      site: { siteCommercialLinks: linksBySite.get(oe.ogSiteId) ?? [] },
    },
  }));

  let oeFromGroup = 0;
  let oeFromGroupSite = 0;
  let oeAmbiguous = 0;
  let oeNoData = 0;
  for (const oe of nullOrderEvents) {
    if (oe.orderGroup?.customerId) {
      oeFromGroup++;
    } else {
      const links = oe.orderGroup?.site?.siteCommercialLinks ?? [];
      const def = links.find((l) => l.defaultBillingCustomer && l.billingAllowed);
      const bill = links.filter((l) => l.billingAllowed);
      if (def || bill.length === 1 || links.length === 1) oeFromGroupSite++;
      else if (bill.length > 1 || links.length > 1) oeAmbiguous++;
      else oeNoData++;
    }
  }

  console.log(`OrderEvents with customerId NULL                        : ${nullOrderEvents.length}`);
  console.log(`  → Resolvable via parent OrderGroup.customerId (direct): ${oeFromGroup}`);
  console.log(`  → Resolvable via parent OrderGroup.site link          : ${oeFromGroupSite}`);
  console.log(`  → Ambiguous                                           : ${oeAmbiguous}`);
  console.log(`  → No data                                             : ${oeNoData}`);
  console.log("\nNote: after step 2a backfills OrderGroup.customerId, every null OrderEvent in those groups becomes resolvable via the direct path.");

  // ==========================================================================
  // 3. Tickets with null siteId — list for manual decision
  // ==========================================================================
  banner("3) Tickets with siteId NULL — MANUAL REVIEW required");

  const nullTickets = await prisma.$queryRaw`
    SELECT t.id, t.title, t.status::text AS status, t."ticketMode"::text AS "ticketMode",
           t."createdAt", t."payingCustomerId", c.name AS "customerName",
           (SELECT count(*)::int FROM "TicketLine" WHERE "ticketId" = t.id) AS "lineCount",
           (SELECT count(*)::int FROM "Quote" WHERE "ticketId" = t.id) AS "quoteCount",
           (SELECT count(*)::int FROM "SalesInvoice" WHERE "ticketId" = t.id) AS "invoiceCount",
           (SELECT count(*)::int FROM "CustomerPO" WHERE "ticketId" = t.id) AS "poCount"
    FROM "Ticket" t
    LEFT JOIN "Customer" c ON c.id = t."payingCustomerId"
    WHERE t."siteId" IS NULL
    ORDER BY t."createdAt" DESC
  `;

  console.log(`Total: ${nullTickets.length} tickets\n`);
  for (const t of nullTickets) {
    console.log(`[${t.id.slice(0, 8)}] ${String(t.status).padEnd(22)} mode=${String(t.ticketMode ?? "—").padEnd(10)} customer="${t.customerName ?? "—"}"`);
    console.log(`           title="${t.title}"`);
    console.log(`           createdAt=${new Date(t.createdAt).toISOString().slice(0, 10)}  lines=${t.lineCount}  quotes=${t.quoteCount}  invoices=${t.invoiceCount}  POs=${t.poCount}`);
    console.log();
  }

  banner("SUMMARY — what can run automatically vs what needs a decision");
  console.log(`AUTO-RESOLVABLE:`);
  console.log(`  TicketLine.siteId     : ${resolvable} of ${nullTicketLines.length} (inherit from parent Ticket)`);
  console.log(`  OrderGroup.customerId : ${ogResolvableDefault + ogResolvableSingle} of ${nullOrderGroups.length} (default billing customer or single link)`);
  console.log(`  OrderEvent.customerId : ${nullOrderEvents.length} of ${nullOrderEvents.length} (cascade after OrderGroup backfill)`);
  console.log(`\nNEEDS DECISION:`);
  console.log(`  Tickets with null siteId            : ${nullTickets.length}  (listed above)`);
  console.log(`  TicketLines whose parent is null    : ${parentAlsoNull}  (blocked until ${parentNullTickets.size} parent tickets are resolved)`);
  console.log(`  OrderGroups ambiguous               : ${ogAmbiguous}`);
  console.log(`  OrderGroups with no site links      : ${ogNoLink}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
