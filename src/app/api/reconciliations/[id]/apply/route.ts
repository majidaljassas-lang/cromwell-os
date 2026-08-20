import { applyReconciliation } from "@/lib/reconciliations/apply";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const reconciliation = await applyReconciliation(id);
    return Response.json({ reconciliation });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "apply failed" },
      { status: 400 },
    );
  }
}
