/**
 * GET  /api/finance/paper-pnl   — list paper ledger entries (newest first)
 * POST /api/finance/paper-pnl   — record materials given to a customer without charge
 *   Body: {
 *     entryDate: "YYYY-MM-DD",
 *     description: string,
 *     customerId: string,          // required — a give-away is always TO someone
 *     qty: number,
 *     actualCostUnit: number,      // what we paid the supplier
 *     agreedRateUnit: number,      // what we'd have charged. Never invoiced.
 *     unit?: string,
 *     siteId?, ticketId?, supplierId?, canonicalProductId?: string,
 *     originBillId?, originBillNo?, notes?: string
 *   }
 *
 * This never posts to the GL and never creates a SalesInvoice — that is the point.
 * See src/lib/finance/paper-pnl.ts
 */
import { prisma } from "@/lib/prisma";
import { computePaperTotals } from "@/lib/finance/paper-pnl";

const UNITS = ["EA", "M", "LM", "LENGTH", "PACK", "LOT", "SET", "PAIR", "BOX", "ROLL", "TONNE"];

export async function GET() {
  const entries = await prisma.paperLedgerEntry.findMany({
    orderBy: { entryDate: "desc" },
    take: 200,
    include: { customer: true, site: true, supplier: true },
  });
  return Response.json({ entries });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      entryDate?: string;
      description?: string;
      customerId?: string;
      qty?: number;
      actualCostUnit?: number;
      agreedRateUnit?: number;
      unit?: string;
      siteId?: string;
      ticketId?: string;
      supplierId?: string;
      canonicalProductId?: string;
      originBillId?: string;
      originBillNo?: string;
      notes?: string;
    };

    if (!body.entryDate || !body.description || !body.customerId) {
      return Response.json(
        { error: "entryDate, description and customerId are required" },
        { status: 400 }
      );
    }

    const qty = Number(body.qty);
    const actualCostUnit = Number(body.actualCostUnit);
    const agreedRateUnit = Number(body.agreedRateUnit);

    if (!Number.isFinite(qty) || qty <= 0) {
      return Response.json({ error: "qty must be a positive number" }, { status: 400 });
    }
    if (!Number.isFinite(actualCostUnit) || actualCostUnit < 0) {
      return Response.json({ error: "actualCostUnit must be a non-negative number" }, { status: 400 });
    }
    if (!Number.isFinite(agreedRateUnit) || agreedRateUnit < 0) {
      return Response.json({ error: "agreedRateUnit must be a non-negative number" }, { status: 400 });
    }

    const unit = body.unit ?? "EA";
    if (!UNITS.includes(unit)) {
      return Response.json({ error: `unit must be one of: ${UNITS.join(", ")}` }, { status: 400 });
    }

    const totals = computePaperTotals({ qty, actualCostUnit, agreedRateUnit });

    const entry = await prisma.paperLedgerEntry.create({
      data: {
        entryDate: new Date(body.entryDate),
        description: body.description,
        customerId: body.customerId,
        siteId: body.siteId || null,
        ticketId: body.ticketId || null,
        supplierId: body.supplierId || null,
        canonicalProductId: body.canonicalProductId || null,
        qty,
        unit: unit as never,
        actualCostUnit,
        agreedRateUnit,
        ...totals,
        originBillId: body.originBillId || null,
        originBillNo: body.originBillNo || null,
        notes: body.notes || null,
      },
    });

    return Response.json({ entry });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return Response.json({ error: message }, { status: 500 });
  }
}
