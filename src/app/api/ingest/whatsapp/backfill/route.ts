import { CUTOVER_DATE } from "@/lib/sync-constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const QR_SERVER = "http://127.0.0.1:3001";

/**
 * POST /api/ingest/whatsapp/backfill
 *
 * Triggers a WhatsApp history backfill through the live PM2 session
 * (cromwell-whatsapp → scripts/whatsapp-qr-server.js). We cannot open a
 * second browser session, so we proxy to the control endpoint running
 * inside that process.
 *
 * Body: { since?: string }  — defaults to CUTOVER_DATE.
 * Returns 202 on accepted, 409 if a backfill is already running, 503 if
 * WhatsApp isn't connected.
 */
export async function POST(req: Request) {
  let body: { since?: string } = {};
  try { body = await req.json(); } catch { /* empty body ok */ }

  const sinceDate = body.since ? new Date(body.since) : CUTOVER_DATE;
  if (Number.isNaN(sinceDate.getTime())) {
    return Response.json({ error: "invalid `since` date" }, { status: 400 });
  }

  try {
    const r = await fetch(`${QR_SERVER}/backfill`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ since: sinceDate.toISOString() }),
    });
    const data = await r.json().catch(() => ({}));
    return Response.json(data, { status: r.status });
  } catch (err) {
    return Response.json(
      { error: "whatsapp control server unreachable", detail: (err as Error).message },
      { status: 502 }
    );
  }
}

/**
 * GET /api/ingest/whatsapp/backfill
 *
 * Returns current backfill progress (running flag, chats scanned, messages
 * ingested, etc.) by proxying to the PM2 process's /backfill/status.
 */
export async function GET() {
  try {
    const r = await fetch(`${QR_SERVER}/backfill/status`);
    const data = await r.json().catch(() => ({}));
    return Response.json(data, { status: r.status });
  } catch (err) {
    return Response.json(
      { error: "whatsapp control server unreachable", detail: (err as Error).message },
      { status: 502 }
    );
  }
}
