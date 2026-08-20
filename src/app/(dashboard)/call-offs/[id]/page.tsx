import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { prisma } from "@/lib/prisma";
import { CallOffDetail } from "@/components/call-offs/call-off-detail";

export const dynamic = "force-dynamic";

export default async function CallOffPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const callOff = await prisma.callOff.findUnique({
    where: { id },
    include: {
      customerPO: { select: { id: true, poNo: true, poLimitValue: true, poRemainingValue: true } },
      ticket: { select: { id: true, ticketNo: true, title: true } },
      lines: {
        orderBy: { displayOrder: "asc" },
        select: {
          id: true,
          description: true,
          requestedQty: true,
          invoicedQty: true,
          agreedUnitPrice: true,
          displayOrder: true,
        },
      },
      invoices: {
        orderBy: { createdAt: "asc" },
        select: { id: true, invoiceNo: true, status: true, totalSell: true, issuedAt: true },
      },
    },
  });
  if (!callOff) notFound();

  // Per-PO call-off sequence (CO1 = first call-off raised against this PO).
  // Display-only; the stored callOffNo remains a global unique counter.
  const coSeq = await prisma.callOff.count({
    where: { customerPOId: callOff.customerPO.id, callOffNo: { lte: callOff.callOffNo } },
  });

  // Sum delivered qty per ticketLine from DNs scoped to this call-off.
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

  const callOffLineMeta = await prisma.callOffLine.findMany({
    where: { callOffId: callOff.id },
    select: { id: true, ticketLineId: true },
  });
  const tLineByCallOffLine = new Map(callOffLineMeta.map((m) => [m.id, m.ticketLineId]));

  const lines = callOff.lines.map((l) => {
    const requested = Number(l.requestedQty);
    const invoiced = Number(l.invoicedQty);
    const unitPrice = Number(l.agreedUnitPrice ?? 0);
    const tlineId = tLineByCallOffLine.get(l.id);
    const delivered = tlineId ? (deliveredByTLine.get(tlineId) ?? 0) : 0;
    return {
      id: l.id,
      description: l.description,
      requestedQty: requested,
      deliveredQty: delivered,
      invoicedQty: invoiced,
      // Open back-order = what's still owed to deliver
      backorderQty: Math.max(0, requested - delivered),
      // Invoiceable now = delivered but not yet invoiced
      invoiceableQty: Math.max(0, delivered - invoiced),
      unitPrice,
      displayOrder: l.displayOrder,
    };
  });

  const totals = lines.reduce(
    (acc, l) => {
      acc.requested += l.requestedQty * l.unitPrice;
      acc.delivered += l.deliveredQty * l.unitPrice;
      acc.invoiced += l.invoicedQty * l.unitPrice;
      acc.backorder += l.backorderQty * l.unitPrice;
      acc.invoiceable += l.invoiceableQty * l.unitPrice;
      return acc;
    },
    { requested: 0, delivered: 0, invoiced: 0, backorder: 0, invoiceable: 0 }
  );

  return (
    <div className="p-4 space-y-4 max-w-5xl">
      <div className="flex items-center gap-2">
        <Link href={`/po-register?highlight=${callOff.customerPO.id}`}>
          <Button variant="ghost" size="sm">
            <ArrowLeft className="size-4 mr-1" /> Back to PO
          </Button>
        </Link>
        <h1 className="text-lg font-medium">Call-off CO{coSeq}</h1>
        <span className="text-xs px-2 py-0.5 rounded border bg-muted">{callOff.status}</span>
        <div className="ml-auto">
          <Link href={`/tickets/${callOff.ticket.id}?tab=procurement&openDn=${callOff.id}`}>
            <Button size="sm" variant="outline">Create Delivery Note</Button>
          </Link>
        </div>
      </div>

      <div className="rounded border p-3 text-xs grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-1">
        <div>
          <span className="text-muted-foreground">PO: </span>
          <Link href={`/po-register?highlight=${callOff.customerPO.id}`} className="underline">
            {callOff.customerPO.poNo}
          </Link>
        </div>
        <div>
          <span className="text-muted-foreground">Ticket: </span>
          <Link href={`/tickets/${callOff.ticket.id}`} className="underline">
            CP-{String(callOff.ticket.ticketNo).padStart(4, "0")}
          </Link>
        </div>
        <div>
          <span className="text-muted-foreground">Date: </span>
          {new Date(callOff.callOffDate).toLocaleDateString("en-GB")}
        </div>
        <div>
          <span className="text-muted-foreground">Source: </span>
          {callOff.source ?? "—"}
        </div>
        <div>
          <span className="text-muted-foreground">Requested £: </span>
          <strong>£{totals.requested.toFixed(2)}</strong>
        </div>
        <div>
          <span className="text-muted-foreground">Delivered £: </span>
          <strong>£{totals.delivered.toFixed(2)}</strong>
        </div>
        <div>
          <span className="text-muted-foreground">Invoiced £: </span>
          <strong>£{totals.invoiced.toFixed(2)}</strong>
        </div>
        <div>
          <span className="text-muted-foreground">Open back-order £: </span>
          <strong className={totals.backorder > 0 ? "text-[#FF9900]" : undefined}>
            £{totals.backorder.toFixed(2)}
          </strong>
        </div>
        <div>
          <span className="text-muted-foreground">Invoiceable now £: </span>
          <strong className={totals.invoiceable > 0 ? "text-[#00CC66]" : undefined}>
            £{totals.invoiceable.toFixed(2)}
          </strong>
        </div>
        <div>
          <span className="text-muted-foreground">PO remaining: </span>
          £{Number(callOff.customerPO.poRemainingValue ?? 0).toFixed(2)}
        </div>
      </div>

      <CallOffDetail
        callOffId={callOff.id}
        status={callOff.status}
        lines={lines}
        invoices={callOff.invoices.map((i) => ({
          id: i.id,
          invoiceNo: i.invoiceNo,
          status: i.status,
          totalSell: Number(i.totalSell),
          issuedAt: i.issuedAt ? i.issuedAt.toISOString() : null,
        }))}
      />
    </div>
  );
}
