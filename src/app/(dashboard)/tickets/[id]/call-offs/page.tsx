import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { prisma } from "@/lib/prisma";
import { CallOffsView } from "@/components/call-offs/call-offs-view";

export const dynamic = "force-dynamic";

export default async function CallOffsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ customerPoId?: string }>;
}) {
  const { id } = await params;
  const { customerPoId } = await searchParams;

  const ticket = await prisma.ticket.findUnique({
    where: { id },
    select: {
      id: true,
      ticketNo: true,
      title: true,
      status: true,
      payingCustomer: { select: { name: true } },
      site: {
        select: {
          siteName: true,
          addressLine1: true,
          addressLine2: true,
          city: true,
          postcode: true,
        },
      },
      customerPOs: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          poNo: true,
          totalValue: true,
          poLimitValue: true,
          lines: { select: { ticketLineId: true, qty: true } },
        },
      },
      lines: {
        orderBy: { displayOrder: "asc" },
        select: {
          id: true,
          displayOrder: true,
          sectionLabel: true,
          productCode: true,
          description: true,
          qty: true,
          unit: true,
          expectedCostUnit: true,
          actualSaleUnit: true,
        },
      },
    },
  });
  if (!ticket) notFound();

  // Resolve which Customer PO (if any) is in scope.
  const scopedPO =
    (customerPoId && ticket.customerPOs.find((p) => p.id === customerPoId)) ||
    (ticket.customerPOs.length === 1 ? ticket.customerPOs[0] : null);

  // Per-CustomerPOLine qty cap for each ticket line on the scoped PO.
  // If a PO line was for qty 60 (out of a ticket line of 160), scope shows 60.
  const scopedQtyByLine = new Map<string, number>();
  if (scopedPO) {
    for (const pl of scopedPO.lines) {
      if (!pl.ticketLineId) continue;
      scopedQtyByLine.set(
        pl.ticketLineId,
        (scopedQtyByLine.get(pl.ticketLineId) ?? 0) + Number(pl.qty ?? 0)
      );
    }
  }
  const scopedTicketLines = scopedPO
    ? ticket.lines.filter((l) => scopedQtyByLine.has(l.id))
    : ticket.lines;

  const aliaxis = await prisma.supplier.findFirst({
    where: { name: "Aliaxis" },
    select: { id: true, name: true },
  });

  const callOffs = await prisma.procurementOrder.findMany({
    where: { ticketId: id },
    include: {
      supplier: { select: { id: true, name: true } },
      lines: {
        select: {
          id: true,
          ticketLineId: true,
          description: true,
          qty: true,
          unitCost: true,
          lineTotal: true,
        },
      },
    },
    orderBy: [{ issuedAt: "desc" }, { poNo: "desc" }],
  });

  // Build per-line tracker: scope qty vs sum of called-off qtys to date
  const calledByLine = new Map<string, number>();
  for (const co of callOffs) {
    for (const col of co.lines) {
      if (!col.ticketLineId) continue;
      calledByLine.set(
        col.ticketLineId,
        (calledByLine.get(col.ticketLineId) ?? 0) + Number(col.qty)
      );
    }
  }
  const lineTracker = scopedTicketLines.map((tl) => {
    const calledOff = calledByLine.get(tl.id) ?? 0;
    // When scoped to a CustomerPO, the scope qty is the qty on that PO line,
    // not the full ticket line qty.
    const scopeQty = scopedPO ? (scopedQtyByLine.get(tl.id) ?? Number(tl.qty)) : Number(tl.qty);
    const remaining = scopeQty - calledOff;
    return {
      id: tl.id,
      displayOrder: tl.displayOrder,
      sectionLabel: tl.sectionLabel,
      productCode: tl.productCode,
      description: tl.description,
      qty: scopeQty,
      unit: tl.unit,
      expectedCostUnit: tl.expectedCostUnit ? Number(tl.expectedCostUnit) : null,
      calledOff,
      remaining,
    };
  });

  // Allocate next PO number CP-PO-2026-NNNN
  const lastPo = await prisma.procurementOrder.findFirst({
    where: { poNo: { startsWith: "CP-PO-2026-" } },
    orderBy: { poNo: "desc" },
    select: { poNo: true },
  });
  let nextSeq = 1;
  if (lastPo?.poNo) {
    const m = lastPo.poNo.match(/^CP-PO-2026-(\d+)$/);
    if (m) nextSeq = parseInt(m[1], 10) + 1;
  }
  const nextPoNo = `CP-PO-2026-${String(nextSeq).padStart(4, "0")}`;

  const customerPoNo = scopedPO?.poNo ?? null;
  const customerPoTotal = scopedPO?.totalValue
    ? Number(scopedPO.totalValue)
    : scopedPO?.poLimitValue
      ? Number(scopedPO.poLimitValue)
      : null;

  return (
    <div className="p-6 space-y-4 max-w-7xl mx-auto">
      <div className="flex items-center gap-2">
        <Link href={`/tickets/${ticket.id}`}>
          <Button variant="ghost" size="sm">
            <ArrowLeft className="size-4 mr-1" /> Back to ticket
          </Button>
        </Link>
      </div>

      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Call-offs · #{ticket.ticketNo}</h1>
          <p className="text-sm text-muted-foreground">
            {ticket.title} · {ticket.payingCustomer?.name}
            {ticket.site?.siteName ? ` · ${ticket.site.siteName}` : ""}
            {customerPoNo ? ` · Customer PO ${customerPoNo}` : ""}
          </p>
        </div>
        {scopedPO ? (
          <Link href={`/po-register/${scopedPO.id}/call-off`}>
            <Button size="sm" className="bg-[#FF6600] text-black hover:bg-[#FF9900]">
              + Log call-off against PO {scopedPO.poNo}
            </Button>
          </Link>
        ) : ticket.customerPOs.length > 0 ? (
          <div className="text-xs text-muted-foreground">
            Pick a PO above to log a call-off against it.
          </div>
        ) : null}
      </div>

      {ticket.customerPOs.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <span className="text-muted-foreground">Scope:</span>
          <Link
            href={`/tickets/${ticket.id}/call-offs`}
            className={`px-2 py-1 rounded border ${!scopedPO ? "bg-[#FF6600] text-black border-[#FF6600]" : "hover:bg-muted"}`}
          >
            All ticket lines ({ticket.lines.length})
          </Link>
          {ticket.customerPOs.map((p) => {
            const active = scopedPO?.id === p.id;
            return (
              <Link
                key={p.id}
                href={`/tickets/${ticket.id}/call-offs?customerPoId=${p.id}`}
                className={`px-2 py-1 rounded border ${active ? "bg-[#FF6600] text-black border-[#FF6600]" : "hover:bg-muted"}`}
              >
                PO {p.poNo} ({p.lines.length})
              </Link>
            );
          })}
        </div>
      )}

      <CallOffsView
        ticketId={ticket.id}
        lines={lineTracker}
        callOffs={callOffs.map((co) => ({
          id: co.id,
          poNo: co.poNo,
          supplier: co.supplier?.name ?? "—",
          supplierRef: co.supplierRef,
          siteContact: (co as { siteContact?: string | null }).siteContact ?? null,
          issuedAt: co.issuedAt ? co.issuedAt.toISOString() : null,
          deliveryDateExpected: co.deliveryDateExpected
            ? co.deliveryDateExpected.toISOString()
            : null,
          status: co.status,
          totalCostExpected: Number(co.totalCostExpected),
          lineCount: co.lines.length,
          lines: co.lines.map((l) => ({
            ticketLineId: l.ticketLineId ?? "",
            qty: Number(l.qty),
            unitCost: Number(l.unitCost),
          })),
        }))}
        aliaxisId={aliaxis?.id ?? null}
        nextPoNo={nextPoNo}
        customerPoTotal={customerPoTotal}
        deliveryAddress={
          ticket.site
            ? [
                ticket.site.siteName,
                ticket.site.addressLine1,
                ticket.site.addressLine2,
                ticket.site.city,
                ticket.site.postcode,
              ]
                .filter(Boolean)
                .join("\n")
            : ""
        }
      />
    </div>
  );
}
