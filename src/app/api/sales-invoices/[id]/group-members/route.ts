/**
 * GET /api/sales-invoices/[id]/group-members
 *
 * List every customer in the same corporate group as the invoice's current
 * billing entity — used to populate the "Change Entity" dropdown.
 */
import { prisma } from "@/lib/prisma";
import type { Prisma, PrismaClient } from "@/generated/prisma";

type Tx = Prisma.TransactionClient | PrismaClient;

async function collectGroupMemberIds(tx: Tx, customerId: string): Promise<string[]> {
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
  if (!cur) return Array.from(visited);

  const ids = new Set<string>([cur.id]);
  const queue: string[] = [cur.id];
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
  return Array.from(ids);
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const inv = await prisma.salesInvoice.findUnique({
      where: { id },
      select: { customerId: true },
    });
    if (!inv) return Response.json({ error: "Invoice not found" }, { status: 404 });

    const ids = await collectGroupMemberIds(prisma, inv.customerId);
    const members = await prisma.customer.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, parentCustomerEntityId: true },
      orderBy: { name: "asc" },
    });

    return Response.json({
      currentCustomerId: inv.customerId,
      members: members.map((m) => ({
        id: m.id,
        name: m.name,
        isCurrent: m.id === inv.customerId,
        isRoot: m.parentCustomerEntityId === null,
      })),
    });
  } catch (e) {
    console.error("/api/sales-invoices/[id]/group-members failed:", e);
    return Response.json(
      { error: e instanceof Error ? e.message : "Failed" },
      { status: 500 }
    );
  }
}
