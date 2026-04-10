import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/ingestion/audit";
import { validateDraftInvoice } from "@/lib/ingestion/validation";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const draft = await prisma.draftInvoiceRecoveryItem.findUnique({ where: { id } });
    if (!draft) return Response.json({ error: "Not found" }, { status: 404 });

    const validation = validateDraftInvoice({
      customerId: draft.customerId,
      siteId: draft.siteId,
      totalValue: draft.totalValue ? Number(draft.totalValue) : null,
      status: draft.status,
    });

    return Response.json({ ...draft, validation });
  } catch (error) {
    console.error("Failed to fetch draft:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Failed to fetch" }, { status: 500 });
  }
}

/**
 * PATCH: update status/verification
 * Actions: VERIFIED_READY, REBUILT, SUPERSEDED, DISCARDED
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { action, notes, actor } = body as {
      action: "VERIFIED_READY" | "REBUILT" | "SUPERSEDED" | "DISCARDED";
      notes?: string;
      actor?: string;
    };

    const draft = await prisma.draftInvoiceRecoveryItem.findUnique({ where: { id } });
    if (!draft) return Response.json({ error: "Not found" }, { status: 404 });

    const previousStatus = draft.status;

    // If verifying, run validation first
    if (action === "VERIFIED_READY") {
      const validation = validateDraftInvoice({
        customerId: draft.customerId,
        siteId: draft.siteId,
        totalValue: draft.totalValue ? Number(draft.totalValue) : null,
      });
      if (!validation.isReady) {
        return Response.json({
          error: "Draft invoice not ready for verification",
          blockers: validation.blockers,
          warnings: validation.warnings,
        }, { status: 422 });
      }
    }

    const updated = await prisma.draftInvoiceRecoveryItem.update({
      where: { id },
      data: {
        status: action,
        verificationStatus: action === "VERIFIED_READY" ? "VERIFIED" : action,
        notes: notes || draft.notes,
      },
    });

    await logAudit({
      objectType: "DraftInvoiceRecoveryItem",
      objectId: id,
      actionType: `DRAFT_INVOICE_${action}`,
      actor,
      previousValue: { status: previousStatus },
      newValue: { status: action },
      reason: notes,
    });

    return Response.json(updated);
  } catch (error) {
    console.error("Failed to update draft:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Failed to update" }, { status: 500 });
  }
}
