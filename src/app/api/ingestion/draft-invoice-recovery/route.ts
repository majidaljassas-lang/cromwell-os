import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/ingestion/audit";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const verificationStatus = searchParams.get("verificationStatus");

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (verificationStatus) where.verificationStatus = verificationStatus;

    const drafts = await prisma.draftInvoiceRecoveryItem.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });

    return Response.json(drafts);
  } catch (error) {
    console.error("Failed to fetch draft invoice recovery:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Failed to fetch" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      zohoInvoiceExternalId,
      ingestionEventId,
      customerId,
      siteId,
      sourceInvoiceJson,
      totalValue,
      notes,
    } = body;

    const draft = await prisma.draftInvoiceRecoveryItem.create({
      data: {
        zohoInvoiceExternalId,
        ingestionEventId,
        customerId,
        siteId,
        status: "DRAFT_IMPORTED",
        verificationStatus: "UNVERIFIED",
        sourceInvoiceJson: sourceInvoiceJson || undefined,
        totalValue,
        notes,
      },
    });

    await logAudit({
      objectType: "DraftInvoiceRecoveryItem",
      objectId: draft.id,
      actionType: "CREATED",
      reason: "Zoho draft invoice imported",
    });

    return Response.json(draft, { status: 201 });
  } catch (error) {
    console.error("Failed to create draft invoice recovery:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Failed to create" }, { status: 500 });
  }
}
