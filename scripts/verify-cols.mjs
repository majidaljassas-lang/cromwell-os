import { PrismaClient } from "../src/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg"; import { config } from "dotenv"; config({ path: ".env" });
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
const rows = await prisma.$queryRaw`
  SELECT column_name, data_type, is_nullable FROM information_schema.columns
  WHERE table_name = 'InboxThread' AND column_name IN ('linkConfidence','linkSource','linkedTicketId')
  ORDER BY column_name
`;
for (const r of rows) console.log(`  ${r.column_name.padEnd(18)} ${r.data_type.padEnd(20)} nullable=${r.is_nullable}`);
await prisma.$disconnect(); await pool.end();
