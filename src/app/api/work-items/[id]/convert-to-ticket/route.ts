import { prisma } from "@/lib/prisma";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await request.json();

    const workItem = await prisma.inquiryWorkItem.findUnique({
      where: { id },
      include: { enquiry: true },
    });

    if (!workItem) {
      return Response.json({ error: "Work item not found" }, { status: 404 });
    }

    if (!workItem.customerId) {
      return Response.json(
        { error: "Work item must have a customer before converting to ticket" },
        { status: 400 }
      );
    }

    const { title, description, ...overrides } = body;

    const ticket = await prisma.$transaction(async (tx) => {
      const newTicket = await tx.ticket.create({
        data: {
          parentJobId: workItem.parentJobId,
          siteId: workItem.siteId,
          siteCommercialLinkId: workItem.siteCommercialLinkId,
          requestedByContactId: workItem.requestedByContactId,
          title: title ?? workItem.enquiry.subjectOrLabel ?? "Untitled",
          description: description ?? workItem.notes,
          status: "CAPTURED",
          ...overrides,
          payingCustomerId: workItem.customerId,
          ticketMode: workItem.mode,
          revenueState: "OPERATIONAL",
        },
      });

      await tx.inquiryWorkItem.update({
        where: { id },
        data: { status: "CONVERTED", ticketId: newTicket.id },
      });

      return newTicket;
    });

    return Response.json(ticket, { status: 201 });
  } catch (error) {
    console.error("Failed to convert work item to ticket:", error);
    return Response.json(
      { error: "Failed to convert work item to ticket" },
      { status: 500 }
    );
  }
}
