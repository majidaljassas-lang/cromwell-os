import { prisma } from "@/lib/prisma";

const DEPRECATED = {
  error:
    "CommercialInvoice is deprecated. Use SalesInvoice via /api/sales-invoices.",
  deprecatedSince: "2026-04-15",
  replacement: "/api/sales-invoices",
} as const;

/**
 * GET /api/commercial/invoices
 *
 * Read-only Zoho reconciliation mirror. CommercialInvoice is DEPRECATED
 * as of 2026-04-15 — all client invoicing flows through SalesInvoice
 * (/api/sales-invoices). This GET handler stays functional so
 * reconciliation tooling can still query historical imports; all
 * mutation verbs return 410 Gone.
 */
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
              include: {
                commercialBillLine: { include: { commercialBill: true } },
              },
            },
          },
        },
      },
      orderBy: { invoiceDate: "desc" },
    });
    return Response.json(invoices);
  } catch (error) {
    console.error("Failed to list commercial invoices:", error);
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to list commercial invoices",
      },
      { status: 500 }
    );
  }
}

// POST DEPRECATED 2026-04-15 — CommercialInvoice is read-only.
export async function POST(): Promise<Response> {
  return Response.json(DEPRECATED, { status: 410 });
}

// PATCH / PUT / DELETE all return the same 410.
export async function PATCH(): Promise<Response> {
  return Response.json(DEPRECATED, { status: 410 });
}
export async function PUT(): Promise<Response> {
  return Response.json(DEPRECATED, { status: 410 });
}
export async function DELETE(): Promise<Response> {
  return Response.json(DEPRECATED, { status: 410 });
}
