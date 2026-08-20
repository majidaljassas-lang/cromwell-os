import { prisma } from "@/lib/prisma";
import { postCashSale } from "@/lib/finance/gl-posting";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");

    const where = status ? { status } : {};

    const cashSales = await prisma.cashSale.findMany({
      where,
      include: {
        ticket: {
          include: {
            payingCustomer: true,
          },
        },
      },
      orderBy: { receivedAt: "desc" },
    });

    return Response.json(cashSales);
  } catch (error) {
    console.error("Failed to list cash sales:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to list cash sales" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      ticketId,
      receivedAmount,
      receivedAt,
      paymentMethod,
      receiptRef,
      status = "RECEIVED",
    } = body;

    // Wrap in transaction so a locked period can't strand a CashSale with no JE.
    const cashSale = await prisma.$transaction(async (tx) => {
      const created = await tx.cashSale.create({
        data: {
          ticketId,
          receivedAmount,
          receivedAt: new Date(receivedAt),
          paymentMethod,
          receiptRef,
          status,
        },
        include: {
          ticket: { include: { payingCustomer: true } },
        },
      });

      // Petty cash sales pass "1500"; default 1000 covers card / bank takings.
      if (status === "RECEIVED" || status === "CLEARED") {
        const bankCode = paymentMethod === "CASH" ? "1500" : "1000";
        await postCashSale(created.id, bankCode, tx);
      }
      return created;
    });

    return Response.json(cashSale, { status: 201 });
  } catch (error) {
    console.error("Failed to create cash sale:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to create cash sale" },
      { status: 500 }
    );
  }
}
