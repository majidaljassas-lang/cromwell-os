import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });
const t = await prisma.ticket.findFirst({ where: { id: { startsWith: "e7a810df" } } });
console.log(JSON.stringify(t, null, 2));
const evs = await prisma.evidenceFragment.findMany({
  where: { ticketId: t.id, fragmentType: "PO_RECEIVED" },
});
console.log("\nPO_RECEIVED evidence:", evs.length);
for (const e of evs) {
  console.log("  ", e.id.slice(0,8), "text:", e.fragmentText, "sourceRef:", e.sourceRef);
}
await prisma.$disconnect(); await pool.end();
