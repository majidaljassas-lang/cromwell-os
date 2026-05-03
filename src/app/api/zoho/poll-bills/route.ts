// Disabled 2026-05-02. We no longer pull anything from Zoho Books — the OS
// is the system of record for Plumbing AP. This route is kept as a tombstone
// so any stale launchd / cron / docs that hit it get a clear signal instead
// of silently working.

export const dynamic = "force-dynamic";

const GONE_BODY = {
  ok: false,
  error: "ZOHO_POLL_DISABLED",
  message: "Zoho Books polling is disabled. Bills now flow via Outlook → IntakeDocument pipeline.",
};

export async function GET() {
  return Response.json(GONE_BODY, { status: 410 });
}

export async function POST() {
  return Response.json(GONE_BODY, { status: 410 });
}
