import { prisma } from "@/lib/prisma";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const ticket = await prisma.ticket.findUnique({
      where: { id },
      include: {
        lines: true,
        payingCustomer: true,
        site: true,
        siteCommercialLink: true,
        events: true,
        tasks: true,
        evidenceFragments: true,
        recoveryCases: true,
      },
    });
    if (!ticket) {
      return Response.json({ error: "Ticket not found" }, { status: 404 });
    }
    return Response.json(ticket);
  } catch (error) {
    console.error("Failed to get ticket:", error);
    return Response.json(
      { error: "Failed to get ticket" },
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
    const ticket = await prisma.ticket.update({
      where: { id },
      data: body,
    });
    return Response.json(ticket);
  } catch (error) {
    console.error("Failed to update ticket:", error);
    return Response.json(
      { error: "Failed to update ticket" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    // Delete related records first
    await prisma.customerPO.deleteMany({ where: { ticketId: id } });
    await prisma.quote.deleteMany({ where: { ticketId: id } });
    await prisma.ticketLine.deleteMany({ where: { ticketId: id } });
    await prisma.event.deleteMany({ where: { ticketId: id } });
    await prisma.ticket.delete({ where: { id } });
    return Response.json({ deleted: true });
  } catch (error) {
    console.error("Failed to delete ticket:", error);
    return Response.json({ error: "Failed to delete ticket" }, { status: 500 });
  }
}
