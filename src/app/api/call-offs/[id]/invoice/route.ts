/**
 * Invoice the shipped portion (or back-order remainder) of an existing CallOff.
 *
 * Body: {
 *   lines: Array<{ callOffLineId: string; qty: number }>;
 *   invoiceStatus?: "DRAFT" | "ISSUED";  // default DRAFT
 *   issuedAt?: string;                   // ISO date; defaults to now
 *   notes?: string;
 * }
 *
 * Per line:
 *   - qty must be > 0 and ≤ (requestedQty − invoicedQty) on that CallOffLine.
 *   - unit price is locked to CallOffLine.agreedUnitPrice.
 *
 * Side effects (one transaction):
 *   - 1 SalesInvoice (linked to the CallOff)
 *   - 1 SalesInvoiceLine + MaterialsDrawdownEntry + CustomerPOAllocation per line
 *   - CallOffLine.invoicedQty += qty
 *   - CallOff.status recomputed (PARTIALLY_INVOICED / COMPLETED)
 *   - CustomerPOLine consumed/remaining decremented
 *   - CustomerPO poConsumedValue / poRemainingValue updated
 */
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { STANDARD_VAT_RATE, lineVat, recomputeInvoiceTotals } from "@/lib/finance/invoice-totals";

type InputLine = { callOffLineId: string; qty: number };
type Body = {
  lines?: unknown;
  invoiceStatus?: unknown;
  issuedAt?: unknown;
  notes?: unknown;
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: callOffId } = await params;
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const inputLines: InputLine[] = Array.isArray(body.lines)
    ? body.lines.flatMap((l) => {
        if (!l || typeof l !== "object") return [];
        const ll = l as Record<string, unknown>;
        if (typeof ll.callOffLineId !== "string") return [];
        const qty = Number(ll.qty);
        if (!Number.isFinite(qty) || qty <= 0) return [];
        return [{ callOffLineId: ll.callOffLineId, qty }];
      })
    : [];
  if (inputLines.length === 0)
    return Response.json({ error: "lines is required and must be non-empty" }, { status: 400 });

  const invoiceStatus =
    typeof body.invoiceStatus === "string" && (body.invoiceStatus === "ISSUED" || body.invoiceStatus === "DRAFT")
      ? body.invoiceStatus
      : "DRAFT";
  const issuedAt =
    typeof body.issuedAt === "string" && body.issuedAt.length > 0 ? new Date(body.issuedAt) : new Date();
  const notes = typeof body.notes === "string" ? body.notes : null;

  const callOff = await prisma.callOff.findUnique({
    where: { id: callOffId },
    include: {
      lines: { include: { customerPOLine: true } },
      customerPO: { select: { id: true, customerId: true, siteId: true, siteCommercialLinkId: true, poNo: true, poConsumedValue: true, poLimitValue: true, overheadPct: true, ticketId: true } },
    },
  });
  if (!callOff) return Response.json({ error: "CallOff not found" }, { status: 404 });
  if (callOff.status === "COMPLETED" || callOff.status === "CANCELLED")
    return Response.json({ error: `CallOff is ${callOff.status} — cannot invoice further` }, { status: 422 });

  // Sum delivered qty per ticketLine from DNs scoped to this call-off.
  // Invoiceable qty per line is (delivered − already invoiced); never (requested − invoiced).
  const dnLines = await prisma.deliveryNoteLine.findMany({
    where: { deliveryNote: { callOffId: callOff.id } },
    select: { ticketLineId: true, qtyDelivered: true },
  });
  const deliveredByTLine = new Map<string, number>();
  for (const dl of dnLines) {
    deliveredByTLine.set(
      dl.ticketLineId,
      (deliveredByTLine.get(dl.ticketLineId) ?? 0) + Number(dl.qtyDelivered)
    );
  }

  const linesById = new Map(callOff.lines.map((l) => [l.id, l]));
  type Resolved = {
    callOffLineId: string;
    poLineId: string;
    ticketLineId: string;
    description: string;
    qty: number;
    unitPrice: number;
    sellValue: number;
  };
  const resolved: Resolved[] = [];
  const overQty: Array<{
    callOffLineId: string;
    description: string;
    requested: number;
    delivered: number;
    invoiced: number;
    invoiceable: number;
    requestedQty: number;
  }> = [];

  for (const il of inputLines) {
    const col = linesById.get(il.callOffLineId);
    if (!col) {
      return Response.json(
        { error: `callOffLineId not on this CallOff: ${il.callOffLineId}` },
        { status: 400 }
      );
    }
    const requested = Number(col.requestedQty);
    const alreadyInvoiced = Number(col.invoicedQty);
    const delivered = deliveredByTLine.get(col.ticketLineId) ?? 0;
    const invoiceable = Math.max(0, delivered - alreadyInvoiced);
    if (il.qty > invoiceable + 1e-6) {
      overQty.push({
        callOffLineId: il.callOffLineId,
        description: col.description,
        requested,
        delivered,
        invoiced: alreadyInvoiced,
        invoiceable,
        requestedQty: requested,
      });
      continue;
    }
    const unitPrice = Number(col.agreedUnitPrice ?? col.customerPOLine.agreedUnitPrice ?? 0);
    const sellValue = Number((il.qty * unitPrice).toFixed(2));
    resolved.push({
      callOffLineId: col.id,
      poLineId: col.customerPOLineId,
      ticketLineId: col.ticketLineId,
      description: col.description,
      qty: il.qty,
      unitPrice,
      sellValue,
    });
  }

  if (overQty.length > 0) {
    return Response.json(
      {
        error: "Some lines exceed invoiceable qty (delivered − already invoiced). Record a DN first.",
        overQty,
      },
      { status: 422 }
    );
  }

  const totalSell = Number(resolved.reduce((s, r) => s + r.sellValue, 0).toFixed(2));
  const po = callOff.customerPO;
  const consumed = Number(po.poConsumedValue ?? 0);
  const poLimit = Number(po.poLimitValue ?? 0);
  const wouldBeConsumed = Number((consumed + totalSell).toFixed(2));
  if (poLimit > 0 && wouldBeConsumed > poLimit + 1e-6) {
    return Response.json(
      {
        error: "Invoice would exceed PO limit",
        poLimit,
        consumedBefore: consumed,
        thisInvoice: totalSell,
        wouldBeConsumed,
        overBy: Number((wouldBeConsumed - poLimit).toFixed(2)),
      },
      { status: 422 }
    );
  }

  const overheadPct = Number(po.overheadPct ?? 0);
  const invoiceNo = `INV-${Date.now()}`;
  const dueDate = new Date(issuedAt.getTime() + 30 * 24 * 60 * 60 * 1000);

  const created = await prisma.$transaction(async (tx) => {
    const invoice = await tx.salesInvoice.create({
      data: {
        ticketId: po.ticketId!,
        invoiceNo,
        customerId: po.customerId,
        siteId: po.siteId,
        siteCommercialLinkId: po.siteCommercialLinkId ?? undefined,
        poNo: po.poNo,
        callOffId: callOff.id,
        invoiceType: "STANDARD",
        status: invoiceStatus,
        issuedAt,
        dueDate,
        totalSell: new Prisma.Decimal(totalSell),
        notes: [notes, `Back-order ship for call-off #${callOff.callOffNo}`].filter(Boolean).join("\n"),
      },
      select: { id: true, invoiceNo: true },
    });

    let lineSeq = 0;
    for (const r of resolved) {
      lineSeq++;
      await tx.salesInvoiceLine.create({
        data: {
          salesInvoiceId: invoice.id,
          ticketLineId: r.ticketLineId,
          description: r.description,
          qty: new Prisma.Decimal(r.qty),
          unitPrice: new Prisma.Decimal(r.unitPrice),
          lineTotal: new Prisma.Decimal(r.sellValue),
          vatRate: STANDARD_VAT_RATE,
          vatAmount: new Prisma.Decimal(lineVat(r.sellValue)),
          displayMode: "LINE",
          displayOrder: lineSeq,
          poMatched: true,
          poMatchStatus: "MATCHED",
        },
      });

      const overheadValue = Number((r.sellValue * (overheadPct / 100)).toFixed(2));
      await tx.materialsDrawdownEntry.create({
        data: {
          customerPOId: po.id,
          ticketId: po.ticketId!,
          ticketLineId: r.ticketLineId,
          drawdownDate: issuedAt,
          description: r.description,
          qty: new Prisma.Decimal(r.qty),
          unitSell: new Prisma.Decimal(r.unitPrice),
          sellValue: new Prisma.Decimal(r.sellValue),
          overheadPct: overheadPct ? new Prisma.Decimal(overheadPct) : undefined,
          overheadValue: overheadPct ? new Prisma.Decimal(overheadValue) : undefined,
          status: "LOGGED",
        },
      });

      await tx.customerPOAllocation.create({
        data: {
          customerPOId: po.id,
          ticketLineId: r.ticketLineId,
          salesInvoiceId: invoice.id,
          allocatedValue: new Prisma.Decimal(r.sellValue),
          status: "ALLOCATED",
        },
      });

      // Bump CallOffLine.invoicedQty
      await tx.callOffLine.update({
        where: { id: r.callOffLineId },
        data: { invoicedQty: { increment: new Prisma.Decimal(r.qty) } },
      });

      // Decrement CustomerPOLine remaining
      const pl = (linesById.get(r.callOffLineId)!).customerPOLine;
      const lineQty = Number(pl.qty ?? 0);
      const lineAgreedTotal = Number(pl.agreedTotal ?? 0);
      const newConsumedQty = Number(pl.consumedQty ?? 0) + r.qty;
      const newConsumedValue = Number(pl.consumedValue ?? 0) + r.sellValue;
      await tx.customerPOLine.update({
        where: { id: pl.id },
        data: {
          consumedQty: new Prisma.Decimal(newConsumedQty),
          consumedValue: new Prisma.Decimal(Number(newConsumedValue.toFixed(2))),
          remainingQty: new Prisma.Decimal(Math.max(0, lineQty - newConsumedQty)),
          remainingValue: new Prisma.Decimal(Math.max(0, lineAgreedTotal - newConsumedValue)),
        },
      });
    }

    await tx.customerPO.update({
      where: { id: po.id },
      data: {
        poConsumedValue: new Prisma.Decimal(wouldBeConsumed),
        poRemainingValue: new Prisma.Decimal(Number((poLimit - wouldBeConsumed).toFixed(2))),
      },
    });

    // CallOff.status reflects delivery progress, not invoicing.
    // Invoicing is tracked via CallOffLine.invoicedQty; status is updated by the DN route.
    await recomputeInvoiceTotals(tx, invoice.id);

    return { invoice };
  });

  return Response.json({
    ok: true,
    invoiceId: created.invoice.id,
    invoiceNo: created.invoice.invoiceNo,
    callOffStatus: callOff.status,
    totalSell,
    linesCreated: resolved.length,
    poConsumedAfter: wouldBeConsumed,
    poRemainingAfter: Number((poLimit - wouldBeConsumed).toFixed(2)),
  });
}
