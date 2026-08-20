#!/usr/bin/env node
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("🔍 Looking up NHS PO data...\n");

  // Find St George's customer
  const customer = await prisma.customer.findFirst({
    where: { name: { contains: "George", mode: "insensitive" } },
    select: { id: true, name: true },
  });

  if (!customer) {
    console.log("❌ St George's customer not found");
    process.exit(1);
  }
  console.log("✓ Customer:", customer);

  // Find sites for this customer
  const sites = await prisma.site.findMany({
    where: {
      siteCommercialLinks: {
        some: { customerId: customer.id, isActive: true },
      },
    },
    select: { id: true, siteName: true },
  });
  console.log("✓ Sites:", sites);

  // Look for quotes by the quote numbers from the PO (corrected)
  const quoteRefs = [
    "Q-1786013172116",
    "Q-1786014520373",
    "Q-1786016745764",
  ];

  console.log("\n🔍 Searching for quotes...\n");
  const foundTicketIds = new Set();

  for (const ref of quoteRefs) {
    const quote = await prisma.quote.findFirst({
      where: { quoteNo: ref },
      include: { ticket: { select: { id: true, title: true } } },
    });

    if (quote) {
      console.log(`✓ Found ${ref}`);
      console.log(`  Ticket ID: ${quote.ticketId}`);
      console.log(`  Ticket: ${quote.ticket?.title}\n`);
      foundTicketIds.add(quote.ticketId);
    } else {
      console.log(`✗ Quote not found: ${ref}\n`);
    }
  }

  if (foundTicketIds.size === 0) {
    console.log("❌ No quotes found. Listing recent tickets for this customer:\n");
    const tickets = await prisma.ticket.findMany({
      where: { payingCustomerId: customer.id },
      select: { id: true, title: true },
      orderBy: { createdAt: "desc" },
      take: 10,
    });
    tickets.forEach((t) => console.log(`  ${t.id} — ${t.title}`));
    process.exit(1);
  }

  // Summary
  console.log("=" + "=".repeat(70));
  console.log("\n📋 READY TO UPLOAD NHS PO 352190583\n");
  console.log(`Customer ID:   ${customer.id}`);
  console.log(`Site ID:       ${sites[0]?.id || "UNKNOWN"}`);
  console.log(`Ticket IDs:    ${Array.from(foundTicketIds).join(", ")}`);
  console.log("\n" + "=" + "=".repeat(70));
  console.log("\nUse this payload for /api/customer-pos/upload-confirm:\n");

  const payload = {
    customerId: customer.id,
    ticketIds: Array.from(foundTicketIds),
    siteId: sites[0]?.id,
    poNo: "352190583",
    poDate: "2026-08-07",
    issuedBy: "INGRID R.J MARTINS",
    fileRef: "/po-uploads/nhs-352190583.pdf",
    fileName: "NHS_PO_352190583.pdf",
    lines: [
      {
        qty: 10,
        productCode: "B4449Aa",
        description: "Sandringham Kitchen Mixer",
        unitPrice: 125.0,
        lineTotal: 1250.0,
      },
      {
        qty: 1,
        productCode: "A/KB50HF",
        description: "2-inch-high flow KB Aylesbury Float Type valve",
        unitPrice: 2291.76,
        lineTotal: 2291.76,
      },
      {
        qty: 100,
        productCode: "",
        description: "15mm x 3M Copper Tube to EN1057",
        unitPrice: 12.0,
        lineTotal: 1200.0,
      },
    ],
  };

  console.log(JSON.stringify(payload, null, 2));
}

main()
  .catch(console.error)
  .finally(() => {
    pool.end();
    process.exit(0);
  });
