"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Account = {
  id: string;
  accountCode: string;
  accountName: string;
  accountType: string;
};

interface Line {
  accountId: string;
  debit: string;
  credit: string;
  description: string;
}

const blankLine = (): Line => ({ accountId: "", debit: "", credit: "", description: "" });

function fmt(n: number): string {
  return n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function JournalForm({ accounts }: { accounts: Account[] }) {
  const router = useRouter();
  const today = new Date().toISOString().slice(0, 10);
  const [entryDate, setEntryDate] = useState(today);
  const [reference, setReference] = useState("");
  const [description, setDescription] = useState("");
  const [lines, setLines] = useState<Line[]>([blankLine(), blankLine()]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const totals = useMemo(() => {
    const debit = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
    const credit = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
    return { debit, credit, balanced: Math.abs(debit - credit) < 0.005 && debit > 0 };
  }, [lines]);

  function update(idx: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }
  function add() {
    setLines((prev) => [...prev, blankLine()]);
  }
  function remove(idx: number) {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }

  async function submit() {
    if (!description) {
      setErr("Description required");
      return;
    }
    if (!totals.balanced) {
      setErr("Lines must balance and total > 0");
      return;
    }
    const payload = {
      entryDate,
      reference: reference || undefined,
      description,
      lines: lines
        .filter((l) => l.accountId)
        .map((l) => ({
          accountId: l.accountId,
          debit: Number(l.debit) || 0,
          credit: Number(l.credit) || 0,
          description: l.description || undefined,
        })),
    };
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/finance/journals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed");
      router.push(`/finance/journals/${json.journalEntryId}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      {err && (
        <div className="border border-[#FF3333] bg-[#3A0000] text-[11px] text-[#FF6666] px-3 py-2">
          {err}
        </div>
      )}

      <div className="grid grid-cols-3 gap-3">
        <Field label="Entry Date">
          <input
            type="date"
            value={entryDate}
            onChange={(e) => setEntryDate(e.target.value)}
            className="bg-[#0A0A0A] border border-[#333333] text-xs text-[#E0E0E0] px-2 py-1.5"
          />
        </Field>
        <Field label="Reference">
          <input
            type="text"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="e.g. ACC-2026-04-01"
            className="bg-[#0A0A0A] border border-[#333333] text-xs text-[#E0E0E0] px-2 py-1.5"
          />
        </Field>
        <Field label="Description (required)">
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What is this journal for?"
            className="bg-[#0A0A0A] border border-[#333333] text-xs text-[#E0E0E0] px-2 py-1.5"
          />
        </Field>
      </div>

      <div className="border border-[#333333] bg-[#1A1A1A]">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[#333333] text-[10px] uppercase tracking-widest text-[#888888]">
              <th className="text-left px-3 py-2 font-semibold">Account</th>
              <th className="text-left px-3 py-2 font-semibold">Description</th>
              <th className="text-right px-3 py-2 font-semibold w-32">Debit</th>
              <th className="text-right px-3 py-2 font-semibold w-32">Credit</th>
              <th className="w-12"></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} className="border-b border-[#222222]">
                <td className="px-3 py-1.5">
                  <select
                    value={l.accountId}
                    onChange={(e) => update(i, { accountId: e.target.value })}
                    className="w-full bg-[#0A0A0A] border border-[#333333] text-xs text-[#E0E0E0] px-2 py-1.5"
                  >
                    <option value="">— pick —</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.accountCode} · {a.accountName}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-1.5">
                  <input
                    type="text"
                    value={l.description}
                    onChange={(e) => update(i, { description: e.target.value })}
                    className="w-full bg-[#0A0A0A] border border-[#333333] text-xs text-[#E0E0E0] px-2 py-1.5"
                  />
                </td>
                <td className="px-3 py-1.5">
                  <input
                    type="number"
                    step="0.01"
                    value={l.debit}
                    onChange={(e) =>
                      update(i, { debit: e.target.value, credit: "" })
                    }
                    className="w-full text-right bg-[#0A0A0A] border border-[#333333] text-xs text-[#E0E0E0] px-2 py-1.5 tabular-nums"
                  />
                </td>
                <td className="px-3 py-1.5">
                  <input
                    type="number"
                    step="0.01"
                    value={l.credit}
                    onChange={(e) =>
                      update(i, { credit: e.target.value, debit: "" })
                    }
                    className="w-full text-right bg-[#0A0A0A] border border-[#333333] text-xs text-[#E0E0E0] px-2 py-1.5 tabular-nums"
                  />
                </td>
                <td className="px-2 py-1.5">
                  {lines.length > 2 && (
                    <button
                      onClick={() => remove(i)}
                      className="text-[10px] text-[#FF3333] hover:underline"
                    >
                      ×
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-[#FF6600] bg-[#1F1F1F]">
              <td colSpan={2} className="px-3 py-3 text-[10px] uppercase tracking-widest text-[#FF6600] font-bold">
                TOTALS
              </td>
              <td className="px-3 py-3 text-xs text-right tabular-nums font-bold text-[#E0E0E0]">
                £{fmt(totals.debit)}
              </td>
              <td className="px-3 py-3 text-xs text-right tabular-nums font-bold text-[#E0E0E0]">
                £{fmt(totals.credit)}
              </td>
              <td>
                <span
                  className={`text-[10px] font-bold px-1.5 ${
                    totals.balanced ? "text-[#00CC66]" : "text-[#FF3333]"
                  }`}
                >
                  {totals.balanced ? "✓" : "≠"}
                </span>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="flex gap-2 items-center">
        <button
          onClick={add}
          className="text-[10px] uppercase tracking-widest text-[#888888] hover:text-[#E0E0E0] border border-[#333333] px-3 py-1.5"
        >
          + Add line
        </button>
        <div className="flex-1" />
        <button
          onClick={submit}
          disabled={busy || !totals.balanced || !description}
          className="bg-[#FF6600] text-black text-[10px] uppercase tracking-widest px-4 py-1.5 font-bold disabled:opacity-30"
        >
          {busy ? "Posting…" : "Post Journal"}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col">
      <span className="text-[9px] uppercase tracking-widest text-[#666666] mb-1">{label}</span>
      {children}
    </label>
  );
}
