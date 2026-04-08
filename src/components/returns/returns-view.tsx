"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, FileText, Trash2, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter,
} from "@/components/ui/sheet";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";

type Decimal = { toString(): string } | string | number | null;
function dec(val: Decimal): string {
  if (val === null || val === undefined) return "—";
  return Number(val.toString()).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

type ReturnData = {
  id: string;
  ticketId: string;
  supplierId: string;
  returnDate: string;
  status: string;
  notes: string | null;
  supplier: { id: string; name: string };
  ticket: { id: string; title: string };
  lines: Array<{
    id: string;
    qtyReturned: Decimal;
    expectedCredit: Decimal;
    actualCredit: Decimal;
    status: string;
    ticketLine: { id: string; description: string; qty: Decimal; unit: string } | null;
  }>;
};

type SupplierOption = { id: string; name: string };
type TicketOption = { id: string; title: string };
type TicketLineOption = { id: string; description: string; qty: Decimal; unit: string; expectedCostUnit: Decimal; ticketId: string; supplierName: string | null };
type StockReturn = { id: string; description: string; qtyOnHand: Decimal; unit: string; costPerUnit: Decimal; supplierName: string | null; originBillNo: string | null };

export function ReturnsView({
  returns,
  suppliers,
  tickets,
  ticketLines,
  stockReturns,
}: {
  returns: ReturnData[];
  suppliers: SupplierOption[];
  tickets: TicketOption[];
  ticketLines: TicketLineOption[];
  stockReturns: StockReturn[];
}) {
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [ticketId, setTicketId] = useState("");
  const [returnLines, setReturnLines] = useState<Array<{ ticketLineId: string; qtyReturned: string; expectedCredit: string; reason: string }>>([
    { ticketLineId: "", qtyReturned: "", expectedCredit: "", reason: "" },
  ]);

  // Group returns by supplier
  const grouped: Record<string, { supplier: SupplierOption; returns: ReturnData[]; totalCredit: number }> = {};
  for (const ret of returns) {
    if (!grouped[ret.supplierId]) {
      grouped[ret.supplierId] = { supplier: ret.supplier, returns: [], totalCredit: 0 };
    }
    grouped[ret.supplierId].returns.push(ret);
    grouped[ret.supplierId].totalCredit += ret.lines.reduce((s, l) => s + Number(l.expectedCredit?.toString() || 0), 0);
  }

  // Available ticket lines filtered by supplier and ticket
  const availableLines = ticketLines.filter((l) => {
    if (ticketId && l.ticketId !== ticketId) return false;
    if (supplierId) {
      const sup = suppliers.find((s) => s.id === supplierId);
      if (sup && l.supplierName && !l.supplierName.toLowerCase().includes(sup.name.toLowerCase().substring(0, 5))) return false;
    }
    return true;
  });

  function addLine() {
    setReturnLines((prev) => [...prev, { ticketLineId: "", qtyReturned: "", expectedCredit: "", reason: "" }]);
  }

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!supplierId || !ticketId) return;
    setSubmitting(true);
    const fd = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/returns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticketId,
          supplierId,
          returnDate: fd.get("returnDate") || new Date().toISOString(),
          notes: fd.get("notes") || undefined,
          lines: returnLines.filter((l) => l.ticketLineId).map((l) => ({
            ticketLineId: l.ticketLineId,
            qtyReturned: Number(l.qtyReturned) || 1,
            expectedCredit: Number(l.expectedCredit) || 0,
            status: "PENDING",
          })),
        }),
      });
      if (res.ok) {
        setAddOpen(false);
        setSupplierId("");
        setTicketId("");
        setReturnLines([{ ticketLineId: "", qtyReturned: "", expectedCredit: "", reason: "" }]);
        router.refresh();
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(returnId: string) {
    if (!confirm("Delete this return?")) return;
    await fetch(`/api/returns/${returnId}`, { method: "DELETE" });
    router.refresh();
  }

  function printSupplierStatement(supId: string) {
    const group = grouped[supId];
    if (!group) return;

    const rows = group.returns.flatMap((ret) =>
      ret.lines.map((line) => `<tr>
        <td>${new Date(ret.returnDate).toLocaleDateString("en-GB")}</td>
        <td>${line.ticketLine?.description || "—"}</td>
        <td style="text-align:right">${Number(line.qtyReturned?.toString() || 0)}</td>
        <td>${line.ticketLine?.unit || "EA"}</td>
        <td style="text-align:right">${dec(line.expectedCredit)}</td>
        <td>${line.status}</td>
        <td>${ret.notes || ""}</td>
      </tr>`)
    ).join("");

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      * { margin:0; padding:0; box-sizing:border-box; }
      body { font-family:-apple-system,'Helvetica Neue',Arial,sans-serif; padding:30px 40px; font-size:12px; color:#000; }
      h1 { font-size:18px; font-weight:800; } .sub { font-size:11px; color:#555; margin-top:2px; }
      hr { border:none; border-top:2px solid #000; margin:12px 0; }
      .meta { display:flex; gap:30px; margin:12px 0 16px; font-size:11px; } .meta b { font-weight:700; }
      table { width:100%; border-collapse:collapse; } th { text-align:left; padding:6px 8px; font-size:10px; text-transform:uppercase; letter-spacing:0.5px; border-bottom:2px solid #000; font-weight:700; }
      td { padding:5px 8px; border-bottom:1px solid #ddd; font-size:11px; }
      .total { margin-top:12px; font-size:13px; font-weight:700; border-top:2px solid #000; padding-top:8px; }
      @page { margin:15mm; }
    </style></head><body>
      <h1>Cromwell Plumbing Ltd</h1>
      <div class="sub">Returns Statement</div>
      <hr />
      <div class="meta">
        <div><b>Supplier:</b> ${group.supplier.name}</div>
        <div><b>Date:</b> ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</div>
        <div><b>Returns:</b> ${group.returns.length}</div>
      </div>
      <table>
        <thead><tr><th>Date</th><th>Description</th><th style="text-align:right">Qty</th><th>Unit</th><th style="text-align:right">Credit Expected (£)</th><th>Status</th><th>Notes</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="total">Total Expected Credit: £${dec(group.totalCredit)}</div>
    </body></html>`;
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); w.focus(); w.print(); }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold tracking-wide">Returns Queue</h1>
        <Sheet open={addOpen} onOpenChange={setAddOpen}>
          <SheetTrigger render={
            <Button size="sm" className="bg-[#FF6600] text-black hover:bg-[#CC5500]">
              <Plus className="size-4 mr-1" /> New Return
            </Button>
          } />
          <SheetContent side="right">
            <SheetHeader>
              <SheetTitle>Create Return</SheetTitle>
              <SheetDescription>Log items to return to a supplier.</SheetDescription>
            </SheetHeader>
            <form onSubmit={handleCreate} className="flex flex-col gap-4 px-4 flex-1 overflow-y-auto">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Supplier *</Label>
                  <Select value={supplierId} onValueChange={(v) => setSupplierId(v ?? "")}>
                    <SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger>
                    <SelectContent>
                      {suppliers.map((s) => (<SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Ticket *</Label>
                  <Select value={ticketId} onValueChange={(v) => setTicketId(v ?? "")}>
                    <SelectTrigger><SelectValue placeholder="Select ticket" /></SelectTrigger>
                    <SelectContent>
                      {tickets.map((t) => (<SelectItem key={t.id} value={t.id}>{t.title}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Return Date</Label>
                  <Input name="returnDate" type="date" defaultValue={new Date().toISOString().split("T")[0]} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Notes to Supplier</Label>
                <Input name="notes" placeholder="e.g. Items not required — please issue credit" />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Return Lines</Label>
                  <Button type="button" size="sm" variant="outline" className="h-6 text-[10px]" onClick={addLine}>
                    <Plus className="size-3 mr-0.5" /> Add Line
                  </Button>
                </div>
                {returnLines.map((line, idx) => (
                  <div key={idx} className="border border-[#333333] p-2 space-y-2">
                    <Select value={line.ticketLineId} onValueChange={(v) => {
                      const tl = ticketLines.find((t) => t.id === v);
                      setReturnLines((prev) => {
                        const next = [...prev];
                        next[idx] = { ...next[idx], ticketLineId: v ?? "", expectedCredit: tl ? String(Number(tl.expectedCostUnit?.toString() || 0) * (Number(next[idx].qtyReturned) || Number(tl.qty?.toString() || 1))) : next[idx].expectedCredit };
                        return next;
                      });
                    }}>
                      <SelectTrigger className="w-full text-xs"><SelectValue placeholder="Select item" /></SelectTrigger>
                      <SelectContent>
                        {availableLines.map((l) => (
                          <SelectItem key={l.id} value={l.id}>
                            {l.description} ({dec(l.qty)} {l.unit})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="grid grid-cols-2 gap-2">
                      <Input placeholder="Qty" type="number" step="1" value={line.qtyReturned}
                        onChange={(e) => setReturnLines((prev) => { const n = [...prev]; n[idx] = { ...n[idx], qtyReturned: e.target.value }; return n; })} />
                      <Input placeholder="Expected credit £" type="number" step="0.01" value={line.expectedCredit}
                        onChange={(e) => setReturnLines((prev) => { const n = [...prev]; n[idx] = { ...n[idx], expectedCredit: e.target.value }; return n; })} />
                    </div>
                  </div>
                ))}
              </div>

              <SheetFooter>
                <Button type="submit" disabled={submitting || !supplierId || !ticketId} className="bg-[#FF6600] text-black hover:bg-[#CC5500]">
                  {submitting ? "Creating..." : "Create Return"}
                </Button>
              </SheetFooter>
            </form>
          </SheetContent>
        </Sheet>
      </div>

      {/* Stock items awaiting return */}
      {stockReturns.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-[11px] uppercase tracking-widest text-[#FF3333] font-bold">Stock Items Awaiting Return ({stockReturns.length})</h2>
          <div className="border border-[#FF3333]/20 bg-[#FF3333]/5">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Bill Ref</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stockReturns.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="text-sm font-medium">{item.description}</TableCell>
                    <TableCell className="text-xs">{item.supplierName || "—"}</TableCell>
                    <TableCell className="text-xs text-[#FF9900]">{item.originBillNo || "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{dec(item.qtyOnHand)}</TableCell>
                    <TableCell className="text-xs text-[#888888]">{item.unit}</TableCell>
                    <TableCell className="text-right tabular-nums">{dec(Number(item.qtyOnHand?.toString() || 0) * Number(item.costPerUnit?.toString() || 0))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Returns grouped by supplier */}
      {Object.keys(grouped).length === 0 ? (
        <div className="border border-[#333333] bg-[#1A1A1A] p-8 text-center text-[#888888]">
          <Package className="size-8 mx-auto mb-2 opacity-30" />
          No returns logged yet. Click "New Return" to start.
        </div>
      ) : (
        Object.entries(grouped).map(([supId, group]) => (
          <div key={supId} className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold">{group.supplier.name}</h2>
                <Badge variant="outline" className="text-[9px]">{group.returns.length} returns</Badge>
                <span className="text-sm tabular-nums text-[#FF9900]">£{dec(group.totalCredit)} credit expected</span>
              </div>
              <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => printSupplierStatement(supId)}>
                <FileText className="size-3 mr-1" /> Print Statement
              </Button>
            </div>
            <div className="border border-[#333333] bg-[#1A1A1A]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Item</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Credit (£)</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Notes</TableHead>
                    <TableHead className="w-8"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {group.returns.flatMap((ret) =>
                    ret.lines.map((line) => (
                      <TableRow key={line.id}>
                        <TableCell className="tabular-nums text-xs">{new Date(ret.returnDate).toLocaleDateString("en-GB")}</TableCell>
                        <TableCell className="text-sm">{line.ticketLine?.description || "—"}</TableCell>
                        <TableCell className="text-right tabular-nums">{dec(line.qtyReturned)}</TableCell>
                        <TableCell className="text-right tabular-nums text-[#FF9900]">{dec(line.expectedCredit)}</TableCell>
                        <TableCell>
                          <Badge variant={line.status === "CREDITED" ? "default" : line.status === "PENDING" ? "outline" : "destructive"} className="text-[9px]">
                            {line.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-[#888888] max-w-[150px] truncate">{ret.notes || "—"}</TableCell>
                        <TableCell>
                          <Button size="sm" variant="outline" className="h-5 w-5 p-0 text-[#888888] hover:text-[#FF3333]" onClick={() => handleDelete(ret.id)}>
                            <Trash2 className="size-3" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
