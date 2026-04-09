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

function getPrisma(): PrismaClient {
  if (!globalForPrisma.prisma || globalForPrisma.poolDead) {
    globalForPrisma.prisma = createPrismaClient();
  }
  return globalForPrisma.prisma;
}

// Export a typed getter that auto-reconnects
export const prisma = new Proxy(createPrismaClient(), {
  get(_target, prop, receiver) {
    const client = getPrisma();
    const value = Reflect.get(client, prop, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
