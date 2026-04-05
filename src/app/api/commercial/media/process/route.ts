import { processMediaBatch } from "@/lib/commercial/media-ocr";

export const maxDuration = 300; // 5 min max for batch processing
export const dynamic = "force-dynamic";

/**
 * POST /api/commercial/media/process
 *
 * Run OCR + classification + order event extraction on pending media.
 * Body: { siteId, limit?: number }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { siteId, limit } = body;

    if (!siteId) {
      return Response.json({ error: "siteId is required" }, { status: 400 });
    }

    const result = await processMediaBatch(siteId, limit || 50);

    return Response.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("Media processing failed:", msg);
    return Response.json({ error: "Processing failed", detail: msg }, { status: 500 });
  }
}
