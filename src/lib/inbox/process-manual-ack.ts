/**
 * Process a supplier order acknowledgement manually attached to a ticket.
 *
 * The user has already decided this email IS an ack for THIS ticket, so we
 * apply matches without the autonomous mode's "≥2 line matches" safety
 * threshold. Single-line tickets get their one line priced.
 *
 * Flow:
 *   1. Pull parsedMessage text (assumes attachments already extracted —
 *      caller should call ensureAttachmentsExtracted first)
 *   2. parseAcknowledgementText to extract supplier, orderRef, lines
 *   3. Resolve Supplier (lookup by name → alias → email domain → create stub)
 *   4. matchAckLines against ticket demand
 *   5. For exact/substitution matches: write expectedCostUnit + supplierName
 *      onto TicketLine; create ProcurementOrder + lines
 *   6. Log [ACK-MATCH:xxxxxxxx] Event for audit + idempotency
 */
import { prisma } from "@/lib/prisma";
import { parseAcknowledgementText, type ParsedAcknowledgement } from "@/lib/procurement/parse-acknowledgement";
import { matchAckLines, type DemandLine } from "@/lib/procurement/match-ack-lines";
import { resolveSupplier } from "@/lib/bills/supplier-resolver";

export interface ProcessManualAckResult {
  ok: boolean;
  reason?: string;
  parsed: { supplier: string | null; orderRef: string | null; totalNet: number | null; lineCount: number };
  applied: { linesUpdated: number; ordersCreated: number; orderLinesCreated: number };
  matches: Array<{ ticketLineId: string | null; description: string; matchType: string; score: number; unitCost: number }>;
  unmatched: Array<{ description: string; qty: number; unitCost: number }>;
  procurementOrderId?: string;
}

export async function processManualAck(args: {
  ingestionEventId: string;
  ticketId: string;
  batchId: string;
}): Promise<ProcessManualAckResult> {
  const result: ProcessManualAckResult = {
    ok: false,
    parsed: { supplier: null, orderRef: null, totalNet: null, lineCount: 0 },
    applied: { linesUpdated: 0, ordersCreated: 0, orderLinesCreated: 0 },
    matches: [],
    unmatched: [],
  };

  // 1. Get text
  const event = await prisma.ingestionEvent.findUnique({
    where: { id: args.ingestionEventId },
    select: {
      id: true,
      rawPayload: true,
      parsedMessages: { select: { extractedText: true }, orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!event) {
    result.reason = "ingestion event not found";
    return result;
  }
  const text = event.parsedMessages[0]?.extractedText ?? "";
  if (text.length < 50) {
    result.reason = "no extracted text on event (attachment extraction may not have run)";
    return result;
  }

  // 2. Parse
  const parsed: ParsedAcknowledgement = parseAcknowledgementText(text);
  result.parsed = {
    supplier: parsed.supplierName,
    orderRef: parsed.orderRef,
    totalNet: parsed.totalNet,
    lineCount: parsed.lines.length,
  };
  if (parsed.lines.length === 0) {
    result.reason = "parser found no line items in the ack";
    return result;
  }

  // 3. Get ticket + demand lines
  const ticket = await prisma.ticket.findUnique({
    where: { id: args.ticketId },
    select: {
      id: true,
      ticketNo: true,
      lines: { select: { id: true, description: true, qty: true, unit: true } },
    },
  });
  if (!ticket) {
    result.reason = "ticket not found";
    return result;
  }
  if (ticket.lines.length === 0) {
    result.reason = "ticket has no lines to match against";
    return result;
  }

  // 4. Resolve supplier
  const raw = (event.rawPayload ?? {}) as Record<string, unknown>;
  const senderEmail = (() => {
    const from = raw.from as { emailAddress?: { address?: string } } | undefined;
    return from?.emailAddress?.address ?? null;
  })();
  const participants: string[] = senderEmail ? [senderEmail] : [];
  const supplierId = await resolveSupplier({ name: parsed.supplierName, participants });

  // 5. Match
  const demand: DemandLine[] = ticket.lines.map((l) => ({
    id: l.id,
    description: l.description,
    qty: Number(l.qty),
    unit: l.unit,
  }));
  const matchResult = matchAckLines(parsed.lines, demand);

  // 6. Apply: write prices to matched ticket lines
  const supplier = await prisma.supplier.findUnique({ where: { id: supplierId }, select: { name: true } });
  const supplierName = supplier?.name ?? parsed.supplierName ?? "Unknown supplier";

  let linesUpdated = 0;
  for (const m of matchResult.matches) {
    if (m.matchType === "extra" || !m.demandLineId) continue;

    // Math reconciliation: parsers can pick the LIST price (pre-discount)
    // and the discounted line total — they won't tie up. Trust line total,
    // recompute unitCost = lineTotal / qty. Tolerance: 1p or 0.5%.
    const reconciled = reconcileUnitCost({
      unitCost: Number(m.supplyLine.unitCost),
      qty: Number(m.supplyLine.qty),
      lineTotal: Number(m.supplyLine.lineTotal),
    });

    await prisma.ticketLine.update({
      where: { id: m.demandLineId },
      data: {
        description: m.supplyLine.description,
        productCode: m.supplyLine.productCode ?? undefined,
        expectedCostUnit: reconciled.unitCost,
        expectedCostTotal: reconciled.lineTotal,
        supplierName,
        supplierId,
        supplierReference: parsed.orderRef ?? undefined,
      },
    });
    linesUpdated++;
    result.matches.push({
      ticketLineId: m.demandLineId,
      description: m.supplyLine.description,
      matchType: m.matchType,
      score: m.score,
      unitCost: reconciled.unitCost,
    });
  }
  for (const m of matchResult.matches) {
    if (m.matchType === "extra") {
      result.unmatched.push({
        description: m.supplyLine.description,
        qty: m.supplyLine.qty,
        unitCost: m.supplyLine.unitCost,
      });
    }
  }

  // 7. Create ProcurementOrder + lines
  let procurementOrderId: string | undefined;
  const totalCost = parsed.lines.reduce((acc, l) => acc + l.lineTotal, 0);
  if (linesUpdated > 0 || matchResult.matches.length > 0) {
    const po = await prisma.procurementOrder.create({
      data: {
        ticketId: ticket.id,
        supplierId,
        poNo: parsed.orderRef ?? `ACK-${event.id.slice(0, 8)}`,
        supplierRef: parsed.orderRef,
        issuedAt: new Date(),
        status: "ACKNOWLEDGED",
        totalCostExpected: totalCost,
      },
    });
    procurementOrderId = po.id;
    result.applied.ordersCreated = 1;

    for (const m of matchResult.matches) {
      const rec = reconcileUnitCost({
        unitCost: Number(m.supplyLine.unitCost),
        qty: Number(m.supplyLine.qty),
        lineTotal: Number(m.supplyLine.lineTotal),
      });
      await prisma.procurementOrderLine.create({
        data: {
          procurementOrderId: po.id,
          ticketLineId: m.matchType === "extra" ? null : m.demandLineId,
          description: m.supplyLine.description,
          qty: m.supplyLine.qty,
          unitCost: rec.unitCost,
          lineTotal: rec.lineTotal,
          matchStatus: m.matchType.toUpperCase(),
        },
      });
      result.applied.orderLinesCreated++;
    }
  }
  result.applied.linesUpdated = linesUpdated;
  result.procurementOrderId = procurementOrderId;

  // 8. Log audit Event with [ACK-MATCH:...] prefix (matches autonomous engine format).
  await prisma.event.create({
    data: {
      ticketId: ticket.id,
      eventType: "ORDER_ACK_RECEIVED" as never,
      timestamp: new Date(),
      notes:
        `[ACK-MATCH:${event.id.slice(0, 8)}] manual classify` +
        ` · supplier=${supplierName}` +
        (parsed.orderRef ? ` · ref=${parsed.orderRef}` : "") +
        ` · ${parsed.lines.length} parsed line(s)` +
        ` · ${linesUpdated} ticket line(s) priced` +
        ` · PO ${procurementOrderId ?? "(none)"}`,
      sourceRef: `manual-classify:${args.batchId}:${ticket.id}`,
    },
  });

  result.ok = true;
  return result;
}

/**
 * Trust the line total. If unitCost × qty disagrees with lineTotal beyond
 * tolerance, the parser likely captured a list/pre-discount unit price and
 * the discounted line total — recompute unitCost from the total.
 *
 * Example (Verdis):  6.46 × 10 = 64.60  but lineTotal = 42.00
 *                    → −35% discount;  effective unit = 42.00/10 = 4.20
 */
function reconcileUnitCost(args: { unitCost: number; qty: number; lineTotal: number }): {
  unitCost: number;
  lineTotal: number;
  reconciled: boolean;
} {
  const { unitCost, qty, lineTotal } = args;
  if (qty <= 0) return { unitCost, lineTotal, reconciled: false };
  if (lineTotal <= 0) {
    // Parser didn't get a usable total — trust the unit and compute total.
    return { unitCost, lineTotal: round2(unitCost * qty), reconciled: false };
  }
  const expected = unitCost * qty;
  const diff = Math.abs(expected - lineTotal);
  const tolerance = Math.max(0.01, expected * 0.005); // 0.5% or 1p
  if (diff <= tolerance) {
    return { unitCost: round4(unitCost), lineTotal: round2(lineTotal), reconciled: false };
  }
  return { unitCost: round4(lineTotal / qty), lineTotal: round2(lineTotal), reconciled: true };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
