/**
 * Ticket status cascade — enforces rules when ticket status changes.
 *
 * Every status change triggers cascading effects:
 * - QUOTED → close all open tasks (ball is in customer's court)
 * - DELIVERED → close delivery tasks, open MATCH_BILL + MARKUP_AND_INVOICE
 * - INVOICED → close MARKUP_AND_INVOICE, open CHASE_PAYMENT
 * - CLOSED → close all tasks
 *
 * Call this AFTER updating ticket status.
 */

import { prisma } from "@/lib/prisma";

export async function cascadeTicketStatus(ticketId: string, newStatus: string) {
  switch (newStatus) {
    case "QUOTED": {
      // Ball is in customer's court — close everything
      await prisma.task.updateMany({
        where: { ticketId, status: "OPEN" },
        data: { status: "DONE" },
      });
      break;
    }

    case "ORDERED": {
      // Order confirmed — ensure delivery + bill tasks exist
      await ensureTask(ticketId, "CONFIRM_DELIVERY_RECEIPT", "HIGH", "Materials ordered — confirm delivery arrives on site");
      await ensureTask(ticketId, "MATCH_BILL_TO_TICKET", "MEDIUM", "Awaiting supplier bills — match costs when received");
      break;
    }

    case "DELIVERED": {
      // Goods on site — close delivery task, ensure bill + invoice tasks
      await prisma.task.updateMany({
        where: { ticketId, taskType: "CONFIRM_DELIVERY_RECEIPT", status: "OPEN" },
        data: { status: "DONE" },
      });
      await ensureTask(ticketId, "MATCH_BILL_TO_TICKET", "HIGH", "Materials delivered — match supplier bills to confirm costs");
      await ensureTask(ticketId, "MARKUP_AND_INVOICE", "MEDIUM", "Materials delivered — apply markup and invoice customer");
      // Update ticket timestamp
      await prisma.ticket.update({ where: { id: ticketId }, data: { deliveredAt: new Date() } });
      break;
    }

    case "INVOICED": {
      // Invoice sent — close markup task, open chase
      await prisma.task.updateMany({
        where: { ticketId, taskType: "MARKUP_AND_INVOICE", status: "OPEN" },
        data: { status: "DONE" },
      });
      await ensureTask(ticketId, "CHASE_PAYMENT", "MEDIUM", "Invoice sent — chase payment if not received");
      await prisma.ticket.update({ where: { id: ticketId }, data: { invoicedAt: new Date() } });
      break;
    }

    case "CLOSED": {
      // Job done — close everything
      await prisma.task.updateMany({
        where: { ticketId, status: "OPEN" },
        data: { status: "DONE" },
      });
      await prisma.ticket.update({ where: { id: ticketId }, data: { closedAt: new Date() } });
      break;
    }
  }
}

async function ensureTask(ticketId: string, taskType: string, priority: string, reason: string) {
  const existing = await prisma.task.findFirst({
    where: { ticketId, taskType, status: "OPEN" },
  });
  if (!existing) {
    await prisma.task.create({
      data: { ticketId, taskType, priority, status: "OPEN", generatedReason: reason },
    });
  }
}
