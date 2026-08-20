/**
 * Supplier PO Drafter
 *
 * When a ticket transitions to ORDERED (because a customer PO arrived),
 * this module auto-generates DRAFT ProcurementOrders — one per supplier
 * that holds the winning price for any of the ticket's lines.
 *
 * Drafts are NEVER auto-sent. Outbound supplier POs are real money out
 * of the door, so the user reviews each draft and clicks Send manually.
 *
 * Stock-check step (skip lines already held in stock) is stubbed until
 * the StockRegisterItem model lands (Phase 14). For now every non-stock
 * line flows through to a draft.
 */

import { prisma } from "@/lib/prisma";

type DraftResult = {
  ticketId: string;
  drafts: Array<{
    supplierId: string;
    supplierName: string;
    poId: string;
    poNo: string;
    totalCost: number;
    lineCount: number;
  }>;
  skippedNoPrice: number;
  skippedFromStock: number;
};

/** Generate a deterministic draft PO number: CP-{ticketNo}-{supplierSlug}-{seq}. */
function generateDraftPoNo(ticketNo: number, supplierName: string, seq: number): string {
  const slug = supplierName.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6) || "SUPP";
  return `CP-T${ticketNo}-${slug}-${String(seq).padStart(2, "0")}`;
}

/**
 * Create or update DRAFT ProcurementOrders for every ticket line that has
 * a winning supplier price. Idempotent: rerunning does not create duplicate
 * drafts — if a DRAFT order already exists for (ticket × supplier) the
 * missing lines are appended to it.
 */
export async function generateSupplierPODrafts(ticketId: string): Promise<DraftResult> {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: {
      id: true,
      ticketNo: true,
      lines: {
        where: { status: { in: ["ORDERED", "READY_FOR_QUOTE", "PRICED"] } },
        select: {
          id: true,
          description: true,
          productCode: true,
          qty: true,
          unit: true,
          parentLineId: true,
          isBomParent: true,
        },
      },
      procurementOrders: {
        select: { id: true, supplierId: true, status: true, lines: { select: { ticketLineId: true } } },
      },
    },
  });
  if (!ticket) throw new Error(`Ticket ${ticketId} not found`);

  const out: DraftResult = { ticketId, drafts: [], skippedNoPrice: 0, skippedFromStock: 0 };

  // Fetch winning price for every line in one round-trip
  const lineIds = ticket.lines.filter((l) => !l.isBomParent).map((l) => l.id); // skip parents, procure the children
  const winners = await prisma.ticketLinePrice.findMany({
    where: { ticketLineId: { in: lineIds }, isWinner: true },
    select: {
      ticketLineId: true,
      supplierId: true,
      supplierName: true,
      costPerUnit: true,
      costTotal: true,
      notes: true,
    },
  });
  const winnerByLine = new Map<string, (typeof winners)[number]>();
  for (const w of winners) winnerByLine.set(w.ticketLineId, w);

  // Group lines by supplier
  const bySupplier = new Map<string, Array<{ line: (typeof ticket.lines)[number]; winner: (typeof winners)[number] }>>();
  for (const line of ticket.lines) {
    if (line.isBomParent) continue; // BOM parents aren't procured — their children are
    const w = winnerByLine.get(line.id);
    if (!w) {
      out.skippedNoPrice++;
      continue;
    }
    // TicketLinePrice.supplierId is optional. If the winning price is a free-text
    // supplier name only (no FK), we can't group against the Supplier table —
    // skip with a note. User can fix by picking the supplier on the price row.
    if (!w.supplierId) {
      out.skippedNoPrice++;
      continue;
    }
    const arr = bySupplier.get(w.supplierId) ?? [];
    arr.push({ line, winner: w });
    bySupplier.set(w.supplierId, arr);
  }

  // Raise a review task for any line without a winning price so it's not lost silently
  if (out.skippedNoPrice > 0) {
    await prisma.task.create({
      data: {
        ticketId,
        taskType: "PRICING_INCOMPLETE",
        priority: "HIGH",
        status: "OPEN",
        generatedReason: `${out.skippedNoPrice} line(s) on this ticket have no winning supplier price — supplier PO drafts cannot be generated until a price is selected.`,
      },
    });
  }

  // For each supplier, create or append to a DRAFT PO
  let supplierSeq = 0;
  for (const [supplierId, group] of bySupplier) {
    supplierSeq++;
    const supplier = await prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { name: true },
    });
    if (!supplier) continue;

    // Is there already a DRAFT PO for this ticket + supplier?
    const existing = ticket.procurementOrders.find(
      (p) => p.supplierId === supplierId && p.status === "DRAFT",
    );

    const linesToCreate = group.filter(
      (g) => !existing?.lines.some((ln) => ln.ticketLineId === g.line.id),
    );
    if (linesToCreate.length === 0) continue; // fully covered already

    const added = linesToCreate.map((g) => {
      const qty = Number(g.line.qty);
      const unitCost = Number(g.winner.costPerUnit);
      const lineTotal = Math.round(qty * unitCost * 100) / 100;
      return {
        ticketLineId: g.line.id,
        description: g.line.productCode ? `${g.line.productCode} — ${g.line.description}` : g.line.description,
        qty,
        unitCost,
        lineTotal,
        matchStatus: "UNMATCHED",
      };
    });
    const addedTotal = added.reduce((s, l) => s + l.lineTotal, 0);

    let po;
    if (existing) {
      po = await prisma.procurementOrder.update({
        where: { id: existing.id },
        data: {
          totalCostExpected: { increment: addedTotal },
          lines: { create: added },
        },
        include: { lines: true },
      });
    } else {
      po = await prisma.procurementOrder.create({
        data: {
          ticketId,
          supplierId,
          poNo: generateDraftPoNo(ticket.ticketNo, supplier.name, supplierSeq),
          status: "DRAFT",
          issuedAt: null,
          totalCostExpected: Math.round(addedTotal * 100) / 100,
          lines: { create: added },
        },
        include: { lines: true },
      });
    }

    out.drafts.push({
      supplierId,
      supplierName: supplier.name,
      poId: po.id,
      poNo: po.poNo,
      totalCost: Math.round(Number(po.totalCostExpected) * 100) / 100,
      lineCount: po.lines.length,
    });
  }

  // Timeline event summarising what happened
  if (out.drafts.length > 0 || out.skippedNoPrice > 0) {
    await prisma.event.create({
      data: {
        ticketId,
        eventType: "AUTO_PO_CREATED",
        timestamp: new Date(),
        notes: `${out.drafts.length} supplier PO draft(s) generated · ${out.skippedNoPrice} line(s) skipped (no winning price)`,
      },
    });
  }

  return out;
}
