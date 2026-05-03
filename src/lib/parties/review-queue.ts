/**
 * Park unresolved Customer / Supplier names for human triage.
 *
 * Replaces silent auto-create of Customer / Supplier records. Idempotent on
 * (queueType, rawValue) — re-firing for the same unknown name updates the
 * description rather than producing duplicates.
 */

import { prisma } from "@/lib/prisma";

type EnqueueArgs = {
  party: "SUPPLIER" | "CUSTOMER";
  rawValue: string;
  description: string;
  entityType?: string;
  entityId?: string;
  siteId?: string;
};

export async function enqueueUnresolvedParty(args: EnqueueArgs): Promise<string> {
  const queueType = args.party === "SUPPLIER" ? "UNRESOLVED_SUPPLIER" : "UNRESOLVED_CUSTOMER";

  const existing = await prisma.reviewQueueItem.findFirst({
    where: { queueType, rawValue: args.rawValue, status: { in: ["OPEN_REVIEW", "IN_PROGRESS_REVIEW"] } },
  });

  if (existing) {
    if (existing.description !== args.description || existing.entityId !== args.entityId) {
      await prisma.reviewQueueItem.update({
        where: { id: existing.id },
        data: {
          description: args.description,
          entityType: args.entityType ?? existing.entityType,
          entityId: args.entityId ?? existing.entityId,
          siteId: args.siteId ?? existing.siteId,
        },
      });
    }
    return existing.id;
  }

  const created = await prisma.reviewQueueItem.create({
    data: {
      queueType,
      status: "OPEN_REVIEW",
      rawValue: args.rawValue,
      description: args.description,
      entityType: args.entityType,
      entityId: args.entityId,
      siteId: args.siteId,
    },
  });

  return created.id;
}
