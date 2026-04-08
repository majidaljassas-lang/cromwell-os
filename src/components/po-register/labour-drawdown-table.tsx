"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, FileText, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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

type LabourEntry = {
  id: string;
  workDate: string | Date;
  plumberContact?: { id: string; fullName: string } | null;
  dayType: string;
  plumberCount: number;
  daysWorked: Decimal;
  billableDayRate: Decimal;
  billableValue: Decimal;
  internalDayCost: Decimal;
  internalCostValue: Decimal;
  overheadPct: Decimal;
  overheadValue: Decimal;
  grossProfitValue: Decimal;
  invoiceNo?: string | null;
  invoiceDate?: string | Date | null;
  status: string;
};

type ContactOption = { id: string; fullName: string };
type TicketOption = { id: string; title: string; payingCustomerId?: string };
type SiteOption = { id: string; siteName: string };
type CommercialLink = { id: string; customerId: string; siteId: string; site: { id: string; siteName: string } };
type CashPayment = { id: string; payee: string; payeeType: string; amount: Decimal; paymentDate: string | Date; paymentMethod: string; reference: string | null; notes: string | null };

export function LabourDrawdownTable({
  poId,
  poCustomerId,
  poSiteId,
  entries,
  contacts,
  tickets,
  sites,
  commercialLinks = [],
  poNo = "",
  customerName = "",
  siteName = "",
  poLimitValue = 0,
  weekdaySellRate = 450,
  weekendSellRate = 675,
  weekdayCostRate = 250,
  weekendCostRate = 375,
  overheadPct = 10,
  cashPayments = [],
}: {
  poId: string;
  poCustomerId?: string;
  poSiteId?: string | null;
  entries: LabourEntry[];
  contacts: ContactOption[];
  tickets: TicketOption[];
  sites: SiteOption[];
  commercialLinks?: CommercialLink[];
  poNo?: string;
  customerName?: string;
  siteName?: string;
  poLimitValue?: number;
  weekdaySellRate?: number;
  weekendSellRate?: number;
  weekdayCostRate?: number;
  weekendCostRate?: number;
  overheadPct?: number;
  cashPayments?: CashPayment[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [entryMode, setEntryMode] = useState<"days" | "balance">("days");
  const [dayType, setDayType] = useState("WEEKDAY");
  const [plumberCount, setPlumberCount] = useState(1);
  const [ticketId, setTicketId] = useState("");
  const [siteId, setSiteId] = useState(poSiteId || "");
  const [plumberContactId, setPlumberContactId] = useState("");
  const [hasInvoice, setHasInvoice] = useState(false);
  const [isDeliveryAgainstAdvance, setIsDeliveryAgainstAdvance] = useState(false);
  const [invoiceNo, setInvoiceNo] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [balanceAmount, setBalanceAmount] = useState("");
  const [balanceDate, setBalanceDate] = useState("");
  // Multi-date rows: each row is a work date + days worked (default 1)
  const [dateRows, setDateRows] = useState([{ workDate: "", daysWorked: 1 }]);

  function addDateRow() {
    setDateRows((prev) => [...prev, { workDate: "", daysWorked: 1 }]);
  }
  function removeDateRow(idx: number) {
    setDateRows((prev) => prev.filter((_, i) => i !== idx));
  }
  function updateDateRow(idx: number, field: string, value: string | number) {
    setDateRows((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
    // Auto-detect weekend/weekday from date
    if (field === "workDate" && value) {
      const d = new Date(value as string);
      const day = d.getUTCDay();
      setDayType(day === 0 || day === 6 ? "WEEKEND" : "WEEKDAY");
    }
  }

  // Cash payments state
  const [payOpen, setPayOpen] = useState(false);
  const [paySubmitting, setPaySubmitting] = useState(false);
  const [payeeType, setPayeeType] = useState("PLUMBER");

  async function handlePayment(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPaySubmitting(true);
    const fd = new FormData(e.currentTarget);
    try {
      const res = await fetch(`/api/customer-pos/${poId}/cash-payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payee: fd.get("payee") as string,
          payeeType,
          amount: fd.get("amount") as string,
          paymentDate: fd.get("paymentDate") as string,
          reference: fd.get("reference") as string || undefined,
          notes: fd.get("notes") as string || undefined,
        }),
      });
      if (res.ok) { setPayOpen(false); (e.target as HTMLFormElement).reset(); router.refresh(); }
    } finally { setPaySubmitting(false); }
  }

  async function handleDeletePayment(paymentId: string) {
    if (!confirm("Delete this payment?")) return;
    await fetch(`/api/customer-pos/${poId}/cash-payments?paymentId=${paymentId}`, { method: "DELETE" });
    router.refresh();
  }

  // Filter sites by commercial link for this PO's customer
  // Fall back to all sites if no commercial links exist for this customer
  const customerLinks = poCustomerId
    ? commercialLinks.filter((cl) => cl.customerId === poCustomerId)
    : [];
  const linkedSites = customerLinks.length > 0
    ? customerLinks.map((cl) => cl.site)
    : sites;
  // If the PO's site isn't in the linked list, add it so it displays correctly
  if (poSiteId && !linkedSites.find((s) => s.id === poSiteId)) {
    const poSite = sites.find((s) => s.id === poSiteId);
    if (poSite) linkedSites.unshift(poSite);
  }
  // Filter tickets by this PO's customer
  const customerTickets = poCustomerId
    ? tickets.filter((t) => t.payingCustomerId === poCustomerId)
    : tickets;

  const sellRate = dayType === "WEEKEND" ? weekendSellRate : weekdaySellRate;
  const costRate = dayType === "WEEKEND" ? weekendCostRate : weekdayCostRate;
  const totalNewDays = dateRows.reduce((s, r) => s + (Number(r.daysWorked) || 0), 0);
  const previewBillable = sellRate * totalNewDays * plumberCount;
  const previewCost = costRate * totalNewDays * plumberCount;
  const previewOverhead = previewBillable * (overheadPct / 100);
  const previewProfit = previewBillable - previewCost - previewOverhead;

  async function handleDeleteEntry(entryId: string) {
    if (!confirm("Delete this labour entry?")) return;
    await fetch(`/api/customer-pos/${poId}/labour-drawdowns?entryId=${entryId}`, { method: "DELETE" });
    router.refresh();
  }

  function printCustomerPDF() {
    const totalDays = poLimitValue > 0 && weekdaySellRate > 0 ? poLimitValue / weekdaySellRate : 0;
    const remaining = totalDays - totalDaysUsed;
    const rows = entries
      .filter((e) => e.status !== "ADVANCE_BILLED")
      .sort((a, b) => new Date(a.workDate).getTime() - new Date(b.workDate).getTime())
      .map((e) => `<tr>
        <td>${new Date(e.workDate).toLocaleDateString("en-GB")}</td>
        <td style="text-align:right">${n(e.daysWorked).toFixed(1)}</td>
        <td style="text-align:right">${e.plumberCount}</td>
        <td style="text-align:right">${fmt(e.billableValue)}</td>
        <td>${e.invoiceNo || "—"}</td>
      </tr>`).join("");

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      * { margin:0; padding:0; box-sizing:border-box; }
      body { font-family:-apple-system,'Helvetica Neue',Arial,sans-serif; padding:30px 40px; font-size:12px; color:#000; }
      h1 { font-size:18px; font-weight:800; } .sub { font-size:11px; color:#555; margin-top:2px; }
      hr { border:none; border-top:2px solid #000; margin:12px 0; }
      .meta { display:flex; gap:30px; margin:12px 0 16px; font-size:11px; } .meta b { font-weight:700; }
      table { width:100%; border-collapse:collapse; } th { text-align:left; padding:6px 8px; font-size:10px; text-transform:uppercase; letter-spacing:0.5px; border-bottom:2px solid #000; font-weight:700; }
      td { padding:5px 8px; border-bottom:1px solid #ddd; font-size:11px; } .r { text-align:right; }
      .summary { margin-top:16px; border-top:2px solid #000; padding-top:12px; display:flex; gap:40px; font-size:12px; } .summary b { font-weight:700; }
      @page { margin:15mm; }
    </style></head><body>
      <h1>Cromwell Plumbing Ltd</h1>
      <div class="sub">Labour Drawdown Statement</div>
      <hr />
      <div class="meta">
        <div><b>Customer:</b> ${customerName}</div>
        <div><b>Site:</b> ${siteName}</div>
        <div><b>PO No:</b> ${poNo}</div>
        <div><b>Date:</b> ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</div>
      </div>
      <table>
        <thead><tr><th>Date</th><th class="r">Days</th><th class="r">Plumbers</th><th class="r">Value (£)</th><th>Invoice</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="summary">
        <div><b>Days Delivered:</b> ${totalDaysUsed.toFixed(1)}</div>
        <div><b>Days Remaining:</b> ${remaining.toFixed(1)}</div>
        <div><b>Total Billed:</b> £${fmt(totalBillable)}</div>
        <div><b>PO Limit:</b> £${fmt(poLimitValue)}</div>
      </div>
    </body></html>`;
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); w.focus(); w.print(); }
  }

  function printPlumberPDF() {
    const workEntries = entries
      .filter((e) => e.status !== "ADVANCE_BILLED")
      .sort((a, b) => new Date(a.workDate).getTime() - new Date(b.workDate).getTime());
    const plumberTotalCost = workEntries.reduce((s, e) => s + n(e.internalCostValue), 0);
    const rows = workEntries
      .map((e) => `<tr>
        <td>${new Date(e.workDate).toLocaleDateString("en-GB")}</td>
        <td>${e.plumberContact?.fullName || "—"}</td>
        <td>${e.dayType === "WEEKEND" ? "Weekend" : "Weekday"}</td>
        <td style="text-align:right">${n(e.daysWorked).toFixed(1)}</td>
        <td style="text-align:right">${e.plumberCount}</td>
        <td style="text-align:right">${fmt(e.internalDayCost)}</td>
        <td style="text-align:right">${fmt(e.internalCostValue)}</td>
      </tr>`).join("");

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      * { margin:0; padding:0; box-sizing:border-box; }
      body { font-family:-apple-system,'Helvetica Neue',Arial,sans-serif; padding:30px 40px; font-size:12px; color:#000; }
      h1 { font-size:18px; font-weight:800; } .sub { font-size:11px; color:#555; margin-top:2px; }
      hr { border:none; border-top:2px solid #000; margin:12px 0; }
      .meta { display:flex; gap:30px; margin:12px 0 16px; font-size:11px; } .meta b { font-weight:700; }
      table { width:100%; border-collapse:collapse; } th { text-align:left; padding:6px 8px; font-size:10px; text-transform:uppercase; letter-spacing:0.5px; border-bottom:2px solid #000; font-weight:700; }
      td { padding:5px 8px; border-bottom:1px solid #ddd; font-size:11px; } .r { text-align:right; }
      .summary { margin-top:16px; border-top:2px solid #000; padding-top:12px; display:flex; gap:40px; font-size:12px; } .summary b { font-weight:700; }
      .sig { margin-top:40px; display:flex; gap:60px; } .sig-box { border-top:1px solid #000; padding-top:4px; width:200px; font-size:10px; color:#555; }
      @page { margin:15mm; }
    </style></head><body>
      <h1>Cromwell Plumbing Ltd</h1>
      <div class="sub">Plumber Payment Record</div>
      <hr />
      <div class="meta">
        <div><b>Site:</b> ${siteName}</div>
        <div><b>Ref:</b> ${poNo}</div>
        <div><b>Printed:</b> ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</div>
      </div>
      <table>
        <thead><tr><th>Date</th><th>Plumber</th><th>Day Type</th><th class="r">Days</th><th class="r">Count</th><th class="r">Day Rate (£)</th><th class="r">Total (£)</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="summary">
        <div><b>Total Days:</b> ${totalDaysUsed.toFixed(1)}</div>
        <div><b>Total Earned:</b> £${fmt(plumberTotalCost)}</div>
      </div>
      ${(() => {
        const plumberPayments = cashPayments.filter((p) => p.payeeType === "PLUMBER");
        if (plumberPayments.length === 0) return `<div class="summary"><div><b>Payments:</b> None recorded</div><div><b>Balance Owing:</b> £${fmt(plumberTotalCost)}</div></div>`;
        const paidTotal = plumberPayments.reduce((s, p) => s + n(p.amount), 0);
        const payRows = plumberPayments.sort((a, b) => new Date(a.paymentDate).getTime() - new Date(b.paymentDate).getTime()).map((p) => `<tr><td>${new Date(p.paymentDate).toLocaleDateString("en-GB")}</td><td>${p.reference || "Cash"}</td><td style="text-align:right">${fmt(p.amount)}</td></tr>`).join("");
        return `<h3 style="margin-top:20px;font-size:12px;font-weight:700">Payments Received</h3>
          <table style="margin-top:6px"><thead><tr><th>Date</th><th>Reference</th><th class="r">Amount (£)</th></tr></thead><tbody>${payRows}</tbody></table>
          <div class="summary"><div><b>Total Paid:</b> £${fmt(paidTotal)}</div><div><b>Balance Owing:</b> £${fmt(plumberTotalCost - paidTotal)}</div></div>`;
      })()}
      <div class="sig">
        <div class="sig-box">Plumber Signature</div>
        <div class="sig-box">Cromwell Plumbing</div>
      </div>
    </body></html>`;
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); w.focus(); w.print(); }
  }

  const totalBillable = entries.reduce((s, e) => s + n(e.billableValue), 0);
  const totalCost = entries.reduce((s, e) => s + n(e.internalCostValue), 0);
  const totalOverhead = entries.reduce((s, e) => s + n(e.overheadValue), 0);
  const totalProfit = entries.reduce((s, e) => s + n(e.grossProfitValue), 0);
  const actualEntries = entries.filter((e) => e.status !== "ADVANCE_BILLED" && e.status !== "DELIVERED_AGAINST_ADVANCE");
  const advanceEntries = entries.filter((e) => e.status === "ADVANCE_BILLED");
  const deliveredAgainstEntries = entries.filter((e) => e.status === "DELIVERED_AGAINST_ADVANCE");
  const actualDaysWorked = actualEntries.reduce((s, e) => s + n(e.daysWorked) * (e.plumberCount || 1), 0);
  const deliveredAgainstDays = deliveredAgainstEntries.reduce((s, e) => s + n(e.daysWorked) * (e.plumberCount || 1), 0);
  const advanceBilled = advanceEntries.reduce((s, e) => s + n(e.billableValue), 0);
  const advanceDaysEquiv = weekdaySellRate > 0 ? advanceBilled / weekdaySellRate : 0;
  const totalDaysUsed = actualDaysWorked + deliveredAgainstDays;
  const daysOwed = Math.max(0, advanceDaysEquiv - deliveredAgainstDays);
  const invoicedEntries = entries.filter((e) => e.invoiceNo);
  const totalInvoiced = invoicedEntries.reduce((s, e) => s + n(e.billableValue), 0);

  const plumberOwed = totalCost - cashPayments.filter((p) => p.payeeType === "PLUMBER").reduce((s, p) => s + n(p.amount), 0);
  const overheadOwed = totalOverhead - cashPayments.filter((p) => p.payeeType === "OVERHEAD").reduce((s, p) => s + n(p.amount), 0);
  const totalPaid = cashPayments.reduce((s, p) => s + n(p.amount), 0);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);

    try {
      if (entryMode === "balance") {
        // PO Balance / Advance billing entry
        const amt = Number(balanceAmount) || 0;
        if (!siteId || amt <= 0 || !balanceDate) { setSubmitting(false); return; }
        const eqDays = weekdaySellRate > 0 ? amt / weekdaySellRate : 0;
        await fetch(`/api/customer-pos/${poId}/labour-drawdowns`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            siteId,
            workDate: balanceDate,
            dayType: "CUSTOM",
            plumberCount: 1,
            daysWorked: eqDays,
            invoiceNo: invoiceNo || undefined,
            invoiceDate: invoiceDate || undefined,
            // Override: this is advance billing, not actual work
            overrideBillable: amt,
            status: "ADVANCE_BILLED",
          }),
        });
      } else {
        // Normal day entries
        const validRows = dateRows.filter((r) => r.workDate);
        if (!siteId || validRows.length === 0) { setSubmitting(false); return; }
        for (const row of validRows) {
          await fetch(`/api/customer-pos/${poId}/labour-drawdowns`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ticketId: ticketId || undefined,
              siteId,
              workDate: row.workDate,
              plumberContactId: plumberContactId || undefined,
              dayType,
              plumberCount,
              daysWorked: Number(row.daysWorked) || 1,
              invoiceNo: (hasInvoice ? invoiceNo : isDeliveryAgainstAdvance ? invoiceNo : undefined) || undefined,
              invoiceDate: (hasInvoice ? invoiceDate : undefined) || undefined,
              // Delivery against advance: work is done, but billing was already covered
              deliveryAgainstAdvance: isDeliveryAgainstAdvance || undefined,
            }),
          });
        }
      }

      setOpen(false);
      setEntryMode("days");
      setDayType("WEEKDAY");
      setPlumberCount(1);
      setDateRows([{ workDate: "", daysWorked: 1 }]);
      setTicketId("");
      setSiteId(poSiteId || "");
      setPlumberContactId("");
      setHasInvoice(false);
      setIsDeliveryAgainstAdvance(false);
      setInvoiceNo("");
      setInvoiceDate("");
      setBalanceAmount("");
      setBalanceDate("");
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-3">
      {/* Days remaining summary */}
      {entries.length > 0 && (
        <div className="grid grid-cols-5 gap-3 text-center">
          <div className="border border-[#333333] bg-[#1A1A1A] p-2">
            <p className="text-[10px] text-[#888888] uppercase">Days Delivered / Remaining</p>
            <p className="text-lg font-semibold tabular-nums">
              {totalDaysUsed.toFixed(1)}
              <span className="text-[#888888] text-sm"> / </span>
              <span className={`${poLimitValue > 0 && weekdaySellRate > 0 && (poLimitValue / weekdaySellRate - totalDaysUsed) < 3 ? "text-[#FF3333]" : "text-[#888888]"}`}>
                {poLimitValue > 0 && weekdaySellRate > 0 ? (poLimitValue / weekdaySellRate - totalDaysUsed).toFixed(1) : "—"}
              </span>
            </p>
          </div>
          <div className="border border-[#333333] bg-[#1A1A1A] p-2">
            <p className="text-[10px] text-[#FF9900] uppercase font-bold">Days Owed</p>
            <p className={`text-lg font-semibold tabular-nums ${daysOwed > 0 ? "text-[#FF9900]" : ""}`}>{daysOwed.toFixed(1)}</p>
            {daysOwed > 0 && <p className="text-[10px] text-[#888888]">advance billed</p>}
          </div>
          <div className="border border-[#333333] bg-[#1A1A1A] p-2">
            <p className="text-[10px] text-[#888888] uppercase">Days on PO</p>
            <p className="text-lg font-semibold tabular-nums">
              {poLimitValue > 0 && weekdaySellRate > 0 ? (poLimitValue / weekdaySellRate).toFixed(1) : "—"}
            </p>
            {poLimitValue > 0 && <p className="text-[10px] text-[#888888]">@ £{fmt(weekdaySellRate)}/day</p>}
          </div>
          <div className="border border-[#333333] bg-[#1A1A1A] p-2">
            <p className="text-[10px] text-[#888888] uppercase">Total Billed</p>
            <p className="text-lg font-semibold tabular-nums">{fmt(totalBillable)}</p>
          </div>
          <div className="border border-[#333333] bg-[#1A1A1A] p-2">
            <p className="text-[10px] text-[#888888] uppercase">Invoiced</p>
            <p className="text-lg font-semibold tabular-nums text-[#00CC66]">{fmt(totalInvoiced)}</p>
            <p className="text-[10px] text-[#888888]">{[...new Set(invoicedEntries.map(e => e.invoiceNo))].length} inv</p>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Labour Drawdown Entries</h3>
        <div className="flex gap-2">
          {entries.length > 0 && (
            <>
              <Button size="sm" variant="outline" onClick={printCustomerPDF} className="h-7 text-[10px]">
                <FileText className="size-3 mr-1" /> Customer Statement
              </Button>
              <Button size="sm" variant="outline" onClick={printPlumberPDF} className="h-7 text-[10px]">
                <User className="size-3 mr-1" /> Plumber Record
              </Button>
            </>
          )}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger
            render={
              <Button size="sm" variant="outline">
                <Plus className="size-4 mr-1" />
                Log Labour
              </Button>
            }
          />
          <SheetContent side="right">
            <SheetHeader>
              <SheetTitle>Log Labour Drawdown</SheetTitle>
              <SheetDescription>
                Record a day of labour against this PO.
              </SheetDescription>
            </SheetHeader>
            <form
              onSubmit={handleSubmit}
              className="flex flex-col gap-4 px-4 flex-1 overflow-y-auto"
            >
              {/* Mode toggle */}
              <div className="flex gap-1">
                <Button type="button" size="sm" variant={entryMode === "days" ? "default" : "outline"} className={`h-7 text-xs ${entryMode === "days" ? "bg-[#FF6600] text-black" : ""}`} onClick={() => setEntryMode("days")}>
                  Day Rates
                </Button>
                <Button type="button" size="sm" variant={entryMode === "balance" ? "default" : "outline"} className={`h-7 text-xs ${entryMode === "balance" ? "bg-[#3399FF] text-white" : ""}`} onClick={() => setEntryMode("balance")}>
                  Advance Billing
                </Button>
              </div>

              {entryMode === "balance" ? (
                <>
                  {/* Advance billing form */}
                  <div className="space-y-1.5">
                    <Label>Billing Date *</Label>
                    <Input type="date" value={balanceDate} onChange={(e) => setBalanceDate(e.target.value)} required />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Amount (£ net) *</Label>
                    <Input type="number" step="0.01" value={balanceAmount} onChange={(e) => setBalanceAmount(e.target.value)} placeholder="e.g. 6660.00" required />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Invoice No. *</Label>
                    <Input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} placeholder="e.g. INV-004814" required />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Invoice Date</Label>
                    <Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Site *</Label>
                    <Select value={siteId} onValueChange={(v) => setSiteId(v ?? "")}>
                      <SelectTrigger className="w-full"><SelectValue placeholder="Select site" /></SelectTrigger>
                      <SelectContent>
                        {linkedSites.map((s) => (<SelectItem key={s.id} value={s.id}>{s.siteName}</SelectItem>))}
                      </SelectContent>
                    </Select>
                  </div>
                  {Number(balanceAmount) > 0 && (
                    <div className="border bg-[#222222] p-3 space-y-1 text-sm">
                      <p className="font-medium text-xs uppercase tracking-wide text-[#888888] mb-2">Preview</p>
                      <div className="flex justify-between">
                        <span>Advance billing</span>
                        <span className="font-medium tabular-nums">{fmt(Number(balanceAmount))}</span>
                      </div>
                      <div className="flex justify-between text-[#888888]">
                        <span>Equivalent days @ £{fmt(weekdaySellRate)}</span>
                        <span className="tabular-nums">{weekdaySellRate > 0 ? (Number(balanceAmount) / weekdaySellRate).toFixed(1) : "—"} days</span>
                      </div>
                      <p className="text-[10px] text-[#FF9900] mt-1">These days are owed — track delivery separately</p>
                    </div>
                  )}
                  <SheetFooter>
                    <Button type="submit" disabled={submitting} className="bg-[#3399FF] text-white hover:bg-[#2277DD]">
                      {submitting ? "Saving..." : "Log Advance Billing"}
                    </Button>
                  </SheetFooter>
                </>
              ) : (
              <>
              {/* Work date rows */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Work Dates *</Label>
                  <Button type="button" size="sm" variant="outline" className="h-6 text-[10px]" onClick={addDateRow}>
                    <Plus className="size-3 mr-0.5" /> Add Date
                  </Button>
                </div>
                {dateRows.map((row, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <Input
                      type="date"
                      value={row.workDate}
                      onChange={(e) => updateDateRow(idx, "workDate", e.target.value)}
                      className="flex-1"
                      required
                    />
                    <Input
                      type="number"
                      min={0.5}
                      step={0.5}
                      value={row.daysWorked}
                      onChange={(e) => updateDateRow(idx, "daysWorked", Number(e.target.value) || 1)}
                      className="w-16 text-center"
                      title="Days"
                    />
                    <span className="text-[10px] text-[#888888] w-6">day{row.daysWorked !== 1 ? "s" : ""}</span>
                    {dateRows.length > 1 && (
                      <button type="button" className="text-xs text-[#888888] hover:text-[#FF3333]" onClick={() => removeDateRow(idx)}>✕</button>
                    )}
                  </div>
                ))}
                <p className="text-[10px] text-[#888888]">{dateRows.filter(r => r.workDate).length} date{dateRows.filter(r => r.workDate).length !== 1 ? "s" : ""} — {totalNewDays} total day{totalNewDays !== 1 ? "s" : ""}</p>
              </div>

              <div className="space-y-1.5">
                <Label>Plumber</Label>
                <Select
                  value={plumberContactId}
                  onValueChange={(v) => setPlumberContactId(v ?? "")}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select plumber (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    {contacts.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.fullName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Day Type *</Label>
                <Select
                  value={dayType}
                  onValueChange={(v) => setDayType(v ?? "WEEKDAY")}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="WEEKDAY">Weekday</SelectItem>
                    <SelectItem value="WEEKEND">Weekend</SelectItem>
                    <SelectItem value="CUSTOM">Custom</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Plumber Count</Label>
                <Input
                  type="number"
                  min={1}
                  value={plumberCount}
                  onChange={(e) =>
                    setPlumberCount(Number(e.target.value) || 1)
                  }
                />
              </div>

              <div className="space-y-1.5">
                <Label>Ticket</Label>
                <Select
                  value={ticketId}
                  onValueChange={(v) => setTicketId(v ?? "")}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select ticket" />
                  </SelectTrigger>
                  <SelectContent>
                    {customerTickets.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Site *</Label>
                <Select
                  value={siteId}
                  onValueChange={(v) => setSiteId(v ?? "")}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select site" />
                  </SelectTrigger>
                  <SelectContent>
                    {linkedSites.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.siteName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Auto-calculated preview */}
              <div className=" border bg-[#222222] p-3 space-y-1 text-sm">
                <p className="font-medium text-xs uppercase tracking-wide text-[#888888] mb-2">
                  Preview
                </p>
                <div className="flex justify-between">
                  <span>
                    Billable: {fmt(sellRate)} x {totalNewDays} day{totalNewDays !== 1 ? "s" : ""} x {plumberCount}
                  </span>
                  <span className="font-medium tabular-nums">
                    {fmt(previewBillable)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>
                    Cost: {fmt(costRate)} x {totalNewDays} x {plumberCount}
                  </span>
                  <span className="font-medium tabular-nums">
                    {fmt(previewCost)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Overhead: {fmt(previewBillable)} x {overheadPct}%</span>
                  <span className="font-medium tabular-nums">
                    {fmt(previewOverhead)}
                  </span>
                </div>
                <div className="flex justify-between border-t pt-1 mt-1">
                  <span className="font-medium">Profit</span>
                  <span
                    className={`font-semibold tabular-nums ${
                      previewProfit >= 0 ? "text-[#00CC66]" : "text-[#FF3333]"
                    }`}
                  >
                    {fmt(previewProfit)}
                  </span>
                </div>
              </div>

              {/* Billing options */}
              <div className="space-y-2 border border-[#333333] p-3">
                <p className="text-[10px] uppercase tracking-wide text-[#888888] font-bold">Billing</p>
                <div className="flex gap-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="billingMode"
                      checked={!hasInvoice && !isDeliveryAgainstAdvance}
                      onChange={() => { setHasInvoice(false); setIsDeliveryAgainstAdvance(false); }}
                      className="accent-[#FF6600]"
                    />
                    <span className="text-xs">Not yet invoiced</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="billingMode"
                      checked={hasInvoice}
                      onChange={() => { setHasInvoice(true); setIsDeliveryAgainstAdvance(false); }}
                      className="accent-[#00CC66]"
                    />
                    <span className="text-xs">Already invoiced</span>
                  </label>
                  {advanceEntries.length > 0 && (
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="billingMode"
                        checked={isDeliveryAgainstAdvance}
                        onChange={() => { setIsDeliveryAgainstAdvance(true); setHasInvoice(false); }}
                        className="accent-[#3399FF]"
                      />
                      <span className="text-xs text-[#3399FF]">Deliver against advance</span>
                    </label>
                  )}
                </div>
                {hasInvoice && (
                  <div className="grid grid-cols-2 gap-3 mt-2">
                    <div className="space-y-1.5">
                      <Label>Invoice No. *</Label>
                      <Input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} placeholder="e.g. INV-004786" required />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Invoice Date</Label>
                      <Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
                    </div>
                  </div>
                )}
                {isDeliveryAgainstAdvance && (
                  <div className="mt-2 space-y-2">
                    <div className="space-y-1.5">
                      <Label>Against Invoice</Label>
                      <Select value={invoiceNo} onValueChange={(v) => setInvoiceNo(v ?? "")}>
                        <SelectTrigger className="w-full"><SelectValue placeholder="Select advance invoice" /></SelectTrigger>
                        <SelectContent>
                          {[...new Set(advanceEntries.map((e) => e.invoiceNo).filter(Boolean))].map((inv) => (
                            <SelectItem key={inv!} value={inv!}>{inv}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <p className="text-[10px] text-[#3399FF]">
                      Days worked but already billed via advance — reduces Days Owed
                    </p>
                  </div>
                )}
              </div>

              <SheetFooter>
                <Button type="submit" disabled={submitting} className="bg-[#FF6600] text-black hover:bg-[#CC5500]">
                  {submitting ? "Saving..." : hasInvoice ? "Log & Mark Invoiced" : "Log Labour"}
                </Button>
              </SheetFooter>
              </>
              )}
            </form>
          </SheetContent>
        </Sheet>
        </div>
      </div>

      <div className="border border-[#333333] bg-[#1A1A1A]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Work Date</TableHead>
              <TableHead>Plumber</TableHead>
              <TableHead>Day Type</TableHead>
              <TableHead className="text-right">Count</TableHead>
              <TableHead className="text-right">Days</TableHead>
              <TableHead className="text-right">Bill Rate</TableHead>
              <TableHead className="text-right">Bill Value</TableHead>
              <TableHead className="text-right">Cost</TableHead>
              <TableHead className="text-right">Overhead</TableHead>
              <TableHead className="text-right">Profit</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-8"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={11}
                  className="text-center py-6 text-[#888888]"
                >
                  No labour entries logged yet.
                </TableCell>
              </TableRow>
            ) : (
              <>
                {entries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="tabular-nums">
                      {new Date(entry.workDate).toLocaleDateString("en-GB")}
                    </TableCell>
                    <TableCell>
                      {entry.plumberContact?.fullName || "\u2014"}
                    </TableCell>
                    <TableCell>
                      {entry.status === "ADVANCE_BILLED" ? (
                        <Badge className="text-[9px] bg-[#3399FF]/15 text-[#3399FF]">ADVANCE</Badge>
                      ) : (
                        <Badge variant={entry.dayType === "WEEKEND" ? "destructive" : "outline"}>
                          {entry.dayType}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {entry.plumberCount}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmt(entry.daysWorked)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmt(entry.billableDayRate)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmt(entry.billableValue)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmt(entry.internalCostValue)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmt(entry.overheadValue)}
                    </TableCell>
                    <TableCell
                      className={`text-right tabular-nums font-medium ${
                        n(entry.grossProfitValue) >= 0
                          ? "text-[#00CC66]"
                          : "text-[#FF3333]"
                      }`}
                    >
                      {fmt(entry.grossProfitValue)}
                    </TableCell>
                    <TableCell>
                      {entry.status === "DELIVERED_AGAINST_ADVANCE" ? (
                        <Badge className="text-[9px] bg-[#3399FF]/15 text-[#3399FF]">DELIVERED {entry.invoiceNo ? `→ ${entry.invoiceNo}` : ""}</Badge>
                      ) : entry.status === "ADVANCE_BILLED" ? (
                        <Badge className="text-[9px] bg-[#FF9900]/15 text-[#FF9900]">ADVANCE {entry.invoiceNo || ""}</Badge>
                      ) : entry.invoiceNo ? (
                        <Badge className="text-[9px] bg-[#00CC66]/15 text-[#00CC66]">{entry.invoiceNo}</Badge>
                      ) : (
                        <Badge variant="outline">{entry.status}</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-5 w-5 p-0 text-[#888888] hover:text-[#FF3333]"
                        onClick={() => handleDeleteEntry(entry.id)}
                      >
                        <Trash2 className="size-3" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {/* Summary row */}
                <TableRow className="bg-[#222222] font-medium">
                  <TableCell colSpan={6} className="text-right">Totals</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmt(totalBillable)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmt(totalCost)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {fmt(totalOverhead)}
                  </TableCell>
                  <TableCell
                    className={`text-right tabular-nums font-semibold ${
                      totalProfit >= 0 ? "text-[#00CC66]" : "text-[#FF3333]"
                    }`}
                  >
                    {fmt(totalProfit)}
                  </TableCell>
                  <TableCell />
                  <TableCell />
                </TableRow>
              </>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Cash Payments Section */}
      <div className="space-y-3 mt-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">Cash Payments</h3>
          <Sheet open={payOpen} onOpenChange={setPayOpen}>
            <SheetTrigger render={
              <Button size="sm" variant="outline" className="h-7 text-[10px]">
                <Plus className="size-3 mr-1" /> Log Payment
              </Button>
            } />
            <SheetContent side="right">
              <SheetHeader>
                <SheetTitle>Log Cash Payment</SheetTitle>
                <SheetDescription>Record a cash payment to plumber or overhead.</SheetDescription>
              </SheetHeader>
              <form onSubmit={handlePayment} className="flex flex-col gap-4 px-4 flex-1 overflow-y-auto">
                <div className="space-y-1.5">
                  <Label>Type</Label>
                  <Select value={payeeType} onValueChange={(v) => setPayeeType(v ?? "PLUMBER")}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PLUMBER">Plumber</SelectItem>
                      <SelectItem value="OVERHEAD">Overhead</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Payee *</Label>
                  <Input name="payee" required placeholder="e.g. John Smith" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Amount (£) *</Label>
                    <Input name="amount" type="number" step="0.01" required placeholder="250.00" />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Date *</Label>
                    <Input name="paymentDate" type="date" required />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Reference</Label>
                  <Input name="reference" placeholder="e.g. receipt number" />
                </div>
                <div className="space-y-1.5">
                  <Label>Notes</Label>
                  <Input name="notes" placeholder="Any details" />
                </div>
                {/* Owing summary */}
                <div className="border bg-[#222222] p-3 text-sm space-y-1">
                  <p className="text-[10px] uppercase tracking-wide text-[#888888] font-bold mb-2">Amounts Owing</p>
                  <div className="flex justify-between"><span>Plumber costs owing</span><span className={`font-medium tabular-nums ${plumberOwed > 0 ? "text-[#FF9900]" : "text-[#00CC66]"}`}>{fmt(plumberOwed)}</span></div>
                  <div className="flex justify-between"><span>Overhead owing</span><span className={`font-medium tabular-nums ${overheadOwed > 0 ? "text-[#FF9900]" : "text-[#00CC66]"}`}>{fmt(overheadOwed)}</span></div>
                </div>
                <SheetFooter>
                  <Button type="submit" disabled={paySubmitting} className="bg-[#00CC66] text-black hover:bg-[#00AA55]">
                    {paySubmitting ? "Saving..." : "Log Payment"}
                  </Button>
                </SheetFooter>
              </form>
            </SheetContent>
          </Sheet>
        </div>

        {/* Owing cards */}
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="border border-[#333333] bg-[#1A1A1A] p-2">
            <p className="text-[10px] text-[#888888] uppercase">Plumber Owing</p>
            <p className={`text-lg font-semibold tabular-nums ${plumberOwed > 0 ? "text-[#FF9900]" : "text-[#00CC66]"}`}>{fmt(plumberOwed)}</p>
          </div>
          <div className="border border-[#333333] bg-[#1A1A1A] p-2">
            <p className="text-[10px] text-[#888888] uppercase">Overhead Owing</p>
            <p className={`text-lg font-semibold tabular-nums ${overheadOwed > 0 ? "text-[#FF9900]" : "text-[#00CC66]"}`}>{fmt(overheadOwed)}</p>
          </div>
          <div className="border border-[#333333] bg-[#1A1A1A] p-2">
            <p className="text-[10px] text-[#888888] uppercase">Total Paid</p>
            <p className="text-lg font-semibold tabular-nums text-[#00CC66]">{fmt(totalPaid)}</p>
          </div>
        </div>

        {/* Payments table */}
        <div className="border border-[#333333] bg-[#1A1A1A]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Payee</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead className="w-8"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cashPayments.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-4 text-[#888888]">No payments logged yet.</TableCell>
                </TableRow>
              ) : (
                cashPayments.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="tabular-nums">{new Date(p.paymentDate).toLocaleDateString("en-GB")}</TableCell>
                    <TableCell className="font-medium">{p.payee}</TableCell>
                    <TableCell>
                      <Badge className={`text-[9px] ${p.payeeType === "PLUMBER" ? "bg-[#3399FF]/15 text-[#3399FF]" : "bg-[#FF9900]/15 text-[#FF9900]"}`}>
                        {p.payeeType === "PLUMBER" ? "Plumber" : "Overhead"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">{fmt(p.amount)}</TableCell>
                    <TableCell className="text-xs text-[#888888]">{p.paymentMethod}</TableCell>
                    <TableCell className="text-xs text-[#888888]">{p.reference || "—"}</TableCell>
                    <TableCell>
                      <Button size="sm" variant="outline" className="h-5 w-5 p-0 text-[#888888] hover:text-[#FF3333]" onClick={() => handleDeletePayment(p.id)}>
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
    </div>
  );
}
