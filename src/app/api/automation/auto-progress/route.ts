import { prisma } from "@/lib/prisma";

/**
 * Auto-progress ticket status based on data conditions.
 *
 * Progression rules:
 *   CAPTURED  -> PRICING    : when lines.length > 0
 *   PRICING   -> QUOTED     : when an APPROVED quote exists
 *   QUOTED    -> APPROVED   : when CustomerPO exists
 *   APPROVED  -> ORDERED    : when ProcurementOrder exists
 *   ORDERED   -> DELIVERED  : when ProcurementOrder.status = DELIVERED
 *                             OR LogisticsEvent type = GOODS_DELIVERED
 *   DELIVERED -> COSTED     : when all lines have expectedCostUnit > 0
 *   COSTED    -> INVOICED   : when SalesInvoice with status SENT or PAID exists
 *
 * Idempotent and safe to run repeatedly. Uses select-only queries on TicketLine
 * so it does not choke on legacy TicketLine.status values that are missing from
 * the current Prisma enum.
 */

const PROGRESSABLE_STATUSES = [
  "CAPTURED",
  "PRICING",
  "QUOTED",
  "APPROVED",
  "ORDERED",
  "DELIVERED",
  "COSTED",
] as const;

type ProgressableStatus = (typeof PROGRESSABLE_STATUSES)[number];

interface Transition {
  ticketId: string;
  ticketNo: number;
  title: string;
  from: string;
  to: string;
  reason: string;
}

export async function POST() {
  try {
    // Fetch all active tickets (not CLOSED, not INVOICED).
    // Use select to avoid deserialising TicketLine.status, which may contain
    // legacy values not present in the current Prisma enum.
    const tickets = await prisma.ticket.findMany({
      where: {
        status: { in: [...PROGRESSABLE_STATUSES] as any },
      },
      select: {
        id: true,
        ticketNo: true,
        title: true,
        status: true,
        lines: {
          select: {
            id: true,
            expectedCostUnit: true,
          },
        },
        quotes: {
          select: { id: true, quoteNo: true, status: true },
        },
        customerPOs: {
          select: { id: true, poNo: true },
        },
        procurementOrders: {
          select: { id: true, poNo: true, status: true },
        },
        logisticsEvents: {
          select: { id: true, eventType: true, timestamp: true },
        },
        invoices: {
          select: { id: true, invoiceNo: true, status: true },
        },
      },
    });

    const transitions: Transition[] = [];

    for (const ticket of tickets) {
      const status = ticket.status as ProgressableStatus;
      let newStatus: ProgressableStatus | "INVOICED" | null = null;
      let reason = "";

      switch (status) {
        case "CAPTURED": {
          if (ticket.lines.length > 0) {
            newStatus = "PRICING";
            reason = `${ticket.lines.length} line(s) added`;
          }
          break;
        }

        case "PRICING": {
          const approvedQuote = ticket.quotes.find(
            (q) => q.status === "APPROVED"
          );
          if (approvedQuote) {
            newStatus = "QUOTED";
            reason = `Quote ${approvedQuote.quoteNo} approved`;
          }
          break;
        }

        case "QUOTED": {
          if (ticket.customerPOs.length > 0) {
            newStatus = "APPROVED";
            reason = `Customer PO ${ticket.customerPOs[0].poNo} received`;
          }
          break;
        }

        case "APPROVED": {
          if (ticket.procurementOrders.length > 0) {
            newStatus = "ORDERED";
            reason = `Procurement order ${ticket.procurementOrders[0].poNo} exists`;
          }
          break;
        }

        case "ORDERED": {
          const deliveredPO = ticket.procurementOrders.find(
            (po) => (po.status || "").toUpperCase() === "DELIVERED"
          );
          const deliveryEvent = ticket.logisticsEvents.find(
            (e) => (e.eventType || "").toUpperCase() === "GOODS_DELIVERED"
          );
          if (deliveredPO) {
            newStatus = "DELIVERED";
            reason = `Procurement order ${deliveredPO.poNo} marked DELIVERED`;
          } else if (deliveryEvent) {
            newStatus = "DELIVERED";
            reason = `GOODS_DELIVERED event logged at ${deliveryEvent.timestamp
              .toISOString()
              .split("T")[0]}`;
          }
          break;
        }

        case "DELIVERED": {
          if (ticket.lines.length === 0) break;
          const allCosted = ticket.lines.every(
            (l) => l.expectedCostUnit != null && Number(l.expectedCostUnit) > 0
          );
          if (allCosted) {
            newStatus = "COSTED";
            reason = `All ${ticket.lines.length} line(s) have expectedCostUnit > 0`;
          }
          break;
        }

        case "COSTED": {
          const sentOrPaidInvoice = ticket.invoices.find((inv) => {
            const s = (inv.status || "").toUpperCase();
            return s === "SENT" || s === "PAID";
          });
          if (sentOrPaidInvoice) {
            newStatus = "INVOICED";
            reason = `Sales invoice ${sentOrPaidInvoice.invoiceNo ?? sentOrPaidInvoice.id} is ${sentOrPaidInvoice.status}`;
          }
          break;
        }
      }

      if (newStatus) {
        await prisma.$transaction(async (tx) => {
          await tx.ticket.update({
            where: { id: ticket.id },
            data: { status: newStatus as any },
          });

          await tx.event.create({
            data: {
              ticketId: ticket.id,
              eventType: "AUTO_STATUS_PROGRESSED" as any,
              timestamp: new Date(),
              notes: `Auto-progressed ${status} -> ${newStatus}: ${reason}`,
            },
          });
        });

        transitions.push({
          ticketId: ticket.id,
          ticketNo: ticket.ticketNo,
          title: ticket.title,
          from: status,
          to: newStatus,
          reason,
        });
      }
    }

    return Response.json({
      ok: true,
      ticketsScanned: tickets.length,
      transitionsApplied: transitions.length,
      transitions,
      message: `Scanned ${tickets.length} tickets, progressed ${transitions.length}`,
    });
  } catch (error) {
    console.error("Auto-progress failed:", error);
    return Response.json(
      {
        error: "Auto-progress failed",
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
