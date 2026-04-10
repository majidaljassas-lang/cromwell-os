import { prisma } from "@/lib/prisma";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const enquiry = await prisma.enquiry.findUnique({
      where: { id },
      include: {
        sourceContact: true,
        suggestedSite: true,
        suggestedCustomer: true,
        workItems: true,
      },
    });
    if (!enquiry) {
      return Response.json({ error: "Enquiry not found" }, { status: 404 });
    }
    return Response.json(enquiry);
  } catch (error) {
    console.error("Failed to get enquiry:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to get enquiry" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await request.json();
    if (body.receivedAt) {
      body.receivedAt = new Date(body.receivedAt);
    }
    const enquiry = await prisma.enquiry.update({
      where: { id },
      data: body,
    });
    return Response.json(enquiry);
  } catch (error) {
    console.error("Failed to update enquiry:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to update enquiry" },
      { status: 500 }
    );
  }
}
