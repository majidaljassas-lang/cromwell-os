/**
 * POST /api/bills/pnl-lock
 *   Body: { ticketLineId?: string }
 *   If ticketLineId given, tries to lock that single line.
 *   Otherwise, sweeps all candidate lines (paid invoices + paid bills).
 */

import { sweepPnlLock, tryLockTicketLine } from "@/lib/bills/pnl-lock";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const ticketLineId = typeof body.ticketLineId === "string" ? body.ticketLineId : null;

    if (ticketLineId) {
      const r = await tryLockTicketLine(ticketLineId);
      return Response.json(r);
    }

    const sweep = await sweepPnlLock();
    return Response.json(sweep);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "pnl-lock failed" },
      { status: 500 },
    );
  }
}
