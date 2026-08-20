/**
 * POST /api/ticket-lines/:id/lock-group
 *
 * "I'm done with this line and everything linked to it."
 *
 * Locks this TicketLine plus every description-matching sibling on the same
 * ticket (same matching logic as copy-to-matching). Idempotent.
 *
 * Body:  {}            — lock the source + matching siblings
 *        { unlock: true } — unlock the same group
 */

import { prisma } from "@/lib/prisma";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const lock = body.unlock !== true;

  const source = await prisma.ticketLine.findUnique({
    where: { id },
    select: { ticketId: true, description: true, productCode: true },
  });
  if (!source) return Response.json({ error: "Line not found" }, { status: 404 });

  const siblings = await prisma.ticketLine.findMany({
    where: { ticketId: source.ticketId, id: { not: id } },
    select: { id: true, description: true, productCode: true },
  });

  // Same matcher as copy-to-matching — keep these in sync.
  const BRANDS = ["Geberit","Crosswater","VADO","Saneux","Coalbrook","D-Neo","Scudo","Merlyn","TrayMate","Level25","Ellis","Kensington","Grohe","Hansgrohe","RAK Ceramics","Nuie","McAlpine","Ideal Standard","Roca","Bristan","Xaviga","Volente","Lakes","WuduMate","KeyPlumb","Mira","Aqualisa","Triton"];
  function stripSku(desc: string): string {
    const t = desc.trim();
    for (const b of BRANDS) { if (t.toLowerCase().startsWith(b.toLowerCase())) return t; }
    for (const b of BRANDS) { const i = t.toLowerCase().indexOf(b.toLowerCase()); if (i > 0) return t.substring(i).trim(); }
    return t;
  }
  function normDesc(desc: string): string {
    return stripSku(desc).toLowerCase().replace(/\s+/g, " ").trim();
  }

  const srcNorm = normDesc(source.description);
  const matching = siblings.filter(s => {
    const sNorm = normDesc(s.description);
    if (srcNorm === sNorm) return true;
    if (srcNorm.length > 10 && sNorm.length > 10) {
      if (srcNorm.startsWith(sNorm) || sNorm.startsWith(srcNorm)) return true;
    }
    if (source.productCode && s.productCode && source.productCode.trim().toLowerCase() === s.productCode.trim().toLowerCase()) return true;
    return false;
  });

  const ids = [id, ...matching.map(m => m.id)];
  await prisma.ticketLine.updateMany({
    where: { id: { in: ids } },
    data: { isLocked: lock },
  });

  return Response.json({
    ok: true,
    action: lock ? "LOCKED" : "UNLOCKED",
    sourceId: id,
    description: source.description,
    affected: ids.length,
    siblingIds: matching.map(m => m.id),
  });
}
