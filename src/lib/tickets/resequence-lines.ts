import { prisma } from "@/lib/prisma";

/**
 * Re-numbers `displayOrder` on every line of a ticket so each section is
 * a single contiguous block. Within a section, current order is preserved.
 * Section order is preserved by the smallest existing displayOrder in that
 * section. Lines with `sectionLabel = NULL` are kept where they are
 * (treated as a section keyed by `null`).
 *
 * Call this after any operation that adds, moves, or re-tags a section so
 * the renderer never prints duplicate section headers.
 */
export async function resequenceLines(ticketId: string): Promise<void> {
  const lines = await prisma.ticketLine.findMany({
    where: { ticketId },
    select: { id: true, sectionLabel: true, displayOrder: true, createdAt: true },
    orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });
  if (lines.length === 0) return;

  // Group by sectionLabel preserving first-seen order.
  const sectionOrder: Array<string | null> = [];
  const seen = new Set<string>();
  for (const l of lines) {
    const key = l.sectionLabel ?? "__NULL__";
    if (!seen.has(key)) {
      seen.add(key);
      sectionOrder.push(l.sectionLabel);
    }
  }

  let order = 1;
  const updates: Array<{ id: string; displayOrder: number }> = [];
  for (const section of sectionOrder) {
    for (const l of lines) {
      if ((l.sectionLabel ?? null) !== (section ?? null)) continue;
      if (l.displayOrder !== order) {
        updates.push({ id: l.id, displayOrder: order });
      }
      order++;
    }
  }

  if (updates.length === 0) return;
  await prisma.$transaction(
    updates.map((u) =>
      prisma.ticketLine.update({
        where: { id: u.id },
        data: { displayOrder: u.displayOrder },
      })
    )
  );
}
