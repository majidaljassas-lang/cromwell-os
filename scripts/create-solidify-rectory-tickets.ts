import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const CUSTOMER_ID = "ceeae63f-000e-4e60-a330-0a8548aa84d9"; // Solidify
const SITE_ID = "49f9ba66-3e03-4f9c-aba1-4e160eb2a1b9";     // The Rectory, Glebe Lane, Worting
const SCL_ID = "9800d4c3-89f4-4422-af1e-7d6143e253fd";
const SUPPLIER_ID = "e26f3a0b-8f16-4913-af62-a8107904f5ec"; // Travis Perkins
const TRACKER_ID = "dtrk-solidify-0001";

// Travis Perkins invoice 1047193799, dated 10/07/2026. Document order preserved.
const TP_LINES = [
  { code: "328898", desc: "Paslode handy pack 90x3.1mm smooth HDGV 141267", qty: 1,  unit: "PACK", cost: 52.50 },
  { code: "760145", desc: "British Gypsum Gyproc Fireline SE 2400 x 1200 x 12.5mm 01919/7", qty: 70, unit: "EA", cost: 14.17 },
  { code: "760084", desc: "British Gypsum Gyproc Wallboard 2400 x 1200 x 12.5mm TE 01129/0", qty: 12, unit: "EA", cost: 8.80 },
  { code: "848612", desc: "Knauf Acoustic Roll (ready cut) 50mm 13.50m 2x600 16.2m2 per pack", qty: 7, unit: "PACK", cost: 48.00 },
  { code: "848743", desc: "British Gypsum Thistle Multi-Finish 25kg 06058/8", qty: 10, unit: "EA", cost: 9.25 },
  { code: "670588", desc: "Structural hardwood plywood EN636-2 EN314-2 CL2 EN12871 2440x1220x18mm FSC", qty: 3, unit: "EA", cost: 25.00 },
  { code: "976197", desc: "Kronobuild standard MDF 2440 x 1220 x 25mm FSC", qty: 4, unit: "EA", cost: 32.00 },
] as const;

const r2 = (n: number) => Math.round(n * 100) / 100;

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  const result = await prisma.$transaction(async (tx) => {
    // ---- Ticket A: materials procured from Travis Perkins ----
    const matTicket = await tx.ticket.create({
      data: {
        payingCustomerId: CUSTOMER_ID,
        siteId: SITE_ID,
        siteCommercialLinkId: SCL_ID,
        title: "The Rectory - Travis Perkins materials",
        description: "Materials procured by Cromwell Plumbing on Travis Perkins account EP6370 for Solidify. TP invoice 1047193799 dated 10/07/2026, delivery note F01280, delivered 10/07/2026 to The Rectory, Glebe Lane, Worting RG23 8QA.",
        ticketMode: "DIRECT_ORDER",
        status: "COSTED",
        source: "MANUAL",
        sourceRef: "TP invoice 1047193799",
        deliveredAt: new Date("2026-07-10"),
      },
    });

    for (const [i, l] of TP_LINES.entries()) {
      const total = r2(l.qty * l.cost);
      await tx.ticketLine.create({
        data: {
          ticketId: matTicket.id,
          displayOrder: i + 1,
          lineType: "MATERIAL",
          description: l.desc,
          productCode: l.code,
          qty: l.qty,
          unit: l.unit as never,
          payingCustomerId: CUSTOMER_ID,
          siteId: SITE_ID,
          siteCommercialLinkId: SCL_ID,
          supplierId: SUPPLIER_ID,
          supplierName: "Travis Perkins",
          supplierReference: "1047193799",
          expectedCostUnit: l.cost,
          expectedCostTotal: total,
          actualCostTotal: total,
          status: "FULLY_COSTED",
        },
      });
    }

    // ---- Ticket B: account ----
    const acctTicket = await tx.ticket.create({
      data: {
        payingCustomerId: CUSTOMER_ID,
        siteId: SITE_ID,
        siteCommercialLinkId: SCL_ID,
        title: "Solidify - Account",
        ticketMode: "DIRECT_ORDER",
        status: "INVOICED",
        source: "MANUAL",
      },
    });

    const acctLine = await tx.ticketLine.create({
      data: {
        ticketId: acctTicket.id,
        displayOrder: 1,
        lineType: "MATERIAL",
        description: "Payment on account",
        qty: 1,
        unit: "EA",
        payingCustomerId: CUSTOMER_ID,
        siteId: SITE_ID,
        siteCommercialLinkId: SCL_ID,
        actualSaleUnit: 500,
        actualSaleTotal: 500,
        status: "PRICED",
      },
    });

    const invoiceNo = `INV-${Date.now()}`;
    const invoice = await tx.salesInvoice.create({
      data: {
        ticketId: acctTicket.id,
        invoiceNo,
        customerId: CUSTOMER_ID,
        siteId: SITE_ID,
        siteCommercialLinkId: SCL_ID,
        invoiceType: "STANDARD",
        status: "DRAFT",
        issuedAt: new Date("2026-07-17"),
        dueDate: new Date("2026-08-16"),
        totalSell: 500,
        totalNet: 500,
        totalVat: 100,
        totalGross: 600,
        lines: {
          create: [{
            ticketLineId: acctLine.id,
            description: "Payment on account",
            qty: 1,
            unitPrice: 500,
            lineTotal: 500,
            vatRate: 20,
            vatAmount: 100,
            displayMode: "LINE",
            displayOrder: 1,
          }],
        },
      },
      include: { lines: true },
    });

    // ---- Recovery against the assumed debt account (internal only, gross) ----
    const repayment = await tx.customerDebtRepayment.create({
      data: {
        trackerId: TRACKER_ID,
        paidAt: new Date("2026-07-17"),
        amount: 600,
        salesInvoiceId: invoice.id,
        note: `Balance 6000.00 -> 5400.00. Invoice issued to Solidify against this payment.`,
      },
    });

    return { matTicket, acctTicket, invoice, repayment };
  });

  console.log("Materials ticket:", result.matTicket.ticketNo, result.matTicket.id);
  console.log("Account ticket:  ", result.acctTicket.ticketNo, result.acctTicket.id);
  console.log("Invoice:         ", result.invoice.invoiceNo, `net ${result.invoice.totalNet} vat ${result.invoice.totalVat} gross ${result.invoice.totalGross}`, result.invoice.status);
  console.log("Repayment:       ", result.repayment.id, `gross ${result.repayment.amount}`);

  await prisma.$disconnect();
  await pool.end();
}
main();
