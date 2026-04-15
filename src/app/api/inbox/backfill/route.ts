/**
 * POST /api/inbox/backfill
 *
 * Builds InboxThread + InboxThreadMessage rows from every existing IngestionEvent
 * since the cutover. Idempotent — safe to re-run. Each event maps to at most one thread.
 *
 * Optional body: { sinceISO?: string } — defaults to 2026-04-01
 */
import { backfillAllEvents } from "@/lib/inbox/thread-builder";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as { sinceISO?: string };
    const result = await backfillAllEvents({ sinceISO: body.sinceISO });
    return Response.json({ ok: true, ...result });
  } catch (e) {
    console.error("/api/inbox/backfill failed:", e);
    return Response.json({ error: e instanceof Error ? e.message : "failed" }, { status: 500 });
  }
}
