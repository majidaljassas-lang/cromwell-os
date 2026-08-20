import { prisma } from "@/lib/prisma";
import type { ReconciliationWorkflowState } from "@/generated/prisma";
import { assertTransition } from "@/lib/reconciliations/state-machine";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const reconciliation = await prisma.reconciliation.findUnique({
    where: { id },
    include: {
      lines: { orderBy: [{ section: "asc" }, { createdAt: "asc" }] },
      parentTicket: {
        select: {
          id: true,
          ticketNo: true,
          title: true,
          status: true,
          isLocked: true,
          payingCustomer: { select: { id: true, name: true } },
          site: { select: { id: true, siteName: true } },
        },
      },
    },
  });
  if (!reconciliation) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  return Response.json({ reconciliation });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await request.json()) as {
    workflowState?: ReconciliationWorkflowState;
    notes?: string;
    lineUpdates?: Array<{ id: string; keepFlag?: boolean | null }>;
  };

  const current = await prisma.reconciliation.findUnique({
    where: { id },
    select: { id: true, workflowState: true },
  });
  if (!current) return Response.json({ error: "not found" }, { status: 404 });

  // APPLIED is only reachable through /apply — PATCH can't short-circuit it.
  if (body.workflowState === "APPLIED") {
    return Response.json(
      { error: "Use POST /api/reconciliations/[id]/apply to apply." },
      { status: 400 },
    );
  }

  if (body.workflowState && body.workflowState !== current.workflowState) {
    try {
      assertTransition(current.workflowState, body.workflowState);
    } catch (err) {
      return Response.json(
        { error: err instanceof Error ? err.message : "invalid transition" },
        { status: 400 },
      );
    }
  }

  await prisma.$transaction(async (tx) => {
    if (body.lineUpdates?.length) {
      for (const u of body.lineUpdates) {
        await tx.reconciliationLine.update({
          where: { id: u.id },
          data: {
            keepFlag:
              u.keepFlag === undefined ? undefined : u.keepFlag,
          },
        });
      }
    }

    const data: {
      workflowState?: ReconciliationWorkflowState;
      notes?: string;
      confirmedAt?: Date;
      closedAt?: Date;
    } = {};
    if (body.workflowState) data.workflowState = body.workflowState;
    if (body.notes !== undefined) data.notes = body.notes;
    if (body.workflowState === "CUSTOMER_APPROVED") data.confirmedAt = new Date();
    if (body.workflowState === "CLOSED") data.closedAt = new Date();

    if (Object.keys(data).length > 0) {
      await tx.reconciliation.update({ where: { id }, data });
    }
  });

  return Response.json({ ok: true });
}
