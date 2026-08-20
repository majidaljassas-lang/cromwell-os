/**
 * Record a debt-recovery amount against a customer's debt tracker.
 *
 * Used when an invoice's sale price has been uplifted to recover an assumed
 * third-party ("dead account") debt. The uplift stays baked into the client
 * invoice (invisible to the customer); this writes the internal-only record
 * that reduces the tracker's remaining balance.
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type Body = {
  trackerId?: string;
  salesInvoiceId?: string | null;
  amount?: number | string;
  paidAt?: string | null;
  note?: string | null;
};

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: customerId } = await params;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const trackerId = body.trackerId?.trim() ?? "";
  const amount = Number(body.amount);

  if (!trackerId) return NextResponse.json({ error: "trackerId required" }, { status: 400 });
  if (!Number.isFinite(amount) || amount <= 0)
    return NextResponse.json({ error: "amount must be a positive number" }, { status: 400 });

  // Tracker must belong to this customer.
  const tracker = await prisma.customerDebtTracker.findFirst({
    where: { id: trackerId, customerId },
    select: { id: true },
  });
  if (!tracker) return NextResponse.json({ error: "tracker not found for customer" }, { status: 404 });

  // If an invoice is given, it must exist (kept as a soft link — no FK).
  let salesInvoiceId: string | null = body.salesInvoiceId?.trim() || null;
  if (salesInvoiceId) {
    const inv = await prisma.salesInvoice.findUnique({
      where: { id: salesInvoiceId },
      select: { id: true },
    });
    if (!inv) return NextResponse.json({ error: "salesInvoiceId not found" }, { status: 404 });
  }

  const repayment = await prisma.customerDebtRepayment.create({
    data: {
      trackerId,
      amount,
      salesInvoiceId,
      paidAt: body.paidAt ? new Date(body.paidAt) : new Date(),
      note: body.note?.trim() || null,
    },
    select: { id: true, amount: true, paidAt: true },
  });

  return NextResponse.json({ ok: true, repayment });
}
