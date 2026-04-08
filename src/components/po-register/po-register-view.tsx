"use client";

import { useState, Fragment } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Pencil,
  ChevronDown,
  ChevronRight,
  FileBarChart,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { LabourDrawdownTable } from "./labour-drawdown-table";
import { MaterialsDrawdownTable } from "./materials-drawdown-table";

type Decimal = { toString(): string } | string | number | null;

function n(val: Decimal): number {
  if (val === null || val === undefined) return 0;
  return Number(val.toString());
}

function fmt(val: Decimal): string {
  if (val === null || val === undefined) return "\u2014";
  return Number(val.toString()).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

type CustomerPOData = {
  id: string;
  poNo: string;
  poType: string;
  poDate: string | Date | null;
  status: string;
  totalValue: Decimal;
  poLimitValue: Decimal;
  poCommittedValue: Decimal;
  poConsumedValue: Decimal;
  poRemainingValue: Decimal;
  overheadPct: Decimal;
  weekdaySellRate: Decimal;
  weekendSellRate: Decimal;
  weekdayCostRate: Decimal;
  weekendCostRate: Decimal;
  profitToDate: Decimal;
  notes: string | null;
  customer: { id: string; name: string };
  site: { id: string; siteName: string } | null;
  ticket: { id: string; title: string } | null;
  lines: any[];
  labourDrawdowns: any[];
  materialsDrawdowns: any[];
  cashPayments: any[];
  _count: { labourDrawdowns: number; materialsDrawdowns: number };
};

type CustomerOption = { id: string; name: string };
type SiteOption = { id: string; siteName: string };
type TicketOption = { id: string; title: string; payingCustomerId?: string; siteId?: string | null };
type ContactOption = { id: string; fullName: string };
type CommercialLink = { id: string; customerId: string; siteId: string; site: { id: string; siteName: string } };

function poTypeBadge(poType: string) {
  switch (poType) {
    case "STANDARD_FIXED":
      return <Badge variant="outline">Standard</Badge>;
    case "DRAWDOWN_LABOUR":
      return <Badge variant="secondary">Labour DD</Badge>;
    case "DRAWDOWN_MATERIALS":
      return <Badge variant="default">Materials DD</Badge>;
    default:
      return <Badge variant="outline">{poType}</Badge>;
  }
}

function statusBadge(status: string) {
  switch (status) {
    case "RECEIVED":
      return <Badge variant="outline">Received</Badge>;
    case "ACTIVE":
      return <Badge variant="default">Active</Badge>;
    case "EXHAUSTED":
      return <Badge variant="destructive">Exhausted</Badge>;
    case "CLOSED":
      return <Badge variant="secondary">Closed</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function utilisationColor(pct: number): string {
  if (pct > 90) return "bg-[#FF3333]";
  if (pct > 75) return "bg-[#FF9900]";
  return "bg-[#00CC66]";
}

export function PORegisterView({
  customerPOs,
  customers,
  sites,
  tickets,
  contacts,
  commercialLinks = [],
}: {
  customerPOs: CustomerPOData[];
  customers: CustomerOption[];
  sites: SiteOption[];
  tickets: TicketOption[];
  contacts: ContactOption[];
  commercialLinks?: CommercialLink[];
}) {
  const router = useRouter();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filterType, setFilterType] = useState("ALL");
  const [filterCustomer, setFilterCustomer] = useState("ALL");
  const [filterStatus, setFilterStatus] = useState("ALL");

  const [ledgerOpen, setLedgerOpen] = useState(false);

  // Add PO sheet state
  const [addOpen, setAddOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [poType, setPoType] = useState("STANDARD_FIXED");
  const [customerId, setCustomerId] = useState("");
  const [siteId, setSiteId] = useState("");
  const [ticketId, setTicketId] = useState("");

  // Edit PO state
  const [editPO, setEditPO] = useState<CustomerPOData | null>(null);
  const [editPoType, setEditPoType] = useState("");
  const [editStatus, setEditStatus] = useState("");
  const [editSiteId, setEditSiteId] = useState("");
  const [editTicketId, setEditTicketId] = useState("");
  const [editSubmitting, setEditSubmitting] = useState(false);

  async function handleEditPO(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editPO) return;
    setEditSubmitting(true);
    const fd = new FormData(e.currentTarget);
    const body: Record<string, unknown> = {
      poNo: fd.get("poNo") as string,
      poType: editPoType,
      status: editStatus,
      siteId: editSiteId || undefined,
      ticketId: editTicketId || undefined,
      poLimitValue: Number(fd.get("poLimitValue")) || undefined,
      totalValue: Number(fd.get("totalValue")) || undefined,
      weekdaySellRate: Number(fd.get("weekdaySellRate")) || undefined,
      weekendSellRate: Number(fd.get("weekendSellRate")) || undefined,
      weekdayCostRate: Number(fd.get("weekdayCostRate")) || undefined,
      weekendCostRate: Number(fd.get("weekendCostRate")) || undefined,
      overheadPct: Number(fd.get("overheadPct")) || undefined,
      notes: (fd.get("notes") as string) || undefined,
    };
    try {
      const res = await fetch(`/api/customer-pos/${editPO.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setEditPO(null);
        router.refresh();
      }
    } finally {
      setEditSubmitting(false);
    }
  }

  function printGlobalPlumberStatement() {
    // Combine all labour entries across all POs, grouped by PO ref
    const allEntries: Array<{ poNo: string; siteName: string; workDate: string; dayType: string; daysWorked: number; plumberCount: number; costRate: number; costTotal: number; plumberName: string }> = [];
    const allPayments: Array<{ paymentDate: string; amount: number; reference: string; poNo: string }> = [];
    let totalEarned = 0;
    let totalPaidGlobal = 0;

    for (const po of customerPOs) {
      if (po.poType !== "DRAWDOWN_LABOUR") continue;
      for (const e of po.labourDrawdowns) {
        if (e.status === "ADVANCE_BILLED") continue;
        const cost = Number(e.internalCostValue) || 0;
        totalEarned += cost;
        allEntries.push({
          poNo: po.poNo,
          siteName: po.site?.siteName || "—",
          workDate: new Date(e.workDate).toLocaleDateString("en-GB"),
          dayType: e.dayType === "WEEKEND" ? "Weekend" : "Weekday",
          daysWorked: Number(e.daysWorked) || 0,
          plumberCount: e.plumberCount || 1,
          costRate: Number(e.internalDayCost) || 0,
          costTotal: cost,
          plumberName: e.plumberContact?.fullName || "—",
        });
      }
      for (const p of (po.cashPayments || [])) {
        if (p.payeeType !== "PLUMBER") continue;
        const amt = Number(p.amount) || 0;
        totalPaidGlobal += amt;
        allPayments.push({
          paymentDate: new Date(p.paymentDate).toLocaleDateString("en-GB"),
          amount: amt,
          reference: p.reference || "Cash",
          poNo: po.poNo,
        });
      }
    }

    // Sort entries by date
    allEntries.sort((a, b) => {
      const da = a.workDate.split("/").reverse().join("");
      const db = b.workDate.split("/").reverse().join("");
      return da.localeCompare(db);
    });
    allPayments.sort((a, b) => {
      const da = a.paymentDate.split("/").reverse().join("");
      const db = b.paymentDate.split("/").reverse().join("");
      return da.localeCompare(db);
    });

    const owing = totalEarned - totalPaidGlobal;

    // Build a combined ledger: interleave work and payments by date, with running balance
    type LedgerRow = { date: string; sortKey: string; type: "work" | "payment"; desc: string; ref: string; debit: number; credit: number };
    const ledger: LedgerRow[] = [];

    for (const e of allEntries) {
      const parts = e.workDate.split("/");
      ledger.push({
        date: e.workDate,
        sortKey: parts[2] + parts[1] + parts[0],
        type: "work",
        desc: `${e.daysWorked} day${e.daysWorked !== 1 ? "s" : ""} × ${e.plumberCount} plumber${e.plumberCount !== 1 ? "s" : ""} @ £${e.costRate.toFixed(2)}`,
        ref: `${e.poNo} — ${e.siteName}`,
        debit: e.costTotal,
        credit: 0,
      });
    }
    for (const p of allPayments) {
      const parts = p.paymentDate.split("/");
      ledger.push({
        date: p.paymentDate,
        sortKey: parts[2] + parts[1] + parts[0],
        type: "payment",
        desc: `Payment — ${p.reference}`,
        ref: p.poNo,
        debit: 0,
        credit: p.amount,
      });
    }
    ledger.sort((a, b) => a.sortKey.localeCompare(b.sortKey));

    let runningBalance = 0;
    const ledgerRows = ledger.map((row) => {
      runningBalance += row.debit - row.credit;
      return `<tr${row.type === "payment" ? ' style="background:#f0fff0"' : ""}>
        <td>${row.date}</td>
        <td>${row.desc}</td>
        <td style="font-size:10px;color:#555">${row.ref}</td>
        <td style="text-align:right">${row.debit > 0 ? row.debit.toFixed(2) : ""}</td>
        <td style="text-align:right;color:green">${row.credit > 0 ? row.credit.toFixed(2) : ""}</td>
        <td style="text-align:right;font-weight:700">${runningBalance.toFixed(2)}</td>
      </tr>`;
    }).join("");

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      * { margin:0; padding:0; box-sizing:border-box; }
      body { font-family:-apple-system,'Helvetica Neue',Arial,sans-serif; padding:30px 40px; font-size:12px; color:#000; }
      h1 { font-size:18px; font-weight:800; }
      .sub { font-size:11px; color:#555; margin-top:2px; }
      hr { border:none; border-top:2px solid #000; margin:12px 0; }
      .meta { font-size:11px; margin:8px 0 16px; color:#555; }
      table { width:100%; border-collapse:collapse; } th { text-align:left; padding:6px 8px; font-size:10px; text-transform:uppercase; letter-spacing:0.5px; border-bottom:2px solid #000; font-weight:700; }
      td { padding:5px 8px; border-bottom:1px solid #ddd; font-size:11px; }
      .balance { font-size:18px; font-weight:800; margin-top:16px; padding:12px 16px; border:2px solid #000; display:inline-block; }
      .sig { margin-top:40px; display:flex; gap:60px; } .sig-box { border-top:1px solid #000; padding-top:4px; width:200px; font-size:10px; color:#555; }
      @page { margin:15mm; }
    </style></head><body>
      <h1>Cromwell Plumbing Ltd</h1>
      <div class="sub">Plumber Statement of Account</div>
      <hr />
      <div class="meta">Statement date: ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</div>
      <table>
        <thead><tr><th>Date</th><th>Description</th><th>Ref</th><th style="text-align:right">Earned (£)</th><th style="text-align:right">Paid (£)</th><th style="text-align:right">Balance (£)</th></tr></thead>
        <tbody>${ledgerRows}</tbody>
      </table>
      <div class="balance">Balance Owing: £${owing.toFixed(2)}</div>
      <div class="sig">
        <div class="sig-box">Plumber Signature</div>
        <div class="sig-box">Cromwell Plumbing</div>
      </div>
    </body></html>`;
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); w.focus(); w.print(); }
  }

  function openEditPO(po: CustomerPOData) {
    setEditPO(po);
    setEditPoType(po.poType);
    setEditStatus(po.status);
    setEditSiteId(po.site?.id || "");
    setEditTicketId(po.ticket?.id || "");
  }

  // Filter POs
  const filtered = customerPOs.filter((po) => {
    if (filterType !== "ALL" && po.poType !== filterType) return false;
    if (filterCustomer !== "ALL" && po.customer.id !== filterCustomer)
      return false;
    if (filterStatus !== "ALL" && po.status !== filterStatus) return false;
    return true;
  });

  // Summary calculations
  const totalPOValue = filtered.reduce(
    (s, po) => s + n(po.poLimitValue ?? po.totalValue),
    0
  );
  const totalConsumed = filtered.reduce((s, po) => s + n(po.poConsumedValue), 0);
  const totalRemaining = filtered.reduce(
    (s, po) => s + n(po.poRemainingValue),
    0
  );
  const totalProfit = filtered.reduce((s, po) => s + n(po.profitToDate), 0);

  async function handleAddPO(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    const form = e.currentTarget;
    const formData = new FormData(form);

    const body: Record<string, unknown> = {
      poNo: formData.get("poNo") as string,
      poType,
      customerId,
      siteId: siteId || undefined,
      ticketId: ticketId || undefined,
      poDate: (formData.get("poDate") as string) || undefined,
      totalValue: Number(formData.get("totalValue")) || undefined,
      poLimitValue: Number(formData.get("poLimitValue")) || undefined,
      overheadPct: Number(formData.get("overheadPct")) || 10,
      notes: (formData.get("notes") as string) || undefined,
    };

    if (poType === "DRAWDOWN_LABOUR") {
      body.weekdaySellRate =
        Number(formData.get("weekdaySellRate")) || 450;
      body.weekendSellRate =
        Number(formData.get("weekendSellRate")) || 675;
      body.weekdayCostRate =
        Number(formData.get("weekdayCostRate")) || 250;
      body.weekendCostRate =
        Number(formData.get("weekendCostRate")) || 375;
    }

    try {
      const res = await fetch("/api/customer-pos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        form.reset();
        setAddOpen(false);
        setPoType("STANDARD_FIXED");
        setCustomerId("");
        setSiteId("");
        setTicketId("");
        router.refresh();
      }
    } finally {
      setSubmitting(false);
    }
  }

  function toggleExpand(id: string) {
    setExpandedId((prev) => (prev === id ? null : id));
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <FileBarChart className="size-6 text-[#888888]" />
          <h1 className="text-[11px] uppercase tracking-widest text-[#888888] font-bold">
            PO Register
          </h1>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={printGlobalPlumberStatement}>
            Plumber Statement
          </Button>
          <Sheet open={addOpen} onOpenChange={setAddOpen}>
            <SheetTrigger
              render={
                <Button size="sm">
                  <Plus className="size-4 mr-1" />
                  Add PO
                </Button>
              }
            />
          <SheetContent side="right">
            <SheetHeader>
              <SheetTitle>Add Customer PO</SheetTitle>
              <SheetDescription>
                Create a new purchase order in the register.
              </SheetDescription>
            </SheetHeader>
            <form
              onSubmit={handleAddPO}
              className="flex flex-col gap-4 px-4 flex-1 overflow-y-auto"
            >
              <div className="space-y-1.5">
                <Label htmlFor="poNo">PO Number *</Label>
                <Input
                  id="poNo"
                  name="poNo"
                  required
                  placeholder="e.g. PO-2026-001"
                />
              </div>

              <div className="space-y-1.5">
                <Label>PO Type *</Label>
                <Select
                  value={poType}
                  onValueChange={(v) => setPoType(v ?? "STANDARD_FIXED")}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="STANDARD_FIXED">
                      Standard Fixed
                    </SelectItem>
                    <SelectItem value="DRAWDOWN_LABOUR">
                      Labour Drawdown
                    </SelectItem>
                    <SelectItem value="DRAWDOWN_MATERIALS">
                      Materials Drawdown
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Customer *</Label>
                <Select
                  value={customerId}
                  onValueChange={(v) => {
                    const newId = v ?? "";
                    setCustomerId(newId);
                    setSiteId("");
                    setTicketId("");
                    // Auto-select site if customer has exactly one linked site
                    const linked = commercialLinks.filter((cl) => cl.customerId === newId);
                    if (linked.length === 1) setSiteId(linked[0].siteId);
                    // Auto-select ticket if customer has exactly one ticket
                    const custTickets = tickets.filter((t) => t.payingCustomerId === newId);
                    if (custTickets.length === 1) setTicketId(custTickets[0].id);
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select customer" />
                  </SelectTrigger>
                  <SelectContent>
                    {customers.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Site</Label>
                {(() => {
                  // Filter sites by commercial link when customer is selected
                  const linkedSites = customerId
                    ? commercialLinks
                        .filter((cl) => cl.customerId === customerId)
                        .map((cl) => cl.site)
                    : sites;
                  const hasSites = linkedSites.length > 0;
                  return (
                    <Select
                      value={siteId}
                      onValueChange={(v) => setSiteId(v ?? "")}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder={customerId && !hasSites ? "No linked sites" : "Select site"} />
                      </SelectTrigger>
                      <SelectContent>
                        {linkedSites.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.siteName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  );
                })()}
                {customerId && commercialLinks.filter((cl) => cl.customerId === customerId).length === 0 && (
                  <p className="text-[10px] text-[#FF9900]">No commercial links found for this customer.</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label>Ticket</Label>
                <Select
                  value={ticketId}
                  onValueChange={(v) => setTicketId(v ?? "")}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select ticket (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    {(customerId
                      ? tickets.filter((t) => t.payingCustomerId === customerId)
                      : tickets
                    ).map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="poDate">PO Date</Label>
                <Input id="poDate" name="poDate" type="date" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="totalValue">Total Value</Label>
                  <Input
                    id="totalValue"
                    name="totalValue"
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="poLimitValue">PO Limit Value</Label>
                  <Input
                    id="poLimitValue"
                    name="poLimitValue"
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="overheadPct">Overhead %</Label>
                <Input
                  id="overheadPct"
                  name="overheadPct"
                  type="number"
                  step="0.01"
                  defaultValue="10"
                />
              </div>

              {poType === "DRAWDOWN_LABOUR" && (
                <div className="space-y-3 border border-[#333333] p-3">
                  <p className="text-sm font-medium">Labour Rates</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="weekdaySellRate">Weekday Sell</Label>
                      <Input
                        id="weekdaySellRate"
                        name="weekdaySellRate"
                        type="number"
                        step="0.01"
                        defaultValue="450"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="weekendSellRate">Weekend Sell</Label>
                      <Input
                        id="weekendSellRate"
                        name="weekendSellRate"
                        type="number"
                        step="0.01"
                        defaultValue="675"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="weekdayCostRate">Weekday Cost</Label>
                      <Input
                        id="weekdayCostRate"
                        name="weekdayCostRate"
                        type="number"
                        step="0.01"
                        defaultValue="250"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="weekendCostRate">Weekend Cost</Label>
                      <Input
                        id="weekendCostRate"
                        name="weekendCostRate"
                        type="number"
                        step="0.01"
                        defaultValue="375"
                      />
                    </div>
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="notes">Notes</Label>
                <Textarea
                  id="notes"
                  name="notes"
                  placeholder="Additional notes..."
                />
              </div>

              <SheetFooter>
                <Button type="submit" disabled={submitting || !customerId}>
                  {submitting ? "Creating..." : "Create PO"}
                </Button>
              </SheetFooter>
            </form>
          </SheetContent>
          </Sheet>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-[#888888] uppercase tracking-wide">
              Total PO Value
            </p>
            <p className="text-2xl font-semibold tabular-nums mt-1">
              {fmt(totalPOValue)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-[#888888] uppercase tracking-wide">
              Total Consumed
            </p>
            <p className="text-2xl font-semibold tabular-nums mt-1">
              {fmt(totalConsumed)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-[#888888] uppercase tracking-wide">
              Total Remaining
            </p>
            <p className="text-2xl font-semibold tabular-nums mt-1">
              {fmt(totalRemaining)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-[#888888] uppercase tracking-wide">
              Total Profit to Date
            </p>
            <p
              className={`text-2xl font-semibold tabular-nums mt-1 ${
                totalProfit >= 0 ? "text-[#00CC66]" : "text-[#FF3333]"
              }`}
            >
              {fmt(totalProfit)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Global Plumber Account */}
      {(() => {
        let globalEarned = 0;
        let globalOverhead = 0;
        let globalPlumberPaid = 0;
        let globalOverheadPaid = 0;
        const ledgerItems: Array<{ date: string; sortKey: string; desc: string; ref: string; earned: number; paid: number }> = [];

        for (const po of customerPOs) {
          if (po.poType !== "DRAWDOWN_LABOUR") continue;
          for (const e of po.labourDrawdowns) {
            if (e.status === "ADVANCE_BILLED") continue;
            const cost = Number(e.internalCostValue) || 0;
            const oh = Number(e.overheadValue) || 0;
            globalEarned += cost;
            globalOverhead += oh;
            const d = new Date(e.workDate);
            const ds = d.toLocaleDateString("en-GB");
            const sk = d.toISOString().slice(0, 10).replace(/-/g, "");
            ledgerItems.push({ date: ds, sortKey: sk, desc: `${n(e.daysWorked)} day × £${n(e.internalDayCost).toFixed(0)}`, ref: po.poNo, earned: cost, paid: 0 });
          }
          for (const p of (po.cashPayments || [])) {
            const amt = Number(p.amount) || 0;
            if (p.payeeType === "PLUMBER") globalPlumberPaid += amt;
            else globalOverheadPaid += amt;
            const d = new Date(p.paymentDate);
            const ds = d.toLocaleDateString("en-GB");
            const sk = d.toISOString().slice(0, 10).replace(/-/g, "");
            ledgerItems.push({ date: ds, sortKey: sk, desc: `Payment — ${p.payee}${p.reference ? ` (${p.reference})` : ""}`, ref: po.poNo, earned: 0, paid: amt });
          }
        }
        ledgerItems.sort((a, b) => a.sortKey.localeCompare(b.sortKey));

        const plumberOwing = globalEarned - globalPlumberPaid;
        const overheadOwing = globalOverhead - globalOverheadPaid;

        if (globalEarned === 0 && globalPlumberPaid === 0) return null;

        return (
          <div className="border border-[#333333] bg-[#1A1A1A] p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-[11px] uppercase tracking-widest text-[#3399FF] font-bold">Plumber Account — All POs</h2>
              <Button size="sm" variant="outline" onClick={printGlobalPlumberStatement} className="h-7 text-[10px]">
                Print Statement
              </Button>
            </div>
            <div className="grid grid-cols-5 gap-3 text-center">
              <div className="border border-[#333333] bg-[#111111] p-2">
                <p className="text-[10px] text-[#888888] uppercase">Total Earned</p>
                <p className="text-lg font-semibold tabular-nums">{fmt(globalEarned)}</p>
              </div>
              <div className="border border-[#333333] bg-[#111111] p-2">
                <p className="text-[10px] text-[#888888] uppercase">Total Paid</p>
                <p className="text-lg font-semibold tabular-nums text-[#00CC66]">{fmt(globalPlumberPaid)}</p>
              </div>
              <div className="border border-[#333333] bg-[#111111] p-2">
                <p className="text-[10px] text-[#FF9900] uppercase font-bold">Plumber Owing</p>
                <p className={`text-lg font-semibold tabular-nums ${plumberOwing > 0 ? "text-[#FF9900]" : "text-[#00CC66]"}`}>{fmt(plumberOwing)}</p>
              </div>
              <div className="border border-[#333333] bg-[#111111] p-2">
                <p className="text-[10px] text-[#888888] uppercase">Overhead Total</p>
                <p className="text-lg font-semibold tabular-nums">{fmt(globalOverhead)}</p>
              </div>
              <div className="border border-[#333333] bg-[#111111] p-2">
                <p className="text-[10px] text-[#888888] uppercase">Overhead Owing</p>
                <p className={`text-lg font-semibold tabular-nums ${overheadOwing > 0 ? "text-[#FF9900]" : "text-[#00CC66]"}`}>{fmt(overheadOwing)}</p>
              </div>
            </div>
            {/* Running ledger */}
            <button onClick={() => setLedgerOpen(!ledgerOpen)} className="text-xs text-[#888888] hover:text-[#FF6600] cursor-pointer">
              {ledgerOpen ? "▼" : "▶"} Running ledger ({ledgerItems.length} entries)
            </button>
            {ledgerOpen && (
              <div className="mt-2 max-h-[300px] overflow-y-auto border border-[#333333]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>PO Ref</TableHead>
                      <TableHead className="text-right">Earned</TableHead>
                      <TableHead className="text-right">Paid</TableHead>
                      <TableHead className="text-right">Balance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(() => {
                      let bal = 0;
                      return ledgerItems.map((row, i) => {
                        bal += row.earned - row.paid;
                        return (
                          <TableRow key={i} className={row.paid > 0 ? "bg-[#00CC66]/5" : ""}>
                            <TableCell className="tabular-nums text-xs">{row.date}</TableCell>
                            <TableCell className="text-xs">{row.desc}</TableCell>
                            <TableCell className="text-[10px] text-[#888888]">{row.ref}</TableCell>
                            <TableCell className="text-right tabular-nums text-xs">{row.earned > 0 ? fmt(row.earned) : ""}</TableCell>
                            <TableCell className="text-right tabular-nums text-xs text-[#00CC66]">{row.paid > 0 ? fmt(row.paid) : ""}</TableCell>
                            <TableCell className="text-right tabular-nums text-xs font-medium">{fmt(bal)}</TableCell>
                          </TableRow>
                        );
                      });
                    })()}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        );
      })()}

      {/* Filters */}
      <div className="flex items-center gap-3">
        <Select
          value={filterType}
          onValueChange={(v) => setFilterType(v ?? "ALL")}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="PO Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Types</SelectItem>
            <SelectItem value="STANDARD_FIXED">Standard</SelectItem>
            <SelectItem value="DRAWDOWN_LABOUR">Labour Drawdown</SelectItem>
            <SelectItem value="DRAWDOWN_MATERIALS">
              Materials Drawdown
            </SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={filterCustomer}
          onValueChange={(v) => setFilterCustomer(v ?? "ALL")}
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Customer" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Customers</SelectItem>
            {customers.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filterStatus}
          onValueChange={(v) => setFilterStatus(v ?? "ALL")}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Statuses</SelectItem>
            <SelectItem value="RECEIVED">Received</SelectItem>
            <SelectItem value="ACTIVE">Active</SelectItem>
            <SelectItem value="EXHAUSTED">Exhausted</SelectItem>
            <SelectItem value="CLOSED">Closed</SelectItem>
          </SelectContent>
        </Select>

        <span className="text-sm text-[#888888] ml-auto">
          {filtered.length} PO{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* PO Table */}
      <div className="border border-[#333333] bg-[#1A1A1A]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>PO No</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Customer</TableHead>
              <TableHead>Site</TableHead>
              <TableHead>Ticket</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">PO Limit</TableHead>
              <TableHead className="text-right">Sell Used</TableHead>
              <TableHead className="text-right">Cost Used</TableHead>
              <TableHead className="text-right">Overhead</TableHead>
              <TableHead className="text-right">Profit</TableHead>
              <TableHead className="text-right">Remaining</TableHead>
              <TableHead className="w-[120px]">Utilisation</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={14}
                  className="text-center py-8 text-[#888888]"
                >
                  No purchase orders found.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((po) => {
                const isExpanded = expandedId === po.id;
                const limit = n(po.poLimitValue ?? po.totalValue);
                const consumed = n(po.poConsumedValue);
                const committed = n(po.poCommittedValue);
                const remaining = n(po.poRemainingValue);
                const profit = n(po.profitToDate);
                const utilPct = limit > 0 ? (consumed / limit) * 100 : 0;

                // Calculate overhead from drawdowns
                const labourOverhead = po.labourDrawdowns.reduce(
                  (s: number, d: any) => s + n(d.overheadValue),
                  0
                );
                const materialsOverhead = po.materialsDrawdowns.reduce(
                  (s: number, d: any) => s + n(d.overheadValue),
                  0
                );
                const totalOverhead = labourOverhead + materialsOverhead;

                // Cost used from drawdowns
                const labourCost = po.labourDrawdowns.reduce(
                  (s: number, d: any) => s + n(d.internalCostValue),
                  0
                );
                const materialsCost = po.materialsDrawdowns.reduce(
                  (s: number, d: any) => s + n(d.costValueActual),
                  0
                );
                const totalCostUsed = labourCost + materialsCost;

                const sellUsed =
                  po.poType === "STANDARD_FIXED" ? committed : consumed;

                return (
                  <Fragment key={po.id}>
                    <TableRow
                      className="cursor-pointer hover:bg-[#222222]"
                      onClick={() => toggleExpand(po.id)}
                    >
                      <TableCell className="px-2">
                        <div className="flex items-center gap-1">
                          {isExpanded ? (
                            <ChevronDown className="size-4 text-[#888888]" />
                          ) : (
                            <ChevronRight className="size-4 text-[#888888]" />
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-5 w-5 p-0"
                            onClick={(e) => { e.stopPropagation(); openEditPO(po); }}
                          >
                            <Pencil className="size-3" />
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell className="font-medium">{po.poNo}</TableCell>
                      <TableCell>{poTypeBadge(po.poType)}</TableCell>
                      <TableCell className="max-w-[120px] truncate">
                        {po.customer.name}
                      </TableCell>
                      <TableCell className="max-w-[100px] truncate text-[#888888]">
                        {po.site?.siteName || "\u2014"}
                      </TableCell>
                      <TableCell className="max-w-[120px] truncate text-[#888888]">
                        {po.ticket?.title || "\u2014"}
                      </TableCell>
                      <TableCell>{statusBadge(po.status)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmt(limit)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmt(sellUsed)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmt(totalCostUsed)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmt(totalOverhead)}
                      </TableCell>
                      <TableCell
                        className={`text-right tabular-nums font-medium ${
                          profit >= 0 ? "text-[#00CC66]" : "text-[#FF3333]"
                        }`}
                      >
                        {fmt(profit)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmt(remaining)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-full bg-[#333333]">
                            <div
                              className={`h-full transition-all ${utilisationColor(
                                utilPct
                              )}`}
                              style={{
                                width: `${Math.min(utilPct, 100)}%`,
                              }}
                            />
                          </div>
                          <span className="text-xs tabular-nums text-[#888888] w-10 text-right">
                            {utilPct.toFixed(0)}%
                          </span>
                        </div>
                      </TableCell>
                    </TableRow>

                    {isExpanded && (
                      <TableRow>
                        <TableCell colSpan={14} className="p-4 bg-[#1A1A1A]">
                          <ExpandedPODetail
                            po={po}
                            contacts={contacts}
                            tickets={tickets}
                            sites={sites}
                            commercialLinks={commercialLinks}
                          />
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Edit PO Sheet */}
      <Sheet open={!!editPO} onOpenChange={(open) => { if (!open) setEditPO(null); }}>
        <SheetContent side="right">
          <SheetHeader>
            <SheetTitle>Edit PO — {editPO?.poNo}</SheetTitle>
            <SheetDescription>Update purchase order details.</SheetDescription>
          </SheetHeader>
          {editPO && (
            <form onSubmit={handleEditPO} className="flex flex-col gap-4 px-4 flex-1 overflow-y-auto">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>PO Number *</Label>
                  <Input name="poNo" required defaultValue={editPO.poNo} />
                </div>
                <div className="space-y-1.5">
                  <Label>Status</Label>
                  <Select value={editStatus} onValueChange={(v) => setEditStatus(v ?? "")}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="RECEIVED">Received</SelectItem>
                      <SelectItem value="ACTIVE">Active</SelectItem>
                      <SelectItem value="EXHAUSTED">Exhausted</SelectItem>
                      <SelectItem value="CLOSED">Closed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>PO Type</Label>
                <Select value={editPoType} onValueChange={(v) => setEditPoType(v ?? "")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="STANDARD_FIXED">Standard / Fixed</SelectItem>
                    <SelectItem value="DRAWDOWN_LABOUR">Labour Drawdown</SelectItem>
                    <SelectItem value="DRAWDOWN_MATERIALS">Materials Drawdown</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Site</Label>
                <Select value={editSiteId} onValueChange={(v) => setEditSiteId(v ?? "")}>
                  <SelectTrigger><SelectValue placeholder="Select site" /></SelectTrigger>
                  <SelectContent>
                    {sites.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.siteName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Ticket</Label>
                <Select value={editTicketId} onValueChange={(v) => setEditTicketId(v ?? "")}>
                  <SelectTrigger><SelectValue placeholder="Select ticket" /></SelectTrigger>
                  <SelectContent>
                    {tickets.map((t) => (
                      <SelectItem key={t.id} value={t.id}>{t.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>PO Limit (£)</Label>
                  <Input name="poLimitValue" type="number" step="0.01" defaultValue={n(editPO.poLimitValue) || ""} />
                </div>
                <div className="space-y-1.5">
                  <Label>Total Value (£)</Label>
                  <Input name="totalValue" type="number" step="0.01" defaultValue={n(editPO.totalValue) || ""} />
                </div>
              </div>
              {(editPoType === "DRAWDOWN_LABOUR") && (
                <>
                  <p className="text-[10px] uppercase tracking-wide text-[#888888] font-bold">Day Rates</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>Weekday Sell (£)</Label>
                      <Input name="weekdaySellRate" type="number" step="0.01" defaultValue={n(editPO.weekdaySellRate) || 450} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Weekend Sell (£)</Label>
                      <Input name="weekendSellRate" type="number" step="0.01" defaultValue={n(editPO.weekendSellRate) || 675} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>Weekday Cost (£)</Label>
                      <Input name="weekdayCostRate" type="number" step="0.01" defaultValue={n(editPO.weekdayCostRate) || 250} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Weekend Cost (£)</Label>
                      <Input name="weekendCostRate" type="number" step="0.01" defaultValue={n(editPO.weekendCostRate) || 375} />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Overhead %</Label>
                    <Input name="overheadPct" type="number" step="0.1" defaultValue={n(editPO.overheadPct) || 10} />
                  </div>
                </>
              )}
              <div className="space-y-1.5">
                <Label>Notes</Label>
                <Input name="notes" defaultValue={editPO.notes || ""} />
              </div>
              <SheetFooter>
                <Button type="submit" disabled={editSubmitting} className="bg-[#FF6600] text-black hover:bg-[#CC5500]">
                  {editSubmitting ? "Saving..." : "Save Changes"}
                </Button>
              </SheetFooter>
            </form>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function ExpandedPODetail({
  po,
  contacts,
  tickets,
  sites,
  commercialLinks = [],
}: {
  po: CustomerPOData;
  contacts: ContactOption[];
  tickets: TicketOption[];
  sites: SiteOption[];
  commercialLinks?: CommercialLink[];
}) {
  if (po.poType === "STANDARD_FIXED") {
    return (
      <div className="space-y-3">
        <h3 className="text-sm font-medium">
          PO Lines ({po.lines.length})
        </h3>
        {po.lines.length === 0 ? (
          <p className="text-sm text-[#888888]">No PO lines.</p>
        ) : (
          <div className="border border-[#333333] bg-[#1A1A1A]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Agreed Unit</TableHead>
                  <TableHead className="text-right">Agreed Total</TableHead>
                  <TableHead className="text-right">Consumed Qty</TableHead>
                  <TableHead className="text-right">Consumed Value</TableHead>
                  <TableHead className="text-right">Remaining</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {po.lines.map((line: any) => (
                  <TableRow key={line.id}>
                    <TableCell className="max-w-[200px] truncate">
                      {line.description}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmt(line.qty)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmt(line.agreedUnitPrice)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmt(line.agreedTotal)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmt(line.consumedQty)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmt(line.consumedValue)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmt(line.remainingValue)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    );
  }

  if (po.poType === "DRAWDOWN_LABOUR") {
    return (
      <LabourDrawdownTable
        poId={po.id}
        poNo={po.poNo}
        customerName={po.customer.name}
        siteName={po.site?.siteName || ""}
        poCustomerId={po.customer.id}
        poSiteId={po.site?.id || null}
        poLimitValue={n(po.poLimitValue)}
        entries={po.labourDrawdowns}
        contacts={contacts}
        tickets={tickets}
        sites={sites}
        commercialLinks={commercialLinks}
        weekdaySellRate={n(po.weekdaySellRate) || 450}
        weekendSellRate={n(po.weekendSellRate) || 675}
        weekdayCostRate={n(po.weekdayCostRate) || 250}
        weekendCostRate={n(po.weekendCostRate) || 375}
        overheadPct={n(po.overheadPct) || 10}
        cashPayments={po.cashPayments || []}
      />
    );
  }

  if (po.poType === "DRAWDOWN_MATERIALS") {
    return (
      <MaterialsDrawdownTable
        poId={po.id}
        entries={po.materialsDrawdowns}
        tickets={tickets}
      />
    );
  }

  return null;
}
