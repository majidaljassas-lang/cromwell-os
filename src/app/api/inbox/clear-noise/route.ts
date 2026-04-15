/**
 * POST /api/inbox/clear-noise
 *
 * Bulk hard-delete every thread currently marked NOISE. Uses the same safety
 * checks as DELETE /api/inbox/threads/:id — IngestionEvents tied to SupplierBills
 * are preserved.
 */
import { prisma } from "@/lib/prisma";

export async function POST() {
  const noise = await prisma.inboxThread.findMany({
    where: { status: "NOISE" },
    select: { id: true },
  });
  if (noise.length === 0) return Response.json({ ok: true, deleted: 0 });

  let deleted = 0;
  let protectedCount = 0;
  const errors: string[] = [];
  const base = "http://localhost:3000";
  for (const t of noise) {
    try {
      const r = await fetch(`${base}/api/inbox/threads/${t.id}`, { method: "DELETE" });
      const j = await r.json();
      if (r.ok) { deleted++; protectedCount += j.eventsProtected ?? 0; }
      else errors.push(`${t.id}: ${j.error}`);
    } catch (e) {
      errors.push(`${t.id}: ${e instanceof Error ? e.message : "err"}`);
    }
  }
  return Response.json({ ok: true, scanned: noise.length, deleted, eventsProtected: protectedCount, errors: errors.slice(0, 10) });
}
