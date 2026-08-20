import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
const t = await prisma.ticket.findUnique({
  where: { id: '07d0db56-0bf9-491a-9d73-9c8e40b04a37' },
  include: { lines: { include: { prices: true }, orderBy: { displayOrder: 'asc' } } }
})
console.log(JSON.stringify(t, null, 2))
await prisma.$disconnect()
