"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Draw = { id: string; description: string; value: number; createdAt: string };
type Credit = {
  id: string;
  sourceDescription: string;
  sourceQty: number;
  sourceUnitValue: number;
  creditValue: number;
  notes: string | null;
  draws: Draw[];
  drawn: number;
  remaining: number;
};

const gbp = (n: number) =>
  n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function ReallocationCreditPanel({ poId, credit }: { poId: string; credit: Credit | null }) {
  const router = useRouter();
  const [description, setDescription] = useState("");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!credit) return null;

  async function addDraw() {
    setError(null);
    const v = Number(value);
    if (!description.trim() || !Number.isFinite(v) || v <= 0) {
      setError("Enter a description and a positive value.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/customer-pos/${poId}/reallocation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: description.trim(), value: v }),
      });
      if (!res.ok) {
        setError((await res.json()).error ?? "Failed to add draw");
        return;
      }
      setDescription("");
      setValue("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function removeDraw(drawId: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/customer-pos/${poId}/reallocation?drawId=${drawId}`, {
        method: "DELETE",
      });
      if (!res.ok) setError((await res.json()).error ?? "Failed to remove draw");
      else router.refresh();
    } finally {
      setBusy(false);
    }
  }

  // Running remaining after each draw, in ledger order.
  let running = credit.creditValue;
  const ledger = credit.draws.map((d) => {
    running = Math.round((running - d.value) * 100) / 100;
    return { ...d, remainingAfter: running };
  });
  const exhausted = credit.remaining <= 0;

  return (
    <div className="rounded border overflow-x-auto max-w-3xl">
      <div className="px-3 py-2 border-b flex items-center justify-between">
        <div className="text-xs font-medium">Reallocation credit (internal)</div>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
          Cap — do not exceed
        </div>
      </div>

      <div className="px-3 py-2 border-b text-[11px] text-muted-foreground">
        {credit.sourceDescription} &nbsp;·&nbsp; credit{" "}
        <span className="font-semibold text-foreground">£{gbp(credit.creditValue)}</span>
        {credit.notes ? <> &nbsp;·&nbsp; {credit.notes}</> : null}
      </div>

      {error && (
        <div className="px-3 py-2 border-b text-xs text-red-600 bg-red-500/10">{error}</div>
      )}

      <table className="w-full text-xs whitespace-nowrap">
        <thead>
          <tr className="text-muted-foreground text-left">
            <th className="px-3 py-1.5 font-normal">Draw</th>
            <th className="px-3 py-1.5 font-normal text-right">Amount</th>
            <th className="px-3 py-1.5 font-normal text-right">Remaining</th>
            <th className="px-3 py-1.5 font-normal text-right w-8"></th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-t">
            <td className="px-3 py-1.5 font-medium">Opening credit</td>
            <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">—</td>
            <td className="px-3 py-1.5 text-right tabular-nums font-medium">£{gbp(credit.creditValue)}</td>
            <td className="px-3 py-1.5"></td>
          </tr>
          {ledger.map((d) => (
            <tr key={d.id} className="border-t">
              <td className="px-3 py-1.5">{d.description}</td>
              <td className="px-3 py-1.5 text-right tabular-nums text-[#EF4444]">−£{gbp(d.value)}</td>
              <td
                className={`px-3 py-1.5 text-right tabular-nums ${d.remainingAfter <= 0 ? "text-[#EF4444] font-semibold" : ""}`}
              >
                £{gbp(d.remainingAfter)}
              </td>
              <td className="px-3 py-1.5 text-right">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => removeDraw(d.id)}
                  className="text-muted-foreground hover:text-[#EF4444] disabled:opacity-40"
                  title="Remove draw"
                >
                  ✕
                </button>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t font-medium">
            <td className="px-3 py-1.5">Remaining</td>
            <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">
              drawn £{gbp(credit.drawn)}
            </td>
            <td
              className={`px-3 py-1.5 text-right tabular-nums ${exhausted ? "text-[#EF4444]" : ""}`}
            >
              £{gbp(credit.remaining)}
            </td>
            <td className="px-3 py-1.5"></td>
          </tr>
        </tfoot>
      </table>

      {exhausted && (
        <div className="px-3 py-2 border-t text-xs font-semibold text-[#EF4444] bg-red-500/10">
          STOP — credit exhausted
        </div>
      )}

      <div className="px-3 py-2 border-t flex items-center gap-1">
        <Input
          placeholder="Extra item / over-order description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="h-7 text-xs"
        />
        <Input
          placeholder="£ value"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="h-7 text-xs w-24"
        />
        <Button size="sm" className="h-7 text-[10px] px-2" disabled={busy} onClick={addDraw}>
          Add draw
        </Button>
      </div>
    </div>
  );
}
