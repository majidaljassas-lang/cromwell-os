import { autoLinkBill, autoLinkBillLine } from "@/lib/ingestion/auto-link-bill-line";

/**
 * POST /api/supplier-bills/auto-link
 * Body: { billId?: string; lineId?: string }
 * Auto-links one bill (all its lines) or one specific line.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { billId, lineId, actor } = body as { billId?: string; lineId?: string; actor?: string };

    if (lineId) {
      const result = await autoLinkBillLine(lineId, actor);
      return Response.json(result);
    }
    if (billId) {
      const results = await autoLinkBill(billId, actor);
      const summary = {
        total: results.length,
        autoLinked: results.filter((r) => r.action === "AUTO_LINKED").length,
        suggested:  results.filter((r) => r.action === "SUGGESTED").length,
        noMatch:    results.filter((r) => r.action === "NO_MATCH").length,
        results,
      };
      return Response.json(summary);
    }
    return Response.json({ error: "billId or lineId required" }, { status: 400 });
  } catch (e) {
    console.error("auto-link failed:", e);
    return Response.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
