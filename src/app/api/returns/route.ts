import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const returns = await prisma.return.findMany({
      include: {
        supplier: true,
        ticket: true,
        lines: {
          include: {
            supplierBillLine: true,
            ticketLine: true,
          },
        },
      },
      orderBy: { returnDate: "desc" },
    });

    return Response.json(returns);
  } catch (error) {
    console.error("Failed to list returns:", error);
    return Response.json(
      { error: "Failed to list returns" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      ticketId,
      supplierId,
      returnDate,
      status = "PENDING",
      notes,
      lines,
    } = body;

    if (!ticketId || !supplierId || !returnDate) {
      return Response.json(
        {
          error: "Missing required fields: ticketId, supplierId, returnDate",
        },
        { status: 400 }
      );
    }

    const created = await prisma.$transaction(async (tx) => {
      const returnRecord = await tx.return.create({
        data: {
          ticketId,
          supplierId,
          returnDate: new Date(returnDate),
          status,
          notes,
        },
      });

      if (lines && Array.isArray(lines) && lines.length > 0) {
        await tx.returnLine.createMany({
          data: lines.map(
            (line: {
              supplierBillLineId?: string;
              ticketLineId: string;
              qtyReturned: number;
              expectedCredit?: number;
              status?: string;
            }) => ({
              returnId: returnRecord.id,
              supplierBillLineId: line.supplierBillLineId,
              ticketLineId: line.ticketLineId,
              qtyReturned: line.qtyReturned,
              expectedCredit: line.expectedCredit,
              status: line.status ?? "PENDING",
            })
          ),
        });
      }

      return tx.return.findUnique({
        where: { id: returnRecord.id },
        include: {
          supplier: true,
          ticket: true,
          lines: {
            include: {
              supplierBillLine: true,
              ticketLine: true,
            },
          },
        },
      });
    });

    return Response.json(created, { status: 201 });
  } catch (error) {
    console.error("Failed to create return:", error);
    return Response.json(
      { error: "Failed to create return" },
      { status: 500 }
    );
  }
}
