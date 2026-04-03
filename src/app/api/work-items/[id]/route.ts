import { prisma } from "@/lib/prisma";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const workItem = await prisma.inquiryWorkItem.findUnique({
      where: { id },
      include: {
        enquiry: true,
        site: true,
        siteCommercialLink: true,
        customer: true,
        requestedByContact: true,
      },
    });
    if (!workItem) {
      return Response.json({ error: "Work item not found" }, { status: 404 });
    }
    return Response.json(workItem);
  } catch (error) {
    console.error("Failed to get work item:", error);
    return Response.json(
      { error: "Failed to get work item" },
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
    const workItem = await prisma.inquiryWorkItem.update({
      where: { id },
      data: body,
    });
    return Response.json(workItem);
  } catch (error) {
    console.error("Failed to update work item:", error);
    return Response.json(
      { error: "Failed to update work item" },
      { status: 500 }
    );
  }
}
