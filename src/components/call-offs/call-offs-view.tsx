"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Plus, Pencil, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Line = {
  id: string;
  displayOrder: number;
  sectionLabel: string | null;
  productCode: string | null;
  description: string;
  qty: number;
  unit: string;
  expectedCostUnit: number | null;
  calledOff: number;
  remaining: number;
};

type CallOff = {
  id: string;
  poNo: string;
  supplier: string;
  supplierRef: string | null;
  siteContact: string | null;
  issuedAt: string | null;
  deliveryDateExpected: string | null;
  status: string;
  totalCostExpected: number;
  lineCount: number;
  lines: Array<{ ticketLineId: string; qty: number; unitCost: number }>;
};

function fmt(n: number | null | undefined): string {
  if (n == null) return "—";
  return `£${Number(n).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function CallOffsView({
  ticketId,
  lines,
  callOffs,
  aliaxisId,
  nextPoNo,
  customerPoTotal,
  deliveryAddress,
}: {
  ticketId: string;
  lines: Line[];
  callOffs: CallOff[];
  aliaxisId: string | null;
  nextPoNo: string;
  customerPoTotal: number | null;
  deliveryAddress: string;
}) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Tranche editor state — qty per ticketLineId
  const [tranche, setTranche] = useState<Record<string, string>>({});
  const [deliveryDate, setDeliveryDate] = useState<string>("");
  const [supplierRef, setSupplierRef] = useState<string>("");
  const [siteContact, setSiteContact] = useState<string>("");

  function resetForm() {
    setTranche({});
    setDeliveryDate("");
    setSupplierRef("");
    setSiteContact("");
    setEditingId(null);
    setError(null);
  }

  function startEdit(co: CallOff) {
    const next: Record<string, string> = {};
    for (const l of co.lines) {
      if (l.ticketLineId) next[l.ticketLineId] = String(l.qty);
    }
    setTranche(next);
    setDeliveryDate(co.deliveryDateExpected ? co.deliveryDateExpected.slice(0, 10) : "");
    setSupplierRef(co.supplierRef ?? "");
    setSiteContact(co.siteContact ?? "");
    setEditingId(co.id);
    setShowForm(true);
    setError(null);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function issuePo(coId: string) {
    if (!confirm("Mark this call-off as ISSUED? This signals it's been sent to Aliaxis.")) return;
    const res = await fetch(`/api/procurement-orders/${coId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "ISSUED", issuedAt: new Date().toISOString() }),
    });
    if (!res.ok) {
      alert("Failed to mark as ISSUED: " + (await res.text()));
      return;
    }
    router.refresh();
  }

  const totals = useMemo(() => {
    let scopeQty = 0;
    let calledQty = 0;
    let scopeValue = 0;
    let calledValue = 0;
    for (const l of lines) {
      scopeQty += l.qty;
      calledQty += l.calledOff;
      if (l.expectedCostUnit != null) {
        scopeValue += l.qty * l.expectedCostUnit;
        calledValue += l.calledOff * l.expectedCostUnit;
      }
    }
    return {
      scopeQty,
      calledQty,
      remainingQty: scopeQty - calledQty,
      scopeValue,
      calledValue,
      remainingValue: scopeValue - calledValue,
    };
  }, [lines]);

  const trancheSummary = useMemo(() => {
    let qty = 0;
    let value = 0;
    let lineCount = 0;
    for (const l of lines) {
      const q = Number(tranche[l.id] || 0);
      if (!q || q <= 0) continue;
      qty += q;
      if (l.expectedCostUnit != null) value += q * l.expectedCostUnit;
      lineCount++;
    }
    return { qty, value, lineCount };
  }, [tranche, lines]);

  function setMaxAll() {
    const next: Record<string, string> = {};
    for (const l of lines) {
      if (l.remaining > 0) next[l.id] = String(l.remaining);
    }
    setTranche(next);
  }

  function clearAll() {
    setTranche({});
  }

  // Per-line allocation already on the call-off being edited (so user can
  // re-edit without their own previously-saved qty counting as "consumed").
  const editingAllocByLine = useMemo(() => {
    const m: Record<string, number> = {};
    if (!editingId) return m;
    const co = callOffs.find((c) => c.id === editingId);
    if (!co) return m;
    for (const l of co.lines) m[l.ticketLineId] = (m[l.ticketLineId] ?? 0) + l.qty;
    return m;
  }, [editingId, callOffs]);

  async function submit() {
    if (!aliaxisId) {
      setError("Aliaxis supplier missing — seed it first.");
      return;
    }
    if (!deliveryDate) {
      setError("Delivery date is required.");
      return;
    }

    let payloadLines: Array<{
      ticketLineId: string;
      description: string;
      qty: number;
      unitCost: number;
      lineTotal: number;
    }> = [];
    try {
      for (const l of lines) {
        const q = Number(tranche[l.id] || 0);
        if (!q || q <= 0) continue;
        const effectiveMax = l.remaining + (editingAllocByLine[l.id] ?? 0);
        if (q > effectiveMax + 0.0001) {
          throw new Error(
            `Line ${l.productCode || l.description.slice(0, 30)}: requested ${q} > available ${effectiveMax}`,
          );
        }
        const unitCost = l.expectedCostUnit ?? 0;
        payloadLines.push({
          ticketLineId: l.id,
          description: l.productCode ? `${l.productCode} — ${l.description}` : l.description,
          qty: q,
          unitCost,
          lineTotal: Math.round(q * unitCost * 100) / 100,
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Validation failed");
      return;
    }

    if (payloadLines.length === 0) {
      setError("No lines selected.");
      return;
    }

    const totalCostExpected = payloadLines.reduce((s, l) => s + l.lineTotal, 0);

    setSubmitting(true);
    setError(null);
    try {
      let poId: string;
      if (editingId) {
        const res = await fetch(`/api/procurement-orders/${editingId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            supplierRef: supplierRef || null,
            deliveryDateExpected: deliveryDate,
            siteContact: siteContact || null,
            totalCostExpected,
            lines: payloadLines,
          }),
        });
        if (!res.ok) throw new Error(`Update failed: ${await res.text()}`);
        poId = editingId;
      } else {
        const res = await fetch(`/api/tickets/${ticketId}/procurement-orders`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            supplierId: aliaxisId,
            poNo: nextPoNo,
            supplierRef: supplierRef || undefined,
            issuedAt: new Date().toISOString(),
            status: "DRAFT",
            deliveryDateExpected: deliveryDate,
            siteContact: siteContact || undefined,
            totalCostExpected,
            lines: payloadLines,
          }),
        });
        if (!res.ok) throw new Error(`Create failed: ${await res.text()}`);
        const po = await res.json();
        poId = po.id;
      }

      // Re-render PDF
      await fetch(`/api/procurement-orders/${poId}/generate-pdf`, { method: "POST" });
      window.open(`/api/procurement-orders/${poId}/generate-pdf`, "_blank");

      resetForm();
      setShowForm(false);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save call-off");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Summary card */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryStat label="Scope (qty)" value={totals.scopeQty.toLocaleString("en-GB")} />
        <SummaryStat label="Called off so far" value={totals.calledQty.toLocaleString("en-GB")} />
        <SummaryStat
          label="Remaining (qty)"
          value={totals.remainingQty.toLocaleString("en-GB")}
          highlight={totals.remainingQty === 0 ? "ok" : "warn"}
        />
        <SummaryStat
          label="Scope cost"
          value={fmt(totals.scopeValue)}
          sub={customerPoTotal ? `Customer PO ${fmt(customerPoTotal)}` : undefined}
        />
      </div>

      {/* Tracker table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">Per-line tracker</CardTitle>
          {!showForm ? (
            <Button size="sm" onClick={() => { resetForm(); setShowForm(true); }} disabled={!aliaxisId}>
              <Plus className="size-4 mr-1" /> New call-off
            </Button>
          ) : (
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => { resetForm(); setShowForm(false); }}
              >
                Cancel
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">#</TableHead>
                <TableHead className="w-32">Code</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Scope</TableHead>
                <TableHead className="text-right">Called off</TableHead>
                <TableHead className="text-right">Remaining</TableHead>
                <TableHead className="text-right">Unit cost</TableHead>
                {showForm && <TableHead className="text-right w-28">Call this time</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((l) => {
                const editAlloc = editingAllocByLine[l.id] ?? 0;
                const effectiveMax = l.remaining + editAlloc;
                const done = effectiveMax <= 0;
                return (
                  <TableRow key={l.id} className={done ? "opacity-60" : ""}>
                    <TableCell className="text-muted-foreground">{l.displayOrder}</TableCell>
                    <TableCell className="font-mono text-xs">{l.productCode || "—"}</TableCell>
                    <TableCell>
                      <div className="text-sm">{l.description}</div>
                      {l.sectionLabel && (
                        <div className="text-xs text-muted-foreground">{l.sectionLabel}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {l.qty} {l.unit}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{l.calledOff || "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {l.remaining <= 0 && !editAlloc ? (
                        <Badge variant="default">DONE</Badge>
                      ) : (
                        <span className="font-medium">{l.remaining}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {fmt(l.expectedCostUnit)}
                    </TableCell>
                    {showForm && (
                      <TableCell className="text-right">
                        <Input
                          type="number"
                          min={0}
                          max={effectiveMax}
                          step={1}
                          value={tranche[l.id] || ""}
                          onChange={(e) =>
                            setTranche({ ...tranche, [l.id]: e.target.value })
                          }
                          className="w-24 ml-auto"
                          disabled={done || submitting}
                        />
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* New call-off form (inline below tracker) */}
      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {editingId
                ? `Edit call-off ${callOffs.find((c) => c.id === editingId)?.poNo ?? ""}`
                : "New call-off to Aliaxis"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={setMaxAll}>
                Fill all to remaining
              </Button>
              <Button size="sm" variant="ghost" onClick={clearAll}>
                Clear
              </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <Label htmlFor="po-no">Supplier PO No.</Label>
                <Input
                  id="po-no"
                  value={editingId ? (callOffs.find((c) => c.id === editingId)?.poNo ?? nextPoNo) : nextPoNo}
                  disabled
                  className="font-mono"
                />
              </div>
              <div>
                <Label htmlFor="delivery">
                  Delivery date <span className="text-red-600">*</span>
                </Label>
                <Input
                  id="delivery"
                  type="date"
                  value={deliveryDate}
                  onChange={(e) => setDeliveryDate(e.target.value)}
                  disabled={submitting}
                  required
                />
              </div>
              <div>
                <Label htmlFor="supplier-ref">Supplier ref (optional)</Label>
                <Input
                  id="supplier-ref"
                  value={supplierRef}
                  onChange={(e) => setSupplierRef(e.target.value)}
                  placeholder="Aliaxis quote / acknowledgement"
                  disabled={submitting}
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <Label>Delivery address (from Site record)</Label>
                <div className="text-xs text-muted-foreground border rounded px-3 py-2 bg-muted/30 whitespace-pre-line min-h-[5.5rem]">
                  {deliveryAddress || "(no site address on record — update in /sites)"}
                </div>
              </div>
              <div>
                <Label htmlFor="site-contact">
                  Site contact for delivery
                </Label>
                <textarea
                  id="site-contact"
                  value={siteContact}
                  onChange={(e) => setSiteContact(e.target.value)}
                  disabled={submitting}
                  rows={4}
                  className="w-full border rounded px-3 py-2 text-sm bg-background"
                  placeholder={"Name\nPhone\nEmail (optional)\nAccess notes"}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Free text — appears on the PDF so Aliaxis can call on arrival.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between bg-muted/40 px-3 py-2 rounded">
              <div className="text-sm">
                <span className="font-medium">{trancheSummary.lineCount}</span> line(s),{" "}
                <span className="font-medium">{trancheSummary.qty}</span> units,{" "}
                <span className="font-medium">{fmt(trancheSummary.value)}</span> at cost
              </div>
              <Button
                onClick={submit}
                disabled={submitting || trancheSummary.lineCount === 0 || !aliaxisId}
              >
                {submitting
                  ? (editingId ? "Saving…" : "Creating…")
                  : (editingId ? "Save changes + regenerate PDF" : "Create call-off + generate PDF")}
              </Button>
            </div>

            {error && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-200 px-3 py-2 rounded">
                {error}
              </div>
            )}
            {!aliaxisId && (
              <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 px-3 py-2 rounded">
                Aliaxis supplier record missing. Create it in /suppliers before raising call-offs.
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Existing call-offs */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Call-offs to date {callOffs.length > 0 && `(${callOffs.length})`}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {callOffs.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">
              No call-offs raised yet. Click <strong>New call-off</strong> above to send the first
              tranche to Aliaxis.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>PO No.</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Issued</TableHead>
                  <TableHead>Delivery exp.</TableHead>
                  <TableHead className="text-right">Lines</TableHead>
                  <TableHead className="text-right">Value (cost)</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-48 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {callOffs.map((co) => (
                  <TableRow key={co.id}>
                    <TableCell className="font-mono text-xs">{co.poNo}</TableCell>
                    <TableCell>{co.supplier}</TableCell>
                    <TableCell>
                      {co.issuedAt
                        ? new Date(co.issuedAt).toLocaleDateString("en-GB")
                        : "—"}
                    </TableCell>
                    <TableCell>
                      {co.deliveryDateExpected
                        ? new Date(co.deliveryDateExpected).toLocaleDateString("en-GB")
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{co.lineCount}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmt(co.totalCostExpected)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={co.status === "DRAFT" ? "secondary" : "default"}>
                        {co.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 justify-end">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => startEdit(co)}
                          disabled={co.status !== "DRAFT"}
                          title={co.status !== "DRAFT" ? "Only DRAFT call-offs can be edited" : "Edit"}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                        {co.status === "DRAFT" && (
                          <Button size="sm" variant="outline" onClick={() => issuePo(co.id)}>
                            <Send className="size-3.5 mr-1" /> Issue
                          </Button>
                        )}
                        <a
                          href={`/api/procurement-orders/${co.id}/generate-pdf`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline"
                        >
                          <FileText className="size-3.5" /> PDF
                        </a>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryStat({
  label,
  value,
  sub,
  highlight,
}: {
  label: string;
  value: string;
  sub?: string;
  highlight?: "ok" | "warn";
}) {
  const colour =
    highlight === "ok"
      ? "text-emerald-700"
      : highlight === "warn"
      ? "text-amber-700"
      : "text-foreground";
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`text-xl font-semibold tabular-nums ${colour}`}>{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
      </CardContent>
    </Card>
  );
}
