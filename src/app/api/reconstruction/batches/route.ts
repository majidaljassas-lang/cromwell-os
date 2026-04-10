import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/ingestion/audit";

export async function GET() {
  try {
    const batches = await prisma.reconstructionBatch.findMany({
      orderBy: { monthYear: "desc" },
    });
    return Response.json(batches);
  } catch (error) {
    console.error("Failed to fetch batches:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Failed to fetch" }, { status: 500 });
  }
}

/**
 * POST: create a reconstruction batch for a given month.
 * Historical ingestion runs in a separate lane.
 * Sequence: Zoho first (financial), Outlook second (commercial), WhatsApp third (forensic).
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { monthYear, notes } = body as { monthYear: string; notes?: string };

    if (!monthYear || !/^\d{4}-\d{2}$/.test(monthYear)) {
      return Response.json({ error: "monthYear required in YYYY-MM format" }, { status: 400 });
    }

    const existing = await prisma.reconstructionBatch.findUnique({
      where: { monthYear },
    });
    if (existing) {
      return Response.json({ error: `Batch already exists for ${monthYear}`, existing }, { status: 409 });
    }

    const batch = await prisma.reconstructionBatch.create({
      data: {
        monthYear,
        status: "PENDING",
        notes,
      },
    });

    await logAudit({
      objectType: "ReconstructionBatch",
      objectId: batch.id,
      actionType: "CREATED",
      reason: `Reconstruction batch for ${monthYear}`,
    });

    return Response.json(batch, { status: 201 });
  } catch (error) {
    console.error("Failed to create batch:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Failed to create" }, { status: 500 });
  }
}
