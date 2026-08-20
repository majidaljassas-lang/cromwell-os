/**
 * Convert a QUOTED ticket to a CustomerPO in one shot.
 *
 * Flow:
 *   1. Validate ticket is QUOTED, has a customer + site, and an APPROVED quote
 *   2. Create CustomerPO (STANDARD_FIXED unless body overrides it)
 *      - poLimitValue defaults to the latest approved quote's totalSell
 *   3. Populate CustomerPOLine rows from that quote's lines, preserving order
 *   4. Move the ticket forward to APPROVED
 *
 * Body: {
 *   poNo: string;             // customer's PO reference
 *   poDate?: string;          // ISO date; defaults to now
 *   poType?: "STANDARD_FIXED" | "DRAWDOWN_LABOUR" | "DRAWDOWN_MATERIALS";
 *   poLimitValue?: number;    // defaults to quote total
 *   issuedBy?: string;        // free-text contact name
 *   notes?: string;
 * }
 */
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma";

type Body = {
  poNo?: unknown;
  poDate?: unknown;
  poType?: unknown;
  poLimitValue?: unknown;
  issuedBy?: unknown;
  notes?: unknown;
  selectedQuoteLineIds?: unknown;
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: ticketId } = await params;
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const poNo = typeof body.poNo === "string" ? body.poNo.trim() : "";
  if (!poNo) return Response.json({ error: "poNo is required" }, { status: 400 });

  const validTypes = new Set(["STANDARD_FIXED", "DRAWDOWN_LABOUR", "DRAWDOWN_MATERIALS"]);
  const poType =
    typeof body.poType === "string" && validTypes.has(body.poType)
      ? (body.poType as "STANDARD_FIXED" | "DRAWDOWN_LABOUR" | "DRAWDOWN_MATERIALS")
      : "STANDARD_FIXED";

  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: {
      id: true,
      ticketNo: true,
      payingCustomerId: true,
      siteId: true,
      siteCommercialLinkId: true,
      status: true,
      quotes: {
        where: { status: "APPROVED" },
        orderBy: { createdAt: "desc" },
        take: 1,
        include: {
          lines: { orderBy: { sortOrder: "asc" } },
        },
      },
    },
  });

  if (!ticket) return Response.json({ error: "Ticket not found" }, { status: 404 });
  if (!ticket.siteId)
    return Response.json({ error: "Ticket has no site — PO requires a site" }, { status: 422 });
  if (ticket.quotes.length === 0)
    return Response.json({ error: "No APPROVED quote on this ticket" }, { status: 422 });

  const quote = ticket.quotes[0];

  // Optional line-level selection. If omitted, all quote lines are PO'd (back-compat).
  let selectedLines = quote.lines;
  let partial = false;
  if (Array.isArray(body.selectedQuoteLineIds)) {
    const requested = body.selectedQuoteLineIds.filter((x): x is string => typeof x === "string");
    if (requested.length === 0)
      return Response.json({ error: "selectedQuoteLineIds is empty" }, { status: 400 });
    const validIds = new Set(quote.lines.map((l) => l.id));
    const unknown = requested.filter((id) => !validIds.has(id));
    if (unknown.length > 0)
      return Response.json(
        { error: `Unknown quote line ids: ${unknown.join(", ")}` },
        { status: 400 }
      );
    const selectedSet = new Set(requested);
    selectedLines = quote.lines.filter((l) => selectedSet.has(l.id));
    partial = selectedLines.length < quote.lines.length;

    // Guard against double-PO'ing a ticket line
    const ticketLineIds = selectedLines.map((l) => l.ticketLineId).filter((x): x is string => Boolean(x));
    if (ticketLineIds.length > 0) {
      const alreadyOn = await prisma.customerPOLine.findMany({
        where: {
          ticketLineId: { in: ticketLineIds },
          customerPO: { ticketId: ticket.id },
        },
        select: { ticketLineId: true },
      });
      if (alreadyOn.length > 0)
        return Response.json(
          {
            error: `One or more selected lines are already on a PO for this ticket: ${alreadyOn
              .map((x) => x.ticketLineId)
              .join(", ")}`,
          },
          { status: 409 }
        );
    }
  }

  const selectedLinesTotal = selectedLines.reduce(
    (sum, l) => sum.plus(new Prisma.Decimal(l.lineTotal ?? 0)),
    new Prisma.Decimal(0)
  );
  const poLimit =
    typeof body.poLimitValue === "number" && body.poLimitValue > 0
      ? new Prisma.Decimal(body.poLimitValue)
      : selectedLinesTotal.gt(0)
        ? selectedLinesTotal
        : new Prisma.Decimal(quote.totalSell);

  const poDate =
    typeof body.poDate === "string" && body.poDate.length > 0
      ? new Date(body.poDate)
      : new Date();

  const issuedBy = typeof body.issuedBy === "string" ? body.issuedBy.trim() || null : null;
  const notes = typeof body.notes === "string" ? body.notes : null;

  const result = await prisma.$transaction(async (tx) => {
    const po = await tx.customerPO.create({
      data: {
        ticketId: ticket.id,
        customerId: ticket.payingCustomerId,
        siteId: ticket.siteId!,
        siteCommercialLinkId: ticket.siteCommercialLinkId ?? undefined,
        poNo,
        poType,
        poDate,
        status: "RECEIVED",
        totalValue: poLimit,
        poLimitValue: poLimit,
        poRemainingValue: poLimit,
        quoteId: quote.id,
        issuedBy,
        notes,
      },
    });

    // Copy selected quote lines into PO lines, preserving order
    for (let i = 0; i < selectedLines.length; i++) {
      const ql = selectedLines[i];
      await tx.customerPOLine.create({
        data: {
          customerPOId: po.id,
          ticketLineId: ql.ticketLineId,
          description: ql.description,
          qty: ql.qty,
          agreedUnitPrice: ql.unitPrice,
          agreedTotal: ql.lineTotal,
        },
      });
    }

    // Advance the ticket. poStatus=PARTIAL if any quote line is left un-PO'd.
    await tx.ticket.update({
      where: { id: ticket.id },
      data: { status: "APPROVED", poStatus: partial ? "PARTIAL" : "RECEIVED" },
    });

    return po;
  });

  return Response.json({
    ok: true,
    poId: result.id,
    poNo: result.poNo,
    poType: result.poType,
    poLimitValue: Number(result.poLimitValue),
    poRemainingValue: Number(result.poRemainingValue),
    linesCreated: selectedLines.length,
    partial,
    quoteId: quote.id,
    ticketId: ticket.id,
  });
}
