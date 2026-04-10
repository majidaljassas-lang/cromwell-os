import { prisma } from "@/lib/prisma";

/**
 * POST /api/enquiries/[id]/convert-to-work-item
 *
 * FLOW: Enquiry → Tasks → Decision → Ticket
 *
 * This endpoint creates a work item and validation tasks.
 * Ticket creation ONLY happens when:
 *   - All validation tasks are complete (status = READY_FOR_TICKET)
 *   - User explicitly requests ticket creation (createTicket = true)
 *   - AND customer is resolved
 *
 * Body: { mode, notes?, customerId?, createTicket?: boolean }
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: enquiryId } = await params;
  try {
    const body = await request.json();
    const { mode, notes, customerId, createTicket } = body;

    if (!mode) {
      return Response.json({ error: "Missing required field: mode" }, { status: 400 });
    }

    const enquiry = await prisma.enquiry.findUnique({
      where: { id: enquiryId },
      include: {
        workItems: { select: { id: true, status: true, customerId: true } },
        enquiryTasks: { select: { id: true, taskType: true, status: true } },
      },
    });

    if (!enquiry) {
      return Response.json({ error: "Enquiry not found" }, { status: 404 });
    }

    // Step 1: Get or create work item
    let workItemId: string;
    let workItemCustomerId: string | null;

    if (enquiry.workItems.length > 0) {
      workItemId = enquiry.workItems[0].id;
      workItemCustomerId = enquiry.workItems[0].customerId;
    } else {
      const workItem = await prisma.inquiryWorkItem.create({
        data: {
          enquiryId,
          parentJobId: enquiry.parentJobId,
          siteId: enquiry.suggestedSiteId,
          siteCommercialLinkId: enquiry.suggestedSiteCommercialLinkId,
          customerId: customerId || enquiry.suggestedCustomerId,
          requestedByContactId: enquiry.sourceContactId,
          mode: mode as any,
          status: "OPEN",
          notes,
        },
      });
      workItemId = workItem.id;
      workItemCustomerId = workItem.customerId;
    }

    // Step 2: Create validation tasks if not already created
    if (enquiry.enquiryTasks.length === 0) {
      const taskTypes = [
        "REVIEW_ENQUIRY",
        "IDENTIFY_CUSTOMER",
        "IDENTIFY_SITE",
        "EXTRACT_SCOPE",
        "VALIDATE_SCOPE",
      ];
      for (const taskType of taskTypes) {
        await prisma.enquiryTask.create({
          data: { enquiryId, taskType },
        });
      }
    }

    // Update enquiry status to IN_REVIEW
    await prisma.enquiry.update({
      where: { id: enquiryId },
      data: { status: "IN_REVIEW" },
    });

    // Step 3: Only create ticket if explicitly requested AND validation complete
    if (createTicket) {
      // Auto-complete all pending tasks when customer is already resolved
      const tasks = await prisma.enquiryTask.findMany({
        where: { enquiryId },
      });
      const pendingTasks = tasks.filter((t) => t.status !== "COMPLETE");
      if (pendingTasks.length > 0 && (customerId || workItemCustomerId)) {
        await prisma.enquiryTask.updateMany({
          where: { enquiryId, status: { not: "COMPLETE" } },
          data: { status: "COMPLETE" },
        });
      }

      const resolvedCustomerId = customerId || workItemCustomerId;
      if (!resolvedCustomerId) {
        return Response.json({
          workItemId,
          converted: false,
          needsCustomer: true,
          error: "Customer required to create ticket.",
        }, { status: 422 });
      }

      // Update work item customer if missing
      if (!workItemCustomerId && resolvedCustomerId) {
        await prisma.inquiryWorkItem.update({
          where: { id: workItemId },
          data: { customerId: resolvedCustomerId },
        });
      }

      const [ticket] = await prisma.$transaction([
        prisma.ticket.create({
          data: {
            parentJobId: enquiry.parentJobId,
            siteId: enquiry.suggestedSiteId,
            siteCommercialLinkId: enquiry.suggestedSiteCommercialLinkId,
            payingCustomerId: resolvedCustomerId,
            requestedByContactId: enquiry.sourceContactId,
            title: enquiry.subjectOrLabel || enquiry.rawText.slice(0, 80),
            description: enquiry.rawText,
            ticketMode: mode as any,
            status: "CAPTURED",
            revenueState: "OPERATIONAL",
          },
        }),
        prisma.inquiryWorkItem.update({
          where: { id: workItemId },
          data: { status: "CONVERTED" },
        }),
        prisma.enquiry.update({
          where: { id: enquiryId },
          data: { status: "CONVERTED" },
        }),
      ]);

      await prisma.event.create({
        data: {
          ticketId: ticket.id,
          eventType: "ENQUIRY_LOGGED",
          timestamp: new Date(),
          notes: `Converted from enquiry: ${enquiry.subjectOrLabel || 'Untitled'}`,
        },
      });

      return Response.json({ workItemId, ticket, converted: true }, { status: 201 });
    }

    // Not creating ticket — return work item with tasks
    const tasks = await prisma.enquiryTask.findMany({
      where: { enquiryId },
      orderBy: { createdAt: "asc" },
    });

    return Response.json({
      workItemId,
      converted: false,
      status: "IN_REVIEW",
      tasks: tasks.map((t) => ({ id: t.id, taskType: t.taskType, status: t.status })),
    }, { status: 201 });
  } catch (error) {
    console.error("Failed to convert enquiry:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Failed to convert enquiry" }, { status: 500 });
  }
}
