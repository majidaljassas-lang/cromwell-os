import { prisma } from "@/lib/prisma";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: enquiryId } = await params;
  try {
    const { mode, ...rest } = await request.json();

    if (!mode) {
      return Response.json(
        { error: "Missing required field: mode" },
        { status: 400 }
      );
    }

    const enquiry = await prisma.enquiry.findUnique({
      where: { id: enquiryId },
    });

    if (!enquiry) {
      return Response.json({ error: "Enquiry not found" }, { status: 404 });
    }

    const workItem = await prisma.inquiryWorkItem.create({
      data: {
        enquiryId,
        parentJobId: enquiry.parentJobId,
        siteId: enquiry.suggestedSiteId,
        siteCommercialLinkId: enquiry.suggestedSiteCommercialLinkId,
        customerId: enquiry.suggestedCustomerId,
        requestedByContactId: enquiry.sourceContactId,
        mode,
        status: "OPEN",
        ...rest,
      },
    });

    return Response.json(workItem, { status: 201 });
  } catch (error) {
    console.error("Failed to convert enquiry to work item:", error);
    return Response.json(
      { error: "Failed to convert enquiry to work item" },
      { status: 500 }
    );
  }
}
