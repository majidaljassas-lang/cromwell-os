import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const supplierId = searchParams.get("supplierId");

    const where: Record<string, string> = {};
    if (status) where.status = status;
    if (supplierId) where.supplierId = supplierId;

    const bills = await prisma.supplierBill.findMany({
      where,
      include: {
        supplier: true,
        lines: true,
        _count: { select: { lines: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return Response.json(bills);
  } catch (error) {
    console.error("Failed to list supplier bills:", error);
    return Response.json(
      { error: "Failed to list supplier bills" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      supplierId,
      billNo,
      billDate,
      siteRef,
      customerRef,
      status = "PENDING",
      totalCost,
      sourceAttachmentRef,
      lines,
    } = body;

    if (!supplierId || !billNo || !billDate || totalCost === undefined) {
      return Response.json(
        {
          error:
            "Missing required fields: supplierId, billNo, billDate, totalCost",
        },
        { status: 400 }
      );
    }

    const bill = await prisma.$transaction(async (tx) => {
      const created = await tx.supplierBill.create({
        data: {
          supplierId,
          billNo,
          billDate: new Date(billDate),
          siteRef,
          customerRef,
          status,
          totalCost,
          sourceAttachmentRef,
        },
      });

      if (lines && Array.isArray(lines) && lines.length > 0) {
        await tx.supplierBillLine.createMany({
          data: lines.map(
            (line: {
              description: string;
              normalizedItemName?: string;
              productCode?: string;
              qty: number;
              unitCost: number;
              lineTotal: number;
              siteId?: string;
              customerId?: string;
              ticketId?: string;
              costClassification?: string;
              allocationStatus?: string;
            }) => ({
              supplierBillId: created.id,
              description: line.description,
              normalizedItemName: line.normalizedItemName,
              productCode: line.productCode,
              qty: line.qty,
              unitCost: line.unitCost,
              lineTotal: line.lineTotal,
              siteId: line.siteId,
              customerId: line.customerId,
              ticketId: line.ticketId,
              costClassification: (line.costClassification ?? "BILLABLE") as "BILLABLE" | "ABSORBED" | "REALLOCATABLE" | "STOCK" | "MOQ_EXCESS" | "WRITE_OFF" | "CREDIT",
              allocationStatus: (line.allocationStatus ?? "UNALLOCATED") as "MATCHED" | "PARTIAL" | "SUGGESTED" | "EXCEPTION" | "UNALLOCATED",
            })
          ),
        });
      }

      return tx.supplierBill.findUnique({
        where: { id: created.id },
        include: {
          supplier: true,
          lines: true,
          _count: { select: { lines: true } },
        },
      });
    });

    return Response.json(bill, { status: 201 });
  } catch (error) {
    console.error("Failed to create supplier bill:", error);
    return Response.json(
      { error: "Failed to create supplier bill" },
      { status: 500 }
    );
  }
}
