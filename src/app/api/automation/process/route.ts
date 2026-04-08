import { processClassifiedEvents } from "@/lib/ingestion/auto-action";

/**
 * POST /api/automation/process
 * Process all classified events through the auto-action pipeline.
 */
export async function POST() {
  try {
    const results = await processClassifiedEvents();

    const summary = {
      processed: results.length,
      actioned: results.filter((r) => r.success && r.action !== "ERROR").length,
      byAction: {} as Record<string, number>,
    };
    for (const r of results) {
      summary.byAction[r.action] = (summary.byAction[r.action] || 0) + 1;
    }

    return Response.json({ results, summary });
  } catch (error) {
    console.error("Auto-action pipeline failed:", error);
    return Response.json({ error: "Pipeline failed" }, { status: 500 });
  }
}
