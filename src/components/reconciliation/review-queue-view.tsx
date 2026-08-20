"use client";

import { useEffect, useState } from "react";

type Pair = {
  billLineId: string;
  bill: {
    date: string | null;
    vendor: string | null;
    billNo: string | null;
    status: string | null;
    qty: number;
    rate: number;
    cost: number;
    description: string;
    cfSite: string | null;
    customerName: string | null;
  };
  invoice: {
    invoiceNumber: string | null;
    invoiceDate: string | null;
    invoiceStatus: string | null;
    customer: string | null;
    cfSite: string | null;
    qty: number;
    rate: number;
    revenue: number;
    description: string;
  } | null;
  profit: number | null;
  margin: number | null;
  tier: "T1" | "T2" | "?";
  reason: string | null;
  confidence: number | null;
};

const fmt = (n: number | null | undefined) =>
  n == null ? "—" : Number(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (m: number | null | undefined) => (m == null ? "—" : `${(m * 100).toFixed(1)}%`);

const TIER_COLOUR: Record<string, string> = { T1: "#00CC66", T2: "#FFCC00", "?": "#888888" };

export function ReviewQueueView() {
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [tier, setTier] = useState<"ALL" | "T1" | "T2">("ALL");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reviewedThisSession, setReviewedThisSession] = useState({ approved: 0, rejected: 0 });

  function load() {
    setLoading(true);
    const params = new URLSearchParams({
      limit: "50",
      offset: "0",
      ...(tier !== "ALL" ? { tier } : {}),
    });
    fetch(`/api/zoho-recon/review/queue?${params}`)
      .then((r) => r.json())
      .then((d) => {
        setPairs(d.pairs ?? []);
        setCount(d.count ?? 0);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [tier]);

  async function decide(pair: Pair, action: "APPROVE" | "REJECT") {
    setBusyId(pair.billLineId);
    const r = await fetch(`/api/zoho-recon/review/${pair.billLineId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    setBusyId(null);
    if (r.ok) {
      setPairs((prev) => prev.filter((p) => p.billLineId !== pair.billLineId));
      setCount((c) => Math.max(0, c - 1));
      setReviewedThisSession((s) =>
        action === "APPROVE" ? { ...s, approved: s.approved + 1 } : { ...s, rejected: s.rejected + 1 }
      );
    }
  }

  async function bulkReject() {
    if (!confirm(`Reject ALL ${count} auto-proposed matches?\n\nThis clears every T1/T2 link wholesale. Manual confirmations are preserved. Cannot be undone in one click.`)) return;
    setLoading(true);
    const r = await fetch("/api/zoho-recon/review/bulk-reject", { method: "POST" });
    const j = await r.json();
    alert(`Cleared ${j.cleared ?? 0} auto-proposed matches.`);
    load();
  }

  return (
    <div className="space-y-3">
      {/* Stats + controls */}
      <div className="flex flex-wrap gap-6 text-[11px] bb-mono border border-[#2A2A2A] bg-[#0F0F0F] px-3 py-2 items-center">
        <div>
          <div className="text-[#888888] tracking-widest text-[10px]">PENDING REVIEW</div>
          <div className="text-[#FFCC00]">{count}</div>
        </div>
        <div>
          <div className="text-[#888888] tracking-widest text-[10px]">SESSION · APPROVED</div>
          <div className="text-[#00CC66]">{reviewedThisSession.approved}</div>
        </div>
        <div>
          <div className="text-[#888888] tracking-widest text-[10px]">SESSION · REJECTED</div>
          <div className="text-[#FF3333]">{reviewedThisSession.rejected}</div>
        </div>
        <div className="ml-auto flex gap-2 items-center">
          <span className="text-[10px] tracking-widest text-[#888888]">TIER:</span>
          {(["ALL", "T1", "T2"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTier(t)}
              className={`px-2 py-1 border text-[10px] tracking-widest ${tier === t ? "border-[#FF6600] text-[#FF6600]" : "border-[#333333] text-[#888888] hover:text-[#CCCCCC]"}`}
            >
              {t}
            </button>
          ))}
          <button
            onClick={bulkReject}
            className="ml-2 px-3 py-1 border border-[#FF3333] text-[#FF3333] text-[10px] tracking-widest hover:bg-[#FF3333] hover:text-black"
          >
            ✕ REJECT ALL T1/T2
          </button>
        </div>
      </div>

      {loading && <div className="text-[#888888] bb-mono text-[11px]">Loading…</div>}

      {!loading && pairs.length === 0 && (
        <div className="text-[#888888] bb-mono text-[11px] py-12 text-center border border-[#2A2A2A]">
          {count === 0 ? "✓ All caught up — no pairs awaiting review." : "Page empty (use a different tier filter)."}
        </div>
      )}

      <div className="space-y-2">
        {pairs.map((p) => {
          const stale = busyId === p.billLineId;
          return (
            <div
              key={p.billLineId}
              className={`border ${stale ? "border-[#666666] opacity-50" : "border-[#2A2A2A]"} bg-[#0F0F0F]`}
            >
              {/* Header strip — tier + reason + profit */}
              <div className="flex flex-wrap gap-3 items-center bg-[#1A1A1A] px-3 py-2 border-b border-[#222222] text-[10px] bb-mono">
                <span style={{ color: TIER_COLOUR[p.tier] }} className="tracking-widest font-bold">{p.tier}</span>
                <span className="text-[#888888]">{p.reason}</span>
                <span className="text-[#666666]">conf {p.confidence ?? "—"}</span>
                <span className="ml-auto flex gap-3">
                  <span><span className="text-[#888888]">PROFIT</span> <span className={p.profit != null && p.profit >= 0 ? "text-[#00CC66]" : "text-[#FF3333]"}>£{fmt(p.profit)}</span></span>
                  <span><span className="text-[#888888]">MARGIN</span> <span className="text-[#00CC66]">{pct(p.margin)}</span></span>
                </span>
              </div>

              {/* Body — bill side | invoice side, side-by-side */}
              <div className="grid grid-cols-2 gap-0 text-[11px] bb-mono">
                <div className="p-3 border-r border-[#222222]">
                  <div className="text-[10px] tracking-widest text-[#888888] mb-1">BILL SIDE</div>
                  <div className="text-[#CCCCCC]">
                    {p.bill.vendor} <span className="text-[#666666]">·</span> {p.bill.billNo}
                  </div>
                  <div className="text-[10px] text-[#888888]">{p.bill.date?.slice(0,10) ?? "—"} · {p.bill.status}</div>
                  <div className="text-[#CCCCCC] mt-2">{p.bill.description.slice(0, 100)}</div>
                  <div className="grid grid-cols-3 gap-2 mt-2 text-[10px]">
                    <div><span className="text-[#666666]">QTY</span> <span className="text-[#CCCCCC]">{p.bill.qty}</span></div>
                    <div><span className="text-[#666666]">RATE</span> <span className="text-[#CCCCCC]">£{fmt(p.bill.rate)}</span></div>
                    <div><span className="text-[#666666]">COST</span> <span className="text-[#CCCCCC]">£{fmt(p.bill.cost)}</span></div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-2 text-[10px]">
                    <div><span className="text-[#666666]">CFSITE</span> <span className="text-[#CCCCCC]">{p.bill.cfSite || "—"}</span></div>
                    <div><span className="text-[#666666]">CUST</span> <span className="text-[#CCCCCC]">{p.bill.customerName || "—"}</span></div>
                  </div>
                </div>
                <div className="p-3">
                  <div className="text-[10px] tracking-widest text-[#888888] mb-1">INVOICE SIDE</div>
                  {p.invoice ? (
                    <>
                      <div className="text-[#00CC66]">
                        {p.invoice.invoiceNumber} <span className="text-[#666666]">·</span> {p.invoice.customer}
                      </div>
                      <div className="text-[10px] text-[#888888]">{p.invoice.invoiceDate?.slice(0,10) ?? "—"} · {p.invoice.invoiceStatus}</div>
                      <div className="text-[#CCCCCC] mt-2">{p.invoice.description.slice(0, 100)}</div>
                      <div className="grid grid-cols-3 gap-2 mt-2 text-[10px]">
                        <div><span className="text-[#666666]">QTY</span> <span className="text-[#CCCCCC]">{p.invoice.qty}</span></div>
                        <div><span className="text-[#666666]">RATE</span> <span className="text-[#CCCCCC]">£{fmt(p.invoice.rate)}</span></div>
                        <div><span className="text-[#666666]">REV</span> <span className="text-[#00CC66]">£{fmt(p.invoice.revenue)}</span></div>
                      </div>
                      <div className="text-[10px] mt-2">
                        <span className="text-[#666666]">CFSITE</span> <span className="text-[#CCCCCC]">{p.invoice.cfSite || "—"}</span>
                      </div>
                    </>
                  ) : (
                    <div className="text-[#FF3333]">invoice link broken</div>
                  )}
                </div>
              </div>

              {/* Action bar */}
              <div className="bg-[#1A1A1A] border-t border-[#222222] px-3 py-2 flex gap-2 justify-end">
                <button
                  onClick={() => decide(p, "REJECT")}
                  disabled={stale}
                  className="border border-[#FF3333] text-[#FF3333] px-3 py-1 text-[10px] tracking-widest hover:bg-[#FF3333] hover:text-black disabled:opacity-30"
                >
                  ✕ REJECT
                </button>
                <button
                  onClick={() => decide(p, "APPROVE")}
                  disabled={stale}
                  className="border border-[#00CC66] text-[#00CC66] px-3 py-1 text-[10px] tracking-widest hover:bg-[#00CC66] hover:text-black disabled:opacity-30"
                >
                  ✓ APPROVE
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
