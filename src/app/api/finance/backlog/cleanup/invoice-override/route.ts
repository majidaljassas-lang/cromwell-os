/**
 * Per-invoice OS Customer override.
 *
 * Body: { invoiceIds: string[], customerId: string | null, reason?: string }
 *  - customerId !== null → moves those invoices to that OS Customer in
 *    unified views (override wins over the Zoho-customer-level link).
 *  - customerId === null → clears the override; invoice falls back to the
 *    Zoho-customer link.
 *
 * Underlying Zoho payload is never modified.
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { invoiceIds, customerId, reason, overrideBy } = body ?? {};
    if (!Array.isArray(invoiceIds) || invoiceIds.length === 0) {
      return NextResponse.json({ error: "invoiceIds required" }, { status: 400 });
    }
    if (customerId !== null && (typeof customerId !== "string" || !customerId)) {
      return NextResponse.json(
        { error: "customerId must be a string or null" },
        { status: 400 }
      );
    }
    if (customerId) {
      const c = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true } });
      if (!c) return NextResponse.json({ error: "Customer not found" }, { status: 400 });
    }
    const result = await prisma.zohoImportedInvoice.updateMany({
      where: { id: { in: invoiceIds } },
      data: {
        overrideCustomerId: customerId,
        overrideAt: customerId ? new Date() : null,
        overrideBy: customerId ? overrideBy ?? null : null,
        overrideReason: customerId ? reason ?? null : null,
      },
    });
    return NextResponse.json({ ok: true, updated: result.count });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Override failed" },
      { status: 500 }
    );
  }
}
