import { prisma } from "@/lib/prisma";
import { Prisma, type ReconciliationWorkflowState } from "@/generated/prisma";
import { assertTransition } from "@/lib/reconciliations/state-machine";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const sub = await prisma.callOffSubstitution.findUnique({
    where: { id },
    include: {
      lines: { orderBy: { displayOrder: "asc" } },
      customerPO: { select: { id: true, poNo: true, ticketId: true } },
    },
  });
  if (!sub) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(sub);
}

// Workflow transitions only (DRAFT → PENDING → APPROVED → CLOSED). APPLIED is a
// mutation and goes through POST /api/substitutions/[id]/apply.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const target = body.workflowState as ReconciliationWorkflowState | undefined;
  const valid: ReconciliationWorkflowState[] = [
    "DRAFT",
    "PENDING_CUSTOMER_CONFIRMATION",
    "CUSTOMER_APPROVED",
    "CLOSED",
  ];
  if (!target || !valid.includes(target)) {
    return Response.json(
      { error: "workflowState must be one of DRAFT, PENDING_CUSTOMER_CONFIRMATION, CUSTOMER_APPROVED, CLOSED" },
      { status: 400 },
    );
  }

  const sub = await prisma.callOffSubstitution.findUnique({
    where: { id },
    select: { workflowState: true },
  });
  if (!sub) return Response.json({ error: "Not found" }, { status: 404 });

  try {
    assertTransition(sub.workflowState, target);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Illegal transition" },
      { status: 422 },
    );
  }

  const now = new Date();
  const data: Prisma.CallOffSubstitutionUpdateInput = { workflowState: target };
  if (target === "CUSTOMER_APPROVED") data.approvedAt = now;
  if (target === "CLOSED") data.closedAt = now;

  const updated = await prisma.callOffSubstitution.update({ where: { id }, data });
  return Response.json(updated);
}
