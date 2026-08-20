import { prisma } from "@/lib/prisma";
import { postPaymentReceived } from "@/lib/finance/gl-posting";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const salesInvoiceId = searchParams.get("salesInvoiceId");

    const where: Record<string, unknown> = {};
    if (salesInvoiceId) where.salesInvoiceId = salesInvoiceId;

    const payments = await prisma.payment.findMany({
      where,
      include: {
        salesInvoice: true,
      },
      orderBy: { paymentDate: "desc" },
    });

    return Response.json(payments);
  } catch (error) {
    console.error("Failed to list payments:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to list payments" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { salesInvoiceId, amount, paymentDate, paymentMethod, reference, notes } = body;

    if (!salesInvoiceId || amount == null || !paymentDate) {
      return Response.json(
        { error: "Missing required fields: salesInvoiceId, amount, paymentDate" },
        { status: 400 }
      );
    }

    const invoice = await prisma.salesInvoice.findUnique({
      where: { id: salesInvoiceId },
      include: { payments: true, salesCreditNotes: true },
    });

    if (!invoice) {
      return Response.json({ error: "Sales invoice not found" }, { status: 404 });
    }

    // Single transaction — Payment, invoice status, and GL post must succeed
    // or fail together. Otherwise a locked period would strand a Payment row.
    const payment = await prisma.$transaction(async (tx) => {
      const created = await tx.payment.create({
        data: {
          salesInvoiceId,
          amount,
          paymentDate: new Date(paymentDate),
          paymentMethod: paymentMethod ?? null,
          reference: reference ?? null,
          notes: notes ?? null,
        },
        include: { salesInvoice: true },
      });

      const existingTotal = invoice.payments.reduce(
        (sum, p) => sum + Number(p.amount),
        0
      );
      const newTotal = existingTotal + Number(amount);
      // Customer pays gross less any credit notes applied to this invoice.
      const credits = invoice.salesCreditNotes
        .filter((c) => !["DRAFT", "VOID", "VOIDED", "CANCELLED"].includes(c.status))
        .reduce((s, c) => s + Number(c.total), 0);
      const target = Number(invoice.totalGross ?? invoice.totalSell) - credits;

      if (newTotal + 0.005 >= target) {
        await tx.salesInvoice.update({
          where: { id: salesInvoiceId },
          data: { status: "PAID", paidAt: new Date() },
        });
      } else if (newTotal > 0) {
        await tx.salesInvoice.update({
          where: { id: salesInvoiceId },
          data: { status: "PARTIALLY_PAID" },
        });
      }

      // Post settlement JE: DR Bank · CR Trade Debtors. Idempotent.
      await postPaymentReceived(created.id, "1000", tx);
      return created;
    });

    return Response.json(payment, { status: 201 });
  } catch (error) {
    console.error("Failed to create payment:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to create payment" },
      { status: 500 }
    );
  }
}
