import { Prisma } from "@/generated/prisma";
import { resyncTicketDownstream } from "@/lib/tickets/sync-downstream";

/**
 * Auto-resync downstream DRAFT artifacts (SalesInvoice, Quote) whenever
 * a TicketLine is created, updated, or deleted via Prisma.
 *
 * The extension runs the Prisma operation, then calls `resyncTicketDownstream`
 * for every affected ticketId. Failures inside the resync are logged but do
 * NOT roll back the original write — TicketLine truth is more important than
 * downstream consistency, and the next write will reconcile.
 *
 * Bypass: pass `{ __skipDownstreamSync: true }` inside `args` (untyped escape
 * hatch) — the resync engine itself uses this to avoid recursion.
 */
export const ticketLineSyncExtension = Prisma.defineExtension((client) => {
  const resync = async (ticketIds: Iterable<string>) => {
    for (const ticketId of new Set(ticketIds)) {
      if (!ticketId) continue;
      try {
        await resyncTicketDownstream(ticketId, client as never);
      } catch (err) {
        console.error("[ticket-line-sync] resync failed for ticket", ticketId, err);
      }
    }
  };

  const skip = (args: unknown): boolean =>
    typeof args === "object" && args !== null && (args as Record<string, unknown>).__skipDownstreamSync === true;

  return client.$extends({
    name: "ticket-line-sync",
    query: {
      ticketLine: {
        async create({ args, query }) {
          const result = await query(args);
          if (skip(args)) return result;
          await resync([(result as { ticketId: string }).ticketId]);
          return result;
        },
        async update({ args, query }) {
          const result = await query(args);
          if (skip(args)) return result;
          await resync([(result as { ticketId: string }).ticketId]);
          return result;
        },
        async upsert({ args, query }) {
          const result = await query(args);
          if (skip(args)) return result;
          await resync([(result as { ticketId: string }).ticketId]);
          return result;
        },
        async delete({ args, query }) {
          const before = await client.ticketLine.findUnique({
            where: args.where,
            select: { ticketId: true },
          });
          const result = await query(args);
          if (skip(args)) return result;
          if (before) await resync([before.ticketId]);
          return result;
        },
        async createMany({ args, query }) {
          const result = await query(args);
          if (skip(args)) return result;
          const data = Array.isArray(args.data) ? args.data : [args.data];
          await resync(data.map((d) => (d as { ticketId: string }).ticketId));
          return result;
        },
        async updateMany({ args, query }) {
          const affected = await client.ticketLine.findMany({
            where: args.where,
            select: { ticketId: true },
          });
          const result = await query(args);
          if (skip(args)) return result;
          await resync(affected.map((a) => a.ticketId));
          return result;
        },
        async deleteMany({ args, query }) {
          const affected = await client.ticketLine.findMany({
            where: args.where,
            select: { ticketId: true },
          });
          const result = await query(args);
          if (skip(args)) return result;
          await resync(affected.map((a) => a.ticketId));
          return result;
        },
      },
    },
  });
});
