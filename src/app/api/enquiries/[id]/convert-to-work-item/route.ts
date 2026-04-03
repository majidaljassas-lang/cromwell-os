import { prisma } from "@/lib/prisma";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: enquiryId } = await params;
  try {
    const body = await request.json();
    const { mode, notes, customerId, createTicket } = body;

    if (!mode) {
      return Response.json(
        { error: "Missing required field: mode" },
        { status: 400 }
      );
    }

    const enquiry = await prisma.enquiry.findUnique({
      where: { id: enquiryId },
      include: { workItems: { select: { id: true, status: true, customerId: true } } },
    });

    if (!enquiry) {
      return Response.json({ error: "Enquiry not found" }, { status: 404 });
    }

    // Step 1: Get or create work item
    let workItemId: string;
    let workItemCustomerId: string | null;

    if (enquiry.workItems.length > 0) {
      // Work item already exists — use it
      workItemId = enquiry.workItems[0].id;
      workItemCustomerId = enquiry.workItems[0].customerId;

      // Heal enquiry status if stuck
      if (enquiry.status === "OPEN") {
        await prisma.enquiry.update({
          where: { id: enquiryId },
          data: { status: "READY_TO_CONVERT" },
        });
      }
    } else {
      // Create new work item
      const workItem = await prisma.inquiryWorkItem.create({
        data: {
          enquiryId,
          parentJobId: enquiry.parentJobId,
          siteId: enquiry.suggestedSiteId,
          siteCommercialLinkId: enquiry.suggestedSiteCommercialLinkId,
          customerId: customerId || enquiry.suggestedCustomerId,
          requestedByContactId: enquiry.sourceContactId,
          mode: mode as "DIRECT_ORDER" | "PRICING_FIRST" | "SPEC_DRIVEN" | "COMPETITIVE_BID" | "RECOVERY" | "CASH_SALE" | "LABOUR_ONLY" | "PROJECT_WORK" | "NON_SITE",
          status: "OPEN",
          notes,
        },
      });

      await prisma.enquiry.update({
        where: { id: enquiryId },
        data: { status: "READY_TO_CONVERT" },
      });

      workItemId = workItem.id;
      workItemCustomerId = workItem.customerId;
    }

    // Step 2: If createTicket requested, convert work item → ticket
    if (createTicket) {
      const resolvedCustomerId = customerId || workItemCustomerId;

      if (!resolvedCustomerId) {
        return Response.json({
          workItemId,
          needsCustomer: true,
          error: "Customer required to create ticket. Pass customerId in the request.",
        }, { status: 422 });
      }

      // Update work item with customer if it was missing
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
            ticketMode: mode as "DIRECT_ORDER" | "PRICING_FIRST" | "SPEC_DRIVEN" | "COMPETITIVE_BID" | "RECOVERY" | "CASH_SALE" | "LABOUR_ONLY" | "PROJECT_WORK" | "NON_SITE",
            status: "CAPTURED",
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

      return Response.json({ workItemId, ticket, converted: true }, { status: 201 });
    }

    // If not creating ticket, just return the work item
    return Response.json({ workItemId, converted: false }, { status: 201 });
  } catch (error) {
    console.error("Failed to convert enquiry:", error);
    return Response.json(
      { error: "Failed to convert enquiry" },
      { status: 500 }
    );
  }
}
