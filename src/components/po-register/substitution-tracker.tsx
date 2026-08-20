"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

type TrackerLine = {
  poLineId: string;
  ticketLineId: string | null;
  description: string;
  code: string | null;
  unit: string | null;
  ordered: number;
  calledOff: number;
  delivered: number;
  remaining: number;
  status: string | null;
  superseded: boolean;
  replaces: { description: string; code: string | null } | null;
};

type BatchLine = {
  id: string;
  oldDescription: string;
  oldCode: string | null;
  newDescription: string;
  newCode: string | null;
  qtyToSwap: number;
  frozenQty: number;
};

type Batch = {
  id: string;
  title: string;
  notes: string | null;
  workflowState: string;
  scopeLabel: string;
  pdfFileName: string | null;
  createdAt: string;
  appliedAt: string | null;
  lines: BatchLine[];
};

type TrackerCallOff = {
  id: string;
  callOffNo: number;
  callOffDate: string;
  status: string;
};

type Draft = { newDescription: string; newCode: string; qty: string };

const STATE_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  PENDING_CUSTOMER_CONFIRMATION: "Awaiting customer",
  CUSTOMER_APPROVED: "Customer approved",
  APPLIED: "Applied",
  CLOSED: "Closed",
};

const STATE_STYLE: Record<string, string> = {
  DRAFT: "bg-neutral-500/10 text-neutral-500 border-neutral-500/30",
  PENDING_CUSTOMER_CONFIRMATION: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  CUSTOMER_APPROVED: "bg-blue-500/10 text-blue-600 border-blue-500/30",
  APPLIED: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  CLOSED: "bg-neutral-500/10 text-neutral-500 border-neutral-500/30",
};

export function SubstitutionTracker({
  poId,
  callOffs,
  selectedCallOffId,
  lines,
  batches,
}: {
  poId: string;
  callOffs: TrackerCallOff[];
  selectedCallOffId: string | null;
  lines: TrackerLine[];
  batches: Batch[];
}) {
  const router = useRouter();

  function changeScope(callOffId: string | null) {
    const base = `/po-register/${poId}`;
    router.push(callOffId ? `${base}?callOff=${callOffId}` : base);
  }
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const draftEntries = Object.entries(drafts).filter(
    ([, d]) => d.newDescription.trim().length > 0,
  );

  function setDraft(poLineId: string, patch: Partial<Draft>) {
    const base: Draft = { newDescription: "", newCode: "", qty: "" };
    setDrafts((prev) => ({
      ...prev,
      [poLineId]: { ...base, ...prev[poLineId], ...patch },
    }));
  }
  function removeDraft(poLineId: string) {
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[poLineId];
      return next;
    });
  }

  async function createBatch(initialState: "DRAFT" | "PENDING_CUSTOMER_CONFIRMATION") {
    setError(null);
    const swaps = draftEntries.map(([poLineId, d]) => {
      const line = lines.find((l) => l.poLineId === poLineId)!;
      return {
        oldTicketLineId: line.ticketLineId,
        newDescription: d.newDescription.trim(),
        newCode: d.newCode.trim() || null,
        qtyToSwap: d.qty.trim() ? Number(d.qty) : undefined,
      };
    });
    if (swaps.some((s) => !s.oldTicketLineId)) {
      setError("Selected line has no ticket line — cannot swap");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/customer-pos/${poId}/substitutions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim() || `Line substitution — ${new Date().toLocaleDateString("en-GB")}`,
          callOffId: selectedCallOffId,
          swaps,
          initialState,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Failed to create amendment");
        return;
      }
      setDrafts({});
      setTitle("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function transition(id: string, workflowState: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/substitutions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workflowState }),
      });
      if (!res.ok) setError((await res.json()).error ?? "Transition failed");
      else router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function apply(id: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/substitutions/${id}/apply`, { method: "POST" });
      if (!res.ok) setError((await res.json()).error ?? "Apply failed");
      else router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function generatePdf(id: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/substitutions/${id}/pdf`, { method: "POST" });
      if (!res.ok) setError((await res.json()).error ?? "PDF generation failed");
      else router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-8">
      {error && (
        <div className="rounded border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-600">
          {error}
        </div>
      )}

      {/* ─── Scope selector ─── */}
      {callOffs.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-muted-foreground">Scope</span>
          <Button
            size="sm"
            variant={selectedCallOffId ? "outline" : "default"}
            className="h-7 text-xs"
            onClick={() => changeScope(null)}
          >
            Whole PO
          </Button>
          {callOffs.map((c) => (
            <Button
              key={c.id}
              size="sm"
              variant={selectedCallOffId === c.id ? "default" : "outline"}
              className="h-7 text-xs"
              onClick={() => changeScope(c.id)}
            >
              Call-off #{c.callOffNo}
              <span className="ml-1 text-[10px] opacity-70">
                {new Date(c.callOffDate).toLocaleDateString("en-GB")}
              </span>
            </Button>
          ))}
        </div>
      )}

      {/* ─── Balance tracker ─── */}
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-2">
          {selectedCallOffId
            ? `Line balances — call-off #${callOffs.find((c) => c.id === selectedCallOffId)?.callOffNo ?? ""}`
            : "Line balances"}
        </h2>
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="p-3 font-medium">Item</th>
                  <th className="p-3 font-medium w-[34%]">
                    {selectedCallOffId
                      ? "On call-off / delivered / swappable"
                      : "Ordered / called-off / delivered / remaining"}
                  </th>
                  <th className="p-3 font-medium text-right">{selectedCallOffId ? "Swappable" : "Remaining"}</th>
                  <th className="p-3 font-medium">Swap</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => {
                  const draft = drafts[l.poLineId];
                  const canSwap = !l.superseded && l.remaining > 0 && l.ticketLineId;
                  const deliveredPct = l.ordered ? (l.delivered / l.ordered) * 100 : 0;
                  const calledOnlyPct = l.ordered
                    ? ((l.calledOff - l.delivered) / l.ordered) * 100
                    : 0;
                  const remainingPct = l.ordered ? (l.remaining / l.ordered) * 100 : 0;
                  return (
                    <tr key={l.poLineId} className="border-b align-top">
                      <td className="p-3">
                        <div className="font-medium flex items-center gap-2">
                          {l.description}
                          {l.superseded && (
                            <Badge variant="outline" className="bg-neutral-500/10 text-neutral-500 border-neutral-500/30 text-[10px]">
                              superseded
                            </Badge>
                          )}
                        </div>
                        {l.code && <div className="text-xs text-muted-foreground">{l.code}</div>}
                        {l.replaces && (
                          <div className="text-xs text-blue-600 mt-1">
                            ⤷ replaced {l.replaces.code ?? l.replaces.description}
                          </div>
                        )}
                      </td>
                      <td className="p-3">
                        <div className="flex h-3 w-full overflow-hidden rounded bg-neutral-200/60">
                          <div className="bg-neutral-700" style={{ width: `${deliveredPct}%` }} title={`Delivered ${l.delivered}`} />
                          <div className="bg-amber-500" style={{ width: `${calledOnlyPct}%` }} title={`Called off, not delivered ${l.calledOff - l.delivered}`} />
                          <div className="bg-violet-500" style={{ width: `${remainingPct}%` }} title={`Remaining ${l.remaining}`} />
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {selectedCallOffId
                            ? `${l.ordered} on call-off · ${l.delivered} delivered · ${l.remaining} swappable`
                            : `${l.ordered} ordered · ${l.calledOff} called off (${l.delivered} delivered) · ${l.remaining} free`}
                        </div>
                      </td>
                      <td className="p-3 text-right font-medium">
                        {l.remaining} {l.unit ?? ""}
                      </td>
                      <td className="p-3">
                        {canSwap ? (
                          draft ? (
                            <div className="space-y-1 min-w-[220px]">
                              <Input
                                placeholder="New item description"
                                value={draft.newDescription}
                                onChange={(e) => setDraft(l.poLineId, { newDescription: e.target.value })}
                                className="h-7 text-xs"
                              />
                              <div className="flex gap-1">
                                <Input
                                  placeholder="Code"
                                  value={draft.newCode}
                                  onChange={(e) => setDraft(l.poLineId, { newCode: e.target.value })}
                                  className="h-7 text-xs"
                                />
                                <Input
                                  placeholder={`Qty (max ${l.remaining})`}
                                  value={draft.qty}
                                  onChange={(e) => setDraft(l.poLineId, { qty: e.target.value })}
                                  className="h-7 text-xs w-24"
                                />
                                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => removeDraft(l.poLineId)}>
                                  ✕
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 px-2 text-xs bg-[#7C3AED]/10 text-[#7C3AED] border-[#7C3AED]/30"
                              onClick={() => setDraft(l.poLineId, {})}
                            >
                              + Swap
                            </Button>
                          )
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>

        {draftEntries.length > 0 && (
          <div className="mt-3 flex items-center gap-2">
            <Input
              placeholder="Amendment title (e.g. Customer revised list 09/07)"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="h-8 max-w-sm"
            />
            <Button size="sm" disabled={busy} onClick={() => createBatch("DRAFT")}>
              Create amendment ({draftEntries.length})
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => createBatch("PENDING_CUSTOMER_CONFIRMATION")}>
              Create &amp; send to customer
            </Button>
          </div>
        )}
      </div>

      {/* ─── Amendments (batches) ─── */}
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-2">
          Amendments
        </h2>
        {batches.length === 0 ? (
          <p className="text-sm text-muted-foreground">No substitutions yet.</p>
        ) : (
          <div className="space-y-3">
            {batches.map((b) => (
              <Card key={b.id}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-medium flex items-center gap-2">
                        {b.title}
                        <Badge variant="outline" className={`text-[10px] ${STATE_STYLE[b.workflowState] ?? ""}`}>
                          {STATE_LABEL[b.workflowState] ?? b.workflowState}
                        </Badge>
                        <Badge variant="outline" className="text-[10px] bg-violet-500/10 text-violet-600 border-violet-500/30">
                          {b.scopeLabel}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(b.createdAt).toLocaleDateString("en-GB")}
                        {b.appliedAt ? ` · applied ${new Date(b.appliedAt).toLocaleDateString("en-GB")}` : ""}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" className="h-7 text-xs" disabled={busy} onClick={() => generatePdf(b.id)}>
                        {b.pdfFileName ? "Regenerate PDF" : "Generate PDF"}
                      </Button>
                      {b.pdfFileName && (
                        <a href={`/api/substitutions/${b.id}/pdf`}>
                          <Button variant="outline" size="sm" className="h-7 text-xs">
                            Download
                          </Button>
                        </a>
                      )}
                      {b.workflowState === "DRAFT" && (
                        <Button size="sm" className="h-7 text-xs" disabled={busy} onClick={() => transition(b.id, "PENDING_CUSTOMER_CONFIRMATION")}>
                          Send to customer
                        </Button>
                      )}
                      {b.workflowState === "PENDING_CUSTOMER_CONFIRMATION" && (
                        <Button size="sm" className="h-7 text-xs" disabled={busy} onClick={() => transition(b.id, "CUSTOMER_APPROVED")}>
                          Mark approved
                        </Button>
                      )}
                      {b.workflowState === "CUSTOMER_APPROVED" && (
                        <Button size="sm" className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700" disabled={busy} onClick={() => apply(b.id)}>
                          Apply to tickets
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className="rounded border divide-y text-sm">
                    {b.lines.map((l) => (
                      <div key={l.id} className="flex items-center gap-3 p-2">
                        <div className="flex-1">
                          <span className="text-muted-foreground line-through">{l.oldCode ?? l.oldDescription}</span>
                          <span className="mx-2 text-violet-500">→</span>
                          <span className="font-medium">{l.newCode ?? l.newDescription}</span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {l.qtyToSwap} moved{l.frozenQty > 0 ? ` · ${l.frozenQty} frozen on original` : ""}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
