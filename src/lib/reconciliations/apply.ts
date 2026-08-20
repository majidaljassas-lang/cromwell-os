// The only path that mutates the parent ticket. Called from the state
// transition APPROVED → APPLIED. Everything in one transaction so a partial
// write can never leave the parent half-mutated.
//
// Section A: replace old Valsir code on the parent line with the Geberit code
// (stored in productCode), wipe cost/sale so pricing is re-entered manually,
// append an internalNotes audit line, set status back to CAPTURED.
// Section C: respect the per-line keepFlag. false → status REMOVED_BY_CUSTOMER.
//            true or null → leave alone.
// Section B: never touched.
// Section D: never touched (these are customer-only — they'd be added as new
//            lines by a separate flow if/when confirmed).
//
// Side effects on parent Ticket:
// - status CLOSED → PRICING (reopen)
// - isLocked → false
// - lastActivityAt bumped
// - Event row (QUOTE_REVISED) written with the reconciliationNo in sourceRef

import { prisma } from "@/lib/prisma";
import type { Reconciliation } from "@/generated/prisma";
import { assertTransition } from "./state-machine";

export async function applyReconciliation(
  reconciliationId: string,
): Promise<Reconciliation> {
  return prisma.$transaction(async (tx) => {
    const recon = await tx.reconciliation.findUnique({
      where: { id: reconciliationId },
      include: {
        lines: true,
        parentTicket: { select: { id: true, status: true, isLocked: true } },
      },
    });
    if (!recon) throw new Error(`Reconciliation ${reconciliationId} not found`);

    assertTransition(recon.workflowState, "APPLIED");

    const now = new Date();

    // Section A — code swap + wipe pricing
    const sectionA = recon.lines.filter((l) => l.section === "A");
    for (const line of sectionA) {
      if (!line.parentTicketLineId || !line.newCode) continue;
      const parentLine = await tx.ticketLine.findUnique({
        where: { id: line.parentTicketLineId },
        select: { internalNotes: true, description: true },
      });
      if (!parentLine) continue;

      const swappedDescription = parentLine.description.replace(
        /\bVS\d{7}\b/,
        line.newCode,
      );
      // Also sprinkle "Geberit" where it says "Valsir"
      const rebrandedDescription = swappedDescription.replace(
        /\bValsir\b/gi,
        "Geberit",
      );

      const auditLine = `[${now.toISOString()}] Reconciliation #${recon.reconciliationNo}: swapped ${line.oldCode} → ${line.newCode}; pricing wiped for manual re-cost.`;
      const newNotes = [parentLine.internalNotes, auditLine]
        .filter(Boolean)
        .join("\n");

      await tx.ticketLine.update({
        where: { id: line.parentTicketLineId },
        data: {
          productCode: line.newCode,
          description: rebrandedDescription,
          expectedCostUnit: null,
          expectedCostTotal: null,
          suggestedSaleUnit: null,
          actualSaleUnit: null,
          actualSaleTotal: null,
          expectedMarginTotal: null,
          actualMarginTotal: null,
          status: "CAPTURED",
          priceOverride: false,
          internalNotes: newNotes,
        },
      });
      await tx.reconciliationLine.update({
        where: { id: line.id },
        data: { appliedAt: now },
      });
    }

    // Section C — honour keep/remove toggle
    const sectionC = recon.lines.filter((l) => l.section === "C");
    for (const line of sectionC) {
      if (!line.parentTicketLineId) continue;
      if (line.keepFlag === false) {
        await tx.ticketLine.update({
          where: { id: line.parentTicketLineId },
          data: {
            status: "REMOVED_BY_CUSTOMER",
            internalNotes: `Removed per reconciliation #${recon.reconciliationNo} (not on customer's revised list)`,
          },
        });
      }
      await tx.reconciliationLine.update({
        where: { id: line.id },
        data: { appliedAt: now },
      });
    }

    // Parent ticket — reopen if closed, unlock, bump lastActivity
    await tx.ticket.update({
      where: { id: recon.parentTicketId },
      data: {
        status: recon.parentTicket.status === "CLOSED" ? "PRICING" : recon.parentTicket.status,
        isLocked: false,
        lastActivityAt: now,
      },
    });

    await tx.event.create({
      data: {
        ticketId: recon.parentTicketId,
        eventType: "QUOTE_REVISED",
        timestamp: now,
        sourceRef: `Reconciliation#${recon.reconciliationNo}`,
        notes: `Applied reconciliation #${recon.reconciliationNo} — ${sectionA.length} code swaps, ${sectionC.filter((l) => l.keepFlag === false).length} removed, ${sectionC.filter((l) => l.keepFlag !== false).length} kept`,
      },
    });

    const updated = await tx.reconciliation.update({
      where: { id: reconciliationId },
      data: { workflowState: "APPLIED", appliedAt: now },
    });
    return updated;
  });
}
