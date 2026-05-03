// Disabled 2026-05-02. We no longer pull anything from Zoho Books. Historical
// data already imported is kept in the QUARANTINED staging tables; no further
// pulls run. Tombstone preserves the URL so anything that hits it sees a
// clear failure instead of silently working.

export const dynamic = "force-dynamic";

const GONE_BODY = {
  ok: false,
  error: "ZOHO_IMPORT_DISABLED",
  message: "Zoho Books import is disabled. The OS is the system of record for Plumbing.",
};

export async function GET() {
  return Response.json(GONE_BODY, { status: 410 });
}

export async function POST() {
  return Response.json(GONE_BODY, { status: 410 });
}
