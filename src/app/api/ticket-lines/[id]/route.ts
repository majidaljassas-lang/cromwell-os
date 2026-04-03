import { prisma } from "@/lib/prisma";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const line = await prisma.ticketLine.findUnique({
      where: { id },
      include: {
        ticket: true,
        payingCustomer: true,
        site: true,
        siteCommercialLink: true,
      },
    });
    if (!line) {
      return Response.json(
        { error: "Ticket line not found" },
        { status: 404 }
      );
    }
    return Response.json(line);
  } catch (error) {
    console.error("Failed to get ticket line:", error);
    return Response.json(
      { error: "Failed to get ticket line" },
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
    const line = await prisma.ticketLine.update({
      where: { id },
      data: body,
    });
    return Response.json(line);
  } catch (error) {
    console.error("Failed to update ticket line:", error);
    return Response.json(
      { error: "Failed to update ticket line" },
      { status: 500 }
    );
  }
}
