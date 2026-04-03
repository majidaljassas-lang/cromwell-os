import { PrismaClient } from "@/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  pool: Pool | undefined;
};

function getPool() {
  if (!globalForPrisma.pool) {
    globalForPrisma.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 20,
      idleTimeoutMillis: 60000,
      connectionTimeoutMillis: 10000,
    });

    // Handle pool errors gracefully — recreate on connection loss
    globalForPrisma.pool.on("error", () => {
      globalForPrisma.pool = undefined;
      globalForPrisma.prisma = undefined;
    });
  }
  return globalForPrisma.pool;
}

function createPrismaClient() {
  const pool = getPool();
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
