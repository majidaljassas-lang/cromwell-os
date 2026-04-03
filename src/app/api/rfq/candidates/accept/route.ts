import { prisma } from "@/lib/prisma";

/**
 * POST: Accept one or more candidates as a ticket line.
 * Body: { candidateIds: string[], ticketId: string, payingCustomerId: string,
 *         description?: string, groupLabel?: string, internalNotes?: string }
 *
 * If multiple candidateIds: merges them into one grouped commercial line.
 * If single: creates one ticket line from the candidate.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { candidateIds, ticketId, payingCustomerId, description, groupLabel, internalNotes } = body;

    if (!candidateIds?.length || !ticketId || !payingCustomerId) {
      return Response.json({ error: "candidateIds, ticketId, payingCustomerId required" }, { status: 400 });
    }

    const candidates = await prisma.extractedLineCandidate.findMany({
      where: { id: { in: candidateIds }, status: { not: "ACCEPTED" } },
    });

    if (candidates.length === 0) {
      return Response.json({ error: "No pending candidates found" }, { status: 404 });
    }

    // Build description and notes from candidates
    const isMerge = candidates.length > 1;
    let lineDescription: string;
    let lineNotes: string;
    let totalQty = 0;
    let lineUnit = "LOT";

    if (isMerge) {
      // Merge: use provided description or group label, build notes from individual items
      lineDescription = description || groupLabel || candidates.map((c) => c.extractedProduct).join(" + ");
      lineNotes = (internalNotes || "") + (internalNotes ? "\n" : "") +
        candidates.map((c) => {
          const qty = c.extractedQty ? `${Number(c.extractedQty)}x ` : "";
          const size = c.extractedSize ? ` ${c.extractedSize}` : "";
          return `${qty}${c.extractedProduct}${size}`;
        }).join("\n");
      totalQty = 1; // Grouped as 1 LOT
      lineUnit = "LOT";
    } else {
      const c = candidates[0];
      lineDescription = description || c.extractedProduct || c.rawText;
      lineNotes = internalNotes || "";
      totalQty = c.extractedQty ? Number(c.extractedQty) : 1;
      lineUnit = (c.extractedUnit as "EA" | "M" | "LENGTH" | "PACK" | "LOT" | "SET") || "EA";
    }

    // Create ticket line
    const ticketLine = await prisma.ticketLine.create({
      data: {
        ticketId,
        lineType: "MATERIAL",
        description: lineDescription,
        internalNotes: lineNotes || undefined,
        qty: totalQty,
        unit: lineUnit as "EA" | "M" | "LENGTH" | "PACK" | "LOT" | "SET",
        payingCustomerId,
        status: "CAPTURED",
      },
    });

    // Update all candidates to ACCEPTED and link to ticket line
    const primaryId = candidates[0].id;
    await prisma.extractedLineCandidate.updateMany({
      where: { id: { in: candidateIds } },
      data: {
        status: "ACCEPTED",
        groupLabel: groupLabel || undefined,
        resultTicketLineId: ticketLine.id,
        mergedIntoId: isMerge ? primaryId : undefined,
      },
    });

    // Update batch status if all candidates resolved
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
    }, { status: 201 });
  } catch (error) {
    console.error("Failed to accept candidates:", error);
    return Response.json({ error: "Failed to accept" }, { status: 500 });
  }
}
