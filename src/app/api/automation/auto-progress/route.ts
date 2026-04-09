import { prisma } from "@/lib/prisma";

/**
 * Auto-progress ticket status based on data conditions.
 *
 * Progression rules:
 *   CAPTURED  -> PRICING    : when ticket has lines
 *   PRICING   -> QUOTED     : when a quote exists
 *   QUOTED    -> APPROVED   : when a quote has status APPROVED
 *   APPROVED  -> ORDERED    : when a ProcurementOrder exists
 *   ORDERED   -> DELIVERED  : when a LogisticsEvent with type DELIVERED exists
 *   DELIVERED -> COSTED     : when all lines have cost allocations
 *
 * Does NOT progress beyond COSTED (invoicing/payment is manual).
 * Idempotent and safe to run repeatedly.
 */

const PROGRESSABLE_STATUSES = [
  "CAPTURED",
  "PRICING",
  "QUOTED",
  "APPROVED",
  "ORDERED",
  "DELIVERED",
] as const;

type ProgressableStatus = (typeof PROGRESSABLE_STATUSES)[number];

export async function POST() {
  try {
    // Fetch all tickets in progressable statuses
    const tickets = await prisma.ticket.findMany({
      where: {
        status: { in: [...PROGRESSABLE_STATUSES] },
      },
      include: {
        lines: {
          include: {
            costAllocations: true,
          },
        },
        quotes: true,
        procurementOrders: true,
        logisticsEvents: true,
      },
    });

    const results = {
      checked: tickets.length,
      progressed: 0,
      details: [] as {
        ticketId: string;
        title: string;
        from: string;
        to: string;
        reason: string;
      }[],
    };

    for (const ticket of tickets) {
      const status = ticket.status as ProgressableStatus;
      let newStatus: string | null = null;
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
          if (ticket.quotes.length > 0) {
            newStatus = "QUOTED";
            reason = `Quote ${ticket.quotes[0].quoteNo} exists`;
          }
          break;
        }

        case "QUOTED": {
          const approvedQuote = ticket.quotes.find(
            (q: { status: string; quoteNo: string }) => q.status === "APPROVED"
          );
          if (approvedQuote) {
            newStatus = "APPROVED";
            reason = `Quote ${approvedQuote.quoteNo} approved`;
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
          const deliveryEvent = ticket.logisticsEvents.find(
            (e: { eventType: string; timestamp: Date }) => e.eventType === "DELIVERED"
          );
          if (deliveryEvent) {
            newStatus = "DELIVERED";
            reason = `Delivery event logged at ${deliveryEvent.timestamp.toISOString().split("T")[0]}`;
          }
          break;
        }

        case "DELIVERED": {
          // All lines must have at least one cost allocation
          const linesWithoutCost = ticket.lines.filter(
            (line: { costAllocations: unknown[]; status: string }) =>
              line.costAllocations.length === 0 &&
              line.status !== "RETURNED" &&
              line.status !== "CLOSED"
          );
          if (ticket.lines.length > 0 && linesWithoutCost.length === 0) {
            newStatus = "COSTED";
            reason = `All ${ticket.lines.length} line(s) have cost allocations`;
          }
          break;
        }
      }

      if (newStatus) {
        await prisma.$transaction(async (tx: typeof prisma) => {
          await tx.ticket.update({
            where: { id: ticket.id },
            data: { status: newStatus as ProgressableStatus },
          });

          await tx.event.create({
            data: {
              ticketId: ticket.id,
              eventType: "AUTO_STATUS_PROGRESSED",
              timestamp: new Date(),
              notes: `Auto-progressed ${status} -> ${newStatus}: ${reason}`,
            },
          });
        });

        results.progressed++;
        results.details.push({
          ticketId: ticket.id,
          title: ticket.title,
          from: status,
          to: newStatus,
          reason,
        });
      }
    }

    return Response.json({
      ...results,
      message: `Checked ${results.checked} tickets, progressed ${results.progressed}`,
    });
  } catch (error) {
    console.error("Auto-progress failed:", error);
    return Response.json(
      { error: "Auto-progress failed" },
      { status: 500 }
    );
  }
}
