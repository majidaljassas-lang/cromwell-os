import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const results = [];

  async function count(label, model, where) {
    try {
      const total = await prisma[model].count();
      const nulls = await prisma[model].count({ where });
      results.push({ label, model, total, nulls, pct: total ? ((nulls / total) * 100).toFixed(1) + "%" : "—" });
    } catch (e) {
      results.push({ label, model, total: "ERR", nulls: e.message.split("\n")[0], pct: "—" });
    }
  }

  // Site: no customerId field at all (linked via SiteCommercialLink)
  try {
    const siteTotal = await prisma.site.count();
    const sitesWithNoLink = await prisma.site.count({
      where: { siteCommercialLinks: { none: {} } },
    });
    results.push({ label: "Site WITHOUT any SiteCommercialLink (orphaned sites)", model: "Site", total: siteTotal, nulls: sitesWithNoLink, pct: siteTotal ? ((sitesWithNoLink / siteTotal) * 100).toFixed(1) + "%" : "—" });
  } catch (e) {
    results.push({ label: "Site orphan check", model: "Site", total: "ERR", nulls: e.message.split("\n")[0], pct: "—" });
  }

  // Ticket — siteId nullable (rule: required once active)
  await count("Ticket.siteId NULL", "ticket", { siteId: null });

  // TicketLine — siteId nullable
  await count("TicketLine.siteId NULL", "ticketLine", { siteId: null });

  // Quote — siteId nullable (EXCEPTION — allowed)
  await count("Quote.siteId NULL (allowed — quote exception)", "quote", { siteId: null });

  // SupplierBillLine — both nullable
  await count("SupplierBillLine.siteId NULL", "supplierBillLine", { siteId: null });
  await count("SupplierBillLine.customerId NULL", "supplierBillLine", { customerId: null });
  await count("SupplierBillLine BOTH NULL", "supplierBillLine", { siteId: null, customerId: null });

  // CustomerPO — siteId nullable
  await count("CustomerPO.siteId NULL", "customerPO", { siteId: null });

  // SalesInvoice — siteId nullable
  await count("SalesInvoice.siteId NULL", "salesInvoice", { siteId: null });

  // OrderGroup — customerId nullable
  await count("OrderGroup.customerId NULL", "orderGroup", { customerId: null });

  // OrderEvent — customerId nullable
  await count("OrderEvent.customerId NULL", "orderEvent", { customerId: null });

  // CommercialInvoice — both nullable
  await count("CommercialInvoice.siteId NULL", "commercialInvoice", { siteId: null });
  await count("CommercialInvoice.customerId NULL", "commercialInvoice", { customerId: null });
  await count("CommercialInvoice BOTH NULL", "commercialInvoice", { siteId: null, customerId: null });

  // CommercialBill
  await count("CommercialBill.siteId NULL", "commercialBill", { siteId: null });

  // BillLineAllocation — both nullable
  await count("BillLineAllocation.siteId NULL", "billLineAllocation", { siteId: null });
  await count("BillLineAllocation.customerId NULL", "billLineAllocation", { customerId: null });

  // BacklogCase — both nullable
  await count("BacklogCase.siteId NULL", "backlogCase", { siteId: null });
  await count("BacklogCase.customerId NULL", "backlogCase", { customerId: null });

  // SiteContactLink — customerId nullable
  await count("SiteContactLink.customerId NULL", "siteContactLink", { customerId: null });

  // Enquiry suggested site/customer (line 384, 386) — suggestion fields, likely OK to be nullable
  await count("Enquiry suggested siteId NULL", "enquiry", { siteId: null });
  await count("Enquiry suggested customerId NULL", "enquiry", { customerId: null });

  // InquiryWorkItem (1484-1485)
  await count("InquiryWorkItem.siteId NULL", "inquiryWorkItem", { siteId: null });
  await count("InquiryWorkItem.customerId NULL", "inquiryWorkItem", { customerId: null });

  console.log("\n=== DATA IMPACT — NULL customerId / siteId counts ===\n");
  const pad = (s, n) => String(s).padEnd(n);
  console.log(pad("Check", 60), pad("Total", 8), pad("NULL", 8), "Pct");
  console.log("-".repeat(90));
  for (const r of results) {
    console.log(pad(r.label, 60), pad(r.total, 8), pad(r.nulls, 8), r.pct);
  }
  console.log();
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
