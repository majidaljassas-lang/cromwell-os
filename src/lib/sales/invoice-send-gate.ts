/**
 * Invoice send gate.
 *
 * Customers may flag `poRequiredDefault` and/or `podRequired`. When set,
 * sending the invoice requires evidence on file:
 *   - poRequiredDefault → invoice's ticket must have a CustomerPO with a poNo
 *   - podRequired       → every TicketLine the invoice covers must have at
 *                         least one PODDocument (or a ticket-wide POD covers it)
 *
 * Returns ok:true when the gate passes. Otherwise returns missing items so
 * the UI can show what's needed.
 */

import { prisma } from "@/lib/prisma";

export type SendGateResult =
  | { ok: true }
  | { ok: false; message: string; missing: string[] };

export async function evaluateInvoiceSendGate(invoiceId: string): Promise<SendGateResult> {
  const inv = await prisma.salesInvoice.findUnique({
    where: { id: invoiceId },
    include: {
      customer: { select: { id: true, name: true, podRequired: true, poRequiredDefault: true } },
      ticket:   { select: { id: true } },
      lines:    { select: { id: true, ticketLineId: true, description: true } },
    },
  });
  if (!inv) return { ok: false, message: "invoice not found", missing: ["invoice"] };

  const missing: string[] = [];

  // 1. Invoice itself — sanity check.
  if (!inv.invoiceNo) missing.push("invoice number");

  // 2. PO Required → ticket must have a CustomerPO with poNo
  if (inv.customer?.poRequiredDefault) {
    if (!inv.ticket?.id) {
      missing.push("ticket link (cannot verify customer PO without ticket)");
    } else {
      const po = await prisma.customerPO.findFirst({
        where: { ticketId: inv.ticket.id, NOT: { poNo: "" } },
        select: { id: true, poNo: true },
      });
      if (!po || !po.poNo) {
        missing.push(`customer PO number (customer "${inv.customer.name}" requires PO)`);
      }
    }
  }

  // 3. POD Required → every line that has a ticketLineId must have a POD
  //    (line-level OR ticket-wide POD covers it).
  if (inv.customer?.podRequired) {
    if (!inv.ticket?.id) {
      missing.push("ticket link (cannot verify PODs without ticket)");
    } else {
      const ticketWidePodCount = await prisma.pODDocument.count({
        where: { ticketId: inv.ticket.id, ticketLineId: null },
      });
      if (ticketWidePodCount === 0) {
        // No ticket-wide POD — every line must have its own.
        const lineIds = inv.lines.map((l) => l.ticketLineId).filter((x): x is string => !!x);
        const podRows = await prisma.pODDocument.findMany({
          where: { ticketLineId: { in: lineIds } },
          select: { ticketLineId: true },
        });
        const covered = new Set(podRows.map((p) => p.ticketLineId).filter((x): x is string => !!x));
        const uncovered = inv.lines.filter((l) => l.ticketLineId && !covered.has(l.ticketLineId));
        if (uncovered.length > 0) {
          missing.push(
            `POD for ${uncovered.length} line${uncovered.length === 1 ? "" : "s"}: ${uncovered
              .slice(0, 3)
              .map((l) => l.description.slice(0, 30))
              .join(", ")}${uncovered.length > 3 ? "…" : ""}`,
          );
        }
      }
    }
  }

  if (missing.length === 0) return { ok: true };
  return {
    ok: false,
    message: `Cannot send invoice — missing required evidence: ${missing.join("; ")}.`,
    missing,
  };
}
