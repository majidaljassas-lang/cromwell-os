#!/usr/bin/env node
import { PrismaClient } from "../src/generated/prisma/index.js";

const prisma = new PrismaClient();

async function main() {
  console.log("🔍 Looking for St George's customer...");
  const customer = await prisma.customer.findFirst({
    where: {
      name: { contains: "George", mode: "insensitive" },
    },
    select: { id: true, name: true },
  });

  if (!customer) {
    console.log("❌ St George's customer not found");
    process.exit(1);
  }

  console.log("✓ Found customer:", customer);

  const sites = await prisma.site.findMany({
    where: {
      siteCommercialLinks: {
        some: { customerId: customer.id },
      },
    },
    select: { id: true, siteName: true },
  });

  console.log("✓ Sites:", sites);

  // Find recent tickets with quotes
  const tickets = await prisma.ticket.findMany({
    where: { payingCustomerId: customer.id },
    select: {
      id: true,
      title: true,
      quotes: { select: { id: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  console.log("\nRecent tickets with quotes:");
  tickets.forEach((t) => {
    console.log(`  - ${t.title} (${t.id})`);
    t.quotes.forEach((q) => console.log(`      Quote: ${q.id}`));
  });

  // Look for quotes matching the PO's quote refs
  const quoteRefs = [
    "Q-1786016745764",
    "Q-1786014520373",
    "Q-1786013172211",
  ];
  console.log("\n🔍 Looking for quotes:", quoteRefs);

  for (const ref of quoteRefs) {
    const quote = await prisma.quote.findFirst({
      where: { quoteNo: ref },
      select: { id: true, quoteNo: true, ticketId: true },
    });
    if (quote) {
      console.log(`  ✓ Found ${ref} -> Ticket: ${quote.ticketId}`);
    } else {
      console.log(`  ✗ Not found: ${ref}`);
    }
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
