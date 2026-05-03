"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";

type POD = {
  id: string;
  ticketLineId: string | null;
  podType: "DELIVERY_NOTE" | "IMAGE" | "TRACKING_NOTE" | "SIGNED_RECEIPT" | "OTHER";
  fileRef: string | null;
  fileName: string | null;
  mimeType: string | null;
  fileSize: number | null;
  trackingNumber: string | null;
  carrier: string | null;
  supplierName: string | null;
  signedBy: string | null;
  signedAt: string | null;
  notes: string | null;
  createdAt: string;
  ticketLine: { id: string; description: string; displayOrder: number } | null;
};

const TYPE_LABEL: Record<POD["podType"], string> = {
  DELIVERY_NOTE: "Delivery Note",
  IMAGE: "Image",
  TRACKING_NOTE: "Tracking",
  SIGNED_RECEIPT: "Signed Receipt",
  OTHER: "Other",
};

export function PODFolder({
  ticketId,
  podRequired,
  ticketLines,
}: {
  ticketId: string;
  podRequired: boolean;
  ticketLines: Array<{ id: string; description: string }>;
}) {
  const router = useRouter();
  const [pods, setPods] = useState<POD[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // Form fields
  const [podType, setPodType] = useState<POD["podType"]>("DELIVERY_NOTE");
  const [ticketLineId, setTicketLineId] = useState<string>("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [carrier, setCarrier] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [signedBy, setSignedBy] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/pods?ticketId=${ticketId}`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      setPods(j.pods ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    } finally {
      setLoading(false);
    }
  }, [ticketId]);

  useEffect(() => { void reload(); }, [reload]);

  function resetForm() {
    setPodType("DELIVERY_NOTE");
    setTicketLineId("");
    setTrackingNumber("");
    setCarrier("");
    setSupplierName("");
    setSignedBy("");
    setNotes("");
    setFile(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      let res: Response;
      if (file) {
        const fd = new FormData();
        fd.append("ticketId", ticketId);
        if (ticketLineId) fd.append("ticketLineId", ticketLineId);
        fd.append("podType", podType);
        if (trackingNumber) fd.append("trackingNumber", trackingNumber);
        if (carrier) fd.append("carrier", carrier);
        if (supplierName) fd.append("supplierName", supplierName);
        if (signedBy) fd.append("signedBy", signedBy);
        if (notes) fd.append("notes", notes);
        fd.append("file", file);
        res = await fetch("/api/pods", { method: "POST", body: fd });
      } else {
        res = await fetch("/api/pods", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ticketId,
            ticketLineId: ticketLineId || undefined,
            podType,
            trackingNumber: trackingNumber || undefined,
            carrier: carrier || undefined,
            supplierName: supplierName || undefined,
            signedBy: signedBy || undefined,
            notes: notes || undefined,
          }),
        });
      }
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      resetForm();
      setAdding(false);
      await reload();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "save failed");
    } finally {
      setBusy(false);
    }
  }

  async function del(id: string) {
    if (!confirm("Delete this POD?")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/pods/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error ?? `HTTP ${res.status}`);
        return;
      }
      await reload();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  // Coverage: which lines have at least one POD
  const coveredLineIds = new Set(pods.map((p) => p.ticketLineId).filter((x): x is string => !!x));
  const ticketLevelCount = pods.filter((p) => !p.ticketLineId).length;
  const uncoveredLines = ticketLines.filter((l) => !coveredLineIds.has(l.id));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[10px] tracking-[0.2em] text-[#FF6600] bb-mono">PROOF OF DELIVERY</div>
          {podRequired && (
            <div className="text-[9px] text-[#FFCC00] bb-mono mt-1">
              POD REQUIRED for this customer · {pods.length} POD{pods.length === 1 ? "" : "s"} on file
              {uncoveredLines.length > 0 && (
                <span className="text-[#FF6666] ml-2">
                  ⚠ {uncoveredLines.length} line{uncoveredLines.length === 1 ? "" : "s"} without POD
                </span>
              )}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => setAdding(!adding)}
          className="px-3 py-1.5 text-[11px] bb-mono border border-[#FF6600] text-[#FF6600] hover:bg-[#FF6600] hover:text-black transition-colors"
        >
          {adding ? "✕ CANCEL" : "+ ADD POD"}
        </button>
      </div>

      {adding && (
        <div className="border border-[#FF6600] bg-[#1A1A1A] p-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <select
              value={podType}
              onChange={(e) => setPodType(e.target.value as POD["podType"])}
              className="px-2 py-1.5 text-[11px] bg-[#0A0A0A] border border-[#2A2A2A] text-[#E0E0E0] bb-mono"
            >
              {Object.entries(TYPE_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <select
              value={ticketLineId}
              onChange={(e) => setTicketLineId(e.target.value)}
              className="px-2 py-1.5 text-[11px] bg-[#0A0A0A] border border-[#2A2A2A] text-[#E0E0E0] bb-mono"
            >
              <option value="">— ticket-wide (any line) —</option>
              {ticketLines.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.description.slice(0, 60)}
                </option>
              ))}
            </select>
            <input
              type="text"
              placeholder="Tracking number (optional)"
              value={trackingNumber}
              onChange={(e) => setTrackingNumber(e.target.value)}
              className="px-2 py-1.5 text-[11px] bg-[#0A0A0A] border border-[#2A2A2A] text-[#E0E0E0] bb-mono"
            />
            <input
              type="text"
              placeholder="Carrier (e.g. Tuffnells)"
              value={carrier}
              onChange={(e) => setCarrier(e.target.value)}
              className="px-2 py-1.5 text-[11px] bg-[#0A0A0A] border border-[#2A2A2A] text-[#E0E0E0] bb-mono"
            />
            <input
              type="text"
              placeholder="Supplier (delivered by)"
              value={supplierName}
              onChange={(e) => setSupplierName(e.target.value)}
              className="px-2 py-1.5 text-[11px] bg-[#0A0A0A] border border-[#2A2A2A] text-[#E0E0E0] bb-mono"
            />
            <input
              type="text"
              placeholder="Signed by (received by)"
              value={signedBy}
              onChange={(e) => setSignedBy(e.target.value)}
              className="px-2 py-1.5 text-[11px] bg-[#0A0A0A] border border-[#2A2A2A] text-[#E0E0E0] bb-mono"
            />
            <input
              type="text"
              placeholder="Notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="col-span-2 px-2 py-1.5 text-[11px] bg-[#0A0A0A] border border-[#2A2A2A] text-[#E0E0E0] bb-mono"
            />
            <input
              ref={fileRef}
              type="file"
              accept="image/*,application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="col-span-2 text-[10px] text-[#888888] bb-mono file:mr-2 file:py-1 file:px-2 file:border file:border-[#2A2A2A] file:bg-[#0A0A0A] file:text-[#888888]"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={submit}
              disabled={busy}
              className="px-3 py-1.5 text-[11px] bb-mono bg-[#FF6600] text-black hover:bg-[#FF7711] disabled:opacity-30"
            >
              {busy ? "SAVING…" : "SAVE POD"}
            </button>
          </div>
        </div>
      )}

      {error && <div className="text-[11px] text-[#FF6666] bb-mono">{error}</div>}

      {loading ? (
        <div className="text-[11px] text-[#888888] bb-mono">Loading…</div>
      ) : pods.length === 0 ? (
        <div className="text-[11px] text-[#666666] bb-mono py-6 text-center border border-dashed border-[#2A2A2A]">
          No PODs yet. {podRequired && "Required for invoice send."}
        </div>
      ) : (
        <div className="border border-[#2A2A2A]">
          <table className="w-full text-[11px] bb-mono">
            <thead className="bg-[#1A1A1A] text-[#888888] uppercase tracking-widest">
              <tr>
                <th className="text-left px-3 py-2">Type</th>
                <th className="text-left px-3 py-2">Line</th>
                <th className="text-left px-3 py-2">File / Tracking</th>
                <th className="text-left px-3 py-2">Carrier · Signed by</th>
                <th className="text-right px-3 py-2">Date</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pods.map((p) => (
                <tr key={p.id} className="border-t border-[#222222]">
                  <td className="px-3 py-2 text-[#CCCCCC]">{TYPE_LABEL[p.podType]}</td>
                  <td className="px-3 py-2 text-[#888888]">
                    {p.ticketLine ? p.ticketLine.description.slice(0, 30) : "(any line)"}
                  </td>
                  <td className="px-3 py-2">
                    {p.fileRef && (
                      <a
                        href={`/api/pods/${p.id}/file`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[#FF6600] hover:underline"
                      >
                        {p.fileName ?? "file"}
                      </a>
                    )}
                    {p.fileRef && p.trackingNumber && <span className="text-[#444]"> · </span>}
                    {p.trackingNumber && (
                      <span className="text-[#CCCCCC]">{p.trackingNumber}</span>
                    )}
                    {!p.fileRef && !p.trackingNumber && <span className="text-[#666]">—</span>}
                  </td>
                  <td className="px-3 py-2 text-[#CCCCCC]">
                    {[p.carrier, p.supplierName, p.signedBy].filter(Boolean).join(" · ") || "—"}
                  </td>
                  <td className="px-3 py-2 text-right text-[#888888] tabular-nums">
                    {new Date(p.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => del(p.id)}
                      disabled={busy}
                      className="text-[10px] text-[#666666] hover:text-[#FF3333] bb-mono"
                    >
                      DELETE
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
