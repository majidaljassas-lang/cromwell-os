import { prisma } from "@/lib/prisma";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: ticketId } = await params;
  try {
    const body = await request.json();
    const { lineType, description, qty, unit, payingCustomerId, status, ...rest } =
      body;

    if (!lineType || !description || qty === undefined || !unit || !payingCustomerId || !status) {
      return Response.json(
        {
          error:
            "Missing required fields: lineType, description, qty, unit, payingCustomerId, status",
        },
        { status: 400 }
      );
    }

    const line = await prisma.ticketLine.create({
      data: {
        ticketId,
        lineType,
        description,
        qty,
        unit,
        payingCustomerId,
        status,
        ...rest,
      },
    });
    return Response.json(line, { status: 201 });
  } catch (error) {
    console.error("Failed to create ticket line:", error);
    return Response.json(
      { error: "Failed to create ticket line" },
      { status: 500 }
    );
  }
}
