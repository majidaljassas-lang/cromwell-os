import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { prisma } from "@/lib/prisma";
import { CallOffPicker } from "@/components/po-register/call-off-picker";
import { PoPnlPanel } from "@/components/po-register/po-pnl-panel";
import { LoggedCallOffs } from "@/components/po-register/logged-call-offs";
import { ReallocationCreditPanel } from "@/components/po-register/reallocation-credit-panel";

export const dynamic = "force-dynamic";

export default async function NewCallOffPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const po = await prisma.customerPO.findUnique({
    where: { id },
    include: {
      customer: { select: { name: true } },
      site: { select: { siteName: true } },
      lines: {
        include: {
          ticketLine: {
            select: { id: true, description: true, productCode: true, unit: true, internalNotes: true },
          },
        },
      },
      materialsDrawdowns: { select: { id: true, drawdownDate: true, sellValue: true } },
    },
  });
  if (!po) notFound();

  // Internal-only reallocation credit (value freed by a cancelled PO line),
  // with its draw ledger. Shaped for the client panel.
  const creditRow = await prisma.reallocationCredit.findFirst({
    where: { customerPOId: po.id },
    include: { draws: { orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }] } },
  });
  const reallocationCredit = creditRow
    ? (() => {
        const drawn = creditRow.draws.reduce((s, d) => s + Number(d.value), 0);
        const creditValue = Number(creditRow.creditValue);
        return {
          id: creditRow.id,
          sourceDescription: creditRow.sourceDescription,
          sourceQty: Number(creditRow.sourceQty),
          sourceUnitValue: Number(creditRow.sourceUnitValue),
          creditValue,
          notes: creditRow.notes,
          draws: creditRow.draws.map((d) => ({
            id: d.id,
            description: d.description,
            value: Number(d.value),
            createdAt: d.createdAt.toISOString(),
          })),
          drawn,
          remaining: Math.round((creditValue - drawn) * 100) / 100,
        };
      })()
    : null;

  // Actual call-offs already logged against this PO (for the list + client/internal copies).
  const callOffsRaw = await prisma.callOff.findMany({
    where: { customerPOId: po.id },
    orderBy: { callOffNo: "asc" },
    include: {
      lines: {
        orderBy: { displayOrder: "asc" },
        include: { ticketLine: { select: { expectedCostUnit: true, supplierName: true } } },
      },
      deliveryNotes: { include: { lines: { select: { ticketLineId: true, qtyDelivered: true } } } },
    },
  });

  // Substitution links for clear display: which item became which, on which
  // call-off, and when — sourced from the APPLIED CallOffSubstitution records so
  // the link (from → to), the call-off (CO seq) and the date are all explicit.
  const coSeqById = new Map(callOffsRaw.map((co, i) => [co.id, i + 1] as const));
  const shortName = (d: string) => d.split(" - ")[0].trim();
  const fmtShort = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const subRecords = await prisma.callOffSubstitution.findMany({
    where: { customerPOId: po.id },
    include: { lines: true, callOff: { select: { id: true, callOffDate: true } } },
  });
  // Supplied qty per (call-off, ticket line) — to show what was actually drawn
  // against each substitute vs the balance it was swapped in to cover.
  const suppliedMap = new Map<string, number>();
  for (const co of callOffsRaw) {
    for (const l of co.lines) {
      if (!l.ticketLineId) continue;
      const k = `${co.id}|${l.ticketLineId}`;
      suppliedMap.set(k, (suppliedMap.get(k) ?? 0) + Number(l.requestedQty));
    }
  }

  // substitutions[itemDescription] = ready-to-render label lines (violet badges).
  const substitutions: Record<string, string[]> = {};
  // Explicit per-swap summary for the client: when · what · why · quantities.
  const substitutionSummary: { co: string; date: string; from: string; to: string; reason: string; balance: number; supplied: number; over: number }[] = [];
  for (const s of subRecords) {
    const seq = s.callOffId ? coSeqById.get(s.callOffId) : undefined;
    const co = seq ? `CO${seq}` : "PO-wide";
    const date = s.callOff ? fmtShort(s.callOff.callOffDate) : "";
    const when = date ? ` · ${date}` : "";
    const reason = s.notes ?? "";
    for (const l of s.lines) {
      const from = shortName(l.oldDescription);
      const to = shortName(l.newDescription);
      (substitutions[l.newDescription] ??= []).push(`🔄 ${co}${when}: from ${from}`);
      (substitutions[l.oldDescription] ??= []).push(`🔄 ${co}${when}: to ${to}`);
      const balance = Number(l.qtyToSwap);
      const supplied = s.callOffId && l.newTicketLineId ? (suppliedMap.get(`${s.callOffId}|${l.newTicketLineId}`) ?? 0) : 0;
      substitutionSummary.push({ co, date, from, to, reason, balance, supplied, over: Math.max(0, supplied - balance) });
    }
  }

  const loggedCallOffs = callOffsRaw.map((co, idx) => {
    const deliveredByTL = new Map<string, number>();
    for (const dn of co.deliveryNotes) {
      for (const dl of dn.lines) {
        deliveredByTL.set(dl.ticketLineId, (deliveredByTL.get(dl.ticketLineId) ?? 0) + Number(dl.qtyDelivered));
      }
    }
    return {
      id: co.id,
      no: co.callOffNo,
      coSeq: idx + 1,
      date: co.callOffDate.toISOString(),
      status: co.status,
      lines: co.lines.map((l) => ({
        description: l.description,
        qty: Number(l.requestedQty),
        sellUnit: Number(l.agreedUnitPrice ?? 0),
        costUnit: Number(l.ticketLine?.expectedCostUnit ?? 0),
        supplier: l.ticketLine?.supplierName ?? null,
        delivered: l.ticketLineId ? (deliveredByTL.get(l.ticketLineId) ?? 0) : 0,
      })),
    };
  });

  // Per-delivery-note breakdown (qty per item), for the balances grid.
  const tlToDesc = new Map<string, string>();
  for (const co of callOffsRaw) {
    for (const l of co.lines) if (l.ticketLineId) tlToDesc.set(l.ticketLineId, l.description);
  }
  const deliveryNotes = callOffsRaw
    .flatMap((co, idx) =>
      co.deliveryNotes.map((dn) => {
        const qtyByDescription: Record<string, number> = {};
        for (const dl of dn.lines) {
          const desc = tlToDesc.get(dl.ticketLineId);
          if (!desc) continue;
          qtyByDescription[desc] = (qtyByDescription[desc] ?? 0) + Number(dl.qtyDelivered);
        }
        return { no: dn.deliveryNo, coSeq: idx + 1, qtyByDescription };
      })
    )
    .sort((a, b) => a.no - b.no);

  // "Called off" is computed live from the sum of CallOffLine.requestedQty per
  // PO line across every call-off on this PO — the same source of truth the
  // save logic enforces against — so it reflects existing call-offs even if the
  // stored consumedQty counter was never written.
  const calledOffGroups = await prisma.callOffLine.groupBy({
    by: ["customerPOLineId"],
    where: { callOff: { customerPOId: po.id } },
    _sum: { requestedQty: true },
  });
  const calledOffByLine = new Map<string, number>();
  for (const g of calledOffGroups) {
    calledOffByLine.set(g.customerPOLineId, Number(g._sum.requestedQty ?? 0));
  }

  const rows = po.lines
    .map((pl) => {
      const orderedQty = Number(pl.qty ?? 0);
      const orderedValue = Number(pl.agreedTotal ?? 0);
      const unitPrice = Number(pl.agreedUnitPrice ?? 0);
      const consumedQty = calledOffByLine.get(pl.id) ?? 0;
      const consumedValue = Math.round(consumedQty * unitPrice * 100) / 100;
      const remainingQty = Math.max(0, orderedQty - consumedQty);
      const remainingValue = Math.max(0, orderedValue - consumedValue);
      return {
        poLineId: pl.id,
        ticketLineId: pl.ticketLineId,
        description: pl.description,
        productCode: pl.ticketLine?.productCode ?? null,
        unit: pl.ticketLine?.unit ?? "EA",
        unitPrice: Number(pl.agreedUnitPrice ?? 0),
        orderedQty,
        orderedValue,
        consumedQty,
        consumedValue,
        remainingQty,
        remainingValue,
        sub: substitutions[pl.description] ?? null,
      };
    })
    // Stable order: original PO line order
    .sort((a, b) => 0);

  // Fixed-value POs leave poLimitValue null and carry the value in totalValue;
  // fall back to it so the remaining/limit header isn't a false £0.
  const limit = Number(po.poLimitValue ?? po.totalValue ?? 0);
  const consumed = Math.round(rows.reduce((s, r) => s + r.consumedValue, 0) * 100) / 100;
  const remaining = Math.max(0, limit - consumed);
  const drawdownCount = po.materialsDrawdowns.length;

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Link href="/po-register">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="size-4 mr-1" /> Back to PO register
          </Button>
        </Link>
        <h1 className="text-lg font-medium">New call-off</h1>
      </div>

      <div className="rounded border p-3 text-xs grid grid-cols-2 gap-x-6 gap-y-1 max-w-3xl">
        <div>
          <span className="text-muted-foreground">PO: </span>
          {po.poNo}
        </div>
        <div>
          <span className="text-muted-foreground">Customer: </span>
          {po.customer.name}
        </div>
        <div>
          <span className="text-muted-foreground">Site: </span>
          {po.site?.siteName ?? "(none)"}
        </div>
        <div>
          <span className="text-muted-foreground">Drawdowns logged: </span>
          {drawdownCount}
        </div>
        <div>
          <span className="text-muted-foreground">PO limit: </span>£
          {limit.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </div>
        <div>
          <span className="text-muted-foreground">Consumed: </span>£
          {consumed.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </div>
        <div className="font-semibold">
          <span className="text-muted-foreground font-normal">Remaining: </span>£
          {remaining.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </div>
      </div>

      <ReallocationCreditPanel poId={po.id} credit={reallocationCredit} />

      <PoPnlPanel poId={po.id} />

      <CallOffPicker poId={po.id} poRemaining={remaining} rows={rows} />

      <LoggedCallOffs
        poNo={po.poNo}
        customerName={po.customer.name}
        siteName={po.site?.siteName ?? ""}
        vatRate={Number(po.vatRate ?? 20)}
        callOffs={loggedCallOffs}
        deliveryNotes={deliveryNotes}
        poQty={po.lines.reduce<Record<string, number>>((m, pl) => {
          m[pl.description] = (m[pl.description] ?? 0) + Number(pl.qty ?? 0);
          return m;
        }, {})}
        substitutions={substitutions}
        substitutionSummary={substitutionSummary}
      />
    </div>
  );
}
