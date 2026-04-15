/**
 * POST /api/bills/reverse-check
 *   Body: { since?: "YYYY-MM-DD" }
 *   Flags SalesInvoiceLines with no corresponding cost coverage.
 *
 * GET /api/bills/reverse-check
 *   Returns currently-flagged unconfirmed invoice lines.
 */

import { prisma } from "@/lib/prisma";
import { runReverseCheck } from "@/lib/bills/reverse-check";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const since = typeof body.since === "string" ? new Date(body.since) : undefined;
    if (since && Number.isNaN(since.getTime())) {
      return Response.json({ error: "invalid since" }, { status: 400 });
    }
    const result = await runReverseCheck({ since });
    return Response.json(result);
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "reverse-check failed" },
      { status: 500 },
    );
  }
}

export async function GET() {
  const unconfirmed = await prisma.salesInvoiceLine.findMany({
    where: { costUnconfirmed: true },
    orderBy: { updatedAt: "desc" },
    take: 500,
    select: {
      id: true, description: true, qty: true, lineTotal: true, updatedAt: true,
      ticketLineId: true,
      salesInvoice: { select: { id: true, invoiceNo: true, ticketId: true, status: true, issuedAt: true } },
    },
  });
  return Response.json({ count: unconfirmed.length, lines: unconfirmed });
}
