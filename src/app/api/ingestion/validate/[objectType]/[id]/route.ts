import { prisma } from "@/lib/prisma";
import { validateBillLine, validateDraftInvoice, validateEnquiryForConversion } from "@/lib/ingestion/validation";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ objectType: string; id: string }> }
) {
  try {
    const { objectType, id } = await params;

    if (objectType === "supplier-bill-line") {
      const line = await prisma.supplierBillLine.findUnique({ where: { id } });
      if (!line) return Response.json({ error: "Not found" }, { status: 404 });

      const result = validateBillLine({
        description: line.description,
        qty: Number(line.qty),
        unitCost: Number(line.unitCost),
        lineTotal: Number(line.lineTotal),
        costClassification: line.costClassification,
        sourceAmountBasis: line.sourceAmountBasis,
        vatStatus: line.vatStatus,
        amountExVat: line.amountExVat ? Number(line.amountExVat) : null,
        siteId: line.siteId,
        customerId: line.customerId,
        sourceSiteTextRaw: line.sourceSiteTextRaw,
        sourceCustomerTextRaw: line.sourceCustomerTextRaw,
      });

      return Response.json({ objectType, objectId: id, ...result });
    }

    if (objectType === "draft-invoice") {
      const draft = await prisma.draftInvoiceRecoveryItem.findUnique({ where: { id } });
      if (!draft) return Response.json({ error: "Not found" }, { status: 404 });

      const result = validateDraftInvoice({
        customerId: draft.customerId,
        siteId: draft.siteId,
        totalValue: draft.totalValue ? Number(draft.totalValue) : null,
        status: draft.status,
      });

      return Response.json({ objectType, objectId: id, ...result });
    }

    if (objectType === "enquiry") {
      const enquiry = await prisma.enquiry.findUnique({ where: { id } });
      if (!enquiry) return Response.json({ error: "Not found" }, { status: 404 });

      const result = validateEnquiryForConversion({
        rawText: enquiry.rawText,
        suggestedSiteId: enquiry.suggestedSiteId,
        suggestedCustomerId: enquiry.suggestedCustomerId,
        sourceContactId: enquiry.sourceContactId,
        status: enquiry.status,
      });

      return Response.json({ objectType, objectId: id, ...result });
    }

    return Response.json({ error: `Unknown objectType: ${objectType}` }, { status: 400 });
  } catch (error) {
    console.error("Validation failed:", error);
    return Response.json({ error: "Validation failed" }, { status: 500 });
  }
}
