"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  ChevronDown,
  ChevronRight,
  FileText,
  Package,
  ArrowRightLeft,
  Undo2,
  Warehouse,
  Upload,
  Loader2,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
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
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

// ── Helpers ──

type Decimal = { toString(): string } | string | number | null;

function dec(val: Decimal): string {
  if (val === null || val === undefined) return "\u2014";
  return Number(val.toString()).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function fmtDate(d: string | Date | null): string {
  if (!d) return "\u2014";
  return new Date(d).toLocaleDateString("en-GB");
}

function statusVariant(
  status: string
): "default" | "secondary" | "outline" | "destructive" {
  switch (status) {
    case "MATCHED":
      return "default";
    case "PARTIAL":
    case "SUGGESTED":
      return "secondary";
    case "EXCEPTION":
    case "UNALLOCATED":
      return "destructive";
    default:
      return "outline";
  }
}

function classificationVariant(
  c: string
): "default" | "secondary" | "outline" | "destructive" {
  switch (c) {
    case "BILLABLE":
      return "default";
    case "ABSORBED":
      return "secondary";
    case "WRITE_OFF":
      return "destructive";
    default:
      return "outline";
  }
}

// ── Types ──

type SupplierBillLine = {
  id: string;
  description: string;
  qty: Decimal;
  unitCost: Decimal;
  lineTotal: Decimal;
  costClassification: string;
  allocationStatus: string;
};

type SupplierBill = {
  id: string;
  billNo: string;
  billDate: string;
  siteRef: string | null;
  customerRef: string | null;
  status: string;
  totalCost: Decimal;
  supplier: { id: string; name: string };
  lines: SupplierBillLine[];
  _count: { lines: number };
};

type CostAllocationItem = {
  id: string;
  qtyAllocated: Decimal;
  unitCost: Decimal;
  totalCost: Decimal;
  allocationStatus: string;
  confidenceScore: Decimal;
  notes: string | null;
  ticketLine: { id: string; description: string };
  supplierBillLine: {
    id: string;
    description: string;
    supplierBill: { id: string; billNo: string };
  };
};

type AbsorbedCostItem = {
  id: string;
  description: string;
  amount: Decimal;
  allocationBasis: string | null;
  createdAt: string;
  supplierBillLine: { id: string; description: string };
  ticket: { id: string; title: string };
};

type ReturnLineItem = {
  id: string;
  qtyReturned: Decimal;
  expectedCredit: Decimal;
  status: string;
};

type ReturnItem = {
  id: string;
  returnDate: string;
  status: string;
  notes: string | null;
  supplier: { id: string; name: string };
  ticket: { id: string; title: string };
  lines: ReturnLineItem[];
};

type StockExcessItem = {
  id: string;
  purchasedCost: Decimal;
  usedCost: Decimal;
  excessCost: Decimal;
  treatment: string;
  status: string;
  supplierBillLine: { id: string; description: string };
  ticketLine: { id: string; description: string } | null;
};

type ReallocationItem = {
  id: string;
  amount: Decimal;
  reason: string | null;
  createdAt: string;
  fromTicketLine: {
    id: string;
    description: string;
    ticket: { id: string; title: string };
  };
  toTicketLine: {
    id: string;
    description: string;
    ticket: { id: string; title: string };
  };
};

type SupplierOption = { id: string; name: string };
type TicketOption = { id: string; title: string };

type Props = {
  supplierBills: SupplierBill[];
  unresolvedAllocations: CostAllocationItem[];
  absorbedCosts: AbsorbedCostItem[];
  returns: ReturnItem[];
  stockExcess: StockExcessItem[];
  reallocations: ReallocationItem[];
  suppliers: SupplierOption[];
  tickets: TicketOption[];
};

export function ProcurementView({
  supplierBills,
  unresolvedAllocations,
  absorbedCosts,
  returns,
  stockExcess,
  reallocations,
  suppliers,
  tickets,
}: Props) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Procurement</h1>
          <p className="text-sm text-muted-foreground">
            Cost truth -- supplier bills, allocations, returns, and stock management
          </p>
        </div>
      </div>

      <Tabs defaultValue="bills">
        <TabsList>
          <TabsTrigger value="bills">
            <FileText className="size-4 mr-1.5" />
            Bills ({supplierBills.length})
          </TabsTrigger>
          <TabsTrigger value="allocations">
            <Package className="size-4 mr-1.5" />
            Allocations ({unresolvedAllocations.length})
          </TabsTrigger>
          <TabsTrigger value="absorbed">
            Absorbed ({absorbedCosts.length})
          </TabsTrigger>
          <TabsTrigger value="returns">
            <Undo2 className="size-4 mr-1.5" />
            Returns ({returns.length})
          </TabsTrigger>
          <TabsTrigger value="stock">
            <Warehouse className="size-4 mr-1.5" />
            MOQ / Stock ({stockExcess.length})
          </TabsTrigger>
        </TabsList>

        {/* ── TAB 1: SUPPLIER BILLS ── */}
        <TabsContent value="bills" className="mt-4">
          <SupplierBillsTab
            bills={supplierBills}
            suppliers={suppliers}
          />
        </TabsContent>

        {/* ── TAB 2: COST ALLOCATIONS ── */}
        <TabsContent value="allocations" className="mt-4">
          <CostAllocationsTab
            unresolvedAllocations={unresolvedAllocations}
            supplierBills={supplierBills}
            tickets={tickets}
          />
        </TabsContent>

        {/* ── TAB 3: ABSORBED COSTS ── */}
        <TabsContent value="absorbed" className="mt-4">
          <AbsorbedCostsTab
            absorbedCosts={absorbedCosts}
            tickets={tickets}
          />
        </TabsContent>

        {/* ── TAB 4: RETURNS & CREDITS ── */}
        <TabsContent value="returns" className="mt-4">
          <ReturnsTab
            returns={returns}
            suppliers={suppliers}
            tickets={tickets}
          />
        </TabsContent>

        {/* ── TAB 5: MOQ / STOCK / REALLOCATIONS ── */}
        <TabsContent value="stock" className="mt-4">
          <StockTab
            stockExcess={stockExcess}
            reallocations={reallocations}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// TAB 1: Supplier Bills
// ────────────────────────────────────────────────────────────────────────────

function SupplierBillsTab({
  bills,
  suppliers,
}: {
  bills: SupplierBill[];
  suppliers: SupplierOption[];
}) {
  const router = useRouter();
  const [expandedBill, setExpandedBill] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [billLines, setBillLines] = useState([
    { description: "", qty: "1", unitCost: "0", lineTotal: "0" },
  ]);

  // PDF upload state
  const [parsing, setParsing] = useState(false);
  const [parseMessage, setParseMessage] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handlePdfUpload = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setParseMessage("Only PDF files are supported.");
      return;
    }

    setParsing(true);
    setParseMessage(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/supplier-bills/parse-pdf", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        setParseMessage(data.error || "Failed to parse PDF.");
        return;
      }

      const { parsed } = data;
      if (!parsed) {
        setParseMessage("Could not extract data from PDF.");
        return;
      }

      // Auto-fill form fields from parsed data
      const form = document.querySelector<HTMLFormElement>(
        'form[data-bill-form]'
      );
      if (form) {
        if (parsed.billNo) {
          const billNoInput = form.querySelector<HTMLInputElement>('#billNo');
          if (billNoInput) {
            // Set value via native setter to trigger React state
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
              window.HTMLInputElement.prototype, 'value'
            )?.set;
            nativeInputValueSetter?.call(billNoInput, parsed.billNo);
            billNoInput.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }
        if (parsed.billDate) {
          const dateInput = form.querySelector<HTMLInputElement>('#billDate');
          if (dateInput) {
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
              window.HTMLInputElement.prototype, 'value'
            )?.set;
            nativeInputValueSetter?.call(dateInput, parsed.billDate);
            dateInput.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }
        if (parsed.grandTotal !== null) {
          const totalInput = form.querySelector<HTMLInputElement>('#totalCost');
          if (totalInput) {
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
              window.HTMLInputElement.prototype, 'value'
            )?.set;
            nativeInputValueSetter?.call(totalInput, String(parsed.grandTotal));
            totalInput.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }
      }

      // Auto-fill line items
      if (parsed.lines && parsed.lines.length > 0) {
        setBillLines(
          parsed.lines.map((l: { description: string; qty: number; unitCost: number; lineTotal: number }) => ({
            description: l.description,
            qty: String(l.qty),
            unitCost: String(l.unitCost),
            lineTotal: String(l.lineTotal),
          }))
        );
        setParseMessage(`Parsed ${parsed.lines.length} line${parsed.lines.length === 1 ? '' : 's'} from PDF.`);
      } else {
        setParseMessage(
          parsed.billNo
            ? "Extracted header info but no line items. Add lines manually."
            : "Could not extract structured data. Enter details manually."
        );
      }
    } catch {
      setParseMessage("Failed to upload PDF. Please try again.");
    } finally {
      setParsing(false);
      // Reset file input so re-uploading the same file triggers change
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, []);

  function updateBillLine(
    idx: number,
    field: string,
    value: string
  ) {
    setBillLines((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      if (field === "qty" || field === "unitCost") {
        const q = Number(next[idx].qty) || 0;
        const u = Number(next[idx].unitCost) || 0;
        next[idx].lineTotal = (q * u).toFixed(2);
      }
      return next;
    });
  }

  function addBillLine() {
    setBillLines((prev) => [
      ...prev,
      { description: "", qty: "1", unitCost: "0", lineTotal: "0" },
    ]);
  }

  function removeBillLine(idx: number) {
    setBillLines((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleImportBill(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    const form = e.currentTarget;
    const fd = new FormData(form);

    const body = {
      supplierId,
      billNo: fd.get("billNo") as string,
      billDate: fd.get("billDate") as string,
      siteRef: (fd.get("siteRef") as string) || undefined,
      customerRef: (fd.get("customerRef") as string) || undefined,
      totalCost: Number(fd.get("totalCost")) || 0,
      lines: billLines
        .filter((l) => l.description.trim())
        .map((l) => ({
          description: l.description,
          qty: Number(l.qty) || 1,
          unitCost: Number(l.unitCost) || 0,
          lineTotal: Number(l.lineTotal) || 0,
          allocationStatus: "UNALLOCATED",
        })),
    };

    try {
      const res = await fetch("/api/supplier-bills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        form.reset();
        setSupplierId("");
        setBillLines([
          { description: "", qty: "1", unitCost: "0", lineTotal: "0" },
        ]);
        setParseMessage(null);
        setSheetOpen(false);
        router.refresh();
      }
    } finally {
      setSubmitting(false);
    }
  }

  function allocationSummary(lines: SupplierBillLine[]): string {
    const matched = lines.filter(
      (l) => l.allocationStatus === "MATCHED"
    ).length;
    return `${matched}/${lines.length} matched`;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Supplier Bills</h2>
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetTrigger
            render={
              <Button size="sm">
                <Plus className="size-4 mr-1" />
                Import Bill
              </Button>
            }
          />
          <SheetContent side="right">
            <SheetHeader>
              <SheetTitle>Import Supplier Bill</SheetTitle>
              <SheetDescription>
                Create a new supplier bill with line items.
              </SheetDescription>
            </SheetHeader>
            <form
              data-bill-form
              onSubmit={handleImportBill}
              className="flex flex-col gap-4 px-4 flex-1 overflow-y-auto"
            >
              {/* ── PDF Upload Zone ── */}
              <div
                className={`relative border-2 border-dashed rounded-lg p-4 text-center transition-colors ${
                  dragOver
                    ? "border-primary bg-primary/5"
                    : "border-muted-foreground/25 hover:border-muted-foreground/50"
                }`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  const file = e.dataTransfer.files?.[0];
                  if (file) handlePdfUpload(file);
                }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handlePdfUpload(file);
                  }}
                />
                {parsing ? (
                  <div className="flex items-center justify-center gap-2 py-2 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    Parsing PDF...
                  </div>
                ) : (
                  <button
                    type="button"
                    className="w-full flex flex-col items-center gap-1.5 py-1 cursor-pointer"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Upload className="size-5 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">
                      Drop a supplier bill PDF here, or click to browse
                    </span>
                  </button>
                )}
                {parseMessage && (
                  <p className={`text-xs mt-2 ${
                    parseMessage.startsWith("Parsed")
                      ? "text-emerald-600"
                      : "text-amber-600"
                  }`}>
                    {parseMessage}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label>Supplier *</Label>
                <Select
                  value={supplierId}
                  onValueChange={(v) => setSupplierId(v ?? "")}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select supplier" />
                  </SelectTrigger>
                  <SelectContent>
                    {suppliers.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="billNo">Bill No *</Label>
                <Input id="billNo" name="billNo" required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="billDate">Bill Date *</Label>
                <Input id="billDate" name="billDate" type="date" required />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="siteRef">Site Ref</Label>
                  <Input id="siteRef" name="siteRef" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="customerRef">Customer Ref</Label>
                  <Input id="customerRef" name="customerRef" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="totalCost">Total Cost *</Label>
                <Input
                  id="totalCost"
                  name="totalCost"
                  type="number"
                  step="0.01"
                  required
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Lines</Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addBillLine}
                  >
                    <Plus className="size-3 mr-1" />
                    Add Line
                  </Button>
                </div>
                {billLines.map((line, idx) => (
                  <div
                    key={idx}
                    className="rounded border p-3 space-y-2 relative"
                  >
                    {billLines.length > 1 && (
                      <button
                        type="button"
                        className="absolute top-1 right-2 text-xs text-muted-foreground hover:text-destructive"
                        onClick={() => removeBillLine(idx)}
                      >
                        Remove
                      </button>
                    )}
                    <Input
                      placeholder="Description"
                      value={line.description}
                      onChange={(e) =>
                        updateBillLine(idx, "description", e.target.value)
                      }
                    />
                    <div className="grid grid-cols-3 gap-2">
                      <Input
                        placeholder="Qty"
                        type="number"
                        step="0.01"
                        value={line.qty}
                        onChange={(e) =>
                          updateBillLine(idx, "qty", e.target.value)
                        }
                      />
                      <Input
                        placeholder="Unit Cost"
                        type="number"
                        step="0.01"
                        value={line.unitCost}
                        onChange={(e) =>
                          updateBillLine(idx, "unitCost", e.target.value)
                        }
                      />
                      <Input
                        placeholder="Line Total"
                        type="number"
                        step="0.01"
                        value={line.lineTotal}
                        readOnly
                        className="bg-muted"
                      />
                    </div>
                  </div>
                ))}
              </div>

              <SheetFooter>
                <Button type="submit" disabled={submitting}>
                  {submitting ? "Importing..." : "Import Bill"}
                </Button>
              </SheetFooter>
            </form>
          </SheetContent>
        </Sheet>
      </div>

      <div className=" border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>Bill No</TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead>Bill Date</TableHead>
              <TableHead>Site Ref</TableHead>
              <TableHead>Customer Ref</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Total Cost</TableHead>
              <TableHead className="text-right">Lines</TableHead>
              <TableHead>Allocation</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {bills.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={10}
                  className="text-center py-8 text-muted-foreground"
                >
                  No supplier bills yet.
                </TableCell>
              </TableRow>
            ) : (
              bills.map((bill) => (
                <>
                  <TableRow
                    key={bill.id}
                    className="cursor-pointer"
                    onClick={() =>
                      setExpandedBill(
                        expandedBill === bill.id ? null : bill.id
                      )
                    }
                  >
                    <TableCell>
                      {expandedBill === bill.id ? (
                        <ChevronDown className="size-4" />
                      ) : (
                        <ChevronRight className="size-4" />
                      )}
                    </TableCell>
                    <TableCell className="font-medium">{bill.billNo}</TableCell>
                    <TableCell>{bill.supplier.name}</TableCell>
                    <TableCell className="tabular-nums">
                      {fmtDate(bill.billDate)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {bill.siteRef || "\u2014"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {bill.customerRef || "\u2014"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{bill.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {dec(bill.totalCost)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {bill._count.lines}
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-muted-foreground">
                        {allocationSummary(bill.lines)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 w-6 p-0 text-red-500 hover:text-red-400 hover:bg-red-950/30 border-[#333333]"
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (!confirm(`Delete bill ${bill.billNo}?`)) return;
                          const res = await fetch(`/api/supplier-bills/${bill.id}`, { method: "DELETE" });
                          if (res.ok) {
                            router.refresh();
                          } else {
                            const err = await res.json().catch(() => null);
                            alert(err?.error || "Failed to delete bill");
                          }
                        }}
                      >
                        <Trash2 className="size-3" />
                      </Button>
                    </TableCell>
                  </TableRow>
                  {expandedBill === bill.id && bill.lines.length > 0 && (
                    <TableRow key={`${bill.id}-lines`}>
                      <TableCell colSpan={10} className="p-0">
                        <div className="bg-muted/30 px-8 py-3">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Description</TableHead>
                                <TableHead className="text-right">Qty</TableHead>
                                <TableHead className="text-right">
                                  Unit Cost
                                </TableHead>
                                <TableHead className="text-right">
                                  Line Total
                                </TableHead>
                                <TableHead>Classification</TableHead>
                                <TableHead>Allocation</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {bill.lines.map((line) => (
                                <TableRow key={line.id}>
                                  <TableCell className="font-medium">
                                    {line.description}
                                  </TableCell>
                                  <TableCell className="text-right tabular-nums">
                                    {dec(line.qty)}
                                  </TableCell>
                                  <TableCell className="text-right tabular-nums">
                                    {dec(line.unitCost)}
                                  </TableCell>
                                  <TableCell className="text-right tabular-nums">
                                    {dec(line.lineTotal)}
                                  </TableCell>
                                  <TableCell>
                                    <Badge
                                      variant={classificationVariant(
                                        line.costClassification
                                      )}
                                    >
                                      {line.costClassification}
                                    </Badge>
                                  </TableCell>
                                  <TableCell>
                                    <Badge
                                      variant={statusVariant(
                                        line.allocationStatus
                                      )}
                                    >
                                      {line.allocationStatus}
                                    </Badge>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// TAB 2: Cost Allocations
// ────────────────────────────────────────────────────────────────────────────

function CostAllocationsTab({
  unresolvedAllocations,
  supplierBills,
  tickets,
}: {
  unresolvedAllocations: CostAllocationItem[];
  supplierBills: SupplierBill[];
  tickets: TicketOption[];
}) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedBillLineId, setSelectedBillLineId] = useState("");
  const [ticketLineId, setTicketLineId] = useState("");

  // Collect all unresolved bill lines across all bills
  const unresolvedBillLines = supplierBills.flatMap((b) =>
    b.lines
      .filter((l) => l.allocationStatus !== "MATCHED")
      .map((l) => ({
        ...l,
        supplierName: b.supplier.name,
        billNo: b.billNo,
      }))
  );

  // Collect all ticket line IDs from allocations to show in form
  const ticketLineOptions = unresolvedAllocations.map((a) => ({
    id: a.ticketLine.id,
    description: a.ticketLine.description,
  }));

  // Deduplicate
  const uniqueTicketLines = Array.from(
    new Map(ticketLineOptions.map((t) => [t.id, t])).values()
  );

  async function handleAllocate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    const fd = new FormData(e.currentTarget);

    const body = {
      ticketLineId,
      supplierBillLineId: selectedBillLineId,
      qtyAllocated: Number(fd.get("qtyAllocated")) || 0,
      unitCost: Number(fd.get("unitCost")) || 0,
      totalCost: Number(fd.get("totalCost")) || 0,
      notes: (fd.get("notes") as string) || undefined,
    };

    try {
      const res = await fetch("/api/cost-allocations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setDialogOpen(false);
        setSelectedBillLineId("");
        setTicketLineId("");
        router.refresh();
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Unresolved Cost Lines */}
      <div className="space-y-3">
        <h2 className="text-lg font-medium">Unresolved Cost Lines</h2>
        <div className=" border bg-background">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Description</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Bill No</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Unit Cost</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Classification</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {unresolvedBillLines.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={9}
                    className="text-center py-8 text-muted-foreground"
                  >
                    All cost lines are matched.
                  </TableCell>
                </TableRow>
              ) : (
                unresolvedBillLines.map((line) => (
                  <TableRow key={line.id}>
                    <TableCell className="font-medium max-w-[200px] truncate">
                      {line.description}
                    </TableCell>
                    <TableCell>{line.supplierName}</TableCell>
                    <TableCell>{line.billNo}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {dec(line.qty)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {dec(line.unitCost)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {dec(line.lineTotal)}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={classificationVariant(
                          line.costClassification
                        )}
                      >
                        {line.costClassification}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={statusVariant(line.allocationStatus)}
                      >
                        {line.allocationStatus}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Dialog
                        open={dialogOpen && selectedBillLineId === line.id}
                        onOpenChange={(open) => {
                          setDialogOpen(open);
                          if (open) setSelectedBillLineId(line.id);
                        }}
                      >
                        <DialogTrigger
                          render={
                            <Button variant="outline" size="sm">
                              Allocate
                            </Button>
                          }
                        />
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>Allocate Cost Line</DialogTitle>
                            <DialogDescription>
                              Allocate &quot;{line.description}&quot; to a ticket
                              line.
                            </DialogDescription>
                          </DialogHeader>
                          <form onSubmit={handleAllocate} className="space-y-4">
                            <div className="space-y-1.5">
                              <Label>Ticket Line *</Label>
                              <Select
                                value={ticketLineId}
                                onValueChange={(v) =>
                                  setTicketLineId(v ?? "")
                                }
                              >
                                <SelectTrigger className="w-full">
                                  <SelectValue placeholder="Select ticket line" />
                                </SelectTrigger>
                                <SelectContent>
                                  {uniqueTicketLines.map((tl) => (
                                    <SelectItem key={tl.id} value={tl.id}>
                                      {tl.description}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="grid grid-cols-3 gap-3">
                              <div className="space-y-1.5">
                                <Label htmlFor="qtyAllocated">Qty</Label>
                                <Input
                                  id="qtyAllocated"
                                  name="qtyAllocated"
                                  type="number"
                                  step="0.01"
                                  defaultValue={Number(
                                    line.qty?.toString() ?? "0"
                                  )}
                                />
                              </div>
                              <div className="space-y-1.5">
                                <Label htmlFor="unitCost">Unit Cost</Label>
                                <Input
                                  id="unitCost"
                                  name="unitCost"
                                  type="number"
                                  step="0.01"
                                  defaultValue={Number(
                                    line.unitCost?.toString() ?? "0"
                                  )}
                                />
                              </div>
                              <div className="space-y-1.5">
                                <Label htmlFor="totalCost">Total</Label>
                                <Input
                                  id="totalCost"
                                  name="totalCost"
                                  type="number"
                                  step="0.01"
                                  defaultValue={Number(
                                    line.lineTotal?.toString() ?? "0"
                                  )}
                                />
                              </div>
                            </div>
                            <div className="space-y-1.5">
                              <Label htmlFor="alloc-notes">Notes</Label>
                              <Textarea
                                id="alloc-notes"
                                name="notes"
                                rows={2}
                              />
                            </div>
                            <DialogFooter>
                              <Button type="submit" disabled={submitting}>
                                {submitting ? "Allocating..." : "Allocate"}
                              </Button>
                            </DialogFooter>
                          </form>
                        </DialogContent>
                      </Dialog>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Recent Allocations */}
      <div className="space-y-3">
        <h2 className="text-lg font-medium">Recent Allocations</h2>
        <div className=" border bg-background">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ticket Line</TableHead>
                <TableHead>Bill Line</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Unit Cost</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Confidence</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {unresolvedAllocations.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="text-center py-8 text-muted-foreground"
                  >
                    No unresolved allocations.
                  </TableCell>
                </TableRow>
              ) : (
                unresolvedAllocations.map((a) => (
                  <TableRow key={a.id}>
                    <TableCell className="font-medium max-w-[180px] truncate">
                      {a.ticketLine.description}
                    </TableCell>
                    <TableCell className="max-w-[180px] truncate">
                      {a.supplierBillLine.description}
                    </TableCell>
                    <TableCell>
                      {a.supplierBillLine.supplierBill.billNo}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {dec(a.qtyAllocated)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {dec(a.unitCost)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {dec(a.totalCost)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(a.allocationStatus)}>
                        {a.allocationStatus}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {a.confidenceScore
                        ? `${Number(a.confidenceScore.toString())}%`
                        : "\u2014"}
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

// ────────────────────────────────────────────────────────────────────────────
// TAB 3: Absorbed Costs
// ────────────────────────────────────────────────────────────────────────────

function AbsorbedCostsTab({
  absorbedCosts,
  tickets,
}: {
  absorbedCosts: AbsorbedCostItem[];
  tickets: TicketOption[];
}) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [ticketId, setTicketId] = useState("");

  async function handleAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    const fd = new FormData(e.currentTarget);

    const body = {
      supplierBillLineId: fd.get("supplierBillLineId") as string,
      ticketId,
      ticketLineId: (fd.get("ticketLineId") as string) || undefined,
      description: fd.get("description") as string,
      amount: Number(fd.get("amount")) || 0,
      allocationBasis: (fd.get("allocationBasis") as string) || undefined,
    };

    try {
      const res = await fetch("/api/absorbed-cost-allocations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setDialogOpen(false);
        setTicketId("");
        router.refresh();
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Absorbed Costs</h2>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger
            render={
              <Button size="sm">
                <Plus className="size-4 mr-1" />
                Add Absorbed Cost
              </Button>
            }
          />
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Absorbed Cost</DialogTitle>
              <DialogDescription>
                Record an absorbed cost allocation.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleAdd} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="abs-billLineId">Supplier Bill Line ID *</Label>
                <Input
                  id="abs-billLineId"
                  name="supplierBillLineId"
                  required
                  placeholder="Paste supplier bill line ID"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Ticket *</Label>
                <Select
                  value={ticketId}
                  onValueChange={(v) => setTicketId(v ?? "")}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select ticket" />
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
                <Label htmlFor="abs-ticketLineId">Ticket Line ID</Label>
                <Input
                  id="abs-ticketLineId"
                  name="ticketLineId"
                  placeholder="Optional ticket line ID"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="abs-description">Description *</Label>
                <Input
                  id="abs-description"
                  name="description"
                  required
                  placeholder="e.g. MOQ surplus on fixings"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="abs-amount">Amount *</Label>
                  <Input
                    id="abs-amount"
                    name="amount"
                    type="number"
                    step="0.01"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="abs-basis">Allocation Basis</Label>
                  <Input
                    id="abs-basis"
                    name="allocationBasis"
                    placeholder="e.g. PRO_RATA"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={submitting}>
                  {submitting ? "Adding..." : "Add Absorbed Cost"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className=" border bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Description</TableHead>
              <TableHead>Supplier Bill Line</TableHead>
              <TableHead>Ticket</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Allocation Basis</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {absorbedCosts.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="text-center py-8 text-muted-foreground"
                >
                  No absorbed costs recorded.
                </TableCell>
              </TableRow>
            ) : (
              absorbedCosts.map((ac) => (
                <TableRow key={ac.id}>
                  <TableCell className="font-medium max-w-[200px] truncate">
                    {ac.description}
                  </TableCell>
                  <TableCell className="max-w-[180px] truncate">
                    {ac.supplierBillLine.description}
                  </TableCell>
                  <TableCell>{ac.ticket.title}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {dec(ac.amount)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {ac.allocationBasis || "\u2014"}
                  </TableCell>
                  <TableCell className="text-muted-foreground tabular-nums">
                    {fmtDate(ac.createdAt)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// TAB 4: Returns & Credits
// ────────────────────────────────────────────────────────────────────────────

function ReturnsTab({
  returns,
  suppliers,
  tickets,
}: {
  returns: ReturnItem[];
  suppliers: SupplierOption[];
  tickets: TicketOption[];
}) {
  const router = useRouter();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [ticketId, setTicketId] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [returnLines, setReturnLines] = useState([
    { ticketLineId: "", qtyReturned: "1", expectedCredit: "0" },
  ]);

  function updateReturnLine(idx: number, field: string, value: string) {
    setReturnLines((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  }

  function addReturnLine() {
    setReturnLines((prev) => [
      ...prev,
      { ticketLineId: "", qtyReturned: "1", expectedCredit: "0" },
    ]);
  }

  function removeReturnLine(idx: number) {
    setReturnLines((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleCreateReturn(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    const fd = new FormData(e.currentTarget);

    const body = {
      ticketId,
      supplierId,
      returnDate: fd.get("returnDate") as string,
      notes: (fd.get("notes") as string) || undefined,
      lines: returnLines
        .filter((l) => l.ticketLineId.trim())
        .map((l) => ({
          ticketLineId: l.ticketLineId,
          qtyReturned: Number(l.qtyReturned) || 0,
          expectedCredit: Number(l.expectedCredit) || 0,
        })),
    };

    try {
      const res = await fetch("/api/returns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setSheetOpen(false);
        setTicketId("");
        setSupplierId("");
        setReturnLines([
          { ticketLineId: "", qtyReturned: "1", expectedCredit: "0" },
        ]);
        router.refresh();
      }
    } finally {
      setSubmitting(false);
    }
  }

  function totalExpectedCredit(lines: ReturnLineItem[]): number {
    return lines.reduce(
      (sum, l) => sum + Number(l.expectedCredit?.toString() ?? 0),
      0
    );
  }

  return (
    <div className="space-y-6">
      {/* Returns */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Returns</h2>
          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetTrigger
              render={
                <Button size="sm">
                  <Plus className="size-4 mr-1" />
                  Create Return
                </Button>
              }
            />
            <SheetContent side="right">
              <SheetHeader>
                <SheetTitle>Create Return</SheetTitle>
                <SheetDescription>
                  Record a supplier return with line items.
                </SheetDescription>
              </SheetHeader>
              <form
                onSubmit={handleCreateReturn}
                className="flex flex-col gap-4 px-4 flex-1 overflow-y-auto"
              >
                <div className="space-y-1.5">
                  <Label>Ticket *</Label>
                  <Select
                    value={ticketId}
                    onValueChange={(v) => setTicketId(v ?? "")}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select ticket" />
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
                  <Label>Supplier *</Label>
                  <Select
                    value={supplierId}
                    onValueChange={(v) => setSupplierId(v ?? "")}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Select supplier" />
                    </SelectTrigger>
                    <SelectContent>
                      {suppliers.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="returnDate">Return Date *</Label>
                  <Input
                    id="returnDate"
                    name="returnDate"
                    type="date"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="return-notes">Notes</Label>
                  <Textarea id="return-notes" name="notes" rows={2} />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Lines</Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={addReturnLine}
                    >
                      <Plus className="size-3 mr-1" />
                      Add Line
                    </Button>
                  </div>
                  {returnLines.map((line, idx) => (
                    <div
                      key={idx}
                      className="rounded border p-3 space-y-2 relative"
                    >
                      {returnLines.length > 1 && (
                        <button
                          type="button"
                          className="absolute top-1 right-2 text-xs text-muted-foreground hover:text-destructive"
                          onClick={() => removeReturnLine(idx)}
                        >
                          Remove
                        </button>
                      )}
                      <Input
                        placeholder="Ticket Line ID"
                        value={line.ticketLineId}
                        onChange={(e) =>
                          updateReturnLine(idx, "ticketLineId", e.target.value)
                        }
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <Input
                          placeholder="Qty Returned"
                          type="number"
                          step="0.01"
                          value={line.qtyReturned}
                          onChange={(e) =>
                            updateReturnLine(
                              idx,
                              "qtyReturned",
                              e.target.value
                            )
                          }
                        />
                        <Input
                          placeholder="Expected Credit"
                          type="number"
                          step="0.01"
                          value={line.expectedCredit}
                          onChange={(e) =>
                            updateReturnLine(
                              idx,
                              "expectedCredit",
                              e.target.value
                            )
                          }
                        />
                      </div>
                    </div>
                  ))}
                </div>

                <SheetFooter>
                  <Button type="submit" disabled={submitting}>
                    {submitting ? "Creating..." : "Create Return"}
                  </Button>
                </SheetFooter>
              </form>
            </SheetContent>
          </Sheet>
        </div>

        <div className=" border bg-background">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Supplier</TableHead>
                <TableHead>Ticket</TableHead>
                <TableHead>Return Date</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Lines</TableHead>
                <TableHead className="text-right">Expected Credit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {returns.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-center py-8 text-muted-foreground"
                  >
                    No returns recorded.
                  </TableCell>
                </TableRow>
              ) : (
                returns.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">
                      {r.supplier.name}
                    </TableCell>
                    <TableCell>{r.ticket.title}</TableCell>
                    <TableCell className="tabular-nums">
                      {fmtDate(r.returnDate)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{r.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.lines.length}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {dec(totalExpectedCredit(r.lines))}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Credit Notes placeholder */}
      <div className="space-y-3">
        <h2 className="text-lg font-medium">Credit Notes</h2>
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Credit note management coming in detail later.
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// TAB 5: MOQ / Stock / Reallocations
// ────────────────────────────────────────────────────────────────────────────

function StockTab({
  stockExcess,
  reallocations,
}: {
  stockExcess: StockExcessItem[];
  reallocations: ReallocationItem[];
}) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleReallocation(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    const fd = new FormData(e.currentTarget);

    const body = {
      fromTicketLineId: fd.get("fromTicketLineId") as string,
      toTicketLineId: fd.get("toTicketLineId") as string,
      amount: Number(fd.get("amount")) || 0,
      reason: (fd.get("reason") as string) || undefined,
    };

    try {
      const res = await fetch("/api/reallocations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setDialogOpen(false);
        router.refresh();
      }
    } finally {
      setSubmitting(false);
    }
  }

  function treatmentVariant(
    t: string
  ): "default" | "secondary" | "outline" | "destructive" {
    switch (t) {
      case "WRITE_OFF":
        return "destructive";
      case "REALLOCATE":
        return "default";
      case "HOLD":
        return "secondary";
      default:
        return "outline";
    }
  }

  return (
    <div className="space-y-6">
      {/* Stock Excess Records */}
      <div className="space-y-3">
        <h2 className="text-lg font-medium">Stock Excess Records</h2>
        <div className=" border bg-background">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Bill Line</TableHead>
                <TableHead className="text-right">Purchased Cost</TableHead>
                <TableHead className="text-right">Used Cost</TableHead>
                <TableHead className="text-right">Excess Cost</TableHead>
                <TableHead>Treatment</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stockExcess.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-center py-8 text-muted-foreground"
                  >
                    No open stock excess records.
                  </TableCell>
                </TableRow>
              ) : (
                stockExcess.map((se) => (
                  <TableRow key={se.id}>
                    <TableCell className="font-medium max-w-[200px] truncate">
                      {se.supplierBillLine?.description || se.description || "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {dec(se.purchasedCost)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {dec(se.usedCost)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {dec(se.excessCost)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={treatmentVariant(se.treatment)}>
                        {se.treatment}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{se.status}</Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Reallocations */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Reallocations</h2>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger
              render={
                <Button size="sm">
                  <ArrowRightLeft className="size-4 mr-1" />
                  Create Reallocation
                </Button>
              }
            />
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create Reallocation</DialogTitle>
                <DialogDescription>
                  Move cost from one ticket line to another.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleReallocation} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="realloc-from">From Ticket Line ID *</Label>
                  <Input
                    id="realloc-from"
                    name="fromTicketLineId"
                    required
                    placeholder="Paste ticket line ID"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="realloc-to">To Ticket Line ID *</Label>
                  <Input
                    id="realloc-to"
                    name="toTicketLineId"
                    required
                    placeholder="Paste ticket line ID"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="realloc-amount">Amount *</Label>
                  <Input
                    id="realloc-amount"
                    name="amount"
                    type="number"
                    step="0.01"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="realloc-reason">Reason</Label>
                  <Textarea id="realloc-reason" name="reason" rows={2} />
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={submitting}>
                    {submitting ? "Creating..." : "Create Reallocation"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        <div className=" border bg-background">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>From Ticket Line</TableHead>
                <TableHead>From Ticket</TableHead>
                <TableHead>To Ticket Line</TableHead>
                <TableHead>To Ticket</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reallocations.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="text-center py-8 text-muted-foreground"
                  >
                    No reallocations recorded.
                  </TableCell>
                </TableRow>
              ) : (
                reallocations.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium max-w-[150px] truncate">
                      {r.fromTicketLine.description}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {r.fromTicketLine.ticket.title}
                    </TableCell>
                    <TableCell className="font-medium max-w-[150px] truncate">
                      {r.toTicketLine.description}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {r.toTicketLine.ticket.title}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {dec(r.amount)}
                    </TableCell>
                    <TableCell className="text-muted-foreground max-w-[150px] truncate">
                      {r.reason || "\u2014"}
                    </TableCell>
                    <TableCell className="text-muted-foreground tabular-nums">
                      {fmtDate(r.createdAt)}
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
