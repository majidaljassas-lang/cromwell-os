import { prisma } from "@/lib/prisma";

interface TicketLine {
  id: string;
  expectedCostUnit: unknown;
  expectedCostTotal: unknown;
  actualCostTotal: unknown;
}

interface QuoteSummary {
  id: string;
  status: string;
  issuedAt: Date | null;
}

interface ProcurementOrderSummary {
  id: string;
  status: string;
}

interface InvoiceSummary {
  id: string;
  status: string;
}

interface TaskSummary {
  id: string;
  taskType: string;
  status: string;
}

// Task definitions: taskType, description, priority, and conditions
const TASK_DEFS = [
  {
    taskType: "REVIEW_ENQUIRY",
    description: "Review enquiry & extract line items",
    priority: "MEDIUM",
  },
  {
    taskType: "PRICE_ITEMS",
    description: "Price items -- get supplier costs",
    priority: "MEDIUM",
  },
  {
    taskType: "PREPARE_QUOTE",
    description: "Prepare and send quote",
    priority: "MEDIUM",
  },
  {
    taskType: "FOLLOW_UP_QUOTE",
    description: "Follow up on quote response",
    priority: "HIGH",
  },
  {
    taskType: "OBTAIN_PO",
    description: "Obtain customer PO",
    priority: "MEDIUM",
  },
  {
    taskType: "PLACE_ORDERS",
    description: "Place orders with suppliers",
    priority: "MEDIUM",
  },
  {
    taskType: "TRACK_DELIVERY",
    description: "Track delivery",
    priority: "MEDIUM",
  },
  {
    taskType: "VERIFY_DELIVERY",
    description: "Verify delivery & reconcile costs",
    priority: "HIGH",
  },
  {
    taskType: "GENERATE_INVOICE",
    description: "Generate and send invoice",
    priority: "MEDIUM",
  },
  {
    taskType: "CHASE_PAYMENT",
    description: "Chase payment",
    priority: "HIGH",
  },
] as const;

const CLOSED_STATUSES = ["CLOSED", "INVOICED"] as const;
const DELIVERED_OR_LATER = [
  "DELIVERED",
  "COSTED",
  "VERIFIED",
  "LOCKED",
  "INVOICED",
  "CLOSED",
] as const;
const COSTED_OR_LATER = [
  "COSTED",
  "VERIFIED",
  "LOCKED",
  "INVOICED",
  "CLOSED",
] as const;

export async function POST() {
  try {
    const tickets = await prisma.ticket.findMany({
      where: {
        status: { notIn: [...CLOSED_STATUSES] },
      },
      include: {
        lines: {
          select: {
            id: true,
            expectedCostUnit: true,
            expectedCostTotal: true,
            actualCostTotal: true,
          },
        },
        quotes: {
          select: { id: true, status: true, issuedAt: true },
        },
        customerPOs: {
          select: { id: true },
        },
        procurementOrders: {
          select: { id: true, status: true },
        },
        invoices: {
          select: { id: true, status: true },
        },
        tasks: {
          select: { id: true, taskType: true, status: true },
        },
      },
    });

    let tasksCreated = 0;
    let tasksClosed = 0;

    for (const ticket of tickets) {
      const existingTasks = ticket.tasks;
      const lines = ticket.lines;
      const quotes = ticket.quotes;
      const customerPOs = ticket.customerPOs;
      const procurementOrders = ticket.procurementOrders;
      const invoices = ticket.invoices;

      // Derived conditions
      const hasLines = lines.length > 0;
      const linesWithNoCost = lines.filter(
        (l: TicketLine) => l.expectedCostUnit === null && l.expectedCostTotal === null
      );
      const allLinesCosted =
        hasLines && linesWithNoCost.length === 0;
      const hasQuote = quotes.length > 0;
      const quoteSent = quotes.some(
        (q: QuoteSummary) => q.status === "SENT" || q.status === "APPROVED"
      );
      const quoteApproved = quotes.some((q: QuoteSummary) => q.status === "APPROVED");
      const hasPO = customerPOs.length > 0;
      const hasProcurementOrder = procurementOrders.length > 0;
      const statusDeliveredOrLater = (
        DELIVERED_OR_LATER as readonly string[]
      ).includes(ticket.status);
      const statusCostedOrLater = (
        COSTED_OR_LATER as readonly string[]
      ).includes(ticket.status);
      const hasInvoice = invoices.length > 0;
      const invoicePaid = invoices.some((inv: InvoiceSummary) => inv.status === "PAID");

      // Determine which tasks should exist and which should be closed
      const taskConditions: Record<
        string,
        { shouldExist: boolean; shouldClose: boolean; dueAt?: Date }
      > = {
        REVIEW_ENQUIRY: {
          shouldExist: !hasLines,
          shouldClose: hasLines,
        },
        PRICE_ITEMS: {
          shouldExist: hasLines && linesWithNoCost.length > 0,
          shouldClose: allLinesCosted,
        },
        PREPARE_QUOTE: {
          shouldExist: allLinesCosted && !hasQuote,
          shouldClose: hasQuote,
        },
        FOLLOW_UP_QUOTE: {
          shouldExist: quoteSent && !quoteApproved,
          shouldClose: quoteApproved,
          dueAt: (() => {
            const sentQuote = quotes.find((q: QuoteSummary) => q.status === "SENT");
            if (sentQuote?.issuedAt) {
              const due = new Date(sentQuote.issuedAt);
              due.setDate(due.getDate() + 3);
              return due;
            }
            return undefined;
          })(),
        },
        OBTAIN_PO: {
          shouldExist: quoteApproved && !hasPO,
          shouldClose: hasPO,
        },
        PLACE_ORDERS: {
          shouldExist: hasPO && !hasProcurementOrder,
          shouldClose: hasProcurementOrder,
        },
        TRACK_DELIVERY: {
          shouldExist: hasProcurementOrder && !statusDeliveredOrLater,
          shouldClose: statusDeliveredOrLater,
        },
        VERIFY_DELIVERY: {
          shouldExist: statusDeliveredOrLater && !statusCostedOrLater,
          shouldClose: statusCostedOrLater,
        },
        GENERATE_INVOICE: {
          shouldExist: statusCostedOrLater && !hasInvoice,
          shouldClose: hasInvoice,
        },
        CHASE_PAYMENT: {
          shouldExist: hasInvoice && !invoicePaid,
          shouldClose: invoicePaid,
        },
      };

      for (const def of TASK_DEFS) {
        const condition = taskConditions[def.taskType];
        if (!condition) continue;

        const existingTask = existingTasks.find(
          (t: TaskSummary) => t.taskType === def.taskType
        );

        // Auto-close: if an OPEN task should be closed, complete it
        if (
          existingTask &&
          existingTask.status === "OPEN" &&
          condition.shouldClose
        ) {
          await prisma.task.update({
            where: { id: existingTask.id },
            data: { status: "COMPLETED" },
          });
          tasksClosed++;
          continue;
        }

        // Auto-create: if task should exist and no task of this type exists
        if (condition.shouldExist && !existingTask) {
          await prisma.task.create({
            data: {
              ticketId: ticket.id,
              taskType: def.taskType,
              priority: def.priority,
              status: "OPEN",
              generatedReason: def.description,
              dueAt: condition.dueAt ?? null,
            },
          });
          tasksCreated++;
        }
      }
    }

    return Response.json({
      ok: true,
      ticketsScanned: tickets.length,
      tasksCreated,
      tasksClosed,
    });
  } catch (error) {
    console.error("generate-tasks failed:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to generate tasks" },
      { status: 500 }
    );
  }
}
