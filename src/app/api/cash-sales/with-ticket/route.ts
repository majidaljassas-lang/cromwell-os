import { prisma } from "@/lib/prisma";
import { postCashSale } from "@/lib/finance/gl-posting";

type LineInput = {
  description: string;
  qty: number;
  unit?: string;
  saleUnit?: number;
  costUnit?: number;
};

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      payingCustomerId,
      title,
      siteId,
      lines,
      receivedAmount,
      receivedAt,
      paymentMethod,
      receiptRef,
      status = "RECEIVED",
    }: {
      payingCustomerId?: string;
      title?: string;
      siteId?: string;
      lines?: LineInput[];
      receivedAmount?: number;
      receivedAt?: string;
      paymentMethod?: string;
      receiptRef?: string | null;
      status?: string;
    } = body;

    if (!payingCustomerId) {
      return Response.json({ error: "payingCustomerId required" }, { status: 400 });
    }
    if (!Array.isArray(lines) || lines.length === 0) {
      return Response.json({ error: "at least one line required" }, { status: 400 });
    }
    if (lines.some((l) => !l.description || !l.qty || l.qty <= 0)) {
      return Response.json({ error: "every line needs description and qty > 0" }, { status: 400 });
    }
    if (typeof receivedAmount !== "number" || receivedAmount < 0) {
      return Response.json({ error: "receivedAmount required" }, { status: 400 });
    }
    if (!receivedAt || !paymentMethod) {
      return Response.json({ error: "receivedAt and paymentMethod required" }, { status: 400 });
    }

    const result = await prisma.$transaction(async (tx) => {
      const ticket = await tx.ticket.create({
        data: {
          payingCustomerId,
          siteId: siteId || undefined,
          title: title?.trim() || `Cash sale ${new Date(receivedAt).toLocaleDateString("en-GB")}`,
          ticketMode: "CASH_SALE",
          status: "CLOSED",
          source: "WALK_IN",
        },
      });

      await tx.ticketLine.createMany({
        data: lines.map((l, idx) => {
          const qty = Number(l.qty);
          const saleUnit = l.saleUnit != null ? Number(l.saleUnit) : null;
          const costUnit = l.costUnit != null ? Number(l.costUnit) : null;
          return {
            ticketId: ticket.id,
            payingCustomerId,
            displayOrder: idx,
            lineType: "CASH_SALE" as const,
            description: l.description.trim(),
            qty,
            unit: (l.unit as
              | "EA"
              | "M"
              | "LM"
              | "LENGTH"
              | "PACK"
              | "LOT"
              | "SET"
              | "PAIR"
              | "BOX"
              | "ROLL") ?? "EA",
            actualSaleUnit: saleUnit,
            actualSaleTotal: saleUnit != null ? saleUnit * qty : null,
            expectedCostUnit: costUnit,
            expectedCostTotal: costUnit != null ? costUnit * qty : null,
            actualCostTotal: costUnit != null ? costUnit * qty : null,
            status: "CLOSED" as const,
          };
        }),
      });

      const cashSale = await tx.cashSale.create({
        data: {
          ticketId: ticket.id,
          receivedAmount,
          receivedAt: new Date(receivedAt),
          paymentMethod,
          receiptRef: receiptRef || null,
          status,
        },
        include: { ticket: { include: { payingCustomer: true } } },
      });

      if (status === "RECEIVED" || status === "CLEARED") {
        const bankCode = paymentMethod === "CASH" ? "1500" : "1000";
        await postCashSale(cashSale.id, bankCode, tx);
      }

      return cashSale;
    });

    return Response.json(result, { status: 201 });
  } catch (error) {
    console.error("Failed to create cash sale with ticket:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed" },
      { status: 500 }
    );
  }
}
