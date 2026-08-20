import { applySubstitutionBatch } from "@/lib/calloffs/substitution/apply";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const batch = await applySubstitutionBatch(id);
    return Response.json({ ok: true, id: batch.id, workflowState: batch.workflowState });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to apply substitution" },
      { status: 422 },
    );
  }
}
