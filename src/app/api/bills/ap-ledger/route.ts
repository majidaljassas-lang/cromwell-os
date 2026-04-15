/**
 * GET /api/bills/ap-ledger[?asOf=YYYY-MM-DD]
 * Aged AP view: overdue, due this week, upcoming, no-due-date.
 */

import { getApLedger } from "@/lib/bills/ap-ledger";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const asOfRaw = searchParams.get("asOf");
    const asOf = asOfRaw ? new Date(asOfRaw) : new Date();
    if (Number.isNaN(asOf.getTime())) {
      return Response.json({ error: "invalid asOf" }, { status: 400 });
    }
    const view = await getApLedger(asOf);
    return Response.json(view);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "ap-ledger failed" },
      { status: 500 },
    );
  }
}
