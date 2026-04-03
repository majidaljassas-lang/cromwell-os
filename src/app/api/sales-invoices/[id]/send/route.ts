import { prisma } from "@/lib/prisma";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const invoice = await prisma.salesInvoice.update({
      where: { id },
      data: {
        status: "SENT",
        issuedAt: new Date(),
      },
      include: {
        ticket: true,
        customer: true,
        site: true,
        lines: true,
        poAllocations: true,
      },
    });

    return Response.json(invoice);
  } catch (error) {
    console.error("Failed to send sales invoice:", error);
    return Response.json(
      { error: "Failed to send sales invoice" },
      { status: 500 }
    );
  }
}
