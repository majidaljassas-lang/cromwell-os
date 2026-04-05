import { prisma } from "@/lib/prisma";
import { normaliseUom } from "@/lib/commercial/uom";
import { normalizeProduct } from "@/lib/reconciliation/normalizer";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const siteId = searchParams.get("siteId");

    const where: Record<string, unknown> = {};
    if (siteId) where.siteId = siteId;

    const invoices = await prisma.commercialInvoice.findMany({
      where,
      include: {
        lines: {
          include: {
            canonicalProduct: true,
            allocations: { include: { orderGroup: true } },
            billLineLinks: {
              include: { commercialBillLine: { include: { commercialBill: true } } },
            },
          },
        },
      },
      orderBy: { invoiceDate: "desc" },
    });
    return Response.json(invoices);
  } catch (error) {
    console.error("Failed to list commercial invoices:", error);
    return Response.json({ error: "Failed to list commercial invoices" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      zohoInvoiceId,
      invoiceNumber,
      invoiceStatus,
      invoiceDate,
      dueDate,
      customerId,
      siteId,
      total,
      paidAmount,
      balance,
      lines,
      sourceJson,
    } = body;

    if (!invoiceNumber || !invoiceDate || total === undefined) {
      return Response.json(
        { error: "invoiceNumber, invoiceDate, total are required" },
        { status: 400 }
      );
    }

    // Validate site exists if provided
    if (siteId) {
      const site = await prisma.site.findUnique({ where: { id: siteId } });
      if (!site) {
        // Create review queue item for unresolved site
        await prisma.reviewQueueItem.create({
          data: {
            queueType: "UNRESOLVED_SITE",
            description: `Invoice ${invoiceNumber} references unknown site ID: ${siteId}`,
            rawValue: siteId,
          },
        });
        return Response.json({ error: "Site not found. Added to review queue." }, { status: 400 });
      }
    }

    const invoice = await prisma.commercialInvoice.create({
      data: {
        zohoInvoiceId,
        invoiceNumber,
        invoiceStatus: invoiceStatus || "DRAFT",
        invoiceDate: new Date(invoiceDate),
        dueDate: dueDate ? new Date(dueDate) : null,
        customerId,
        siteId,
        total,
        paidAmount: paidAmount || 0,
        balance: balance || total,
        sourceJson,
      },
    });

    // Process invoice lines if provided
    if (lines && Array.isArray(lines)) {
      for (const line of lines) {
        // Try to resolve canonical product
        let canonicalProductId: string | null = null;
        const productText = line.rawProductText || line.description || "";
        const normalized = normalizeProduct(productText);

        if (normalized.normalized !== "UNKNOWN") {
          const cp = await prisma.canonicalProduct.findUnique({
            where: { code: normalized.normalized },
          });
          if (cp) {
            canonicalProductId = cp.id;
          } else {
            // Create review queue item for unresolved product
            await prisma.reviewQueueItem.create({
              data: {
                queueType: "UNRESOLVED_PRODUCT",
                description: `Invoice ${invoiceNumber} line: "${productText}" normalized to ${normalized.normalized} but no canonical product found`,
                productCode: normalized.normalized,
                entityId: invoice.id,
                entityType: "CommercialInvoice",
                rawValue: productText,
              },
            });
          }
        } else {
          await prisma.reviewQueueItem.create({
            data: {
              queueType: "UNRESOLVED_PRODUCT",
              description: `Invoice ${invoiceNumber} line: "${productText}" could not be normalized`,
              entityId: invoice.id,
              entityType: "CommercialInvoice",
              rawValue: productText,
            },
          });
        }

        // UOM normalisation
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

        await prisma.commercialInvoiceLine.create({
          data: {
            commercialInvoiceId: invoice.id,
            canonicalProductId,
            description: line.description,
            rawProductText: line.rawProductText,
            qty: line.qty,
            rawUom: line.rawUom || "EA",
            normalisedQty,
            canonicalUom,
            uomResolved,
            sellRate: line.sellRate,
            sellAmount: line.sellAmount,
            allocationStatus: "UNALLOCATED",
          },
        });
      }
    }

    // Fetch the full invoice with lines
    const fullInvoice = await prisma.commercialInvoice.findUnique({
      where: { id: invoice.id },
      include: {
        lines: { include: { canonicalProduct: true } },
      },
    });

    return Response.json(fullInvoice, { status: 201 });
  } catch (error) {
    console.error("Failed to create commercial invoice:", error);
    return Response.json({ error: "Failed to create commercial invoice" }, { status: 500 });
  }
}
