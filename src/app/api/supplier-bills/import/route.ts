import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { bills } = body;

    if (!bills || !Array.isArray(bills) || bills.length === 0) {
      return Response.json(
        { error: "Request body must contain a non-empty 'bills' array" },
        { status: 400 }
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      let totalBills = 0;
      let totalLines = 0;

      for (const bill of bills) {
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
        } = bill;

        if (!supplierId || !billNo || !billDate || totalCost === undefined) {
          throw new Error(
            `Missing required fields in bill: supplierId, billNo, billDate, totalCost (billNo: ${billNo || "unknown"})`
          );
        }

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

        totalBills++;

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

          totalLines += lines.length;
        }
      }

      return { totalBills, totalLines };
    });

    return Response.json(
      {
        message: "Import completed successfully",
        billsCreated: result.totalBills,
        linesCreated: result.totalLines,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Failed to import supplier bills:", error);
    const message =
      error instanceof Error ? error.message : "Failed to import supplier bills";
    return Response.json({ error: message }, { status: 500 });
  }
}
