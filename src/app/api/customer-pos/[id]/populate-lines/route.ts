import { prisma } from "@/lib/prisma";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const po = await prisma.customerPO.findUnique({
      where: { id },
      include: { lines: true },
    });

    if (!po) {
      return Response.json({ error: "PO not found" }, { status: 404 });
    }

    if (!po.ticketId) {
      return Response.json({ error: "PO has no linked ticket" }, { status: 400 });
    }

    // Find the latest quote for this ticket
    const quotes = await prisma.quote.findMany({
      where: { ticketId: po.ticketId },
      include: { lines: true },
      orderBy: { createdAt: "desc" },
      take: 1,
    });

    const quote = quotes[0];
    if (!quote || quote.lines.length === 0) {
      return Response.json({ error: "No quote lines found for this ticket" }, { status: 400 });
    }

    // Delete existing lines and recreate from quote
    await prisma.customerPOLine.deleteMany({ where: { customerPOId: id } });

    const created = await prisma.customerPOLine.createMany({
      data: quote.lines.map((ql) => ({
        customerPOId: id,
        ticketLineId: ql.ticketLineId,
        description: ql.description,
        qty: ql.qty,
        agreedUnitPrice: ql.unitPrice,
        agreedTotal: ql.lineTotal,
      })),
    });

    // Update PO totalValue from quote total if not set
    if (!po.totalValue) {
      await prisma.customerPO.update({
        where: { id },
        data: { totalValue: quote.totalSell, poLimitValue: quote.totalSell, poRemainingValue: quote.totalSell },
      });
    }

    return Response.json({ populated: created.count, fromQuote: quote.quoteNo });
  } catch (error) {
    console.error("Failed to populate PO lines:", error);
    return Response.json({ error: "Failed to populate PO lines" }, { status: 500 });
  }
}
