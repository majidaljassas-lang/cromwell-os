"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

type Decimal = { toString(): string } | string | number | null;

function dec(val: Decimal): string {
  if (val === null || val === undefined) return "\u2014";
  return Number(val.toString()).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function statusVariant(
  status: string
): "default" | "secondary" | "outline" | "destructive" {
  switch (status) {
    case "MATCHED":
    case "CONFIRMED":
    case "DELIVERED":
      return "default";
    case "PARTIAL":
    case "SUGGESTED":
    case "ISSUED":
      return "secondary";
    case "EXCEPTION":
    case "UNALLOCATED":
      return "destructive";
    default:
      return "outline";
  }
}

type ProcurementOrderLine = {
  id: string;
  description: string;
  qty: Decimal;
  unitCost: Decimal;
  lineTotal: Decimal;
  ticketLine: { id: string; description: string };
};

type ProcurementOrder = {
  id: string;
  poNo: string;
  status: string;
  totalCostExpected: Decimal;
  supplier: { id: string; name: string };
  lines: ProcurementOrderLine[];
};

type CostAllocationItem = {
  id: string;
  qtyAllocated: Decimal;
  unitCost: Decimal;
  totalCost: Decimal;
  allocationStatus: string;
  confidenceScore: Decimal;
  ticketLine: { id: string; description: string };
  supplierBillLine: {
    id: string;
    description: string;
    supplierBill: { id: string; billNo: string };
  };
  supplier: { id: string; name: string };
};

type AbsorbedCostItem = {
  id: string;
  description: string;
  amount: Decimal;
  allocationBasis: string | null;
  supplierBillLine: { id: string; description: string };
};

type SupplierOption = { id: string; name: string };
type TicketLineOption = { id: string; description: string };

type Props = {
  ticketId: string;
  procurementOrders: ProcurementOrder[];
  supplierBills: any[];
  costAllocations: CostAllocationItem[];
  absorbedCosts: AbsorbedCostItem[];
  suppliers: SupplierOption[];
  ticketLines: TicketLineOption[];
};

export function TicketProcurementTab({
  ticketId,
  procurementOrders,
  costAllocations,
  absorbedCosts,
  suppliers,
  ticketLines,
}: Props) {
  const router = useRouter();
  const [poSheetOpen, setPoSheetOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [poLines, setPoLines] = useState([
    { ticketLineId: "", description: "", qty: "1", unitCost: "0", lineTotal: "0" },
  ]);

  // Summary calculations
  const totalOrdered = procurementOrders.reduce(
    (sum, po) => sum + Number(po.totalCostExpected?.toString() ?? 0),
    0
  );
  const totalAllocated = costAllocations.reduce(
    (sum, ca) => sum + Number(ca.totalCost?.toString() ?? 0),
    0
  );
  const totalAbsorbed = absorbedCosts.reduce(
    (sum, ac) => sum + Number(ac.amount?.toString() ?? 0),
    0
  );
  const unallocatedCount = costAllocations.filter(
    (ca) => ca.allocationStatus !== "MATCHED"
  ).length;

  function updatePoLine(idx: number, field: string, value: string) {
    setPoLines((prev) => {
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

  function addPoLine() {
    setPoLines((prev) => [
      ...prev,
      { ticketLineId: "", description: "", qty: "1", unitCost: "0", lineTotal: "0" },
    ]);
  }

  function removePoLine(idx: number) {
    setPoLines((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleCreatePO(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    const fd = new FormData(e.currentTarget);

    const body = {
      ticketId,
      supplierId,
      poNo: fd.get("poNo") as string,
      supplierRef: (fd.get("supplierRef") as string) || undefined,
      siteRef: (fd.get("siteRef") as string) || undefined,
      lines: poLines
        .filter((l) => l.description.trim())
        .map((l) => ({
          ticketLineId: l.ticketLineId || undefined,
          description: l.description,
          qty: Number(l.qty) || 1,
          unitCost: Number(l.unitCost) || 0,
          lineTotal: Number(l.lineTotal) || 0,
        })),
    };

    try {
      const res = await fetch("/api/procurement-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setPoSheetOpen(false);
        setSupplierId("");
        setPoLines([
          { ticketLineId: "", description: "", qty: "1", unitCost: "0", lineTotal: "0" },
        ]);
        router.refresh();
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Total Ordered Cost</p>
            <p className="text-xl font-semibold tabular-nums">{dec(totalOrdered)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Total Allocated Cost</p>
            <p className="text-xl font-semibold tabular-nums">{dec(totalAllocated)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Total Absorbed</p>
            <p className="text-xl font-semibold tabular-nums">{dec(totalAbsorbed)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">Unallocated</p>
            <p className="text-xl font-semibold tabular-nums">{unallocatedCount}</p>
          </CardContent>
        </Card>
      </div>

      {/* Procurement Orders */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-medium">
            Procurement Orders ({procurementOrders.length})
          </h3>
          <Sheet open={poSheetOpen} onOpenChange={setPoSheetOpen}>
            <SheetTrigger
              render={
                <Button size="sm">
                  <Plus className="size-4 mr-1" />
                  Create PO
                </Button>
              }
            />
            <SheetContent side="right">
              <SheetHeader>
                <SheetTitle>Create Procurement Order</SheetTitle>
                <SheetDescription>
                  Create a new purchase order for this ticket.
                </SheetDescription>
              </SheetHeader>
              <form
                onSubmit={handleCreatePO}
                className="flex flex-col gap-4 px-4 flex-1 overflow-y-auto"
              >
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
                  <Label htmlFor="poNo">PO Number *</Label>
                  <Input id="poNo" name="poNo" required />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="supplierRef">Supplier Ref</Label>
                    <Input id="supplierRef" name="supplierRef" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="po-siteRef">Site Ref</Label>
                    <Input id="po-siteRef" name="siteRef" />
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Lines</Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={addPoLine}
                    >
                      <Plus className="size-3 mr-1" />
                      Add Line
                    </Button>
                  </div>
                  {poLines.map((line, idx) => (
                    <div
                      key={idx}
                      className="rounded border p-3 space-y-2 relative"
                    >
                      {poLines.length > 1 && (
                        <button
                          type="button"
                          className="absolute top-1 right-2 text-xs text-muted-foreground hover:text-destructive"
                          onClick={() => removePoLine(idx)}
                        >
                          Remove
                        </button>
                      )}
                      <Select
                        value={line.ticketLineId}
                        onValueChange={(v) =>
                          updatePoLine(idx, "ticketLineId", v ?? "")
                        }
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Link to ticket line (optional)" />
                        </SelectTrigger>
                        <SelectContent>
                          {ticketLines.map((tl) => (
                            <SelectItem key={tl.id} value={tl.id}>
                              {tl.description}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        placeholder="Description"
                        value={line.description}
                        onChange={(e) =>
                          updatePoLine(idx, "description", e.target.value)
                        }
                      />
                      <div className="grid grid-cols-3 gap-2">
                        <Input
                          placeholder="Qty"
                          type="number"
                          step="0.01"
                          value={line.qty}
                          onChange={(e) =>
                            updatePoLine(idx, "qty", e.target.value)
                          }
                        />
                        <Input
                          placeholder="Unit Cost"
                          type="number"
                          step="0.01"
                          value={line.unitCost}
                          onChange={(e) =>
                            updatePoLine(idx, "unitCost", e.target.value)
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
                    {submitting ? "Creating..." : "Create PO"}
                  </Button>
                </SheetFooter>
              </form>
            </SheetContent>
          </Sheet>
        </div>

        <div className="rounded-lg border bg-background">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>PO No</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Total Cost</TableHead>
                <TableHead className="text-right">Lines</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {procurementOrders.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="text-center py-6 text-muted-foreground"
                  >
                    No procurement orders for this ticket.
                  </TableCell>
                </TableRow>
              ) : (
                procurementOrders.map((po) => (
                  <TableRow key={po.id}>
                    <TableCell className="font-medium">{po.poNo}</TableCell>
                    <TableCell>{po.supplier.name}</TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(po.status)}>
                        {po.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {dec(po.totalCostExpected)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {po.lines.length}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Cost Allocations for this ticket */}
      <div className="space-y-3">
        <h3 className="text-base font-medium">
          Cost Allocations ({costAllocations.length})
        </h3>
        <div className="rounded-lg border bg-background">
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
              </TableRow>
            </TableHeader>
            <TableBody>
              {costAllocations.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="text-center py-6 text-muted-foreground"
                  >
                    No cost allocations for this ticket.
                  </TableCell>
                </TableRow>
              ) : (
                costAllocations.map((ca) => (
                  <TableRow key={ca.id}>
                    <TableCell className="font-medium max-w-[150px] truncate">
                      {ca.ticketLine.description}
                    </TableCell>
                    <TableCell className="max-w-[150px] truncate">
                      {ca.supplierBillLine.description}
                    </TableCell>
                    <TableCell>{ca.supplier.name}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {dec(ca.qtyAllocated)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {dec(ca.unitCost)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {dec(ca.totalCost)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(ca.allocationStatus)}>
                        {ca.allocationStatus}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Absorbed Costs for this ticket */}
      <div className="space-y-3">
        <h3 className="text-base font-medium">
          Absorbed Costs ({absorbedCosts.length})
        </h3>
        {absorbedCosts.length === 0 ? (
          <Card>
            <CardContent className="py-6 text-center text-muted-foreground">
              No absorbed costs for this ticket.
            </CardContent>
          </Card>
        ) : (
          <div className="rounded-lg border bg-background">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead>Bill Line</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Basis</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {absorbedCosts.map((ac) => (
                  <TableRow key={ac.id}>
                    <TableCell className="font-medium">
                      {ac.description}
                    </TableCell>
                    <TableCell className="max-w-[180px] truncate">
                      {ac.supplierBillLine.description}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {dec(ac.amount)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {ac.allocationBasis || "\u2014"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
