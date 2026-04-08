"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Wand2, Check, X, Merge, ChevronDown, ChevronRight, Package, Filter, Upload } from "lucide-react";
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

// ─── Auto-group rules ───────────────────────────────────────────────────────

const GROUP_RULES: Array<{ label: string; color: string; test: (text: string) => boolean }> = [
  {
    label: "Copper Pipe Package",
    color: "#FF6600",
    test: (t) => /\bcopp?er\s*(pipe|tube)\b/i.test(t) || /\blength\s*\d+mm\s*copp?er/i.test(t) || (/\bcopp?er\b/i.test(t) && /\blength\b/i.test(t)),
  },
  {
    label: "MLCP Pipe & Press Fittings",
    color: "#3399FF",
    test: (t) => /\bmlcp\b/i.test(t) || (/\bpress\b/i.test(t) && !/\bcopp?er\b/i.test(t)),
  },
  {
    label: "Valves / Controls",
    color: "#00CC66",
    test: (t) => /\bvalve\b/i.test(t) || /\blbv\b/i.test(t) || /\bmotorised\b/i.test(t) || /\bbypass\b/i.test(t),
  },
  {
    label: "Cooper Press Fittings",
    color: "#9966FF",
    test: (t) => /\bcopp?er\s*press\b/i.test(t) || (/\bpress\b/i.test(t) && /\bcopp?er\b/i.test(t)),
  },
  {
    label: "Taps & Mixers",
    color: "#FF9900",
    test: (t) => /\btap\b/i.test(t) || /\bmixer\b/i.test(t) || /\bshower\b/i.test(t) || /\bbasin\b/i.test(t) || /\bbath\b/i.test(t),
  },
  {
    label: "Fixing / Sundries",
    color: "#888888",
    test: (t) => /\bclip\b/i.test(t) || /\bband\b/i.test(t) || /\bfix/i.test(t) || /\bptfe\b/i.test(t) || /\bflux\b/i.test(t) || /\bsolder\b/i.test(t) || /\bcement\b/i.test(t) || /\btape\b/i.test(t) || /\bsilicone\b/i.test(t) || /\bring\b/i.test(t),
  },
];

function suggestGroup(text: string): { label: string; color: string } | null {
  for (const rule of GROUP_RULES) {
    if (rule.test(text)) return rule;
  }
  return null;
}

// ─── Component ──────────────────────────────────────────────────────────────

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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editQty, setEditQty] = useState("");
  const [editProduct, setEditProduct] = useState("");
  const [editSize, setEditSize] = useState("");

  function startEdit(c: Candidate) {
    setEditingId(c.id);
    setEditQty(c.extractedQty ? String(Number(c.extractedQty)) : "");
    setEditProduct(c.extractedProduct || c.rawText);
    setEditSize(c.extractedSize || "");
  }

  async function saveEdit() {
    if (!editingId) return;
    await fetch(`/api/rfq/candidates/${editingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        extractedQty: editQty ? Number(editQty) : null,
        extractedProduct: editProduct,
        extractedSize: editSize || null,
      }),
    });
    setBatch((prev) => prev ? {
      ...prev,
      candidates: prev.candidates.map((c) => c.id === editingId ? {
        ...c,
        extractedQty: editQty ? Number(editQty) : null,
        extractedProduct: editProduct,
        extractedSize: editSize || null,
      } : c),
    } : null);
    setEditingId(null);
  }
  const [processing, setProcessing] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const [filterGroup, setFilterGroup] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  async function handleExcelUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/rfq/upload-excel", { method: "POST", body: fd });
      if (res.ok) {
        const data = await res.json();
        setCustomText(data.text);
      }
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  // Auto-extract on mount
  useEffect(() => {
    if (customText.trim() && !batch && !extracting) {
      handleExtract();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Computed: candidates with suggested groups
  const enriched = useMemo(() => {
    if (!batch?.candidates) return [];
    return batch.candidates.map((c) => ({
      ...c,
      suggestedGroup: suggestGroup(c.extractedProduct || c.rawText),
    }));
  }, [batch?.candidates]);

  const pending = enriched.filter((c) => c.status === "PENDING");
  const accepted = enriched.filter((c) => c.status === "ACCEPTED");
  const discarded = enriched.filter((c) => c.status === "DISCARDED");

  // Group counts for pending
  const groupCounts = useMemo(() => {
    const counts: Record<string, number> = { Ungrouped: 0 };
    for (const c of pending) {
      const label = c.suggestedGroup?.label || "Ungrouped";
      counts[label] = (counts[label] || 0) + 1;
    }
    return counts;
  }, [pending]);

  // Filtered pending
  const filteredPending = filterGroup
    ? pending.filter((c) => (c.suggestedGroup?.label || "Ungrouped") === filterGroup)
    : pending;

  async function handleExtract() {
    if (!customText.trim()) return;
    setExtracting(true);
    try {
      const res = await fetch("/api/rfq/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceText: customText, ticketId }),
      });
      if (res.ok) setBatch(await res.json());
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
        setBatch((prev) => prev ? { ...prev, candidates: prev.candidates.map((c) => c.id === candidateId ? { ...c, status: "ACCEPTED" } : c) } : null);
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
    setBatch((prev) => prev ? { ...prev, candidates: prev.candidates.map((c) => c.id === candidateId ? { ...c, status: "DISCARDED" } : c) } : null);
  }

  async function handleMergeSelected() {
    if (selected.size < 1 || !mergeLabel.trim()) return;
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
        setBatch((prev) => prev ? { ...prev, candidates: prev.candidates.map((c) => selected.has(c.id) ? { ...c, status: "ACCEPTED", groupLabel: mergeLabel } : c) } : null);
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
    setSelected((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }

  function selectAllInGroup(groupLabel: string) {
    const ids = pending.filter((c) => (c.suggestedGroup?.label || "Ungrouped") === groupLabel).map((c) => c.id);
    setSelected(new Set(ids));
    setMergeLabel(groupLabel === "Ungrouped" ? "" : groupLabel);
  }

  function selectAll() {
    setSelected(new Set(filteredPending.map((c) => c.id)));
  }

  function selectNone() {
    setSelected(new Set());
  }

  // ─── Quick merge: select all in group and immediately show merge dialog
  function quickMerge(groupLabel: string) {
    selectAllInGroup(groupLabel);
    setMergeLabel(groupLabel);
    setShowMerge(true);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[11px] uppercase tracking-widest text-[#888888] font-bold">RFQ EXTRACTION</h2>
        {batch && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-[#888888] bb-mono">{pending.length} pending / {accepted.length} accepted / {discarded.length} discarded</span>
            <Badge className={`text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 ${batch.status === "COMPLETED" ? "text-[#00CC66] bg-[#00CC66]/10" : "text-[#FF9900] bg-[#FF9900]/10"}`}>{batch.status}</Badge>
          </div>
        )}
      </div>

      {/* Source text input (before extraction) */}
      {!batch && (
        <div className="space-y-2">
          <Label>RFQ Source Text</Label>
          <Textarea value={customText} onChange={(e) => setCustomText(e.target.value)} rows={6} className="bg-[#222222] border-[#333333] text-[#E0E0E0] text-xs bb-mono" placeholder="Paste the enquiry / email / RFQ text here, or upload an Excel file..." />
          <div className="flex gap-2">
          <label className="cursor-pointer">
            <input type="file" accept=".xlsx,.xls,.csv" onChange={handleExcelUpload} className="hidden" />
            <span className={`inline-flex items-center gap-1 px-3 py-1.5 text-sm border border-[#333333] hover:bg-[#222222] ${uploading ? "opacity-50" : ""}`}>
              <Upload className="size-4" />
              {uploading ? "Parsing..." : "Upload Excel"}
            </span>
          </label>
          <Button onClick={handleExtract} disabled={extracting || !customText.trim()} className="bg-[#FF6600] text-black hover:bg-[#FF9900]">
            <Wand2 className="size-4 mr-1" />
            {extracting ? "Extracting..." : "Explode RFQ"}
          </Button>
          </div>
        </div>
      )}

      {/* Source toggle */}
      {batch && (
        <button onClick={() => setShowSource(!showSource)} className="flex items-center gap-1 text-xs text-[#666666] hover:text-[#E0E0E0]">
          {showSource ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          Raw Source ({batch.sourceText.length} chars)
        </button>
      )}
      {showSource && batch && (
        <div className="bg-[#151515] border border-[#333333] p-3 text-[10px] text-[#888888] bb-mono whitespace-pre-wrap max-h-32 overflow-y-auto">{batch.sourceText}</div>
      )}

      {/* ── QUICK GROUP BUTTONS ──────────────────────────────────────── */}
      {pending.length > 0 && (
        <div className="space-y-2">
          <div className="text-[10px] uppercase tracking-widest text-[#888888]">QUICK GROUP — click to select all + merge</div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(groupCounts).filter(([, count]) => count > 0).map(([label, count]) => {
              const rule = GROUP_RULES.find((r) => r.label === label);
              return (
                <button
                  key={label}
                  onClick={() => quickMerge(label)}
                  className="flex items-center gap-1.5 px-3 py-1.5 border text-xs font-medium hover:bg-[#222222] transition-colors"
                  style={{ borderColor: rule?.color || "#555", color: rule?.color || "#888" }}
                >
                  <Package className="size-3" />
                  {label}
                  <span className="text-[9px] bb-mono opacity-70">({count})</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── FILTER BAR ───────────────────────────────────────────────── */}
      {pending.length > 0 && (
        <div className="flex items-center gap-2">
          <Filter className="size-3 text-[#888888]" />
          <button onClick={() => setFilterGroup(null)} className={`text-[10px] px-2 py-0.5 ${!filterGroup ? "bg-[#FF6600] text-black" : "text-[#888888] hover:text-[#E0E0E0]"}`}>All ({pending.length})</button>
          {Object.entries(groupCounts).filter(([, count]) => count > 0).map(([label, count]) => {
            const rule = GROUP_RULES.find((r) => r.label === label);
            return (
              <button key={label} onClick={() => setFilterGroup(label)} className={`text-[10px] px-2 py-0.5 ${filterGroup === label ? "text-black" : "hover:text-[#E0E0E0]"}`} style={filterGroup === label ? { backgroundColor: rule?.color || "#555" } : { color: rule?.color || "#888" }}>
                {label.split(" ")[0]} ({count})
              </button>
            );
          })}
        </div>
      )}

      {/* ── ACTION BAR (when selected) ───────────────────────────────── */}
      {selected.size > 0 && (
        <div className="flex items-center gap-2 border border-[#3399FF]/30 bg-[#3399FF]/5 px-3 py-2">
          <span className="text-xs text-[#3399FF] bb-mono font-bold">{selected.size} selected</span>
          <Button size="sm" onClick={() => setShowMerge(true)} className="bg-[#3399FF] text-black hover:bg-[#2277DD]">
            <Merge className="size-3 mr-1" /> Merge into Package
          </Button>
          <Button size="sm" variant="outline" onClick={selectNone} className="bg-[#222222] border-[#333333] text-[#E0E0E0]">Clear</Button>
          {filterGroup && filterGroup !== "Ungrouped" && (
            <Button size="sm" variant="outline" onClick={() => selectAllInGroup(filterGroup)} className="bg-[#222222] border-[#333333] text-[#E0E0E0]">Select all in {filterGroup.split(" ")[0]}</Button>
          )}
        </div>
      )}

      {/* ── MERGE DIALOG ─────────────────────────────────────────────── */}
      {showMerge && selected.size > 0 && (
        <div className="border border-[#3399FF]/30 bg-[#3399FF]/5 p-3 space-y-2">
          <div className="text-[10px] uppercase tracking-widest text-[#3399FF] font-bold">CREATE PACKAGE FROM {selected.size} ITEMS</div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Package Name *</Label>
              <Input value={mergeLabel} onChange={(e) => setMergeLabel(e.target.value)} placeholder="e.g. Copper Pipe Package" className="bg-[#222222] border-[#333333]" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Notes (optional)</Label>
              <Input value={mergeNotes} onChange={(e) => setMergeNotes(e.target.value)} placeholder="Additional notes" className="bg-[#222222] border-[#333333]" />
            </div>
          </div>
          <div className="text-[10px] text-[#888888] bb-mono max-h-20 overflow-y-auto border border-[#333333] p-2 bg-[#151515]">
            {[...selected].map((id) => {
              const c = pending.find((p) => p.id === id);
              if (!c) return null;
              return <div key={id}>{c.extractedQty ? `${Number(c.extractedQty)}x ` : ""}{c.extractedProduct || c.rawText}</div>;
            })}
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleMergeSelected} disabled={!mergeLabel.trim() || processing} className="bg-[#3399FF] text-black">
              {processing ? "Creating..." : `Create "${mergeLabel}" (${selected.size} items)`}
            </Button>
            <Button size="sm" variant="outline" onClick={() => { setShowMerge(false); }} className="bg-[#222222] border-[#333333] text-[#E0E0E0]">Cancel</Button>
          </div>
        </div>
      )}

      {/* ── PENDING CANDIDATES TABLE ─────────────────────────────────── */}
      {filteredPending.length > 0 && (
        <div className="border border-[#333333] bg-[#1A1A1A]">
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-[#333333]">
            <div className="flex items-center gap-2">
              <input type="checkbox" checked={selected.size === filteredPending.length && filteredPending.length > 0} onChange={() => selected.size === filteredPending.length ? selectNone() : selectAll()} className="accent-[#3399FF]" />
              <span className="text-[10px] text-[#888888] uppercase tracking-widest">Pending ({filteredPending.length})</span>
            </div>
          </div>
          <table className="w-full">
            <thead>
              <tr className="text-[9px] uppercase tracking-widest text-[#666666] border-b border-[#333333]">
                <th className="w-8 px-2 py-1.5"></th>
                <th className="text-right px-2 py-1.5 w-12">Qty</th>
                <th className="text-left px-2 py-1.5">Description</th>
                <th className="text-left px-2 py-1.5 w-16">Size</th>
                <th className="text-left px-2 py-1.5 w-24">Suggested Group</th>
                <th className="text-right px-2 py-1.5 w-12">Conf</th>
                <th className="px-2 py-1.5 w-20">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredPending.map((c) => {
                const isEditing = editingId === c.id;
                return (
                <tr key={c.id} className={`border-b border-[#2A2A2A] hover:bg-[#222222] ${selected.has(c.id) ? "bg-[#3399FF]/5" : ""} ${isEditing ? "bg-[#FF6600]/5 border-[#FF6600]/30" : ""}`}>
                  <td className="px-2 py-1.5">
                    <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleSelect(c.id)} className="accent-[#3399FF]" />
                  </td>
                  <td className="px-2 py-1.5 text-right text-xs bb-mono text-[#E0E0E0]">
                    {isEditing ? (
                      <input type="number" value={editQty} onChange={(e) => setEditQty(e.target.value)} className="w-12 h-6 text-right bg-[#222222] border border-[#FF6600] text-[#E0E0E0] text-xs px-1" autoFocus />
                    ) : (
                      <span className="cursor-pointer hover:text-[#FF6600]" onClick={() => startEdit(c)}>{c.extractedQty ? Number(c.extractedQty) : "?"}</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-xs text-[#E0E0E0]">
                    {isEditing ? (
                      <input value={editProduct} onChange={(e) => setEditProduct(e.target.value)} className="w-full h-6 bg-[#222222] border border-[#FF6600] text-[#E0E0E0] text-xs px-1" />
                    ) : (
                      <span className="cursor-pointer hover:text-[#FF6600]" onClick={() => startEdit(c)}>{c.extractedProduct || c.rawText}</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-[10px] text-[#888888] bb-mono">
                    {isEditing ? (
                      <input value={editSize} onChange={(e) => setEditSize(e.target.value)} className="w-16 h-6 bg-[#222222] border border-[#FF6600] text-[#E0E0E0] text-[10px] px-1" />
                    ) : (
                      <span className="cursor-pointer hover:text-[#FF6600]" onClick={() => startEdit(c)}>{c.extractedSize || "—"}</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    {c.suggestedGroup && (
                      <button onClick={() => quickMerge(c.suggestedGroup!.label)} className="text-[9px] px-1.5 py-0.5 font-bold uppercase tracking-wider" style={{ color: c.suggestedGroup.color, backgroundColor: c.suggestedGroup.color + "15" }}>
                        {c.suggestedGroup.label.split(" ")[0]}
                      </button>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right text-[10px] bb-mono">
                    <span className={Number(c.confidence) >= 80 ? "text-[#00CC66]" : Number(c.confidence) >= 60 ? "text-[#FF9900]" : "text-[#FF3333]"}>
                      {Number(c.confidence)}
                    </span>
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex gap-0.5">
                      {isEditing ? (
                        <>
                          <button onClick={saveEdit} className="p-1 hover:bg-[#FF6600]/10" title="Save edit">
                            <Check className="size-3 text-[#FF6600]" />
                          </button>
                          <button onClick={() => setEditingId(null)} className="p-1 hover:bg-[#333333]" title="Cancel">
                            <X className="size-3 text-[#888888]" />
                          </button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => startEdit(c)} className="p-1 hover:bg-[#FF6600]/10" title="Edit">
                            <Wand2 className="size-3 text-[#FF6600]" />
                          </button>
                          <button onClick={() => handleAcceptSingle(c.id)} disabled={processing} className="p-1 hover:bg-[#00CC66]/10" title="Accept as line">
                            <Check className="size-3 text-[#00CC66]" />
                          </button>
                          <button onClick={() => handleDiscard(c.id)} className="p-1 hover:bg-[#FF3333]/10" title="Discard">
                            <X className="size-3 text-[#FF3333]" />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── ACCEPTED ─────────────────────────────────────────────────── */}
      {accepted.length > 0 && (
        <div className="space-y-1">
          <span className="text-[10px] uppercase tracking-widest text-[#00CC66] font-bold">ACCEPTED ({accepted.length})</span>
          {accepted.map((c) => (
            <div key={c.id} className="border border-[#00CC66]/20 bg-[#00CC66]/5 px-3 py-1.5 text-xs text-[#E0E0E0] flex items-center gap-2">
              <Check className="size-3 text-[#00CC66] shrink-0" />
              <span>{c.extractedQty ? `${Number(c.extractedQty)}x ` : ""}{c.extractedProduct || c.rawText}</span>
              {c.groupLabel && <Badge className="text-[8px] bg-[#3399FF]/10 text-[#3399FF] shrink-0">{c.groupLabel}</Badge>}
            </div>
          ))}
        </div>
      )}

      {/* ── DISCARDED ────────────────────────────────────────────────── */}
      {discarded.length > 0 && (
        <div className="space-y-1">
          <span className="text-[10px] uppercase tracking-widest text-[#666666]">DISCARDED ({discarded.length})</span>
          {discarded.map((c) => (
            <div key={c.id} className="px-3 py-0.5 text-[10px] text-[#555555] line-through">{c.extractedProduct || c.rawText}</div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {batch && pending.length === 0 && accepted.length === 0 && (
        <div className="text-center py-8 text-[#888888] text-sm">No candidates extracted. Try pasting different RFQ text.</div>
      )}
    </div>
  );
}
