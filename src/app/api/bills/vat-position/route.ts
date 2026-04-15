/**
 * GET /api/bills/vat-position?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Input vs output VAT, position = output - input.
 * Defaults: current UK VAT quarter (to = today, from = start of quarter).
 */

import { getVatPosition } from "@/lib/bills/vat-position";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const toRaw = searchParams.get("to");
    const fromRaw = searchParams.get("from");
    const to = toRaw ? new Date(toRaw) : new Date();
    const from = fromRaw ? new Date(fromRaw) : startOfCurrentQuarter(to);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      return Response.json({ error: "invalid date" }, { status: 400 });
    }
    const pos = await getVatPosition(from, to);
    return Response.json(pos);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "vat-position failed" },
      { status: 500 },
    );
  }
}

function startOfCurrentQuarter(ref: Date): Date {
  const q = Math.floor(ref.getMonth() / 3);
  return new Date(ref.getFullYear(), q * 3, 1);
}
