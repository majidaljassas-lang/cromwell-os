#!/usr/bin/env node
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const t = await prisma.ticket.findFirst({
    where: { id: { startsWith: "145395c2" } },
    select: {
      id: true, ticketNo: true, title: true, siteId: true, payingCustomerId: true,
      ticketMode: true, status: true, scopeType: true, siteCommercialLinkId: true,
      payingCustomer: { select: { id: true, name: true } },
      site: { select: { id: true, siteName: true } },
      lines: { select: { id: true } },
      quotes: { select: { id: true, quoteNo: true, versionNo: true, status: true } },
    },
  });
  console.log("TICKET:", JSON.stringify(t, null, 2));

  if (!t) return;

  const sites = await prisma.site.findMany({
    where: {
      OR: [
        { siteName: { contains: "Haymarket", mode: "insensitive" } },
        { siteName: { contains: "054", mode: "insensitive" } },
      ],
    },
    select: {
      id: true, siteName: true, addressLine1: true, postcode: true,
      siteCommercialLinks: {
        where: { customerId: t.payingCustomerId },
        select: { id: true, role: true, billingAllowed: true, customerId: true, isActive: true },
      },
    },
  });
  console.log("HAYMARKET SITES:", JSON.stringify(sites, null, 2));
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); await pool.end(); });
