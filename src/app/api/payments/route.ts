import { prisma } from "@/lib/prisma";

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
      { error: "Failed to list payments" },
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
      include: { payments: true },
    });

    if (!invoice) {
      return Response.json({ error: "Sales invoice not found" }, { status: 404 });
    }

    const payment = await prisma.payment.create({
      data: {
        salesInvoiceId,
        amount,
        paymentDate: new Date(paymentDate),
        paymentMethod: paymentMethod ?? null,
        reference: reference ?? null,
        notes: notes ?? null,
      },
      include: {
        salesInvoice: true,
      },
    });

    // Calculate total payments including the new one
    const existingTotal = invoice.payments.reduce(
      (sum, p) => sum + Number(p.amount),
      0
    );
    const newTotal = existingTotal + Number(amount);

    // Auto-update invoice status to PAID if total payments >= invoice total
    if (newTotal >= Number(invoice.totalSell)) {
      await prisma.salesInvoice.update({
        where: { id: salesInvoiceId },
        data: { status: "PAID", paidAt: new Date() },
      });
    }

    return Response.json(payment, { status: 201 });
  } catch (error) {
    console.error("Failed to create payment:", error);
    return Response.json(
      { error: "Failed to create payment" },
      { status: 500 }
    );
  }
}
