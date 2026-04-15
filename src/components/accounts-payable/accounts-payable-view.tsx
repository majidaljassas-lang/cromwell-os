"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type AgingBuckets = { current: number; days30: number; days60: number; days90: number; total: number };
type SupplierBalance = { supplierId: string; supplierName: string; outstanding: number; bills: number; oldestDays: number };
type OpenBill = {
  id: string; billNo: string; billDate: string;
  supplierId: string; supplierName: string;
  totalCost: number; paid: number; outstanding: number;
  ageDays: number; bucket: "current" | "days30" | "days60" | "days90";
};
type APData = { asOf: string; cutover: string; aging: AgingBuckets; suppliers: SupplierBalance[]; openBills: OpenBill[] };

const BUCKET_COLOR: Record<OpenBill["bucket"], string> = {
  current: "#00CC66",
  days30:  "#FFCC00",
  days60:  "#FF9900",
  days90:  "#FF3333",
};

const BUCKET_LABEL: Record<OpenBill["bucket"], string> = {
  current: "0–30",
  days30:  "31–60",
  days60:  "61–90",
  days90:  "90+",
};

function fmt(n: number): string {
  return n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function AccountsPayableView() {
  const [data, setData] = useState<APData | null>(null);
  const [loading, setLoading] = useState(false);
  const [supplierFilter, setSupplierFilter] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [paying, setPaying] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState("BACS");
  const [paymentRef, setPaymentRef] = useState("");
  const [resultBanner, setResultBanner] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    try {
      const r = await fetch("/api/finance/accounts-payable");
      const j = await r.json();
      setData(j);
    } finally { setLoading(false); }
  }
  useEffect(() => { refresh(); }, []);

  function toggleSelect(billId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(billId)) next.delete(billId); else next.add(billId);
      return next;
    });
  }

  // Filter open bills by chosen supplier if any
  const filteredBills = (data?.openBills ?? []).filter((b) =>
    !supplierFilter || b.supplierId === supplierFilter
  );

  const selectedBills = filteredBills.filter((b) => selected.has(b.id));
  const selectedTotal = selectedBills.reduce((s, b) => s + b.outstanding, 0);
  const selectedSuppliers = new Set(selectedBills.map((b) => b.supplierId));

  async function payRun() {
    if (selectedBills.length === 0) return;
    if (selectedSuppliers.size > 1) {
      alert("Select bills from a single supplier per payment run.");
      return;
    }
    const supplierId = [...selectedSuppliers][0];
    setPaying(true);
    setResultBanner(null);
    try {
      const allocations = selectedBills.map((b) => ({ supplierBillId: b.id, amount: b.outstanding }));
      const r = await fetch("/api/finance/payments-made", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierId,
          paymentDate: new Date().toISOString(),
          paymentMethod,
          reference: paymentRef || null,
          allocations,
        }),
      });
      const j = await r.json();
      if (r.ok) {
        setResultBanner(`✓ Paid £${fmt(j.total)} across ${allocations.length} bill${allocations.length === 1 ? "" : "s"}`);
        setSelected(new Set());
        setPaymentRef("");
        await refresh();
      } else {
        setResultBanner(`✗ ${j.error ?? "payment failed"}`);
      }
    } catch (e) {
      setResultBanner(`✗ ${e instanceof Error ? e.message : "payment failed"}`);
    } finally { setPaying(false); }
  }

  if (!data) return <div className="text-sm text-muted-foreground">{loading ? "Loading…" : "No data"}</div>;

  return (
    <div className="space-y-4">
      {/* Aging headline */}
      <div className="border border-[#333333] bg-[#0F0F0F] p-4">
        <div className="flex items-baseline justify-between mb-3">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Total outstanding (post-cutover)</div>
            <div className="text-3xl font-bold tabular-nums" style={{ color: "#FF6600" }}>£{fmt(data.aging.total)}</div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={refresh} disabled={loading}>↻ Refresh</Button>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-3">
          {(["current", "days30", "days60", "days90"] as const).map((b) => (
            <div key={b} className="border border-[#333333] p-2">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{BUCKET_LABEL[b]} days</div>
              <div className="text-xl font-medium tabular-nums" style={{ color: BUCKET_COLOR[b] }}>£{fmt(data.aging[b])}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Supplier balances */}
      <div className="border border-[#333333] bg-[#1A1A1A]">
        <div className="px-3 py-2 border-b border-[#333333] text-[10px] uppercase tracking-wider text-muted-foreground flex items-center justify-between">
          <span>Supplier balances ({data.suppliers.length})</span>
          {supplierFilter && (
            <button type="button" className="text-[10px] text-[#FF6600]" onClick={() => { setSupplierFilter(null); setSelected(new Set()); }}>
              ← clear filter
            </button>
          )}
        </div>
        {data.suppliers.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">No outstanding suppliers.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Supplier</TableHead>
                <TableHead className="text-right">Bills</TableHead>
                <TableHead className="text-right">Oldest</TableHead>
                <TableHead className="text-right">Outstanding</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.suppliers.map((s) => {
                const bucket = s.oldestDays > 90 ? "days90" : s.oldestDays > 60 ? "days60" : s.oldestDays > 30 ? "days30" : "current";
                const isFiltered = supplierFilter === s.supplierId;
                return (
                  <TableRow
                    key={s.supplierId}
                    className={`cursor-pointer hover:bg-[#222] ${isFiltered ? "bg-[#222]" : ""}`}
                    onClick={() => { setSupplierFilter(isFiltered ? null : s.supplierId); setSelected(new Set()); }}
                  >
                    <TableCell className="font-medium">{s.supplierName}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.bills}</TableCell>
                    <TableCell className="text-right tabular-nums" style={{ color: BUCKET_COLOR[bucket] }}>{s.oldestDays}d</TableCell>
                    <TableCell className="text-right tabular-nums">£{fmt(s.outstanding)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Open bills + pay-run controls */}
      <div className="border border-[#333333] bg-[#1A1A1A]">
        <div className="px-3 py-2 border-b border-[#333333] flex items-center justify-between flex-wrap gap-2">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Open bills ({filteredBills.length}{supplierFilter ? ` · filtered to ${data.suppliers.find((s) => s.supplierId === supplierFilter)?.supplierName}` : ""})
            {selected.size > 0 && (
              <span className="ml-3 text-[#FF6600]">
                · {selected.size} selected · £{fmt(selectedTotal)}{selectedSuppliers.size > 1 ? " (multiple suppliers!)" : ""}
              </span>
            )}
          </div>
          {selected.size > 0 && (
            <div className="flex gap-2 items-center">
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                className="h-7 text-xs bg-[#0A0A0A] border border-[#333333] px-2"
              >
                <option>BACS</option>
                <option>Card</option>
                <option>DD</option>
                <option>Cash</option>
                <option>Other</option>
              </select>
              <input
                type="text" value={paymentRef}
                onChange={(e) => setPaymentRef(e.target.value)}
                placeholder="Reference"
                className="h-7 text-xs bg-[#0A0A0A] border border-[#333333] px-2 w-32"
              />
              <Button size="sm" variant="default" onClick={payRun} disabled={paying || selectedSuppliers.size > 1}>
                {paying ? "Posting…" : `▶ Pay £${fmt(selectedTotal)}`}
              </Button>
            </div>
          )}
        </div>
        {resultBanner && (
          <div className="px-3 py-1.5 text-xs border-b border-[#222]" style={{ color: resultBanner.startsWith("✓") ? "#00CC66" : "#FF3333" }}>
            {resultBanner}
          </div>
        )}
        {filteredBills.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">All paid 🎉</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8"></TableHead>
                <TableHead>Bill date</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Bill #</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Paid</TableHead>
                <TableHead className="text-right">Outstanding</TableHead>
                <TableHead className="text-right">Age</TableHead>
                <TableHead>Bucket</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredBills.map((b) => (
                <TableRow key={b.id} className={selected.has(b.id) ? "bg-[#1F1F1F]" : ""}>
                  <TableCell>
                    <input type="checkbox" checked={selected.has(b.id)} onChange={() => toggleSelect(b.id)} />
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{new Date(b.billDate).toLocaleDateString("en-GB")}</TableCell>
                  <TableCell>{b.supplierName}</TableCell>
                  <TableCell className="text-xs">
                    <a href={`/procurement?bill=${b.id}`} className="text-primary hover:underline">{b.billNo}</a>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">£{fmt(b.totalCost)}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">£{fmt(b.paid)}</TableCell>
                  <TableCell className="text-right tabular-nums font-medium">£{fmt(b.outstanding)}</TableCell>
                  <TableCell className="text-right tabular-nums" style={{ color: BUCKET_COLOR[b.bucket] }}>{b.ageDays}d</TableCell>
                  <TableCell><Badge variant="outline" style={{ color: BUCKET_COLOR[b.bucket] }}>{BUCKET_LABEL[b.bucket]}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
