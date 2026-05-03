/**
 * GET  → list family members the line can be reallocated to (for picker).
 * POST → re-allocate the SupplierBillLine to a different customer in the
 *        same family. If the line has no current customer, any existing
 *        Customer is allowed (initial allocation). Otherwise the target
 *        must be in the same corporate tree.
 *
 * Side-effects on POST:
 *   - SupplierBillLine.customerId       → new
 *   - BillLineAllocation.customerId     → new (for every allocation row on this line)
 *   - IngestionAuditLog row              → audit
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { collectFamilyMembers } from "@/lib/customers/family";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; lineId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { lineId } = await ctx.params;

  const line = await prisma.supplierBillLine.findUnique({
    where: { id: lineId },
    select: { customerId: true },
  });
  if (!line) return NextResponse.json({ error: "line not found" }, { status: 404 });

  if (!line.customerId) {
    // No current customer — initial allocation. Return all customers so user
    // can pick. Tag the picker as "unscoped".
    const customers = await prisma.customer.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
    return NextResponse.json({
      scoped: false,
      members: customers.map((c) => ({ id: c.id, name: c.name, isCurrent: false, isRoot: false })),
    });
  }

  const members = await collectFamilyMembers(line.customerId);
  return NextResponse.json({ scoped: true, members });
}

export async function POST(req: Request, ctx: Ctx) {
  const { id: billId, lineId } = await ctx.params;

  let body: { customerId?: string; reason?: string };
  try {
    body = (await req.json()) as { customerId?: string; reason?: string };
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const targetCustomerId = body.customerId?.trim();
  if (!targetCustomerId) return NextResponse.json({ error: "customerId required" }, { status: 400 });

  const line = await prisma.supplierBillLine.findUnique({
    where: { id: lineId },
    select: { id: true, supplierBillId: true, customerId: true },
  });
  if (!line) return NextResponse.json({ error: "line not found" }, { status: 404 });
  if (line.supplierBillId !== billId) {
    return NextResponse.json({ error: "line does not belong to this bill" }, { status: 400 });
  }

  // Family scope check: only enforce when there's already a customer.
  if (line.customerId) {
    const family = await collectFamilyMembers(line.customerId);
    if (!family.some((m) => m.id === targetCustomerId)) {
      return NextResponse.json(
        { error: "target is not in the same corporate family as the current customer" },
        { status: 400 },
      );
    }
  } else {
    // No current customer; just verify target exists.
    const target = await prisma.customer.findUnique({
      where: { id: targetCustomerId },
      select: { id: true },
    });
    if (!target) return NextResponse.json({ error: "target customer not found" }, { status: 404 });
  }

  const previousCustomerId = line.customerId;

  await prisma.$transaction(async (tx) => {
    await tx.supplierBillLine.update({
      where: { id: lineId },
      data: { customerId: targetCustomerId, updatedAt: new Date() },
    });
    await tx.billLineAllocation.updateMany({
      where: { supplierBillLineId: lineId },
      data: { customerId: targetCustomerId },
    });
    await tx.ingestionAuditLog.create({
      data: {
        objectType: "SupplierBillLine",
        objectId: lineId,
        actionType: "CUSTOMER_REALLOCATED",
        actor: "USER",
        previousValueJson: { customerId: previousCustomerId },
        newValueJson: { customerId: targetCustomerId },
        reason: body.reason ?? null,
      },
    });
  });

  return NextResponse.json({ ok: true, lineId, previousCustomerId, customerId: targetCustomerId });
}
