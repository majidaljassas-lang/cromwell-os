"use client";

import { useState, Fragment } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
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
  _count: { labourDrawdowns: number; materialsDrawdowns: number };
};

type CustomerOption = { id: string; name: string };
type SiteOption = { id: string; siteName: string };
type TicketOption = { id: string; title: string };
type ContactOption = { id: string; fullName: string };

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
  if (pct > 90) return "bg-red-500";
  if (pct > 75) return "bg-yellow-500";
  return "bg-green-500";
}

export function PORegisterView({
  customerPOs,
  customers,
  sites,
  tickets,
  contacts,
}: {
  customerPOs: CustomerPOData[];
  customers: CustomerOption[];
  sites: SiteOption[];
  tickets: TicketOption[];
  contacts: ContactOption[];
}) {
  const router = useRouter();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filterType, setFilterType] = useState("ALL");
  const [filterCustomer, setFilterCustomer] = useState("ALL");
  const [filterStatus, setFilterStatus] = useState("ALL");

  // Add PO sheet state
  const [addOpen, setAddOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [poType, setPoType] = useState("STANDARD_FIXED");
  const [customerId, setCustomerId] = useState("");
  const [siteId, setSiteId] = useState("");
  const [ticketId, setTicketId] = useState("");

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
          <FileBarChart className="size-6 text-muted-foreground" />
          <h1 className="text-2xl font-semibold tracking-tight">
            PO Register
          </h1>
        </div>
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
                  onValueChange={(v) => setCustomerId(v ?? "")}
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
                <Select
                  value={siteId}
                  onValueChange={(v) => setSiteId(v ?? "")}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select site (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    {sites.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.siteName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
                    {tickets.map((t) => (
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
                <div className="space-y-3 rounded-md border p-3">
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

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">
              Total PO Value
            </p>
            <p className="text-2xl font-semibold tabular-nums mt-1">
              {fmt(totalPOValue)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">
              Total Consumed
            </p>
            <p className="text-2xl font-semibold tabular-nums mt-1">
              {fmt(totalConsumed)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">
              Total Remaining
            </p>
            <p className="text-2xl font-semibold tabular-nums mt-1">
              {fmt(totalRemaining)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">
              Total Profit to Date
            </p>
            <p
              className={`text-2xl font-semibold tabular-nums mt-1 ${
                totalProfit >= 0 ? "text-green-600" : "text-red-600"
              }`}
            >
              {fmt(totalProfit)}
            </p>
          </CardContent>
        </Card>
      </div>

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

        <span className="text-sm text-muted-foreground ml-auto">
          {filtered.length} PO{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* PO Table */}
      <div className="rounded-lg border bg-background">
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
                  className="text-center py-8 text-muted-foreground"
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
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => toggleExpand(po.id)}
                    >
                      <TableCell className="px-2">
                        {isExpanded ? (
                          <ChevronDown className="size-4 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="size-4 text-muted-foreground" />
                        )}
                      </TableCell>
                      <TableCell className="font-medium">{po.poNo}</TableCell>
                      <TableCell>{poTypeBadge(po.poType)}</TableCell>
                      <TableCell className="max-w-[120px] truncate">
                        {po.customer.name}
                      </TableCell>
                      <TableCell className="max-w-[100px] truncate text-muted-foreground">
                        {po.site?.siteName || "\u2014"}
                      </TableCell>
                      <TableCell className="max-w-[120px] truncate text-muted-foreground">
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
                          profit >= 0 ? "text-green-600" : "text-red-600"
                        }`}
                      >
                        {fmt(profit)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmt(remaining)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-full rounded-full bg-muted">
                            <div
                              className={`h-full rounded-full transition-all ${utilisationColor(
                                utilPct
                              )}`}
                              style={{
                                width: `${Math.min(utilPct, 100)}%`,
                              }}
                            />
                          </div>
                          <span className="text-xs tabular-nums text-muted-foreground w-10 text-right">
                            {utilPct.toFixed(0)}%
                          </span>
                        </div>
                      </TableCell>
                    </TableRow>

                    {isExpanded && (
                      <TableRow>
                        <TableCell colSpan={14} className="p-4 bg-muted/30">
                          <ExpandedPODetail
                            po={po}
                            contacts={contacts}
                            tickets={tickets}
                            sites={sites}
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
    </div>
  );
}

function ExpandedPODetail({
  po,
  contacts,
  tickets,
  sites,
}: {
  po: CustomerPOData;
  contacts: ContactOption[];
  tickets: TicketOption[];
  sites: SiteOption[];
}) {
  if (po.poType === "STANDARD_FIXED") {
    return (
      <div className="space-y-3">
        <h3 className="text-sm font-medium">
          PO Lines ({po.lines.length})
        </h3>
        {po.lines.length === 0 ? (
          <p className="text-sm text-muted-foreground">No PO lines.</p>
        ) : (
          <div className="rounded-lg border bg-background">
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
        entries={po.labourDrawdowns}
        contacts={contacts}
        tickets={tickets}
        sites={sites}
        weekdaySellRate={n(po.weekdaySellRate) || 450}
        weekendSellRate={n(po.weekendSellRate) || 675}
        weekdayCostRate={n(po.weekdayCostRate) || 250}
        weekendCostRate={n(po.weekendCostRate) || 375}
        overheadPct={n(po.overheadPct) || 10}
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
