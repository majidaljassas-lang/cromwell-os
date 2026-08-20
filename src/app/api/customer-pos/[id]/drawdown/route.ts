/**
 * POST /api/customer-pos/[id]/drawdown
 *
 * Draw down a group PO against the entity that owns the order right now.
 * Creates one CallOff (bill-to entity + site, no ticket) depleting pooled
 * CustomerPOLines. See src/lib/finance/po-drawdown.ts.
 *
 * Body: {
 *   billToCustomerId: string;   // subsidiary that pays for this call-off
 *   siteId: string;             // delivery/project site (must be commercially linked to bill-to)
 *   callOffDate?: string;       // ISO; defaults to now
 *   source?: string;
 *   notes?: string;
 *   lines: Array<{ customerPOLineId: string; qty: number; unitPrice?: number }>;
 * }
 */
import { recordDrawdown, type DrawdownInputLine } from "@/lib/finance/po-drawdown";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: poId } = await params;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const lines: DrawdownInputLine[] = Array.isArray(body.lines)
    ? (body.lines as unknown[]).flatMap((l) => {
        if (!l || typeof l !== "object") return [];
        const ll = l as Record<string, unknown>;
        if (typeof ll.customerPOLineId !== "string") return [];
        const qty = Number(ll.qty);
        if (!Number.isFinite(qty) || qty <= 0) return [];
        const unitPrice = Number.isFinite(Number(ll.unitPrice)) ? Number(ll.unitPrice) : undefined;
        return [{ customerPOLineId: ll.customerPOLineId, qty, unitPrice }];
      })
    : [];

  let result;
  try {
    result = await recordDrawdown(poId, {
      billToCustomerId: typeof body.billToCustomerId === "string" ? body.billToCustomerId : "",
      siteId: typeof body.siteId === "string" ? body.siteId : "",
      callOffDate: typeof body.callOffDate === "string" && body.callOffDate ? new Date(body.callOffDate) : undefined,
      source: typeof body.source === "string" ? body.source : null,
      notes: typeof body.notes === "string" ? body.notes : null,
      lines,
    });
  } catch (e) {
    console.error("drawdown failed:", e);
    return Response.json({ error: "Drawdown failed: " + (e instanceof Error ? e.message : "unknown") }, { status: 500 });
  }

  if (!result.ok) {
    return Response.json({ error: result.error, detail: result.detail }, { status: result.status });
  }
  return Response.json(
    { ok: true, callOffId: result.callOffId, callOffNo: result.callOffNo, netValue: result.netValue, pool: result.pool },
    { status: 201 }
  );
}
