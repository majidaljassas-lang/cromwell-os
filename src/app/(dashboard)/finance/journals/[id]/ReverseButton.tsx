"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ReverseButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function reverse() {
    if (!confirm("Reverse this journal? Creates an opposite JE.")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/finance/journals/${id}/reverse`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed");
      router.refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed");
      setBusy(false);
    }
  }

  return (
    <button
      onClick={reverse}
      disabled={busy}
      className="text-[10px] uppercase tracking-widest text-[#FF3333] hover:underline font-bold disabled:opacity-30"
    >
      {busy ? "…" : "REVERSE"}
    </button>
  );
}
