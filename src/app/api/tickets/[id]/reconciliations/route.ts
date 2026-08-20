import { prisma } from "@/lib/prisma";
import { createReconciliation } from "@/lib/reconciliations/create";
import type {
  ReconciliationType,
  ReconciliationWorkflowState,
} from "@/generated/prisma";
import type { CustomerListRow } from "@/lib/reconciliations/classify";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: parentTicketId } = await params;
  const reconciliations = await prisma.reconciliation.findMany({
    where: { parentTicketId },
    orderBy: { createdAt: "desc" },
    include: { lines: false, _count: { select: { lines: true } } },
  });
  return Response.json({ reconciliations });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: parentTicketId } = await params;
  const body = (await request.json()) as {
    title: string;
    type: ReconciliationType;
    notes?: string;
    customerList: CustomerListRow[];
    initialState?: ReconciliationWorkflowState;
  };

  if (!body.title || !body.type || !Array.isArray(body.customerList)) {
    return Response.json(
      { error: "title, type, and customerList[] are required" },
      { status: 400 },
    );
  }

  const parent = await prisma.ticket.findUnique({
    where: { id: parentTicketId },
    select: { id: true },
  });
  if (!parent) {
    return Response.json({ error: "parent ticket not found" }, { status: 404 });
  }

  const recon = await createReconciliation({
    parentTicketId,
    title: body.title,
    type: body.type,
    notes: body.notes,
    customerList: body.customerList,
    initialState:
      body.initialState === "PENDING_CUSTOMER_CONFIRMATION"
        ? "PENDING_CUSTOMER_CONFIRMATION"
        : "DRAFT",
  });

  return Response.json({ reconciliation: recon });
}
