import { prisma } from "@/lib/prisma";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const payment = await prisma.payment.findUnique({
      where: { id },
      include: {
        salesInvoice: true,
      },
    });

    if (!payment) {
      return Response.json({ error: "Payment not found" }, { status: 404 });
    }

    return Response.json(payment);
  } catch (error) {
    console.error("Failed to get payment:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to get payment" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const payment = await prisma.payment.findUnique({
      where: { id },
    });

    if (!payment) {
      return Response.json({ error: "Payment not found" }, { status: 404 });
    }

    await prisma.payment.delete({
      where: { id },
    });

    return Response.json({ success: true });
  } catch (error) {
    console.error("Failed to delete payment:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to delete payment" },
      { status: 500 }
    );
  }
}
