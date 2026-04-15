/**
 * POST /api/bills/process
 * Body: { threadId: string }
 * Runs the end-to-end bill processing pipeline for a BILL-classified InboxThread.
 */

import { processBillThread } from "@/lib/bills/pipeline";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const threadId = typeof body.threadId === "string" ? body.threadId : null;
    if (!threadId) {
      return Response.json({ error: "threadId required" }, { status: 400 });
    }
    const result = await processBillThread(threadId);
    return Response.json(result);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "pipeline failed" },
      { status: 500 },
    );
  }
}
