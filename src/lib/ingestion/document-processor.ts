/**
 * Document processor — takes extracted document data and writes it to the database.
 *
 * Called after document-extractor.ts parses the text. This module handles:
 * - QUOTE → creates TicketLinePrice rows (supplier pricing)
 * - BILL → creates SupplierBill + SupplierBillLine rows
 * - CREDIT_NOTE → creates CreditNote record
 * - ORDER_ACK → logs procurement confirmation
 */

import { prisma } from "@/lib/prisma";
import type { ExtractedDocument, ExtractedLineItem } from "./document-extractor";
import { enqueueUnresolvedParty } from "@/lib/parties/review-queue";

export interface ProcessResult {
  documentType: string;
  documentRef: string | null;
  linesProcessed: number;
  pricesCreated: number;
  billCreated: boolean;
  errors: string[];
}

/**
 * Process an extracted document against a ticket.
 * Matches extracted lines to existing ticket lines by description similarity.
 */
export async function processExtractedDocument(
  ticketId: string,
  doc: ExtractedDocument,
  supplierName?: string,
): Promise<ProcessResult> {
  const result: ProcessResult = {
    documentType: doc.documentType,
    documentRef: doc.documentRef,
    linesProcessed: 0,
    pricesCreated: 0,
    billCreated: false,
    errors: [],
  };

  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: { lines: { select: { id: true, description: true, qty: true } } },
  });
  if (!ticket) { result.errors.push("Ticket not found"); return result; }

  const supplier = supplierName ?? doc.supplierName ?? "Unknown Supplier";

  if (doc.documentType === "QUOTE") {
    // Match each extracted line to a ticket line and create TicketLinePrice
    for (const line of doc.lines) {
      const matchedTicketLine = findBestMatch(line.description, ticket.lines);
      if (matchedTicketLine) {
        // Check if price already exists from this supplier
        const existing = await prisma.ticketLinePrice.findFirst({
          where: { ticketLineId: matchedTicketLine.id, supplierName: supplier },
        });
        if (!existing) {
          const qty = Number(matchedTicketLine.qty);
          await prisma.ticketLinePrice.create({
            data: {
              ticketLineId: matchedTicketLine.id,
              supplierName: supplier,
              costPerUnit: line.unitPrice,
              costTotal: Math.round(line.unitPrice * qty * 100) / 100,
              notes: `From ${doc.documentType} ${doc.documentRef ?? ""}: ${line.description}`.trim(),
            },
          });
          result.pricesCreated++;

          // Recalc winner
          await recalcWinnerSimple(matchedTicketLine.id);
        }
      }
      result.linesProcessed++;
    }
  } else if (doc.documentType === "BILL") {
    // Create SupplierBill + lines. No silent supplier auto-create — unknown
    // names park in ReviewQueue (UNRESOLVED_SUPPLIER) for human triage.
    const existingSupplier = await prisma.supplier.findFirst({
      where: { name: { contains: supplier, mode: "insensitive" } },
    });
    if (!existingSupplier) {
      await enqueueUnresolvedParty({
        party: "SUPPLIER",
        rawValue: supplier,
        description: `Document processor (BILL) could not match supplier "${supplier}" for ticket ${ticketId}.`,
        entityType: "Ticket",
        entityId: ticketId,
      });
      result.errors.push(`Supplier "${supplier}" unresolved — bill not created. Match in ReviewQueue.`);
      return result;
    }
    const supplierId: string = existingSupplier.id;

    // Check for duplicate bill
    if (doc.documentRef) {
      const existingBill = await prisma.supplierBill.findFirst({
        where: { billNo: doc.documentRef, supplierId },
      });
      if (existingBill) {
        result.errors.push(`Bill ${doc.documentRef} already exists`);
        return result;
      }
    }

    const bill = await prisma.supplierBill.create({
      data: {
        supplierId,
        billNo: doc.documentRef ?? `AUTO-${Date.now()}`,
        billDate: doc.documentDate ? new Date(doc.documentDate) : new Date(),
        totalCost: doc.total ?? doc.subtotal ?? doc.lines.reduce((s, l) => s + l.lineTotal, 0),
        amountExVat: doc.subtotal ?? doc.lines.reduce((s, l) => s + l.lineTotal, 0),
        status: "PARSED",
        paymentStatus: "UNPAID",
      },
    });

    for (const line of doc.lines) {
      const matchedTicketLine = findBestMatch(line.description, ticket.lines);
      await prisma.supplierBillLine.create({
        data: {
          supplierBillId: bill.id,
          description: line.description,
          qty: line.qty,
          unitCost: line.unitPrice,
          lineTotal: line.lineTotal,
          amountExVat: line.lineTotal,
          ticketId,
          ticketLineId: matchedTicketLine?.id ?? null,
        },
      });
      result.linesProcessed++;
    }
    result.billCreated = true;
  }

  return result;
}

// ── Line matching ───────────────────────────────────────────────────────────

function findBestMatch(
  description: string,
  ticketLines: Array<{ id: string; description: string; qty: unknown }>,
): { id: string; description: string; qty: unknown } | null {
  if (ticketLines.length === 0) return null;

  const descWords = description.toLowerCase().split(/\s+/).filter((w) => w.length >= 3);
  if (descWords.length === 0) return null;

  let bestMatch: typeof ticketLines[0] | null = null;
  let bestScore = 0;

  for (const line of ticketLines) {
    const lineWords = line.description.toLowerCase().split(/\s+/);
    const matches = descWords.filter((w) => lineWords.some((lw) => lw.includes(w) || w.includes(lw)));
    const score = matches.length / descWords.length;
    if (score > bestScore && score >= 0.3) {
      bestScore = score;
      bestMatch = line;
    }
  }

  return bestMatch;
}

// ── Simple winner recalc ────────────────────────────────────────────────────

async function recalcWinnerSimple(ticketLineId: string) {
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

  const line = await prisma.ticketLine.findUnique({
    where: { id: ticketLineId },
    select: { priceOverride: true },
  });
  if (line?.priceOverride) return;

  await prisma.ticketLine.update({
    where: { id: ticketLineId },
    data: {
      expectedCostUnit: winner.costPerUnit,
      expectedCostTotal: winner.costTotal,
    },
  });
}
