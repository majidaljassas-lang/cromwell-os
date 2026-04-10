import { prisma } from "@/lib/prisma";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const payments = await prisma.pOCashPayment.findMany({
      where: { customerPOId: id },
      orderBy: { paymentDate: "desc" },
    });
    return Response.json(payments);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Failed to list payments" }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await request.json();
    const payment = await prisma.pOCashPayment.create({
      data: {
        customerPOId: id,
        payee: body.payee,
        payeeType: body.payeeType || "PLUMBER",
        amount: Number(body.amount),
        paymentDate: new Date(body.paymentDate),
        paymentMethod: body.paymentMethod || "CASH",
        reference: body.reference || null,
        notes: body.notes || null,
      },
    });
    return Response.json(payment, { status: 201 });
  } catch (error) {
    console.error("Failed to create payment:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Failed to create payment" }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: poId } = await params;
  try {
    const { searchParams } = new URL(request.url);
    const paymentId = searchParams.get("paymentId");
    if (!paymentId) return Response.json({ error: "paymentId required" }, { status: 400 });
    await prisma.pOCashPayment.delete({ where: { id: paymentId } });
    return Response.json({ deleted: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Failed to delete" }, { status: 500 });
  }
}
