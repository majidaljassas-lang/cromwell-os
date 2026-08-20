/**
 * GET  → list Sites the line's current customer has a SiteCommercialLink to.
 *        If no customer set, return all active sites unscoped.
 * POST → set SupplierBillLine.siteId and propagate to BillLineAllocation.siteId
 *        rows that have no site set yet.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; lineId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { lineId } = await ctx.params;

  const line = await prisma.supplierBillLine.findUnique({
    where: { id: lineId },
    select: { siteId: true, customerId: true },
  });
  if (!line) return NextResponse.json({ error: "line not found" }, { status: 404 });

  if (!line.customerId) {
    const sites = await prisma.site.findMany({
      where: { isActive: true },
      orderBy: { siteName: "asc" },
      select: { id: true, siteName: true },
    });
    return NextResponse.json({
      scoped: false,
      members: sites.map((s) => ({ id: s.id, name: s.siteName, isCurrent: s.id === line.siteId })),
    });
  }

  const links = await prisma.siteCommercialLink.findMany({
    where: { customerId: line.customerId, isActive: true },
    select: { site: { select: { id: true, siteName: true } } },
    orderBy: { site: { siteName: "asc" } },
  });
  const seen = new Set<string>();
  const members = links
    .map((l) => l.site)
    .filter((s) => {
      if (seen.has(s.id)) return false;
      seen.add(s.id);
      return true;
    })
    .map((s) => ({ id: s.id, name: s.siteName, isCurrent: s.id === line.siteId }));

  return NextResponse.json({ scoped: true, members });
}

export async function POST(req: Request, ctx: Ctx) {
  const { id: billId, lineId } = await ctx.params;

  let body: { siteId?: string; reason?: string };
  try {
    body = (await req.json()) as { siteId?: string; reason?: string };
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const targetSiteId = body.siteId?.trim();
  if (!targetSiteId) return NextResponse.json({ error: "siteId required" }, { status: 400 });

  const line = await prisma.supplierBillLine.findUnique({
    where: { id: lineId },
    select: { id: true, supplierBillId: true, customerId: true, siteId: true },
  });
  if (!line) return NextResponse.json({ error: "line not found" }, { status: 404 });
  if (line.supplierBillId !== billId) {
    return NextResponse.json({ error: "line does not belong to this bill" }, { status: 400 });
  }

  if (line.customerId) {
    const link = await prisma.siteCommercialLink.findFirst({
      where: { customerId: line.customerId, siteId: targetSiteId, isActive: true },
      select: { id: true },
    });
    if (!link) {
      return NextResponse.json(
        { error: "site is not commercially linked to the line's customer" },
        { status: 400 },
      );
    }
  } else {
    const site = await prisma.site.findUnique({ where: { id: targetSiteId }, select: { id: true } });
    if (!site) return NextResponse.json({ error: "site not found" }, { status: 404 });
  }

  const previousSiteId = line.siteId;

  await prisma.$transaction(async (tx) => {
    await tx.supplierBillLine.update({
      where: { id: lineId },
      data: { siteId: targetSiteId, updatedAt: new Date() },
    });
    await tx.billLineAllocation.updateMany({
      where: { supplierBillLineId: lineId, siteId: null },
      data: { siteId: targetSiteId },
    });
    await tx.ingestionAuditLog.create({
      data: {
        objectType: "SupplierBillLine",
        objectId: lineId,
        actionType: "SITE_REALLOCATED",
        actor: "USER",
        previousValueJson: { siteId: previousSiteId },
        newValueJson: { siteId: targetSiteId },
        reason: body.reason ?? null,
      },
    });
  });

  return NextResponse.json({ ok: true, lineId, previousSiteId, siteId: targetSiteId });
}
