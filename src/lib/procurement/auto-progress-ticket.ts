import { prisma } from "@/lib/prisma";

/**
 * Check if all lines on a ticket are fulfilled (ORDERED, FROM_STOCK, or beyond)
 * and auto-progress the ticket status accordingly.
 *
 * Rules:
 * - All lines ORDERED/FROM_STOCK/PARTIALLY_COSTED/FULLY_COSTED/INVOICED/CLOSED → ticket ORDERED
 * - All lines FULLY_COSTED or beyond → ticket COSTED
 * - All lines INVOICED or CLOSED → ticket INVOICED
 *
 * Only progresses forward, never regresses.
 */

const FULFILLED_STATUSES = [
  "ORDERED",
  "FROM_STOCK",
  "PARTIALLY_COSTED",
  "FULLY_COSTED",
  "INVOICED",
  "CLOSED",
];

const COSTED_STATUSES = ["FULLY_COSTED", "INVOICED", "CLOSED"];
const INVOICED_STATUSES = ["INVOICED", "CLOSED"];

const TICKET_ORDER = [
  "CAPTURED",
  "PRICING",
  "QUOTED",
  "APPROVED",
  "ORDERED",
  "DELIVERED",
  "COSTED",
  "PENDING_PO",
  "RECOVERY",
  "VERIFIED",
  "LOCKED",
  "INVOICED",
  "CLOSED",
];

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

  // Check all lines fulfilled → ORDERED
  const allFulfilled = lines.every((l) => FULFILLED_STATUSES.includes(l.status));
  if (allFulfilled && currentIdx < TICKET_ORDER.indexOf("ORDERED")) {
    await prisma.ticket.update({
      where: { id: ticketId },
      data: { status: "ORDERED" },
    });
    return;
  }

  // Check all lines costed → COSTED
  const allCosted = lines.every((l) => COSTED_STATUSES.includes(l.status));
  if (allCosted && currentIdx < TICKET_ORDER.indexOf("COSTED")) {
    await prisma.ticket.update({
      where: { id: ticketId },
      data: { status: "COSTED" },
    });
    return;
  }

  // Check all lines invoiced → INVOICED
  const allInvoiced = lines.every((l) => INVOICED_STATUSES.includes(l.status));
  if (allInvoiced && currentIdx < TICKET_ORDER.indexOf("INVOICED")) {
    await prisma.ticket.update({
      where: { id: ticketId },
      data: { status: "INVOICED" },
    });
    return;
  }
}
