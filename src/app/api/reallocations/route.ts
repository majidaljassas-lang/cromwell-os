import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const reallocations = await prisma.reallocationRecord.findMany({
      include: {
        fromTicketLine: {
          include: {
            ticket: true,
          },
        },
        toTicketLine: {
          include: {
            ticket: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return Response.json(reallocations);
  } catch (error) {
    console.error("Failed to list reallocations:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to list reallocations" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { fromTicketLineId, toTicketLineId, amount, reason } = body;

    if (!fromTicketLineId || !toTicketLineId || amount === undefined) {
      return Response.json(
        {
          error:
            "Missing required fields: fromTicketLineId, toTicketLineId, amount",
        },
        { status: 400 }
      );
    }

    const reallocation = await prisma.reallocationRecord.create({
      data: {
        fromTicketLineId,
        toTicketLineId,
        amount,
        reason,
      },
      include: {
        fromTicketLine: {
          include: {
            ticket: true,
          },
        },
        toTicketLine: {
          include: {
            ticket: true,
          },
        },
      },
    });

    return Response.json(reallocation, { status: 201 });
  } catch (error) {
    console.error("Failed to create reallocation:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to create reallocation" },
      { status: 500 }
    );
  }
}
