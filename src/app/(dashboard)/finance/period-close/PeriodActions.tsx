"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function PeriodActions({
  periodId,
  status,
}: {
  periodId: string;
  status: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function setStatus(next: "OPEN" | "CLOSED" | "LOCKED") {
    if (next === "LOCKED" && !confirm("Lock this period? No further JEs will be accepted.")) return;
    setBusy(true);
    try {
      const res = await fetch("/api/finance/period-close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periodId, status: next }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed");
      router.refresh();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed");
      setBusy(false);
    }
  }

  return (
    <div className="flex gap-1 justify-end">
      {status !== "OPEN" && (
        <button
          onClick={() => setStatus("OPEN")}
          disabled={busy}
          className="text-[10px] uppercase tracking-widest text-[#00CC66] hover:underline disabled:opacity-30"
        >
          OPEN
        </button>
      )}
      {status !== "CLOSED" && (
        <button
          onClick={() => setStatus("CLOSED")}
          disabled={busy}
          className="text-[10px] uppercase tracking-widest text-[#FFCC00] hover:underline disabled:opacity-30 ml-2"
        >
          CLOSE
        </button>
      )}
      {status !== "LOCKED" && (
        <button
          onClick={() => setStatus("LOCKED")}
          disabled={busy}
          className="text-[10px] uppercase tracking-widest text-[#FF3333] hover:underline disabled:opacity-30 ml-2"
        >
          LOCK
        </button>
      )}
    </div>
  );
}
