import { prisma } from "@/lib/prisma";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const ticket = await prisma.ticket.findUnique({
      where: { id },
      include: { lines: true },
    });

    if (!ticket) {
      return Response.json({ error: "Ticket not found" }, { status: 404 });
    }

    if (ticket.status !== "VERIFIED") {
      return Response.json(
        { error: "Ticket must be in VERIFIED status to lock" },
        { status: 400 }
      );
    }

    // Lock ticket and all its lines in a transaction
    const updatedTicket = await prisma.$transaction(async (tx) => {
      // Lock all ticket lines
      await tx.ticketLine.updateMany({
        where: { ticketId: id },
        data: { isLocked: true },
      });

      // Lock the ticket itself
      return tx.ticket.update({
        where: { id },
        data: {
          isLocked: true,
          status: "LOCKED",
        },
        include: {
          lines: true,
          payingCustomer: true,
          site: true,
        },
      });
    });

    return Response.json(updatedTicket);
  } catch (error) {
    console.error("Failed to lock ticket:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to lock ticket" },
      { status: 500 }
    );
  }
}
