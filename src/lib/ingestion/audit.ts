/**
 * Ingestion Audit Logger
 *
 * Every suggestion, override, delete, reversal, or state change
 * affecting ingested data gets an immutable audit record.
 */

import { prisma } from "@/lib/prisma";

export async function logAudit(params: {
  objectType: string;
  objectId: string;
  actionType: string;
  actor?: string;
  previousValue?: unknown;
  newValue?: unknown;
  reason?: string;
}) {
  return prisma.ingestionAuditLog.create({
    data: {
      objectType: params.objectType,
      objectId: params.objectId,
      actionType: params.actionType,
      actor: params.actor ?? "SYSTEM",
      previousValueJson: params.previousValue ? JSON.parse(JSON.stringify(params.previousValue)) : undefined,
      newValueJson: params.newValue ? JSON.parse(JSON.stringify(params.newValue)) : undefined,
      reason: params.reason,
    },
  });
}
