import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const tickets = await prisma.ticket.findMany({
      include: {
        payingCustomer: true,
        site: true,
        _count: { select: { lines: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return Response.json(tickets);
  } catch (error) {
    console.error("Failed to list tickets:", error);
    return Response.json(
      { error: "Failed to list tickets" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { payingCustomerId, title, ticketMode, status, ...rest } = body;

    if (!payingCustomerId || !title || !ticketMode || !status) {
      return Response.json(
        {
          error:
            "Missing required fields: payingCustomerId, title, ticketMode, status",
        },
        { status: 400 }
      );
    }

    const ticket = await prisma.ticket.create({
      data: {
        payingCustomerId,
        title,
        ticketMode,
        status,
        ...rest,
      },
    });
    return Response.json(ticket, { status: 201 });
  } catch (error) {
    console.error("Failed to create ticket:", error);
    return Response.json(
      { error: "Failed to create ticket" },
      { status: 500 }
    );
  }
}
