import { PrismaClient } from "@/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  pool: Pool | undefined;
  poolDead: boolean;
};

function getPool() {
  if (!globalForPrisma.pool || globalForPrisma.poolDead) {
    // Kill old pool if it exists
    if (globalForPrisma.pool) {
      globalForPrisma.pool.end().catch(() => {});
    }

    globalForPrisma.poolDead = false;
    globalForPrisma.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
      idleTimeoutMillis: 5000,
      connectionTimeoutMillis: 10000,
      allowExitOnIdle: true,
    });

    // Handle pool errors gracefully — mark as dead so next request recreates
    globalForPrisma.pool.on("error", () => {
      globalForPrisma.poolDead = true;
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

// Use a getter so it auto-recreates after connection loss
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    if (!globalForPrisma.prisma || globalForPrisma.poolDead) {
      globalForPrisma.prisma = createPrismaClient();
    }
    return (globalForPrisma.prisma as any)[prop];
  },
});
