import { prisma } from "@/lib/prisma";
import { normaliseUom } from "@/lib/commercial/uom";
import { normalizeProduct } from "@/lib/reconciliation/normalizer";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const supplierId = searchParams.get("supplierId");

    const where: Record<string, unknown> = {};
    if (supplierId) where.supplierId = supplierId;

    const bills = await prisma.commercialBill.findMany({
      where,
      include: {
        lines: { include: { canonicalProduct: true } },
      },
      orderBy: { billDate: "desc" },
    });
    return Response.json(bills);
  } catch (error) {
    console.error("Failed to list commercial bills:", error);
    return Response.json({ error: "Failed to list commercial bills" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      zohoBillId,
      billNumber,
      supplierId,
      supplierName,
      billDate,
      dueDate,
      total,
      paidAmount,
      balance,
      status,
      lines,
      sourceJson,
    } = body;

    if (!billNumber || !billDate || total === undefined) {
      return Response.json(
        { error: "billNumber, billDate, total are required" },
        { status: 400 }
      );
    }

    const bill = await prisma.commercialBill.create({
      data: {
        zohoBillId,
        billNumber,
        supplierId,
        supplierName,
        billDate: new Date(billDate),
        dueDate: dueDate ? new Date(dueDate) : null,
        total,
        paidAmount: paidAmount || 0,
        balance: balance || total,
        status: status || "DRAFT",
        sourceJson,
      },
    });

    if (lines && Array.isArray(lines)) {
      for (const line of lines) {
        let canonicalProductId: string | null = null;
        const productText = line.rawProductText || line.description || "";
        const normalized = normalizeProduct(productText);

        if (normalized.normalized !== "UNKNOWN") {
          const cp = await prisma.canonicalProduct.findUnique({
            where: { code: normalized.normalized },
          });
          if (cp) canonicalProductId = cp.id;
        }

        let normalisedQty: number | null = null;
        let canonicalUom: string | null = null;
        let uomResolved = false;

        if (canonicalProductId) {
          const cp = await prisma.canonicalProduct.findUnique({
            where: { id: canonicalProductId },
          });
          if (cp) {
            const uomResult = await normaliseUom(
              canonicalProductId,
              line.qty,
              line.rawUom || "EA",
              cp.canonicalUom
            );
            normalisedQty = uomResult.normalisedQty;
            canonicalUom = uomResult.canonicalUom;
            uomResolved = uomResult.uomResolved;
          }
        }

        await prisma.commercialBillLine.create({
          data: {
            commercialBillId: bill.id,
            canonicalProductId,
            description: line.description,
            rawProductText: line.rawProductText,
            qty: line.qty,
            rawUom: line.rawUom || "EA",
            normalisedQty,
            canonicalUom,
            uomResolved,
            costRate: line.costRate,
            costAmount: line.costAmount,
          },
        });
      }
    }

    const fullBill = await prisma.commercialBill.findUnique({
      where: { id: bill.id },
      include: { lines: { include: { canonicalProduct: true } } },
    });

    return Response.json(fullBill, { status: 201 });
  } catch (error) {
    console.error("Failed to create commercial bill:", error);
    return Response.json({ error: "Failed to create commercial bill" }, { status: 500 });
  }
}
