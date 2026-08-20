"use client";

import { useState } from "react";

type DrawdownPo = {
  id: string;
  poNo: string;
  poLimitValue: number | null;
  poConsumedValue: number | null;
};

export function DrawFromQuoteButton({
  quoteId,
  customerId,
  status,
}: {
  quoteId: string;
  customerId: string;
  status: string;
}) {
  const [busy, setBusy] = useState(false);
  const [pos, setPos] = useState<DrawdownPo[] | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (status !== "APPROVED") return null;

  async function draw(poId: string) {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await fetch(`/api/customer-pos/${poId}/draw-from-quote`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ quoteId }),
      });
      const data = await res.json();
      if (res.ok) {
        setMsg(
          `Drawn £${data.drawnValue.toLocaleString("en-GB", { minimumFractionDigits: 2 })} against PO ${data.poNo}. ` +
            `Remaining budget: £${data.poRemainingValue.toLocaleString("en-GB", { minimumFractionDigits: 2 })}.`
        );
        setPos(null);
      } else {
        setErr(data.message || data.error || "Drawdown failed");
      }
    } catch {
      setErr("Network error");
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await fetch(
        `/api/customer-pos?customerId=${customerId}&poType=DRAWDOWN_MATERIALS`
      );
      const list = (await res.json()) as DrawdownPo[];
      const active = Array.isArray(list) ? list : [];
      if (active.length === 0) {
        setErr("No materials drawdown PO found for this customer.");
        return;
      }
      if (active.length === 1) {
        await draw(active[0].id);
        return;
      }
      setPos(active); // let the user pick
    } catch {
      setErr("Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded border border-gray-200 p-3">
      <div className="flex items-center gap-3">
        <button
          onClick={start}
          disabled={busy}
          className="inline-block px-4 py-2 bg-black text-white text-sm font-semibold hover:bg-gray-800 disabled:opacity-50 disabled:cursor-wait tracking-wide"
        >
          {busy ? "Working…" : "Draw down against PO"}
        </button>
        <span className="text-xs text-gray-500">
          Logs this approved quote against the customer&apos;s materials drawdown PO.
        </span>
      </div>

      {pos && (
        <div className="flex flex-col gap-1">
          <p className="text-xs text-gray-600">Choose the PO to draw against:</p>
          {pos.map((p) => {
            const remaining = (Number(p.poLimitValue) || 0) - (Number(p.poConsumedValue) || 0);
            return (
              <button
                key={p.id}
                onClick={() => draw(p.id)}
                disabled={busy}
                className="text-left text-sm px-3 py-2 border border-gray-200 hover:bg-gray-50 disabled:opacity-50"
              >
                PO {p.poNo} · remaining £
                {remaining.toLocaleString("en-GB", { minimumFractionDigits: 2 })}
              </button>
            );
          })}
        </div>
      )}

      {msg && <p className="text-green-700 text-xs">{msg}</p>}
      {err && <p className="text-red-600 text-xs">{err}</p>}
    </div>
  );
}
