#!/usr/bin/env node
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const tickets = await prisma.ticket.findMany({
    where: {
      OR: [
        { title: { contains: "Park Hill", mode: "insensitive" } },
        { site: { siteName: { contains: "Park Hill", mode: "insensitive" } } },
        { site: { addressLine1: { contains: "Park Hill", mode: "insensitive" } } },
        { site: { addressLine2: { contains: "Park Hill", mode: "insensitive" } } },
      ],
    },
    select: {
      id: true,
      ticketNo: true,
      title: true,
      status: true,
      site: { select: { siteName: true, addressLine1: true, addressLine2: true, postcode: true } },
      _count: { select: { lines: true } },
    },
  });
  console.log(JSON.stringify(tickets, null, 2));
}
main().finally(() => prisma.$disconnect());
