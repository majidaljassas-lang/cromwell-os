import { prisma } from "@/lib/prisma";

/**
 * Manage line-item-level splits for a bill line.
 *
 * Concept: a single bill line (e.g. qty 22 of Pressfit Equal Tee 42mm) can be
 * split across multiple targets — 1 to W11, 15 to Criterion, 4 to stock, 2 pending.
 * Each split is a row in ZohoBillLineMatch with a targetType.
 *
 * targetType values:
 *   INVOICE    invoiceLineId set, points to a real ZohoImportedInvoiceLine
 *   STOCK      qty held for future use; targetSiteName / targetCustomerName optional
 *   WRITE_OFF  qty written off (damage, return, lost); manualNote required
 *   TICKET     allocated to a ticket; targetTicketRef set
 *   PENDING    verbally allocated; targetCustomerName / targetSiteName for context
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const VALID_TARGETS = ["INVOICE", "STOCK", "WRITE_OFF", "TICKET", "PENDING"] as const;

interface SplitInput {
  targetType: typeof VALID_TARGETS[number];
  qty: number;
  invoiceLineId?: string | null;
  invoiceNumber?: string | null;       // optional convenience — UI may pass "INV-004842"
  targetCustomerName?: string | null;
  targetSiteName?: string | null;
  targetTicketRef?: string | null;
  note?: string | null;
}

// GET — list current splits for a bill line
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const billLine = await prisma.zohoImportedBillLine.findUnique({
    where: { id },
    include: { bill: { select: { zohoNumber: true, vendorName: true, billDate: true } } },
  });
  if (!billLine) {
    return Response.json({ error: "bill line not found" }, { status: 404 });
  }
  const splits = await prisma.zohoBillLineMatch.findMany({
    where: { billLineId: id },
    orderBy: { createdAt: "asc" },
  });
  // Resolve invoice line / invoice descriptors for INVOICE-typed rows
  const invoiceLineIds = splits.map((s) => s.invoiceLineId).filter((x): x is string => !!x);
  const invoiceLines = invoiceLineIds.length
    ? await prisma.zohoImportedInvoiceLine.findMany({
        where: { id: { in: invoiceLineIds } },
        include: { invoice: { select: { zohoNumber: true, customerName: true, status: true } } },
      })
    : [];
  const invMap = new Map(invoiceLines.map((il) => [il.id, il]));

  // Compute totals
  const billQty = Number(billLine.quantity ?? 0);
  const billCost = Number(billLine.itemTotal ?? 0);
  const totalAllocatedQty = splits.reduce((s, x) => s + Number(x.qtyAllocated), 0);
  const remainingQty = billQty - totalAllocatedQty;

  return Response.json({
    billLine: {
      id: billLine.id,
      vendor: billLine.bill.vendorName,
      billNo: billLine.bill.zohoNumber,
      billDate: billLine.bill.billDate,
      description: billLine.itemDesc || billLine.itemName || "",
      qty: billQty,
      rate: Number(billLine.rate ?? 0),
      cost: billCost,
      cfSite: billLine.cfSite,
      customerName: billLine.customerName,
      // The legacy direct match (set by auto-closer) — surface for reference
      matchedInvoiceLineId: billLine.matchedInvoiceLineId,
    },
    splits: splits.map((s) => {
      const il = s.invoiceLineId ? invMap.get(s.invoiceLineId) : null;
      return {
        id: s.id,
        targetType: s.targetType,
        invoiceLineId: s.invoiceLineId,
        invoiceNumber: il?.invoice?.zohoNumber ?? null,
        invoiceCustomer: il?.invoice?.customerName ?? null,
        invoiceStatus: il?.invoice?.status ?? null,
        invoiceLineCost: il ? Number(il.itemTotal ?? 0) : null,
        targetCustomerName: s.targetCustomerName,
        targetSiteName: s.targetSiteName,
        targetTicketRef: s.targetTicketRef,
        qtyAllocated: Number(s.qtyAllocated),
        costAllocated: Number(s.costAllocated),
        source: s.source,
        confidence: s.confidence != null ? Number(s.confidence) : null,
        note: s.manualNote,
        createdAt: s.createdAt,
      };
    }),
    totals: {
      billQty,
      billCost,
      allocatedQty: totalAllocatedQty,
      allocatedCost: splits.reduce((s, x) => s + Number(x.costAllocated), 0),
      remainingQty,
      remainingCost: billCost - splits.reduce((s, x) => s + Number(x.costAllocated), 0),
    },
  });
}

// PUT — replace ALL splits for a bill line with the provided set.
// Wipe-and-replace semantics so the UI can be a simple "submit the whole list".
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();
  const allocations: SplitInput[] = Array.isArray(body.allocations) ? body.allocations : [];

  const billLine = await prisma.zohoImportedBillLine.findUnique({
    where: { id },
  });
  if (!billLine) return Response.json({ error: "bill line not found" }, { status: 404 });

  const billQty = Number(billLine.quantity ?? 0);
  const billCost = Number(billLine.itemTotal ?? 0);
  const billRate = billQty > 0 ? billCost / billQty : 0;

  // Validate
  if (allocations.length === 0) {
    return Response.json({ error: "allocations array required (use empty PUT to remove all)" }, { status: 400 });
  }
  let totalQty = 0;
  for (const a of allocations) {
    if (!VALID_TARGETS.includes(a.targetType)) {
      return Response.json({ error: `invalid targetType: ${a.targetType}` }, { status: 400 });
    }
    if (!Number.isFinite(a.qty) || a.qty <= 0) {
      return Response.json({ error: "every allocation needs a positive qty" }, { status: 400 });
    }
    if (a.targetType === "INVOICE" && !a.invoiceLineId && !a.invoiceNumber) {
      return Response.json({ error: "INVOICE allocation requires invoiceLineId or invoiceNumber" }, { status: 400 });
    }
    totalQty += a.qty;
  }
  if (totalQty - billQty > 0.0001) {
    return Response.json(
      { error: `allocation qty sum (${totalQty}) exceeds bill line qty (${billQty})` },
      { status: 400 }
    );
  }

  // Resolve invoiceNumber → invoiceLineId for convenience inputs
  // (UI can pass invoiceNumber + a description hint; we look up the line.)
  for (const a of allocations) {
    if (a.targetType === "INVOICE" && !a.invoiceLineId && a.invoiceNumber) {
      const inv = await prisma.zohoImportedInvoice.findFirst({
        where: { zohoNumber: a.invoiceNumber },
        include: { lines: { select: { id: true, itemDesc: true, itemName: true } } },
      });
      if (!inv) {
        return Response.json({ error: `invoice ${a.invoiceNumber} not found` }, { status: 400 });
      }
      // Pick a line — best-effort by description token overlap; fallback first line
      const billDesc = (billLine.itemDesc || billLine.itemName || "").toLowerCase();
      let best: typeof inv.lines[number] | null = null;
      for (const il of inv.lines) {
        const ilDesc = ((il.itemDesc || il.itemName) || "").toLowerCase();
        if (ilDesc && billDesc && ilDesc.split(" ").some((t) => t.length > 3 && billDesc.includes(t))) {
          best = il; break;
        }
      }
      a.invoiceLineId = (best ?? inv.lines[0])?.id ?? null;
      if (!a.invoiceLineId) {
        return Response.json({ error: `no invoice lines on ${a.invoiceNumber}` }, { status: 400 });
      }
    }
  }

  // Persist atomically — wipe existing splits + write new ones, clear legacy
  // matchedInvoiceLineId on the bill line (junction is now authoritative).
  await prisma.$transaction(async (tx) => {
    await tx.zohoBillLineMatch.deleteMany({ where: { billLineId: id } });
    for (const a of allocations) {
      const cost = Math.round(a.qty * billRate * 100) / 100;
      await tx.zohoBillLineMatch.create({
        data: {
          billLineId: id,
          invoiceLineId: a.invoiceLineId ?? null,
          targetType: a.targetType,
          targetCustomerName: a.targetCustomerName ?? null,
          targetSiteName: a.targetSiteName ?? null,
          targetTicketRef: a.targetTicketRef ?? null,
          qtyAllocated: a.qty,
          costAllocated: cost,
          source: "MANUAL",
          confidence: 100,
          manualConfirmedAt: new Date(),
          manualNote: a.note ?? null,
        },
      });
    }
    // If there's exactly one INVOICE allocation that consumes the full qty,
    // sync the legacy matchedInvoiceLineId so non-split-aware code still works.
    const single = allocations.length === 1 && allocations[0].targetType === "INVOICE"
      && Math.abs(allocations[0].qty - billQty) < 0.0001
      ? allocations[0].invoiceLineId : null;
    await tx.zohoImportedBillLine.update({
      where: { id },
      data: {
        matchedInvoiceLineId: single,
        clearStatus: single ? "CLEARED" : "SPLIT",
        matchReason: single ? "Manual single-target match" : `Split into ${allocations.length} allocations`,
        matchedAt: new Date(),
      },
    });
  });

  return Response.json({ ok: true, count: allocations.length });
}

// DELETE — remove ALL splits for a bill line, revert to unmatched
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await prisma.$transaction([
    prisma.zohoBillLineMatch.deleteMany({ where: { billLineId: id } }),
    prisma.zohoImportedBillLine.update({
      where: { id },
      data: {
        matchedInvoiceLineId: null,
        clearStatus: null,
        matchConfidence: null,
        matchReason: null,
        matchedAt: null,
      },
    }),
  ]);
  return Response.json({ ok: true });
}
