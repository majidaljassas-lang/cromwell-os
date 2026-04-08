import { prisma } from "@/lib/prisma";

/**
 * Auto-progress ticket status based on the state of its lines and events.
 *
 * Full lifecycle:
 *   CAPTURED → PRICING → QUOTED → APPROVED → ORDERED → DELIVERED → COSTED → INVOICED → CLOSED
 *
 * Rules:
 * - All lines priced → PRICING
 * - Quote exists → QUOTED
 * - Quote approved → APPROVED
 * - All lines ORDERED/FROM_STOCK → ORDERED
 * - Delivery event logged → DELIVERED
 * - All lines FULLY_COSTED → COSTED
 * - All lines INVOICED → INVOICED
 *
 * Only progresses forward, never regresses.
 */

const TICKET_ORDER = [
  "CAPTURED", "PRICING", "QUOTED", "APPROVED", "ORDERED",
  "DELIVERED", "COSTED", "PENDING_PO", "RECOVERY", "VERIFIED",
  "LOCKED", "INVOICED", "CLOSED",
];

const ORDERED_STATUSES = ["ORDERED", "FROM_STOCK", "PARTIALLY_COSTED", "FULLY_COSTED", "INVOICED", "CLOSED"];
const COSTED_STATUSES = ["FULLY_COSTED", "INVOICED", "CLOSED"];
const INVOICED_STATUSES = ["INVOICED", "CLOSED"];

export async function autoProgressTicket(ticketId: string) {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: { status: true },
  });
  if (!ticket) return;

  const lines = await prisma.ticketLine.findMany({
    where: { ticketId },
    select: { status: true },
  });
  if (lines.length === 0) return;

  const currentIdx = TICKET_ORDER.indexOf(ticket.status);
  let newStatus = ticket.status;

  // All lines invoiced → INVOICED
  if (lines.every((l) => INVOICED_STATUSES.includes(l.status)) && currentIdx < TICKET_ORDER.indexOf("INVOICED")) {
    newStatus = "INVOICED";
  }
  // All lines costed → COSTED
  else if (lines.every((l) => COSTED_STATUSES.includes(l.status)) && currentIdx < TICKET_ORDER.indexOf("COSTED")) {
    newStatus = "COSTED";
  }
  // Check for delivery events → DELIVERED
  else if (currentIdx <= TICKET_ORDER.indexOf("ORDERED")) {
    const allOrdered = lines.every((l) => ORDERED_STATUSES.includes(l.status) || l.status === "PARTIALLY_ORDERED");
    if (allOrdered && currentIdx < TICKET_ORDER.indexOf("ORDERED")) {
      newStatus = "ORDERED";
    }

    // If already ORDERED, check for delivery events
    if (newStatus === "ORDERED" || ticket.status === "ORDERED") {
      const deliveryEvents = await prisma.event.count({
        where: { ticketId, eventType: "GOODS_DELIVERED" },
      });
      if (deliveryEvents > 0) {
        newStatus = "DELIVERED";
      }
    }
  }

  if (newStatus !== ticket.status) {
    await prisma.ticket.update({
      where: { id: ticketId },
      data: { status: newStatus },
    });
  }
}
