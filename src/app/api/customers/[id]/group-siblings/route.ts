/**
 * Returns the customer's group: parent (if any) + all descendants of that
 * parent. Used by the per-invoice override picker to show sibling LEs in
 * the same group (e.g. all GS8 / Luc subsidiaries under the GS8 parent)
 * for one-click switching.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const c = await prisma.customer.findUnique({
    where: { id },
    select: { id: true, name: true, parentCustomerEntityId: true },
  });
  if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Find the root: walk up until parentCustomerEntityId is null
  let rootId = c.parentCustomerEntityId ?? c.id;
  // Cap walk-up to avoid infinite loops
  for (let i = 0; i < 5; i++) {
    const r = await prisma.customer.findUnique({
      where: { id: rootId },
      select: { parentCustomerEntityId: true },
    });
    if (!r?.parentCustomerEntityId) break;
    rootId = r.parentCustomerEntityId;
  }

  // BFS down from root
  const acc: Array<{ id: string; name: string; entityType: string | null; isCurrent: boolean }> = [];
  const seen = new Set<string>();
  const queue: string[] = [rootId];
  while (queue.length > 0) {
    const next = queue.shift()!;
    if (seen.has(next)) continue;
    seen.add(next);
    const cur = await prisma.customer.findUnique({
      where: { id: next },
      select: {
        id: true,
        name: true,
        entityType: true,
        subsidiaries: { select: { id: true }, orderBy: { name: "asc" } },
      },
    });
    if (!cur) continue;
    acc.push({ id: cur.id, name: cur.name, entityType: cur.entityType, isCurrent: cur.id === id });
    for (const s of cur.subsidiaries) queue.push(s.id);
  }

  return NextResponse.json({
    rootId,
    members: acc,
  });
}
