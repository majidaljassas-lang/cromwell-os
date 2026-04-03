import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const enquiries = await prisma.enquiry.findMany({
      include: {
        sourceContact: true,
        suggestedSite: true,
        suggestedCustomer: true,
      },
      orderBy: { receivedAt: "desc" },
    });
    return Response.json(enquiries);
  } catch (error) {
    console.error("Failed to list enquiries:", error);
    return Response.json(
      { error: "Failed to list enquiries" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { sourceType, rawText, enquiryType, receivedAt, status, ...rest } =
      body;

    if (!sourceType || !rawText || !enquiryType || !receivedAt || !status) {
      return Response.json(
        {
          error:
            "Missing required fields: sourceType, rawText, enquiryType, receivedAt, status",
        },
        { status: 400 }
      );
    }

    const enquiry = await prisma.enquiry.create({
      data: {
        sourceType,
        rawText,
        enquiryType,
        receivedAt: new Date(receivedAt),
        status,
        ...rest,
      },
    });
    return Response.json(enquiry, { status: 201 });
  } catch (error) {
    console.error("Failed to create enquiry:", error);
    return Response.json(
      { error: "Failed to create enquiry" },
      { status: 500 }
    );
  }
}
