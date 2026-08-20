"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Member = { id: string; name: string; isCurrent: boolean; isRoot: boolean };

export function LineCustomerSwap({
  billId,
  lineId,
  currentCustomer,
  disabled,
  alwaysOpen,
  onClose,
}: {
  billId: string;
  lineId: string;
  currentCustomer: { id: string; name: string } | null;
  disabled?: boolean;
  alwaysOpen?: boolean;
  onClose?: () => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(!!alwaysOpen);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [scoped, setScoped] = useState(true);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (alwaysOpen && !members && !loading) void loadMembers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alwaysOpen]);

  async function loadMembers() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/supplier-bills/${billId}/lines/${lineId}/change-customer`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      setMembers(j.members ?? []);
      setScoped(!!j.scoped);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    } finally {
      setLoading(false);
    }
  }

  async function submit() {
    if (!target) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/supplier-bills/${billId}/lines/${lineId}/change-customer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ customerId: target }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      setOpen(false);
      setMembers(null);
      setTarget("");
      onClose?.();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "save failed");
    } finally {
      setBusy(false);
    }
  }

  function toggle() {
    if (open) {
      setOpen(false);
      setMembers(null);
      setTarget("");
      setError(null);
      onClose?.();
    } else {
      setOpen(true);
      if (!members) void loadMembers();
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={toggle}
        disabled={disabled}
        className="text-[#FFCC00] hover:underline disabled:opacity-50"
        title={currentCustomer ? `Currently: ${currentCustomer.name}` : "Allocate to customer"}
      >
        → CUST
      </button>
    );
  }

  const swappable = (members ?? []).filter((m) => !m.isCurrent);

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="text-[9px] text-[#888888]">
        {currentCustomer ? `From: ${currentCustomer.name}` : "Allocate"}
        {!scoped && " · all customers"}
      </div>
      <div className="flex gap-1">
        <select
          autoFocus
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          disabled={loading || busy}
          className="bg-[#0D0D0D] border border-[#333333] text-[#CCCCCC] text-[10px] px-1 py-0.5 max-w-[160px]"
        >
          <option value="">{loading ? "loading…" : "select target"}</option>
          {swappable.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}{m.isRoot ? " ★" : ""}
            </option>
          ))}
        </select>
        <button
          onClick={submit}
          disabled={!target || busy}
          className="text-[10px] bb-mono text-[#FF6600] hover:underline disabled:opacity-50"
        >
          OK
        </button>
        <button onClick={toggle} className="text-[10px] bb-mono text-[#666666] hover:text-[#CCCCCC]">
          ✕
        </button>
      </div>
      {error && <div className="text-[9px] text-[#FF6666]">{error}</div>}
    </div>
  );
}
