#!/usr/bin/env node
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  const ticketId = "f91fd704-6ca9-4fb7-a512-2b113d6a743b";
  const fragments = await prisma.evidenceFragment.findMany({
    where: { OR: [{ ticketId }, { ticketLine: { ticketId } }] },
    select: { id: true, fragmentType: true, fragmentText: true, attachmentUrl: true, timestamp: true },
    orderBy: { createdAt: "asc" },
  });
  console.log("Evidence count:", fragments.length);
  for (const f of fragments) console.log(JSON.stringify(f));

  // skip events lookup
}
main().finally(() => prisma.$disconnect());
