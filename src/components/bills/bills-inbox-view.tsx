"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type BillLine = {
  id: string;
  description: string;
  qty: string | number;
  unitCost: string | number;
  lineTotal: string | number;
  allocationStatus: "MATCHED" | "PARTIAL" | "SUGGESTED" | "EXCEPTION" | "UNALLOCATED";
};

type Bill = {
  id: string;
  billNo: string;
  billDate: string;
  status: string;
  totalCost: string | number;
  supplier: { id: string; name: string };
  lines: BillLine[];
  _count: { lines: number };
};

type Tab = "review" | "posted" | "all";

function fmt(n: string | number): string {
  const v = typeof n === "string" ? Number(n) : n;
  return v.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function exceptionsCount(b: Bill): number {
  return b.lines.filter((l) => l.allocationStatus === "EXCEPTION" || l.allocationStatus === "UNALLOCATED").length;
}

function needsReview(b: Bill): boolean {
  if (b.status !== "MATCHED" && b.status !== "POSTED") return true;
  return exceptionsCount(b) > 0;
}

const STATUS_COLOUR: Record<string, string> = {
  POSTED:    "#00CC66",
  MATCHED:   "#00CC66",
  PARTIAL:   "#FFCC00",
  PENDING:   "#999999",
  REVIEW_REQUIRED: "#FF9900",
  DISPUTE:   "#FF3333",
};

export function BillsInboxView() {
  const [bills, setBills] = useState<Bill[]>([]);
  const [tab, setTab] = useState<Tab>("review");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch("/api/supplier-bills")
      .then((r) => r.json())
      .then((data: Bill[]) => setBills(Array.isArray(data) ? data : []))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    if (tab === "all") return bills;
    if (tab === "posted") return bills.filter((b) => b.status === "POSTED" || b.status === "MATCHED");
    return bills.filter(needsReview);
  }, [bills, tab]);

  const counts = useMemo(
    () => ({
      review: bills.filter(needsReview).length,
      posted: bills.filter((b) => b.status === "POSTED" || b.status === "MATCHED").length,
      all:    bills.length,
    }),
    [bills]
  );

  return (
    <div className="space-y-3">
      <div className="flex gap-1 border-b border-[#333333]">
        {([
          { key: "review", label: "NEEDS REVIEW" },
          { key: "posted", label: "POSTED" },
          { key: "all",    label: "ALL" },
        ] as Array<{ key: Tab; label: string }>).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-3 py-1.5 text-[11px] tracking-widest bb-mono border-b-2 transition-colors ${
              tab === key
                ? "border-[#FF6600] text-[#FF6600]"
                : "border-transparent text-[#888888] hover:text-[#CCCCCC]"
            }`}
          >
            {label} <span className="ml-1 text-[#666666]">({counts[key]})</span>
          </button>
        ))}
      </div>

      {loading && <div className="text-[11px] text-[#888888] bb-mono">Loading…</div>}

      {!loading && filtered.length === 0 && (
        <div className="text-[11px] text-[#888888] bb-mono py-8 text-center">No bills.</div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="border border-[#2A2A2A]">
          <table className="w-full text-[11px] bb-mono">
            <thead className="bg-[#1A1A1A] text-[#888888] uppercase tracking-widest">
              <tr>
                <th className="text-left px-3 py-2">Supplier</th>
                <th className="text-left px-3 py-2">Bill No</th>
                <th className="text-left px-3 py-2">Date</th>
                <th className="text-right px-3 py-2">Lines</th>
                <th className="text-right px-3 py-2">Exceptions</th>
                <th className="text-right px-3 py-2">Total</th>
                <th className="text-left px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((b) => {
                const exc = exceptionsCount(b);
                return (
                  <tr key={b.id} className="border-t border-[#222222] hover:bg-[#161616]">
                    <td className="px-3 py-2">
                      <Link href={`/bills/${b.id}`} className="text-[#CCCCCC] hover:text-[#FF6600]">
                        {b.supplier.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-[#CCCCCC]">{b.billNo}</td>
                    <td className="px-3 py-2 text-[#888888]">
                      {new Date(b.billDate).toLocaleDateString("en-GB")}
                    </td>
                    <td className="px-3 py-2 text-right text-[#CCCCCC]">{b._count.lines}</td>
                    <td className="px-3 py-2 text-right">
                      {exc > 0 ? <span className="text-[#FF9900]">{exc}</span> : <span className="text-[#444444]">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right text-[#CCCCCC]">{fmt(b.totalCost)}</td>
                    <td className="px-3 py-2">
                      <span style={{ color: STATUS_COLOUR[b.status] || "#888888" }}>
                        {b.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
