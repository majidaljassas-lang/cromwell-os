import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { prisma } from "@/lib/prisma";
import { CreatePOForm } from "@/components/tickets/create-po-form";

export const dynamic = "force-dynamic";

export default async function CreatePOPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const ticket = await prisma.ticket.findUnique({
    where: { id },
    select: {
      id: true,
      ticketNo: true,
      title: true,
      status: true,
      payingCustomer: { select: { id: true, name: true } },
      site: { select: { id: true, siteName: true } },
      _count: { select: { lines: true } },
      quotes: {
        where: { status: "APPROVED" },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: {
          id: true,
          quoteNo: true,
          totalSell: true,
          lines: {
            orderBy: { sortOrder: "asc" },
            select: {
              id: true,
              ticketLineId: true,
              description: true,
              qty: true,
              unitPrice: true,
              lineTotal: true,
            },
          },
        },
      },
      customerPOs: {
        select: {
          id: true,
          poNo: true,
          poType: true,
          poLimitValue: true,
          lines: { select: { ticketLineId: true } },
        },
      },
    },
  });

  if (!ticket) notFound();

  const quote = ticket.quotes[0] ?? null;
  const existingPO = ticket.customerPOs[0] ?? null;

  const alreadyPOdTicketLineIds = new Set(
    ticket.customerPOs.flatMap((po) =>
      po.lines.map((l) => l.ticketLineId).filter((x): x is string => Boolean(x))
    )
  );

  const quoteLines =
    quote?.lines.map((l) => ({
      id: l.id,
      ticketLineId: l.ticketLineId,
      description: l.description,
      qty: Number(l.qty ?? 0),
      unitPrice: Number(l.unitPrice ?? 0),
      lineTotal: Number(l.lineTotal ?? 0),
      alreadyPOd: l.ticketLineId ? alreadyPOdTicketLineIds.has(l.ticketLineId) : false,
    })) ?? [];

  return (
    <div className="p-4 space-y-4 max-w-2xl">
      <div className="flex items-center gap-2">
        <Link href={`/tickets/${ticket.id}`}>
          <Button variant="ghost" size="sm">
            <ArrowLeft className="size-4 mr-1" /> Back to ticket
          </Button>
        </Link>
        <h1 className="text-lg font-medium">Convert to Customer PO</h1>
      </div>

      <div className="rounded border p-3 text-xs space-y-1">
        <div>
          <span className="text-muted-foreground">Ticket: </span>
          CP-{String(ticket.ticketNo).padStart(4, "0")} — {ticket.title}
        </div>
        <div>
          <span className="text-muted-foreground">Customer: </span>
          {ticket.payingCustomer.name}
        </div>
        <div>
          <span className="text-muted-foreground">Site: </span>
          {ticket.site?.siteName ?? "(none)"}
        </div>
        <div>
          <span className="text-muted-foreground">Lines: </span>
          {ticket._count.lines}
        </div>
        <div>
          <span className="text-muted-foreground">Approved quote: </span>
          {quote
            ? `${quote.quoteNo} — £${Number(quote.totalSell).toLocaleString("en-GB", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })} ex VAT`
            : "(none — must approve a quote first)"}
        </div>
      </div>

      {existingPO && (
        <div className="rounded border border-[#FF9900]/40 bg-[#FF9900]/10 p-3 text-xs">
          A PO already exists for this ticket: <strong>{existingPO.poNo}</strong> (
          {existingPO.poType}, limit £
          {Number(existingPO.poLimitValue ?? 0).toLocaleString("en-GB", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
          ). Creating another will not delete it.
        </div>
      )}

      {!quote ? (
        <div className="rounded border p-3 text-xs text-muted-foreground">
          This ticket has no APPROVED quote. Approve a quote on the ticket first, then come back.
        </div>
      ) : (
        <CreatePOForm
          ticketId={ticket.id}
          defaultLimit={Number(quote.totalSell)}
          quoteNo={quote.quoteNo}
          lines={quoteLines}
        />
      )}
    </div>
  );
}
