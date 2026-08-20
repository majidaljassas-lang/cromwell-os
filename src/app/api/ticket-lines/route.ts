import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const ticketId = url.searchParams.get("ticketId");
  if (!ticketId) return Response.json({ error: "ticketId required" }, { status: 400 });

  const lines = await prisma.ticketLine.findMany({
    where: { ticketId },
    select: { id: true, description: true, sectionLabel: true, isBomParent: true, qty: true, expectedCostUnit: true },
    orderBy: { createdAt: "asc" },
  });

  return Response.json(lines);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { ticketId, payingCustomerId, description, quantity, unitPrice, productCode } = body;

    if (!ticketId || !payingCustomerId || !description || !quantity) {
      return Response.json(
        { error: "Missing required fields: ticketId, payingCustomerId, description, quantity" },
        { status: 400 }
      );
    }

    const line = await prisma.ticketLine.create({
      data: {
        ticketId,
        payingCustomerId,
        description,
        qty: quantity,
        unit: 'EA',
        lineType: 'MATERIAL',
        productCode,
        expectedCostUnit: unitPrice ? parseFloat(unitPrice.toString()) : undefined,
        expectedCostTotal: unitPrice ? parseFloat((quantity * unitPrice).toString()) : undefined,
        status: 'CAPTURED',
      },
    });

    return Response.json(line, { status: 201 });
  } catch (error) {
    console.error("Failed to create ticket line:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to create ticket line" },
      { status: 500 }
    );
  }
}
