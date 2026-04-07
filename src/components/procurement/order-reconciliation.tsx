"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Check, X, Link2, Package, Truck, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

type PoLine = {
  id: string;
  description: string;
  qty: number;
  unitCost: number;
  lineTotal: number;
  matchStatus: string;
  ticketLineId: string | null;
  ticketLine: { id: string; description: string; qty: number; unit: string } | null;
  procurementOrder: { poNo: string; supplier: { name: string } };
};

type TicketLine = {
  id: string;
  description: string;
  qty: number;
  unit: string;
  status: string;
};

type ReconData = {
  poLines: PoLine[];
  ticketLines: TicketLine[];
  unmatchedTicketLines: TicketLine[];
  summary: {
    totalPoLines: number;
    matched: number;
    matchedWithExcess: number;
    unmatched: number;
    deliveryCost: number;
    unmatchedTicketLines: number;
  };
};

function statusBadge(status: string) {
  switch (status) {
    case "MATCHED":
      return <Badge className="text-[9px] bg-[#00CC66]/15 text-[#00CC66]">MATCHED</Badge>;
    case "MATCHED_WITH_EXCESS":
      return <Badge className="text-[9px] bg-[#FF9900]/15 text-[#FF9900]">EXCESS</Badge>;
    case "UNMATCHED":
      return <Badge className="text-[9px] bg-[#FF3333]/15 text-[#FF3333]">UNMATCHED</Badge>;
    case "STOCK_EXCESS":
      return <Badge className="text-[9px] bg-[#3399FF]/15 text-[#3399FF]">STOCK</Badge>;
    case "DELIVERY_COST":
      return <Badge className="text-[9px] bg-[#888888]/15 text-[#888888]">DELIVERY</Badge>;
    case "ABSORBED":
      return <Badge className="text-[9px] bg-[#888888]/15 text-[#888888]">ABSORBED</Badge>;
    case "STOCK_ALLOCATED":
      return <Badge className="text-[9px] bg-[#3399FF]/15 text-[#3399FF]">IN STOCK</Badge>;
    case "RETURN":
      return <Badge className="text-[9px] bg-[#FF9900]/15 text-[#FF9900]">RETURN</Badge>;
    default:
      return <Badge variant="outline" className="text-[9px]">{status}</Badge>;
  }
}

export function OrderReconciliation({ ticketId }: { ticketId: string }) {
  const router = useRouter();
  const [data, setData] = useState<ReconData | null>(null);
  const [loading, setLoading] = useState(true);
  const [matchingLineId, setMatchingLineId] = useState<string | null>(null);
  const [selectedTicketLineId, setSelectedTicketLineId] = useState("");

  useEffect(() => {
    fetch(`/api/tickets/${ticketId}/order-reconciliation`)
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); });
  }, [ticketId]);

  async function doAction(action: string, poLineId: string, extra?: Record<string, string>) {
    await fetch(`/api/tickets/${ticketId}/order-reconciliation`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, poLineId, ...extra }),
    });
    // Reload
    const r = await fetch(`/api/tickets/${ticketId}/order-reconciliation`);
    setData(await r.json());
    setMatchingLineId(null);
    setSelectedTicketLineId("");
    router.refresh();
  }

  if (loading) return <div className="py-8 text-center text-[#888888]">Loading reconciliation...</div>;
  if (!data) return <div className="py-8 text-center text-[#FF3333]">Failed to load</div>;

  const { poLines, unmatchedTicketLines, summary } = data;

  // Group by supplier
  const grouped: Record<string, PoLine[]> = {};
  for (const pl of poLines) {
    const key = `${pl.procurementOrder.supplier.name} (${pl.procurementOrder.poNo})`;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(pl);
  }

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="flex items-center gap-4 text-xs">
        <span className="text-[#00CC66]"><Check className="size-3 inline mr-1" />{summary.matched} matched</span>
        <span className="text-[#FF9900]"><Package className="size-3 inline mr-1" />{summary.matchedWithExcess} excess</span>
        <span className="text-[#FF3333]"><AlertTriangle className="size-3 inline mr-1" />{summary.unmatched} unmatched</span>
        {summary.deliveryCost > 0 && <span className="text-[#888888]"><Truck className="size-3 inline mr-1" />{summary.deliveryCost} delivery</span>}
        {summary.unmatchedTicketLines > 0 && <span className="text-[#FF3333] font-bold">{summary.unmatchedTicketLines} ticket lines not ordered</span>}
      </div>

      {/* Ordered vs Required */}
      <div className="border border-[#333333]">
        <div className="px-3 py-2 bg-[#222222] border-b border-[#333333]">
          <span className="text-xs font-bold">Ordered vs Required</span>
        </div>
        <table className="w-full">
          <thead>
            <tr className="text-[9px] uppercase tracking-widest text-[#666666] border-b border-[#333333]">
              <th className="text-left px-2 py-1.5">Item</th>
              <th className="text-right px-2 py-1.5 w-16">Required</th>
              <th className="text-right px-2 py-1.5 w-16">Ordered</th>
              <th className="text-right px-2 py-1.5 w-16">Diff</th>
              <th className="text-left px-2 py-1.5 w-20">Status</th>
              <th className="px-2 py-1.5 w-28">Action</th>
            </tr>
          </thead>
          <tbody>
            {data.ticketLines.map((tl) => {
              const matchedPoLines = poLines.filter(pl => pl.ticketLineId === tl.id);
              const hasStockAllocated = matchedPoLines.some(pl => pl.matchStatus === "STOCK_ALLOCATED");
              const hasReturn = matchedPoLines.some(pl => pl.matchStatus === "RETURN");
              const totalOrderedQty = matchedPoLines.reduce((s, pl) => s + Number(pl.qty), 0);
              const requiredQty = Number(tl.qty);
              // Handle pack UOM
              let effectiveRequired = requiredQty;
              if (tl.unit === "PACK") {
                const packMatch = tl.description.match(/\((\d+)\)/);
                if (packMatch) effectiveRequired = requiredQty * parseInt(packMatch[1]);
              }
              // If stock/return allocated, show as resolved (effective ordered = required)
              const orderedQty = (hasStockAllocated || hasReturn) ? effectiveRequired : totalOrderedQty;
              const diff = orderedQty - effectiveRequired;
              const resolved = hasStockAllocated || hasReturn;
              const statusColor = orderedQty === 0 ? "text-[#FF3333]" : resolved ? "text-[#00CC66]" : diff === 0 ? "text-[#00CC66]" : diff > 0 ? "text-[#FF9900]" : "text-[#FF3333]";
              const statusText = orderedQty === 0 ? "NOT ORDERED" : resolved ? (hasStockAllocated ? "RESOLVED → STOCK" : "RESOLVED → RETURN") : diff === 0 ? "EXACT" : diff > 0 ? `+${diff} EXCESS` : `${diff} SHORT`;
              const isSplitSupply = matchedPoLines.length > 1;
              const suppliers = [...new Set(matchedPoLines.map(pl => pl.procurementOrder.supplier.name))];
              return (
                <tr key={tl.id} className={`border-b border-[#2A2A2A] hover:bg-[#1E1E1E] ${isSplitSupply ? "bg-[#3399FF]/5" : ""}`}>
                  <td className="px-2 py-1.5 text-xs">
                    {tl.description}
                    {isSplitSupply && (
                      <div className="mt-0.5">
                        <span className="text-[9px] text-[#3399FF] font-bold">SPLIT SUPPLY: </span>
                        {matchedPoLines.map((pl, i) => (
                          <span key={pl.id} className="text-[9px] text-[#888888]">
                            {i > 0 ? " + " : ""}{pl.procurementOrder.supplier.name} ({Number(pl.qty)})
                          </span>
                        ))}
                      </div>
                    )}
                    {!isSplitSupply && matchedPoLines.length === 1 && (
                      <div className="text-[9px] text-[#666666] mt-0.5">{suppliers[0]}</div>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-xs text-right tabular-nums">{effectiveRequired}</td>
                  <td className="px-2 py-1.5 text-xs text-right tabular-nums">{orderedQty}</td>
                  <td className={`px-2 py-1.5 text-xs text-right tabular-nums font-bold ${statusColor}`}>{diff === 0 ? "—" : (diff > 0 ? "+" : "") + diff}</td>
                  <td className="px-2 py-1.5">
                    <span className={`text-[9px] font-bold ${statusColor}`}>{statusText}</span>
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex gap-0.5">
                      {!resolved && diff < 0 && (
                        <Button size="sm" variant="outline" className="h-5 text-[9px] px-1.5 text-[#FF3333]" onClick={() => doAction("flag_short", tl.id, { description: tl.description, shortQty: String(Math.abs(diff)) })}>
                          Order {Math.abs(diff)}
                        </Button>
                      )}
                      {!resolved && diff > 0 && (
                        <>
                          <Button size="sm" variant="outline" className="h-5 text-[9px] px-1.5 text-[#3399FF]" onClick={async () => { for (const pl of matchedPoLines) { await doAction("allocate_stock", pl.id, {}); } }}>
                            Stock +{diff}
                          </Button>
                          <Button size="sm" variant="outline" className="h-5 text-[9px] px-1.5 text-[#FF9900]" onClick={async () => { for (const pl of matchedPoLines) { await doAction("update_status", pl.id, { matchStatus: "RETURN" }); } }}>
                            Return
                          </Button>
                        </>
                      )}
                      {!resolved && orderedQty === 0 && (
                        <Button size="sm" variant="outline" className="h-5 text-[9px] px-1.5 text-[#FF3333]" onClick={() => doAction("flag_short", tl.id, { description: tl.description, shortQty: String(effectiveRequired) })}>
                          Order
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Unmatched ticket lines — need ordering */}
      {unmatchedTicketLines.length > 0 && (
        <div className="border border-[#FF3333]/30 bg-[#FF3333]/5 p-3 space-y-2">
          <div className="text-[10px] uppercase tracking-widest text-[#FF3333] font-bold">
            <AlertTriangle className="size-3 inline mr-1" />
            {unmatchedTicketLines.length} ticket lines NOT covered by any order
          </div>
          {unmatchedTicketLines.map((tl) => (
            <div key={tl.id} className="text-xs text-[#E0E0E0] pl-4">
              {Number(tl.qty)} {tl.unit} — {tl.description}
            </div>
          ))}
        </div>
      )}

      {/* Grouped by supplier */}
      {Object.entries(grouped).map(([supplier, lines]) => (
        <div key={supplier} className="border border-[#333333]">
          <div className="px-3 py-2 bg-[#222222] border-b border-[#333333] flex items-center justify-between">
            <span className="text-xs font-bold">{supplier}</span>
            <span className="text-[10px] text-[#888888]">{lines.length} lines</span>
          </div>
          <table className="w-full">
            <thead>
              <tr className="text-[9px] uppercase tracking-widest text-[#666666] border-b border-[#333333]">
                <th className="text-left px-2 py-1.5">Ordered</th>
                <th className="text-right px-2 py-1.5 w-12">Qty</th>
                <th className="text-right px-2 py-1.5 w-16">Cost</th>
                <th className="text-left px-2 py-1.5 w-24">Status</th>
                <th className="text-left px-2 py-1.5">Matched To</th>
                <th className="px-2 py-1.5 w-24">Actions</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((pl) => (
                <tr key={pl.id} className="border-b border-[#2A2A2A] hover:bg-[#1E1E1E]">
                  <td className="px-2 py-2 text-xs">{pl.description}</td>
                  <td className="px-2 py-2 text-xs text-right tabular-nums">{Number(pl.qty)}</td>
                  <td className="px-2 py-2 text-xs text-right tabular-nums">£{Number(pl.lineTotal).toFixed(2)}</td>
                  <td className="px-2 py-2">{statusBadge(pl.matchStatus)}</td>
                  <td className="px-2 py-2 text-[10px] text-[#888888]">
                    {pl.ticketLine ? (
                      <span className="text-[#00CC66]">{pl.ticketLine.description.slice(0, 40)}{pl.ticketLine.description.length > 40 ? "..." : ""}</span>
                    ) : matchingLineId === pl.id ? (
                      <div className="flex items-center gap-1">
                        <Select value={selectedTicketLineId} onValueChange={setSelectedTicketLineId}>
                          <SelectTrigger className="h-6 text-[10px] w-48">
                            <SelectValue placeholder="Select ticket line" />
                          </SelectTrigger>
                          <SelectContent>
                            {data.ticketLines.map((tl) => (
                              <SelectItem key={tl.id} value={tl.id} className="text-xs">
                                {Number(tl.qty)} {tl.unit} — {tl.description.slice(0, 50)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button size="sm" className="h-6 w-6 p-0 bg-[#00CC66]" onClick={() => selectedTicketLineId && doAction("match", pl.id, { ticketLineId: selectedTicketLineId })}>
                          <Check className="size-3" />
                        </Button>
                        <Button size="sm" variant="outline" className="h-6 w-6 p-0" onClick={() => setMatchingLineId(null)}>
                          <X className="size-3" />
                        </Button>
                      </div>
                    ) : (
                      <span className="text-[#FF3333]">—</span>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex gap-0.5">
                      {!pl.ticketLineId && pl.matchStatus !== "STOCK_EXCESS" && pl.matchStatus !== "ABSORBED" && (
                        <>
                          <Button size="sm" variant="outline" className="h-5 text-[9px] px-1.5" onClick={() => setMatchingLineId(pl.id)}>
                            <Link2 className="size-3 mr-0.5" />Match
                          </Button>
                          <Button size="sm" variant="outline" className="h-5 text-[9px] px-1.5 text-[#888888]" onClick={() => doAction("update_status", pl.id, { matchStatus: "ABSORBED" })}>
                            Absorb
                          </Button>
                        </>
                      )}
                      {pl.ticketLineId && (
                        <Button size="sm" variant="outline" className="h-5 text-[9px] px-1.5 text-[#FF9900]" onClick={() => doAction("unmatch", pl.id)}>
                          Unmatch
                        </Button>
                      )}
                      {pl.matchStatus === "MATCHED_WITH_EXCESS" && (
                        <Button size="sm" variant="outline" className="h-5 text-[9px] px-1.5 text-[#3399FF]" onClick={() => doAction("allocate_stock", pl.id, {})}>
                          <Package className="size-3 mr-0.5" />Stock
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
