"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Member = { id: string; name: string; isCurrent: boolean };

export function LineSiteSwap({
  billId,
  lineId,
  currentSite,
  onClose,
}: {
  billId: string;
  lineId: string;
  currentSite: { id: string; siteName: string } | null;
  disabled?: boolean;
  alwaysOpen?: boolean;
  onClose?: () => void;
}) {
  const router = useRouter();
  const [members, setMembers] = useState<Member[] | null>(null);
  const [scoped, setScoped] = useState(true);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/supplier-bills/${billId}/lines/${lineId}/change-site`);
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
      const res = await fetch(`/api/supplier-bills/${billId}/lines/${lineId}/change-site`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ siteId: target }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      setTarget("");
      onClose?.();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "save failed");
    } finally {
      setBusy(false);
    }
  }

  const swappable = (members ?? []).filter((m) => !m.isCurrent);

  return (
    <div className="flex flex-col gap-1 px-3 py-2">
      <div className="text-[9px] text-[#888888]">
        {currentSite ? `From: ${currentSite.siteName}` : "Allocate site"}
        {!scoped && " · all sites"}
      </div>
      <div className="flex gap-1">
        <select
          autoFocus
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          disabled={loading || busy}
          className="bg-[#0D0D0D] border border-[#333333] text-[#CCCCCC] text-[10px] px-1 py-0.5 max-w-[160px]"
        >
          <option value="">{loading ? "loading…" : "select site"}</option>
          {swappable.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
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
        <button
          onClick={() => {
            setTarget("");
            setError(null);
            onClose?.();
          }}
          className="text-[10px] bb-mono text-[#666666] hover:text-[#CCCCCC]"
        >
          ✕
        </button>
      </div>
      {error && <div className="text-[9px] text-[#FF6666]">{error}</div>}
    </div>
  );
}
