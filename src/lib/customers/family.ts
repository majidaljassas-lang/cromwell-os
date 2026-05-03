/**
 * Resolve the corporate "family" of a customer — root + every descendant.
 *
 * Used by entity-swap features (sales-invoice change-entity, supplier bill
 * line change-customer) so the picker is scoped to siblings under the same
 * bucket, not the whole customer table.
 */

import { prisma } from "@/lib/prisma";
import type { Prisma, PrismaClient } from "@/generated/prisma";

type Tx = Prisma.TransactionClient | PrismaClient;

export type FamilyMember = { id: string; name: string; isCurrent: boolean; isRoot: boolean };

export async function collectFamilyMembers(
  customerId: string,
  tx: Tx = prisma,
): Promise<FamilyMember[]> {
  // Walk up to root.
  let cur = await tx.customer.findUnique({
    where: { id: customerId },
    select: { id: true, parentCustomerEntityId: true },
  });
  if (!cur) return [];

  const visited = new Set<string>([cur.id]);
  while (cur.parentCustomerEntityId && !visited.has(cur.parentCustomerEntityId)) {
    visited.add(cur.parentCustomerEntityId);
    cur = await tx.customer.findUnique({
      where: { id: cur.parentCustomerEntityId },
      select: { id: true, parentCustomerEntityId: true },
    });
    if (!cur) break;
  }
  if (!cur) return [];
  const rootId = cur.id;

  // BFS descendants from root.
  const ids = new Set<string>([rootId]);
  const queue: string[] = [rootId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const children = await tx.customer.findMany({
      where: { parentCustomerEntityId: id },
      select: { id: true },
    });
    for (const c of children) {
      if (!ids.has(c.id)) {
        ids.add(c.id);
        queue.push(c.id);
      }
    }
  }

  const rows = await tx.customer.findMany({
    where: { id: { in: Array.from(ids) } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    isCurrent: r.id === customerId,
    isRoot: r.id === rootId,
  }));
}
