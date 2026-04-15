/**
 * GET /api/health
 *
 * Heartbeat for the operational engine. Returns 200 when:
 *   - DB reachable
 *   - At least one IngestionSource is active
 *   - Last poller activity < N minutes ago (configurable via ?staleMinutes=)
 *
 * Returns 503 with a diagnostic body if any of the above fails — pm2 / cron /
 * external monitoring can hit this and react.
 */
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const staleMinutes = Number(url.searchParams.get("staleMinutes") ?? "15");
  const cutoff = new Date(Date.now() - staleMinutes * 60_000);

  const checks: Array<{ name: string; ok: boolean; detail?: string }> = [];

  // DB reachability
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.push({ name: "db", ok: true });
  } catch (e) {
    checks.push({ name: "db", ok: false, detail: e instanceof Error ? e.message : "unknown" });
  }

  // Ingestion sources active
  let outlookSource = null;
  try {
    outlookSource = await prisma.ingestionSource.findFirst({
      where: { sourceType: "OUTLOOK", isActive: true },
      select: { id: true, lastSyncAt: true, displayName: true, accountName: true },
    });
    checks.push({
      name: "outlook_source",
      ok: !!outlookSource,
      detail: outlookSource ? `${outlookSource.accountName ?? outlookSource.displayName ?? "(unnamed)"}` : "no active OUTLOOK source",
    });
  } catch (e) {
    checks.push({ name: "outlook_source", ok: false, detail: e instanceof Error ? e.message : "unknown" });
  }

  // Poller liveness — lastSyncAt must be within staleMinutes
  if (outlookSource) {
    const fresh = outlookSource.lastSyncAt && outlookSource.lastSyncAt > cutoff;
    checks.push({
      name: "poller_liveness",
      ok: !!fresh,
      detail: outlookSource.lastSyncAt
        ? `lastSyncAt ${outlookSource.lastSyncAt.toISOString()} (${Math.floor((Date.now() - outlookSource.lastSyncAt.getTime()) / 60_000)} min ago, threshold ${staleMinutes})`
        : "lastSyncAt is null",
    });
  }

  // Recent intake activity (anything moved through the queue in the last N minutes)
  try {
    const recent = await prisma.intakeDocument.count({ where: { lastAttemptAt: { gte: cutoff } } });
    checks.push({ name: "intake_activity", ok: true, detail: `${recent} doc(s) attempted in last ${staleMinutes} min` });
  } catch { /* non-fatal */ }

  const overallOk = checks.every((c) => c.ok);
  return Response.json({
    ok: overallOk,
    asOf: new Date().toISOString(),
    staleMinutes,
    checks,
  }, { status: overallOk ? 200 : 503 });
}
