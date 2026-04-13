import { prisma } from "@/lib/prisma";
import { extractRfqCandidates } from "@/lib/ingestion/rfq-parser";

/**
 * POST: Extract line candidates from raw RFQ text.
 * Creates ExtractionBatch + ExtractedLineCandidates.
 * Does NOT create ticket lines — candidates are drafts only.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { sourceText, ticketId, enquiryId } = body;

    if (!sourceText || sourceText.trim().length === 0) {
      return Response.json({ error: "sourceText required" }, { status: 400 });
    }

    // Extract candidates using rules engine
    const extracted = extractRfqCandidates(sourceText);

    // Create batch with candidates
    const batch = await prisma.extractionBatch.create({
      data: {
        ticketId,
        enquiryId,
        sourceText,
        status: "DRAFT",
        candidates: {
          create: extracted.map((c) => ({
            rawText: c.rawText,
            extractedQty: c.qty,
            extractedUnit: c.unit,
            extractedProduct: c.product,
            extractedSize: c.size,
            extractedSpec: c.spec,
            extractedUnitCost: c.unitCost,
            suggestedLineType: c.lineType,
            confidence: c.confidence,
            status: "PENDING",
          })),
        },
      },
      include: {
        candidates: { orderBy: { createdAt: "asc" } },
      },
    });

    return Response.json(batch, { status: 201 });
  } catch (error) {
    console.error("RFQ extraction failed:", error);
    return Response.json({ error: "Extraction failed" }, { status: 500 });
  }
}
