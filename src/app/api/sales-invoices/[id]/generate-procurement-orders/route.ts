/**
 * Turn a call-off (a SalesInvoice generated from drawdowns on a CustomerPO)
 * into supplier ProcurementOrders. One PO per supplier, each PO line carries
 * the called-off qty and the TicketLine's expectedCost.
 *
 * Side effects:
 *   - 1 ProcurementOrder per distinct supplier touched by the call-off
 *   - 1 ProcurementOrderLine per called-off TicketLine for that supplier
 *   - 1 CostAllocation per line (so the cost ties back to the ticket line)
 *   - 1 Event (PURCHASE_ORDER_SENT) per PO created
 *
 * Idempotency: re-running creates a NEW set of POs. The endpoint does not
 * deduplicate against prior runs — that's deliberate so you can split a
 * call-off into multiple supplier POs over time if you need to.
 *
 * Returns the created POs with line counts + totals.
 */
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: invoiceId } = await params;

  const invoice = await prisma.salesInvoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true,
      invoiceNo: true,
      ticketId: true,
      poNo: true,
      customer: { select: { name: true } },
      site: { select: { siteName: true } },
      lines: {
        select: {
          ticketLineId: true,
          qty: true,
          ticketLine: {
            select: {
              id: true,
              description: true,
              productCode: true,
              supplierId: true,
              supplierName: true,
              supplierReference: true,
              unit: true,
              expectedCostUnit: true,
            },
          },
        },
      },
    },
  });
  if (!invoice) return Response.json({ error: "Invoice not found" }, { status: 404 });

  const ticketId = invoice.ticketId;

  // Group lines by supplier
  type Bucket = {
    supplierId: string;
    supplierName: string;
    lines: Array<{
      ticketLineId: string;
      description: string;
      qty: Prisma.Decimal;
      unitCost: Prisma.Decimal;
      lineTotal: Prisma.Decimal;
      supplierReference: string | null;
    }>;
    totalCost: Prisma.Decimal;
  };
  const buckets = new Map<string, Bucket>();
  const skipped: Array<{ description: string; reason: string }> = [];

  for (const il of invoice.lines) {
    const tl = il.ticketLine;
    if (!tl) {
      skipped.push({ description: "(no ticket line)", reason: "missing ticketLine" });
      continue;
    }
    if (!tl.supplierId) {
      skipped.push({ description: tl.description, reason: "no supplier assigned" });
      continue;
    }
    const cu = Number(tl.expectedCostUnit ?? 0);
    if (cu <= 0) {
      skipped.push({ description: tl.description, reason: "no cost price" });
      continue;
    }

    const qty = new Prisma.Decimal(il.qty);
    const unitCost = new Prisma.Decimal(cu);
    const lineTotal = qty.mul(unitCost).toDecimalPlaces(2);

    const b = buckets.get(tl.supplierId) ?? {
      supplierId: tl.supplierId,
      supplierName: tl.supplierName ?? "Supplier",
      lines: [],
      totalCost: new Prisma.Decimal(0),
    };
    b.lines.push({
      ticketLineId: tl.id,
      description: tl.description,
      qty,
      unitCost,
      lineTotal,
      supplierReference: tl.supplierReference ?? null,
    });
    b.totalCost = b.totalCost.add(lineTotal);
    buckets.set(tl.supplierId, b);
  }

  const issuedAt = new Date();
  const ts = Date.now().toString(36).toUpperCase();
  const created: Array<Record<string, unknown>> = [];

  for (const [supplierId, b] of buckets.entries()) {
    const poNo = `PO-${b.supplierName.replace(/[^a-z0-9]/gi, "").slice(0, 5).toUpperCase()}-${ts}-${created.length + 1}`;

    const po = await prisma.$transaction(async (tx) => {
      const po = await tx.procurementOrder.create({
        data: {
          ticketId,
          supplierId,
          poNo,
          status: "DRAFT",
          totalCostExpected: b.totalCost,
          issuedAt,
          siteRef: invoice.site?.siteName ?? undefined,
          supplierRef: invoice.poNo ?? undefined,
          lines: {
            create: b.lines.map((l) => ({
              ticketLineId: l.ticketLineId,
              description: l.description,
              qty: l.qty,
              unitCost: l.unitCost,
              lineTotal: l.lineTotal,
              matchStatus: "MATCHED",
            })),
          },
        },
        include: { lines: true, supplier: { select: { id: true, name: true } } },
      });

      // CostAllocation per line
      for (const poLine of po.lines) {
        if (!poLine.ticketLineId) continue;
        await tx.costAllocation.create({
          data: {
            ticketLineId: poLine.ticketLineId,
            procurementOrderLineId: poLine.id,
            supplierId,
            qtyAllocated: poLine.qty,
            unitCost: poLine.unitCost,
            totalCost: poLine.lineTotal,
            allocationStatus: "MATCHED",
            confidenceScore: 100,
            notes: `Generated from call-off invoice ${invoice.invoiceNo ?? invoice.id}`,
          },
        });
      }

      await tx.event.create({
        data: {
          ticketId,
          eventType: "PURCHASE_ORDER_SENT",
          timestamp: issuedAt,
          notes: `${po.poNo} → ${b.supplierName} (${b.lines.length} lines, £${Number(b.totalCost).toFixed(2)}) for call-off ${invoice.invoiceNo ?? ""}`,
        },
      });

      return po;
    });

    created.push({
      poId: po.id,
      poNo: po.poNo,
      supplier: b.supplierName,
      lines: po.lines.length,
      totalCost: Number(b.totalCost.toFixed(2)),
    });
  }

  return Response.json({
    ok: true,
    invoiceNo: invoice.invoiceNo,
    procurementOrdersCreated: created.length,
    created,
    skipped,
    totalCost: Number(
      Array.from(buckets.values())
        .reduce((acc, b) => acc.add(b.totalCost), new Prisma.Decimal(0))
        .toFixed(2)
    ),
  });
}
