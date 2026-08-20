import { PrismaClient } from "@/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { ticketLineSyncExtension } from "@/lib/prisma-extensions/ticket-line-sync";

type ExtendedClient = ReturnType<typeof extend>;

const globalForPrisma = globalThis as unknown as {
  prisma: ExtendedClient | undefined;
  pool: Pool | undefined;
  poolDead: boolean;
};

function extend(base: PrismaClient) {
  return base.$extends(ticketLineSyncExtension);
}

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

function createPrismaClient(): ExtendedClient {
  const pool = getPool();
  const adapter = new PrismaPg(pool);
  return extend(new PrismaClient({ adapter }));
}

function getPrisma(): ExtendedClient {
  if (!globalForPrisma.prisma || globalForPrisma.poolDead) {
    globalForPrisma.prisma = createPrismaClient();
  }
  return globalForPrisma.prisma;
}

// Export a typed getter that auto-reconnects.
// Runtime: extended with ticketLineSyncExtension (auto-resync of DRAFT
// invoices/quotes on every TicketLine write).
// Compile-time: typed as plain PrismaClient so existing call sites that
// expect `PrismaClient` keep compiling — the extension only adds behavior,
// not new fields.
export const prisma = new Proxy(createPrismaClient() as object, {
  get(_target, prop, receiver) {
    const client = getPrisma();
    const value = Reflect.get(client as object, prop, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
}) as unknown as PrismaClient;
