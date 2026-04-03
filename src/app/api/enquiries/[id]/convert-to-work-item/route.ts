import { prisma } from "@/lib/prisma";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: enquiryId } = await params;
  try {
    const body = await request.json();
    const { mode, notes } = body;

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

    // Transaction: create work item AND update enquiry status
    const [workItem] = await prisma.$transaction([
      prisma.inquiryWorkItem.create({
        data: {
          enquiryId,
          parentJobId: enquiry.parentJobId,
          siteId: enquiry.suggestedSiteId,
          siteCommercialLinkId: enquiry.suggestedSiteCommercialLinkId,
          customerId: enquiry.suggestedCustomerId,
          requestedByContactId: enquiry.sourceContactId,
          mode: mode as "DIRECT_ORDER" | "PRICING_FIRST" | "SPEC_DRIVEN" | "COMPETITIVE_BID" | "RECOVERY" | "CASH_SALE" | "LABOUR_ONLY" | "PROJECT_WORK" | "NON_SITE",
          status: "OPEN",
          notes,
        },
      }),
      prisma.enquiry.update({
        where: { id: enquiryId },
        data: { status: "READY_TO_CONVERT" },
      }),
    ]);

    return Response.json(workItem, { status: 201 });
  } catch (error) {
    console.error("Failed to convert enquiry to work item:", error);
    return Response.json(
      { error: "Failed to convert enquiry to work item" },
      { status: 500 }
    );
  }
}
