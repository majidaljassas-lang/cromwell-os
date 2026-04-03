import { prisma } from "@/lib/prisma";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const quote = await prisma.quote.findUnique({
      where: { id },
      include: {
        lines: {
          include: { ticketLine: true },
        },
        customer: true,
      },
    });

    if (!quote) {
      return Response.json({ error: "Quote not found" }, { status: 404 });
    }

    return Response.json(quote);
  } catch (error) {
    console.error("Failed to fetch quote:", error);
    return Response.json({ error: "Failed to fetch quote" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const quote = await prisma.quote.update({
      where: { id },
      data: body,
    });

    return Response.json(quote);
  } catch (error) {
    console.error("Failed to update quote:", error);
    return Response.json({ error: "Failed to update quote" }, { status: 500 });
  }
}
