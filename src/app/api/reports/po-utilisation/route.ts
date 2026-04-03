import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const customerPOs = await prisma.customerPO.findMany({
      include: {
        customer: { select: { name: true } },
        ticket: { select: { title: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    const result = customerPOs.map((po) => {
      const limit = po.poLimitValue ?? po.totalValue;
      const consumed = po.poConsumedValue;
      const remaining = po.poRemainingValue;
      const profit = po.profitToDate;
      const utilisationPct =
        limit && Number(limit) > 0
          ? Number(((Number(consumed) / Number(limit)) * 100).toFixed(2))
          : 0;

      return {
        id: po.id,
        poNo: po.poNo,
        poType: po.poType,
        customerName: po.customer.name,
        ticketTitle: po.ticket?.title ?? null,
        limit,
        consumed,
        remaining,
        profit,
        utilisationPct,
        status: po.status,
      };
    });

    return Response.json(result);
  } catch (error) {
    console.error("Failed to compute PO utilisation:", error);
    return Response.json(
      { error: "Failed to compute PO utilisation" },
      { status: 500 }
    );
  }
}
