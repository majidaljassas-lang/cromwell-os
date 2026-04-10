import { prisma } from "@/lib/prisma";

/**
 * POST: Accept candidates as ticket lines.
 *
 * Single candidate → creates individual ticket line (status CAPTURED)
 * Multiple candidates → creates ONE package line (status CAPTURED), marks originals MERGED
 *
 * Idempotent: already-accepted candidates are skipped.
 * All created lines track sourceItemIds for audit.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { candidateIds, ticketId, payingCustomerId, description, groupLabel, internalNotes } = body;

    if (!candidateIds?.length || !ticketId || !payingCustomerId) {
      return Response.json({ error: "candidateIds, ticketId, payingCustomerId required" }, { status: 400 });
    }

    // Idempotency: only process pending candidates
    const candidates = await prisma.extractedLineCandidate.findMany({
      where: { id: { in: candidateIds }, status: "PENDING" },
    });

    if (candidates.length === 0) {
      return Response.json({ error: "No pending candidates found — may already be accepted" }, { status: 409 });
    }

    const isMerge = candidates.length > 1;
    let lineDescription: string;
    let lineNotes: string;

    if (isMerge) {
      lineDescription = description || groupLabel || candidates.map((c) => c.extractedProduct).join(" + ");
      lineNotes = (internalNotes || "") + (internalNotes ? "\n" : "") +
        candidates.map((c) => {
          const qty = c.extractedQty ? `${Number(c.extractedQty)}x ` : "";
          const size = c.extractedSize ? ` ${c.extractedSize}` : "";
          return `${qty}${c.extractedProduct}${size}`;
        }).join("\n");
    } else {
      const c = candidates[0];
      lineDescription = description || c.extractedProduct || c.rawText;
      lineNotes = internalNotes || "";
    }

    // Create the ACTIVE package line
    const ticketLine = await prisma.ticketLine.create({
      data: {
        ticketId,
        lineType: "MATERIAL",
        description: lineDescription,
        internalNotes: lineNotes.trim() || undefined,
        qty: isMerge ? 1 : (candidates[0].extractedQty ? Number(candidates[0].extractedQty) : 1),
        unit: isMerge ? "LOT" : ((candidates[0].extractedUnit || "EA") as "EA" | "M" | "LENGTH" | "PACK" | "LOT" | "SET"),
        payingCustomerId,
        status: "CAPTURED",
        sourceItemIds: candidates.map((c) => c.id),
      },
    });

    // Update candidates to ACCEPTED
    await prisma.extractedLineCandidate.updateMany({
      where: { id: { in: candidateIds } },
      data: {
        status: "ACCEPTED",
        groupLabel: groupLabel || undefined,
        resultTicketLineId: ticketLine.id,
        mergedIntoId: isMerge ? ticketLine.id : undefined,
      },
    });

    // Check if batch is complete
    const batch = await prisma.extractionBatch.findFirst({
      where: { candidates: { some: { id: candidates[0].id } } },
      include: { candidates: { select: { status: true } } },
    });
    if (batch) {
      const allResolved = batch.candidates.every((c) => c.status === "ACCEPTED" || c.status === "DISCARDED");
      if (allResolved) {
        await prisma.extractionBatch.update({
          where: { id: batch.id },
          data: { status: "COMPLETED", reviewedAt: new Date() },
        });
      }
    }

    return Response.json({
      ticketLine,
      acceptedCount: candidates.length,
      merged: isMerge,
      groupLabel: groupLabel || null,
    }, { status: 201 });
  } catch (error) {
    console.error("Failed to accept candidates:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Failed to accept" }, { status: 500 });
  }
}
