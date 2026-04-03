"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Wand2, Check, X, Merge, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

type Candidate = {
  id: string;
  rawText: string;
  extractedQty: number | null;
  extractedUnit: string | null;
  extractedProduct: string | null;
  extractedSize: string | null;
  extractedSpec: string | null;
  suggestedLineType: string | null;
  confidence: number | null;
  status: string;
  groupLabel: string | null;
  resultTicketLineId: string | null;
};

type Batch = {
  id: string;
  sourceText: string;
  status: string;
  candidates: Candidate[];
};

export function RfqExploder({
  ticketId,
  payingCustomerId,
  sourceText,
  existingBatch,
}: {
  ticketId: string;
  payingCustomerId: string;
  sourceText?: string;
  existingBatch?: Batch | null;
}) {
  const router = useRouter();
  const [batch, setBatch] = useState<Batch | null>(existingBatch || null);
  const [extracting, setExtracting] = useState(false);
  const [customText, setCustomText] = useState(sourceText || "");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mergeLabel, setMergeLabel] = useState("");
  const [mergeNotes, setMergeNotes] = useState("");
  const [showMerge, setShowMerge] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [showSource, setShowSource] = useState(false);

  // Auto-extract on mount if source text exists and no batch
  useEffect(() => {
    if (customText.trim() && !batch && !extracting) {
      handleExtract();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleExtract() {
    if (!customText.trim()) return;
    setExtracting(true);
    try {
      const res = await fetch("/api/rfq/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceText: customText, ticketId }),
      });
      if (res.ok) {
        const data = await res.json();
        setBatch(data);
      }
    } finally {
      setExtracting(false);
    }
  }

  async function handleAcceptSingle(candidateId: string) {
    setProcessing(true);
    try {
      const res = await fetch("/api/rfq/candidates/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateIds: [candidateId], ticketId, payingCustomerId }),
      });
      if (res.ok) {
        setBatch((prev) => prev ? {
          ...prev,
          candidates: prev.candidates.map((c) => c.id === candidateId ? { ...c, status: "ACCEPTED" } : c),
        } : null);
        router.refresh();
      }
    } finally {
      setProcessing(false);
    }
  }

  async function handleDiscard(candidateId: string) {
    await fetch(`/api/rfq/candidates/${candidateId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "DISCARDED" }),
    });
    setBatch((prev) => prev ? {
      ...prev,
      candidates: prev.candidates.map((c) => c.id === candidateId ? { ...c, status: "DISCARDED" } : c),
    } : null);
  }

  async function handleMergeSelected() {
    if (selected.size < 2 || !mergeLabel.trim()) return;
    setProcessing(true);
    try {
      const res = await fetch("/api/rfq/candidates/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateIds: [...selected],
          ticketId,
          payingCustomerId,
          description: mergeLabel,
          groupLabel: mergeLabel,
          internalNotes: mergeNotes,
        }),
      });
      if (res.ok) {
        setBatch((prev) => prev ? {
          ...prev,
          candidates: prev.candidates.map((c) =>
            selected.has(c.id) ? { ...c, status: "ACCEPTED", groupLabel: mergeLabel } : c
          ),
        } : null);
        setSelected(new Set());
        setMergeLabel("");
        setMergeNotes("");
        setShowMerge(false);
        router.refresh();
      }
    } finally {
      setProcessing(false);
    }
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const pending = batch?.candidates.filter((c) => c.status === "PENDING") || [];
  const accepted = batch?.candidates.filter((c) => c.status === "ACCEPTED") || [];
  const discarded = batch?.candidates.filter((c) => c.status === "DISCARDED") || [];

  const confColor = (conf: number) =>
    conf >= 70 ? "text-[#00CC66]" : conf >= 50 ? "text-[#FF9900]" : "text-[#FF3333]";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[11px] uppercase tracking-widest text-[#888888] font-bold">RFQ EXTRACTION</h2>
        {batch && (
          <Badge className={`text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 ${
            batch.status === "COMPLETED" ? "text-[#00CC66] bg-[#00CC66]/10" :
            "text-[#FF9900] bg-[#FF9900]/10"
          }`}>{batch.status}</Badge>
        )}
      </div>

      {/* Source text input */}
      {!batch && (
        <div className="space-y-2">
          <Label>RFQ Source Text</Label>
          <Textarea
            value={customText}
            onChange={(e) => setCustomText(e.target.value)}
            rows={6}
            className="bg-[#222222] border-[#333333] text-[#E0E0E0] text-xs bb-mono"
            placeholder="Paste the enquiry / email / RFQ text here..."
          />
          <Button onClick={handleExtract} disabled={extracting || !customText.trim()} className="bg-[#FF6600] text-black hover:bg-[#FF9900]">
            <Wand2 className="size-4 mr-1" />
            {extracting ? "Extracting..." : "Explode RFQ"}
          </Button>
        </div>
      )}

      {/* Source text toggle (after extraction) */}
      {batch && (
        <button onClick={() => setShowSource(!showSource)} className="flex items-center gap-1 text-xs text-[#888888] hover:text-[#E0E0E0]">
          {showSource ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          Raw Source ({batch.sourceText.length} chars)
        </button>
      )}
      {showSource && batch && (
        <div className="bg-[#151515] border border-[#333333] p-3 text-xs text-[#888888] bb-mono whitespace-pre-wrap max-h-40 overflow-y-auto">
          {batch.sourceText}
        </div>
      )}

      {/* Pending candidates */}
      {pending.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-widest text-[#888888]">
              PENDING ({pending.length})
            </span>
            {selected.size >= 2 && (
              <Button size="sm" onClick={() => setShowMerge(!showMerge)} className="bg-[#3399FF] text-black hover:bg-[#2277DD]">
                <Merge className="size-3 mr-1" />
                Merge {selected.size} Selected
              </Button>
            )}
          </div>

          {/* Merge dialog */}
          {showMerge && selected.size >= 2 && (
            <div className="border border-[#3399FF]/30 bg-[#3399FF]/5 p-3 space-y-2">
              <div className="space-y-1">
                <Label className="text-xs">Package Name</Label>
                <Input value={mergeLabel} onChange={(e) => setMergeLabel(e.target.value)} placeholder="e.g. Copper Pipe Package" className="bg-[#222222] border-[#333333]" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Internal Notes (optional)</Label>
                <Input value={mergeNotes} onChange={(e) => setMergeNotes(e.target.value)} placeholder="Additional notes" className="bg-[#222222] border-[#333333]" />
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={handleMergeSelected} disabled={!mergeLabel.trim() || processing} className="bg-[#3399FF] text-black">
                  {processing ? "Merging..." : "Create Grouped Line"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => { setShowMerge(false); setSelected(new Set()); }} className="bg-[#222222] border-[#333333] text-[#E0E0E0]">
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {/* Candidate rows */}
          {pending.map((c) => (
            <div key={c.id} className={`border ${selected.has(c.id) ? "border-[#3399FF]" : "border-[#333333]"} bg-[#1A1A1A] p-3 flex items-start gap-3`}>
              <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleSelect(c.id)} className="mt-1 accent-[#3399FF]" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-[#E0E0E0]">{c.extractedProduct || c.rawText}</span>
                  {c.extractedSize && <Badge variant="outline" className="text-[9px]">{c.extractedSize}</Badge>}
                  <Badge variant="outline" className="text-[9px]">{c.suggestedLineType}</Badge>
                </div>
                <div className="flex items-center gap-3 mt-1 text-[10px] text-[#888888] bb-mono">
                  {c.extractedQty && <span>Qty: {Number(c.extractedQty)}</span>}
                  <span>UOM: {c.extractedUnit || "EA"}</span>
                  <span className={confColor(Number(c.confidence || 0))}>Conf: {Number(c.confidence || 0)}%</span>
                  <span className="text-[#666666] truncate max-w-[200px]">Raw: {c.rawText}</span>
                </div>
              </div>
              <div className="flex gap-1 shrink-0">
                <Button size="sm" variant="ghost" onClick={() => handleAcceptSingle(c.id)} disabled={processing} title="Accept as individual line">
                  <Check className="size-3.5 text-[#00CC66]" />
                </Button>
                <Button size="sm" variant="ghost" onClick={() => handleDiscard(c.id)} title="Discard">
                  <X className="size-3.5 text-[#FF3333]" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Accepted */}
      {accepted.length > 0 && (
        <div className="space-y-1">
          <span className="text-[10px] uppercase tracking-widest text-[#00CC66]">ACCEPTED ({accepted.length})</span>
          {accepted.map((c) => (
            <div key={c.id} className="border border-[#00CC66]/20 bg-[#00CC66]/5 px-3 py-2 text-xs text-[#E0E0E0] flex items-center gap-2">
              <Check className="size-3 text-[#00CC66]" />
              <span>{c.extractedProduct || c.rawText}</span>
              {c.groupLabel && <Badge className="text-[8px] bg-[#3399FF]/10 text-[#3399FF]">{c.groupLabel}</Badge>}
            </div>
          ))}
        </div>
      )}

      {/* Discarded */}
      {discarded.length > 0 && (
        <div className="space-y-1">
          <span className="text-[10px] uppercase tracking-widest text-[#666666]">DISCARDED ({discarded.length})</span>
          {discarded.map((c) => (
            <div key={c.id} className="px-3 py-1 text-[10px] text-[#666666] line-through">{c.extractedProduct || c.rawText}</div>
          ))}
        </div>
      )}
    </div>
  );
}
