/**
 * POST /api/ticket-lines/:id/copy-to-matching
 *
 * Copies ALL data from this line (code, supplier, cost, sale) to every
 * matching line on the same ticket (matched by description, case-insensitive).
 */

import { prisma } from "@/lib/prisma";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const source = await prisma.ticketLine.findUnique({
    where: { id },
    select: {
      ticketId: true, description: true, productCode: true,
      supplierName: true, supplierId: true,
      expectedCostUnit: true, actualSaleUnit: true,
      isBomParent: true,
      components: { select: { description: true, qty: true, unit: true, expectedCostUnit: true, supplierName: true } },
    },
  });

  if (!source) return Response.json({ error: "Line not found" }, { status: 404 });

  const normalDesc = source.description.trim().toLowerCase();

  // Find all matching lines on the same ticket
  const siblings = await prisma.ticketLine.findMany({
    where: { ticketId: source.ticketId, id: { not: id } },
    select: { id: true, description: true, qty: true, productCode: true, isBomParent: true },
  });

  // Strip SKU prefix for fuzzy matching (e.g. "BSW0290T Crosswater..." → "Crosswater...")
  const BRANDS = ["Geberit","Crosswater","VADO","Saneux","Coalbrook","D-Neo","Scudo","Merlyn","TrayMate","Level25","Ellis","Kensington"];
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

  let updated = 0;
  for (const sib of matching) {
    const qty = Number(sib.qty);
    const cost = Number(source.expectedCostUnit || 0);
    const sale = Number(source.actualSaleUnit || 0);

    await prisma.ticketLine.update({
      where: { id: sib.id },
      data: {
        productCode: source.productCode,
        supplierName: source.supplierName,
        supplierId: source.supplierId,
        expectedCostUnit: cost || undefined,
        expectedCostTotal: cost ? Math.round(cost * qty * 100) / 100 : undefined,
        actualSaleUnit: sale || undefined,
        actualSaleTotal: sale ? Math.round(sale * qty * 100) / 100 : undefined,
      },
    });

    // Copy BOM if source has one and sibling doesn't
    if (source.isBomParent && source.components.length > 0 && !sib.isBomParent) {
      try {
        await fetch(`http://localhost:3000/api/ticket-lines/${sib.id}/bom`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            components: source.components.map(c => ({
              description: c.description,
              qty: Number(c.qty),
              unit: c.unit || "EA",
              expectedCostUnit: Number(c.expectedCostUnit || 0),
              supplierName: c.supplierName || undefined,
            })),
          }),
        });
      } catch {}
    }

    updated++;
  }

  return Response.json({ ok: true, updated, description: source.description });
}
