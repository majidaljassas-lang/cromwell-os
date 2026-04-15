/**
 * POST /api/intake/rekick-errors
 *
 * Finds every IntakeDocument stuck in ERROR (or DEAD_LETTER) and resets it
 * back to NEW with retryCount=0 so the pipeline will reprocess it through
 * pdf-parser → OCR → extractor → match → allocate.
 *
 * Body (optional):
 *   { status?: "ERROR" | "DEAD_LETTER" | "OCR_REQUIRED",
 *     limit?: number }
 *
 * Returns { scanned, reset, skipped, errors }
 *
 * The poller's next tick (or a manual POST /api/intake/queue {action:"tick"})
 * will pick these up and re-run them. The content-matcher async rescore
 * fires automatically as they transition to PARSED.
 */
import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as {
      status?: "ERROR" | "DEAD_LETTER" | "OCR_REQUIRED";
      limit?: number;
    };
    const targetStatus = body.status ?? "ERROR";
    const limit = Math.min(1000, Number(body.limit ?? 200));

    const stuck = await prisma.intakeDocument.findMany({
      where: { status: targetStatus },
      select: { id: true, ingestionEventId: true, fileRef: true, errorMessage: true },
      orderBy: { createdAt: "asc" },
      take: limit,
    });

    let reset = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const d of stuck) {
      try {
        // Skip obviously-unrecoverable errors (e.g. attachment no longer exists)
        if (d.errorMessage && /404|not\s*found|missing attachment/i.test(d.errorMessage)) {
          skipped++;
          continue;
        }
        await prisma.intakeDocument.update({
          where: { id: d.id },
          data: {
            status: "NEW",
            retryCount: 0,
            errorMessage: null,
            nextAttemptAt: null,
          },
        });
        reset++;
      } catch (e) {
        errors.push(`${d.id}: ${e instanceof Error ? e.message : "failed"}`);
      }
    }

    return Response.json({
      ok: true,
      scanned: stuck.length,
      reset,
      skipped,
      errors: errors.slice(0, 10),
      hint: "Call POST /api/intake/queue {\"action\":\"tick\"} or wait for the next 2-min poll cycle.",
    });
  } catch (e) {
    console.error("/api/intake/rekick-errors failed:", e);
    return Response.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
