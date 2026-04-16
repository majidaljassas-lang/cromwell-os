"use client";

import { useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Plus, Star, Pin, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

// ── Types ───────────────────────────────────────────────────────────────────

type Decimal = { toString(): string } | string | number | null;

interface Price {
  id: string;
  supplierName: string;
  supplierId: string | null;
  costPerUnit: Decimal;
  costTotal: Decimal;
  leadTimeDays: number | null;
  notes: string | null;
  isWinner: boolean;
  isManual: boolean;
}

interface Line {
  id: string;
  description: string;
  qty: Decimal;
  unit: string;
  expectedCostUnit: Decimal;
  expectedCostTotal: Decimal;
  supplierName: string | null;
  prices: Price[];
}

interface Supplier {
  id: string;
  name: string;
}

interface ComparisonPricingProps {
  ticketId: string;
  lines: Line[];
  suppliers: Supplier[];
  competitorTarget?: number | null;
  defaultMarginPct?: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function num(v: Decimal): number {
  if (v === null || v === undefined) return 0;
  return Number(v.toString());
}

function fmt(n: number): string {
  return n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Add Price Form (inline) ─────────────────────────────────────────────────

function AddPriceRow({
  ticketId,
  lineId,
  suppliers,
  onSaved,
  onCancel,
}: {
  ticketId: string;
  lineId: string;
  suppliers: Supplier[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [costPerUnit, setCostPerUnit] = useState("");
  const [leadTime, setLeadTime] = useState("");
  const [saving, setSaving] = useState(false);
  const [suggestions, setSuggestions] = useState<Supplier[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  function handleNameChange(val: string) {
    setName(val);
    setSupplierId(null);
    if (val.length >= 2) {
      const matches = suppliers.filter((s) =>
        s.name.toLowerCase().includes(val.toLowerCase())
      ).slice(0, 5);
      setSuggestions(matches);
      setShowSuggestions(matches.length > 0);
    } else {
      setShowSuggestions(false);
    }
  }

  function selectSupplier(s: Supplier) {
    setName(s.name);
    setSupplierId(s.id);
    setShowSuggestions(false);
  }

  async function save() {
    if (!name.trim() || !costPerUnit) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/tickets/${ticketId}/lines/${lineId}/prices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierName: name.trim(),
          supplierId,
          costPerUnit: Number(costPerUnit),
          leadTimeDays: leadTime ? Number(leadTime) : null,
        }),
      });
      if (res.ok) {
        onSaved();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr className="border-[#333333] bg-[#0A0A0A]">
      <td className="p-1 relative">
        <Input
          value={name}
          onChange={(e) => handleNameChange(e.target.value)}
          onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
          placeholder="Supplier name"
          className="bg-[#1A1A1A] border-[#444] text-xs h-7"
          autoFocus
        />
        {showSuggestions && (
          <div className="absolute z-10 top-8 left-1 bg-[#1A1A1A] border border-[#444] rounded shadow-lg max-h-32 overflow-y-auto">
            {suggestions.map((s) => (
              <button
                key={s.id}
                className="block w-full text-left px-3 py-1.5 text-xs hover:bg-[#333] text-[#ccc]"
                onMouseDown={() => selectSupplier(s)}
              >
                {s.name}
              </button>
            ))}
          </div>
        )}
      </td>
      <td className="p-1">
        <Input
          type="number"
          step="0.01"
          value={costPerUnit}
          onChange={(e) => setCostPerUnit(e.target.value)}
          placeholder="0.00"
          className="bg-[#1A1A1A] border-[#444] text-xs h-7 w-24 text-right tabular-nums"
          onKeyDown={(e) => { if (e.key === "Enter") save(); }}
        />
      </td>
      <td className="p-1 text-xs text-right tabular-nums text-[#666]">
        {costPerUnit ? `£${fmt(Number(costPerUnit))}` : "—"}
      </td>
      <td className="p-1">
        <Input
          type="number"
          value={leadTime}
          onChange={(e) => setLeadTime(e.target.value)}
          placeholder="days"
          className="bg-[#1A1A1A] border-[#444] text-xs h-7 w-16 text-right"
        />
      </td>
      <td className="p-1">
        <div className="flex gap-1">
          <Button size="sm" className="h-6 text-[10px] bg-[#00CC66] hover:bg-[#00AA55] text-black px-2" onClick={save} disabled={saving || !name.trim() || !costPerUnit}>
            {saving ? "..." : "Save"}
          </Button>
          <Button size="sm" variant="ghost" className="h-6 text-[10px] px-1 text-[#888]" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </td>
    </tr>
  );
}

// ── Per-line price comparison ────────────────────────────────────────────────

function LinePricing({
  ticketId,
  line,
  suppliers,
  marginPct,
}: {
  ticketId: string;
  line: Line;
  suppliers: Supplier[];
  marginPct: number;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [expanded, setExpanded] = useState(line.prices.length > 0);

  const qty = num(line.qty);
  const winner = line.prices.find((p) => p.isWinner);
  const winnerCost = winner ? num(winner.costTotal) : 0;
  const salePrice = winnerCost > 0 ? winnerCost / (1 - marginPct / 100) : 0;
  const margin = salePrice - winnerCost;
  const hasPrices = line.prices.length > 0;

  async function setWinner(priceId: string) {
    await fetch(`/api/tickets/${ticketId}/lines/${line.id}/prices`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ priceId, isManual: true }),
    });
    router.refresh();
  }

  async function deletePrice(priceId: string) {
    await fetch(`/api/tickets/${ticketId}/lines/${line.id}/prices`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ priceId }),
    });
    router.refresh();
  }

  function handleSaved() {
    setAdding(false);
    router.refresh();
  }

  return (
    <div className="border border-[#333333] rounded-md mb-2 overflow-hidden">
      {/* Line header */}
      <button
        className="w-full flex items-center gap-3 px-3 py-2 bg-[#111] hover:bg-[#1A1A1A] text-left"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown className="w-3 h-3 text-[#666]" /> : <ChevronRight className="w-3 h-3 text-[#666]" />}
        <span className="text-xs font-medium flex-1 truncate">{line.description}</span>
        <span className="text-[10px] text-[#888] tabular-nums">{qty} {line.unit}</span>
        {hasPrices ? (
          <div className="flex items-center gap-3 text-xs tabular-nums">
            <span className="text-[#888]">
              {line.prices.length} price{line.prices.length !== 1 ? "s" : ""}
            </span>
            {winner && (
              <>
                <span className="text-[#FF9900]">
                  Best: £{fmt(winnerCost)}
                </span>
                <span className="text-[#00CC66]">
                  Sale: £{fmt(salePrice)}
                </span>
              </>
            )}
          </div>
        ) : (
          <Badge variant="outline" className="text-[10px] border-[#555] text-[#888]">
            No prices
          </Badge>
        )}
      </button>

      {expanded && (
        <div className="border-t border-[#333333]">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#333333]">
                <th className="text-[10px] uppercase tracking-wider text-[#888] font-normal text-left px-3 py-1.5 w-[35%]">Supplier</th>
                <th className="text-[10px] uppercase tracking-wider text-[#888] font-normal text-right px-3 py-1.5 w-[15%]">Unit £</th>
                <th className="text-[10px] uppercase tracking-wider text-[#888] font-normal text-right px-3 py-1.5 w-[15%]">Total £</th>
                <th className="text-[10px] uppercase tracking-wider text-[#888] font-normal text-right px-3 py-1.5 w-[10%]">Lead</th>
                <th className="text-[10px] uppercase tracking-wider text-[#888] font-normal text-right px-3 py-1.5 w-[25%]"></th>
              </tr>
            </thead>
            <tbody>
              {line.prices.map((price, idx) => {
                const isLowest = idx === 0 && !price.isManual && price.isWinner;
                const isManualWinner = price.isManual && price.isWinner;

                return (
                  <tr key={price.id} className={`border-b border-[#222] hover:bg-[#1A1A1A] ${price.isWinner ? "bg-[#00CC66]/5" : ""}`}>
                    <td className="px-3 py-1.5 text-xs">
                      <div className="flex items-center gap-2">
                        {price.isWinner && (
                          isManualWinner
                            ? <Pin className="w-3 h-3 text-[#3399FF]" />
                            : <Star className="w-3 h-3 text-[#FF9900] fill-[#FF9900]" />
                        )}
                        <span className={price.isWinner ? "font-medium" : "text-[#ccc]"}>
                          {price.supplierName}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-1.5 text-xs text-right tabular-nums">
                      £{fmt(num(price.costPerUnit))}
                    </td>
                    <td className={`px-3 py-1.5 text-xs text-right tabular-nums font-medium ${price.isWinner ? "text-[#00CC66]" : ""}`}>
                      £{fmt(num(price.costTotal))}
                    </td>
                    <td className="px-3 py-1.5 text-xs text-right tabular-nums text-[#888]">
                      {price.leadTimeDays != null ? `${price.leadTimeDays}d` : "—"}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {!price.isWinner && (
                          <button
                            onClick={() => setWinner(price.id)}
                            className="text-[10px] text-[#3399FF] hover:text-[#55BBFF] px-1.5 py-0.5 rounded hover:bg-[#3399FF]/10"
                            title="Override: use this supplier"
                          >
                            Use this
                          </button>
                        )}
                        <button
                          onClick={() => deletePrice(price.id)}
                          className="text-[#555] hover:text-[#FF3333] p-0.5"
                          title="Remove price"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {adding && (
                <AddPriceRow
                  ticketId={ticketId}
                  lineId={line.id}
                  suppliers={suppliers}
                  onSaved={handleSaved}
                  onCancel={() => setAdding(false)}
                />
              )}
            </tbody>
          </table>
          {!adding && (
            <button
              onClick={() => setAdding(true)}
              className="w-full flex items-center gap-1.5 px-3 py-1.5 text-[10px] text-[#888] hover:text-[#ccc] hover:bg-[#1A1A1A]"
            >
              <Plus className="w-3 h-3" />
              Add supplier price
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export function ComparisonPricing({
  ticketId,
  lines,
  suppliers,
  competitorTarget,
  defaultMarginPct = 20,
}: ComparisonPricingProps) {
  const [marginPct, setMarginPct] = useState(defaultMarginPct);

  const totals = useMemo(() => {
    let bestCost = 0;
    let linesWithPrices = 0;

    for (const line of lines) {
      const winner = line.prices.find((p) => p.isWinner);
      if (winner) {
        bestCost += num(winner.costTotal);
        linesWithPrices++;
      }
    }

    const saleTotal = bestCost > 0 ? bestCost / (1 - marginPct / 100) : 0;
    const marginTotal = saleTotal - bestCost;
    const allPriced = linesWithPrices === lines.length && lines.length > 0;
    const target = competitorTarget ?? 0;
    const undercut = target > 0 ? target - saleTotal : 0;

    // Winner breakdown
    const winnerMap = new Map<string, number>();
    for (const line of lines) {
      const winner = line.prices.find((p) => p.isWinner);
      if (winner) {
        winnerMap.set(winner.supplierName, (winnerMap.get(winner.supplierName) ?? 0) + 1);
      }
    }

    return { bestCost, saleTotal, marginTotal, linesWithPrices, allPriced, target, undercut, winnerMap };
  }, [lines, marginPct, competitorTarget]);

  return (
    <div className="space-y-3">
      {/* Summary bar */}
      <div className="grid grid-cols-5 gap-2">
        <div className="bg-[#111] border border-[#333] rounded p-2.5 text-center">
          <div className="text-[9px] uppercase text-[#888] tracking-wider">Best Cost</div>
          <div className="text-sm font-semibold tabular-nums mt-0.5">
            {totals.bestCost > 0 ? `£${fmt(totals.bestCost)}` : "—"}
          </div>
        </div>
        <div className="bg-[#111] border border-[#333] rounded p-2.5 text-center">
          <div className="text-[9px] uppercase text-[#888] tracking-wider">Margin %</div>
          <div className="mt-0.5">
            <input
              type="number"
              step="0.5"
              value={marginPct}
              onChange={(e) => setMarginPct(Number(e.target.value) || 0)}
              className="w-16 bg-transparent border-b border-[#444] focus:border-[#FF9900] text-center text-sm font-semibold tabular-nums focus:outline-none"
            />
            <span className="text-xs text-[#888]">%</span>
          </div>
        </div>
        <div className="bg-[#111] border border-[#333] rounded p-2.5 text-center">
          <div className="text-[9px] uppercase text-[#888] tracking-wider">Sale Total</div>
          <div className="text-sm font-semibold tabular-nums mt-0.5 text-[#FF9900]">
            {totals.saleTotal > 0 ? `£${fmt(totals.saleTotal)}` : "—"}
          </div>
        </div>
        <div className="bg-[#111] border border-[#333] rounded p-2.5 text-center">
          <div className="text-[9px] uppercase text-[#888] tracking-wider">Margin £</div>
          <div className={`text-sm font-semibold tabular-nums mt-0.5 ${totals.marginTotal >= 0 ? "text-[#00CC66]" : "text-[#FF3333]"}`}>
            {totals.marginTotal > 0 ? `£${fmt(totals.marginTotal)}` : "—"}
          </div>
        </div>
        {totals.target > 0 ? (
          <div className="bg-[#111] border border-[#333] rounded p-2.5 text-center">
            <div className="text-[9px] uppercase text-[#888] tracking-wider">vs Target £{fmt(totals.target)}</div>
            <div className={`text-sm font-semibold tabular-nums mt-0.5 ${totals.undercut > 0 ? "text-[#00CC66]" : "text-[#FF3333]"}`}>
              {totals.saleTotal > 0 ? `${totals.undercut > 0 ? "-" : "+"}£${fmt(Math.abs(totals.undercut))}` : "—"}
            </div>
          </div>
        ) : (
          <div className="bg-[#111] border border-[#333] rounded p-2.5 text-center">
            <div className="text-[9px] uppercase text-[#888] tracking-wider">Priced</div>
            <div className="text-sm font-semibold tabular-nums mt-0.5">
              {totals.linesWithPrices}/{lines.length}
            </div>
          </div>
        )}
      </div>

      {/* Winner breakdown */}
      {totals.winnerMap.size > 0 && (
        <div className="flex items-center gap-2 px-1">
          <span className="text-[10px] text-[#888] uppercase tracking-wider">Winners:</span>
          {Array.from(totals.winnerMap.entries()).map(([name, count]) => (
            <Badge key={name} variant="secondary" className="text-[10px]">
              {name} ({count})
            </Badge>
          ))}
        </div>
      )}

      {/* Per-line pricing */}
      <div>
        {lines.map((line) => (
          <LinePricing
            key={line.id}
            ticketId={ticketId}
            line={line}
            suppliers={suppliers}
            marginPct={marginPct}
          />
        ))}
      </div>

      {/* Generate Quote button */}
      {totals.allPriced && (
        <div className="flex justify-end">
          <Button
            className="bg-[#FF9900] hover:bg-[#FF9900]/90 text-black font-medium"
            size="sm"
          >
            Generate Quote from Best Prices
          </Button>
        </div>
      )}
    </div>
  );
}
