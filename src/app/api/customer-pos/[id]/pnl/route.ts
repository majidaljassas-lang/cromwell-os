/**
 * P&L for a single CustomerPO. Reads sales from the linked ticket lines and
 * costs from the same lines' expectedCostTotal (allocated cost takes
 * precedence if a real bill has landed). Groups by supplier and per call-off.
 */
import { prisma } from "@/lib/prisma";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const po = await prisma.customerPO.findUnique({
    where: { id },
    select: {
      id: true,
      poNo: true,
      poLimitValue: true,
      poConsumedValue: true,
      poRemainingValue: true,
      ticketId: true,
    },
  });
  if (!po || !po.ticketId) {
    return Response.json({ error: "PO or linked ticket not found" }, { status: 404 });
  }

  const lines = await prisma.ticketLine.findMany({
    where: { ticketId: po.ticketId, parentLineId: null },
    select: {
      id: true,
      description: true,
      qty: true,
      supplierName: true,
      expectedCostUnit: true,
      expectedCostTotal: true,
      actualCostTotal: true,
      actualSaleTotal: true,
    },
  });

  type SupBucket = { lines: number; sale: number; cost: number };
  const bySupplier = new Map<string, SupBucket>();
  let totalSale = 0;
  let totalCost = 0;
  let uncostedLines = 0;
  for (const l of lines) {
    const sale = Number(l.actualSaleTotal ?? 0);
    const cost = l.actualCostTotal != null ? Number(l.actualCostTotal) : Number(l.expectedCostTotal ?? 0);
    totalSale += sale;
    totalCost += cost;
    if (cost <= 0) uncostedLines++;
    const key = l.supplierName ?? "(no supplier)";
    const b = bySupplier.get(key) ?? { lines: 0, sale: 0, cost: 0 };
    b.lines++;
    b.sale += sale;
    b.cost += cost;
    bySupplier.set(key, b);
  }

  const supplierBreakdown = Array.from(bySupplier.entries())
    .map(([supplier, b]) => {
      const margin = b.sale - b.cost;
      const pct = b.sale > 0 ? (margin / b.sale) * 100 : 0;
      return {
        supplier,
        lines: b.lines,
        sale: round2(b.sale),
        cost: round2(b.cost),
        margin: round2(margin),
        marginPct: round2(pct),
      };
    })
    .sort((a, b) => b.cost - a.cost);

  // Per call-off P&L — one bucket per SalesInvoice referenced by drawdowns
  const drawdowns = await prisma.materialsDrawdownEntry.findMany({
    where: { customerPOId: id },
    select: { ticketLineId: true, qty: true, sellValue: true },
  });
  const allocs = await prisma.customerPOAllocation.findMany({
    where: { customerPOId: id },
    select: {
      salesInvoice: { select: { id: true, invoiceNo: true, status: true, issuedAt: true, totalSell: true } },
      ticketLineId: true,
      allocatedValue: true,
    },
  });

  type CallOff = { invoiceNo: string | null; status: string; issuedAt: string | null; sale: number; cost: number; lines: number };
  const callOffByInvoice = new Map<string, CallOff>();
  const lineCostUnit = new Map<string, number>();
  for (const l of lines) lineCostUnit.set(l.id, Number(l.expectedCostUnit ?? 0));

  // Aggregate sales side from POAllocations (linked to the invoice)
  for (const a of allocs) {
    if (!a.salesInvoice) continue;
    const key = a.salesInvoice.id;
    const bucket = callOffByInvoice.get(key) ?? {
      invoiceNo: a.salesInvoice.invoiceNo,
      status: a.salesInvoice.status,
      issuedAt: a.salesInvoice.issuedAt ? a.salesInvoice.issuedAt.toISOString() : null,
      sale: 0,
      cost: 0,
      lines: 0,
    };
    bucket.sale += Number(a.allocatedValue ?? 0);
    bucket.lines++;
    callOffByInvoice.set(key, bucket);
  }

  // Cost side from drawdowns (qty × line cost). Drawdowns aren't linked to invoice
  // by FK; bucket them by date or via the same PO. Simpler: count cost per line
  // proportional to allocated qty. Approx is fine for an at-a-glance P&L.
  const drawdownsBySalesInvoice = new Map<string, { qty: number; tlineId: string }[]>();
  for (const a of allocs) {
    if (!a.salesInvoice) continue;
    // We can find drawdowns whose ticketLineId == a.ticketLineId and bucket them.
    // For each invoice, take qty from the matching drawdown nearest in time. Good
    // enough heuristic since one invoice == one call-off in our flow.
  }
  // Simpler: every drawdown belongs to some invoice (1:1 in our flow). Map
  // by ticketLineId+qty to invoice via allocations.
  for (const dd of drawdowns) {
    if (!dd.ticketLineId) continue;
    const cu = lineCostUnit.get(dd.ticketLineId) ?? 0;
    const ddCost = cu * Number(dd.qty ?? 0);
    // find allocation with same ticketLineId
    const match = allocs.find((a) => a.ticketLineId === dd.ticketLineId && a.salesInvoice);
    if (match && match.salesInvoice) {
      const key = match.salesInvoice.id;
      const bucket = callOffByInvoice.get(key);
      if (bucket) bucket.cost += ddCost;
    }
  }

  const callOffs = Array.from(callOffByInvoice.values()).map((c) => {
    const margin = c.sale - c.cost;
    return {
      ...c,
      sale: round2(c.sale),
      cost: round2(c.cost),
      margin: round2(margin),
      marginPct: c.sale > 0 ? round2((margin / c.sale) * 100) : 0,
    };
  });

  return Response.json({
    poId: po.id,
    poNo: po.poNo,
    totals: {
      poLimit: Number(po.poLimitValue ?? 0),
      poConsumed: Number(po.poConsumedValue ?? 0),
      poRemaining: Number(po.poRemainingValue ?? 0),
      sale: round2(totalSale),
      cost: round2(totalCost),
      margin: round2(totalSale - totalCost),
      marginPct: totalSale > 0 ? round2(((totalSale - totalCost) / totalSale) * 100) : 0,
      lines: lines.length,
      uncostedLines,
    },
    supplierBreakdown,
    callOffs,
  });
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
