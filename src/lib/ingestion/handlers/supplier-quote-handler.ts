/**
 * Supplier Quote → TicketLinePrice writer (Universal Ingestion, Phase B step 5)
 *
 * A supplier quote responds to an open RFQ. Each line carries a per-unit price
 * we want to capture so the OS can pick the winning supplier automatically.
 *
 * Pipeline:
 *   1. extractFromText → structured.lines (AI extractor handles QUOTE doctype)
 *   2. Resolve target ticket via Q-number / quote ref / site name in subject
 *   3. Persist IntakeDocument(docType=SUPPLIER_QUOTE)
 *   4. For each extracted line, fuzzy-match a TicketLine by description and
 *      write a TicketLinePrice (creates one cost option per supplier per line)
 *   5. Recalculate winner (lowest costTotal wins unless a manual price exists)
 *   6. Emit SUPPLIER_QUOTE signal → close any Task(AWAITING_QUOTE)
 */
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/ingestion/audit";
import { resolveTasksForSignal } from "@/lib/ingestion/signal-resolver";
import { triggerRegistry, type TriggerHandler } from "@/lib/ingestion/trigger-registry";
import { extractFromText } from "@/lib/ingestion/extract-any";

function extractQNumber(text: string): string | null {
  // Canonical Cromwell Q-number is Q- followed by 10+ digits.
  const m = text.match(/\bQ-(\d{10,})\b/) ?? text.match(/\bQ-(\d{6,})\b/);
  return m ? `Q-${m[1]}` : null;
}

function fuzzyMatchTicketLine(
  description: string,
  ticketLines: Array<{ id: string; description: string; qty: unknown }>,
): { id: string; description: string; qty: unknown } | null {
  const descWords = description
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length >= 3);
  if (descWords.length === 0) return null;
  let bestId: { id: string; description: string; qty: unknown } | null = null;
  let bestScore = 0;
  for (const tl of ticketLines) {
    const lineWords = tl.description.toLowerCase().split(/\s+/);
    const hits = descWords.filter((w) => lineWords.some((lw) => lw.includes(w) || w.includes(lw))).length;
    const score = hits / descWords.length;
    if (score > bestScore && score >= 0.4) {
      bestScore = score;
      bestId = tl;
    }
  }
  return bestId;
}

async function recalcWinner(ticketLineId: string) {
  const prices = await prisma.ticketLinePrice.findMany({
    where: { ticketLineId },
    orderBy: { costTotal: "asc" },
  });
  if (prices.length === 0) return;
  const manual = prices.find((p) => p.isManual);
  const winner = manual ?? prices[0];
  await prisma.ticketLinePrice.updateMany({
    where: { ticketLineId, isWinner: true },
    data: { isWinner: false },
  });
  await prisma.ticketLinePrice.update({
    where: { id: winner.id },
    data: { isWinner: true },
  });
}

async function resolveSupplier(
  fromEmail: string,
  fromName: string,
  extractedName: string | null,
): Promise<{ id: string; name: string } | null> {
  const domain = (fromEmail.split("@")[1] || "").toLowerCase().split(".")[0];
  const candidates = [extractedName, fromName, domain].filter(Boolean) as string[];
  for (const cand of candidates) {
    const supplier = await prisma.supplier.findFirst({
      where: { name: { contains: cand, mode: "insensitive" } },
      select: { id: true, name: true },
    });
    if (supplier) return supplier;
  }
  return null;
}

export const handleSupplierQuote: TriggerHandler = async (ctx) => {
  const extracted = await extractFromText(`${ctx.subject}\n${ctx.text}`);
  const doc = extracted.structured;
  const supplier = await resolveSupplier(ctx.fromEmail, ctx.fromName, doc.supplierName);

  // Resolve ticket via Q-number → Quote.quoteNo → Quote.ticketId. This is the
  // canonical Cromwell anchor; if a quote with that Q-number exists, the
  // supplier is replying to that RFQ.
  const qNumber = extractQNumber(`${ctx.subject}\n${ctx.text}`);
  let ticket: { id: string; lines: Array<{ id: string; description: string; qty: unknown }> } | null = null;
  if (qNumber) {
    const quote = await prisma.quote.findFirst({
      where: { quoteNo: qNumber },
      orderBy: { versionNo: "desc" },
      select: { ticketId: true },
    });
    if (quote) {
      const t = await prisma.ticket.findUnique({
        where: { id: quote.ticketId },
        select: {
          id: true,
          lines: { select: { id: true, description: true, qty: true } },
        },
      });
      if (t) ticket = t;
    }
  }

  const intake = await prisma.intakeDocument.create({
    data: {
      sourceType: "EMAIL_SUPPLIER_QUOTE",
      sourceRef: ctx.eventId,
      ingestionEventId: ctx.eventId,
      rawText: ctx.text.slice(0, 100_000),
      docType: "SUPPLIER_QUOTE",
      intent: "REACTION",
      intentConfidence: doc.lines.length > 0 ? 80 : 50,
      status: "PARSED",
      extracted: JSON.parse(
        JSON.stringify({
          parsed: {
            documentRef: doc.documentRef,
            supplierName: doc.supplierName,
            documentDate: doc.documentDate,
            total: doc.total,
            lines: doc.lines,
          },
          qNumber,
          resolvedTicketId: ticket?.id ?? null,
          resolvedSupplierId: supplier?.id ?? null,
          sender: { email: ctx.fromEmail, name: ctx.fromName },
          subject: ctx.subject,
        }),
      ),
      linkedTicketId: ticket?.id ?? null,
      triggerStatus: "FIRED",
    },
  });

  let pricesCreated = 0;
  const supplierLabel = supplier?.name ?? doc.supplierName ?? ctx.fromName ?? "Unknown supplier";

  if (ticket && doc.lines.length > 0) {
    for (const line of doc.lines) {
      const matched = fuzzyMatchTicketLine(line.description, ticket.lines);
      if (!matched) continue;
      const qty = Number(matched.qty as unknown as number) || line.qty || 1;
      const costPerUnit = line.unitPrice;
      const costTotal = Math.round(line.unitPrice * qty * 100) / 100;

      // Skip if this exact supplier already priced this line at this cost.
      const existing = await prisma.ticketLinePrice.findFirst({
        where: {
          ticketLineId: matched.id,
          supplierName: supplierLabel,
          costPerUnit: costPerUnit as unknown as number,
        },
        select: { id: true },
      });
      if (existing) continue;

      await prisma.ticketLinePrice.create({
        data: {
          ticketLineId: matched.id,
          supplierId: supplier?.id ?? null,
          supplierName: supplierLabel,
          costPerUnit: costPerUnit as unknown as number,
          costTotal: costTotal as unknown as number,
          notes: `From quote ${doc.documentRef ?? "?"}: ${line.description.slice(0, 200)}`,
        },
      });
      pricesCreated++;
      await recalcWinner(matched.id);
    }
  }

  // Emit signal so any Task(AWAITING_QUOTE) keyed to this supplier/ticket closes.
  const signalMatcher: Record<string, string | undefined> = {
    ticketId: ticket?.id,
    supplierId: supplier?.id,
    quoteRef: doc.documentRef ?? undefined,
    qNumber: qNumber ?? undefined,
  };
  const resolveResult = await resolveTasksForSignal({
    docType: "SUPPLIER_QUOTE",
    matcher: signalMatcher,
    source: intake.id,
  });

  await logAudit({
    objectType: "IntakeDocument",
    objectId: intake.id,
    actionType: "SUPPLIER_QUOTE_PROCESSED",
    newValue: {
      eventId: ctx.eventId,
      ticketId: ticket?.id ?? null,
      supplierId: supplier?.id ?? null,
      pricesCreated,
      autoClosedTasks: resolveResult.closedTaskIds.length,
    },
    reason: ticket
      ? `Supplier quote attached to ticket ${ticket.id}; ${pricesCreated} prices written`
      : "Supplier quote received but no matching ticket — review needed",
  });

  await prisma.ingestionEvent.update({
    where: { id: ctx.eventId },
    data: { status: "ACTIONED" },
  });

  return {
    eventId: ctx.eventId,
    action: "SUPPLIER_QUOTE",
    success: true,
    details:
      `supplier=${supplierLabel} ticket=${ticket?.id ?? "?"} ` +
      `prices=${pricesCreated} auto-closed=${resolveResult.closedTaskIds.length}`,
    intakeDocumentId: intake.id,
  };
};

triggerRegistry.register("SUPPLIER_QUOTE", "REACTION", handleSupplierQuote);
