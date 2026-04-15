/**
 * GET /api/intake/documents/:id
 *
 * Drill-down for an IntakeDocument: header + raw text excerpt + parsed bill (if any)
 * with each line's top BillLineMatch candidates and resolved BillLineAllocations.
 */
import { prisma } from "@/lib/prisma";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const doc = await prisma.intakeDocument.findUnique({
    where: { id },
    include: {
      ingestionEvent: { select: { id: true, sourceRecordType: true, externalMessageId: true, receivedAt: true } },
    },
  });
  if (!doc) return Response.json({ error: "doc not found" }, { status: 404 });

  let bill = null;
  if (doc.supplierBillId) {
    bill = await prisma.supplierBill.findUnique({
      where: { id: doc.supplierBillId },
      include: {
        supplier: { select: { id: true, name: true } },
        lines: {
          include: {
            billLineMatches: {
              orderBy: { overallConfidence: "desc" },
              take: 3,
              select: {
                id: true, candidateType: true, candidateId: true,
                supplierConfidence: true, productConfidence: true,
                ticketConfidence: true, siteConfidence: true, entityConfidence: true,
                overallConfidence: true, action: true, reasons: true,
              },
            },
            billLineAllocations: {
              select: {
                id: true, allocationType: true, qtyAllocated: true, costAllocated: true, reason: true,
                ticketLine: { select: { id: true, ticket: { select: { ticketNo: true, title: true } } } },
                site: { select: { siteName: true } },
                customer: { select: { name: true } },
              },
            },
          },
        },
      },
    });
  }

  return Response.json({
    doc: {
      id: doc.id,
      sourceType: doc.sourceType,
      sourceRef: doc.sourceRef,
      status: doc.status,
      retryCount: doc.retryCount,
      errorMessage: doc.errorMessage,
      parseConfidence: doc.parseConfidence,
      rawTextExcerpt: doc.rawText ? doc.rawText.slice(0, 2000) : null,
      rawTextLength: doc.rawText?.length ?? 0,
      createdAt: doc.createdAt,
      lastAttemptAt: doc.lastAttemptAt,
      ingestionEvent: doc.ingestionEvent,
    },
    bill,
  });
}
