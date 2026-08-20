import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
const ts = await prisma.ticket.findMany({
  where: { title: { contains: 'Delabie', mode: 'insensitive' } },
  select: { id: true, ticketNo: true, title: true, status: true, ticketMode: true, createdAt: true,
    payingCustomerId: true, siteId: true, _count: { select: { lines: true, phases: true } } }
})
console.log(JSON.stringify(ts, null, 2))
await prisma.$disconnect()
