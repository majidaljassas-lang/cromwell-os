import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const customerId = searchParams.get("customerId");

    const where: Record<string, string> = {};
    if (status) where.status = status;
    if (customerId) where.customerId = customerId;

    const invoices = await prisma.salesInvoice.findMany({
      where,
      include: {
        ticket: true,
        customer: true,
        site: true,
        lines: {
          include: {
            ticketLine: true,
          },
        },
        poAllocations: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return Response.json(invoices);
  } catch (error) {
    console.error("Failed to list sales invoices:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to list sales invoices" },
      { status: 500 }
    );
  }
}
