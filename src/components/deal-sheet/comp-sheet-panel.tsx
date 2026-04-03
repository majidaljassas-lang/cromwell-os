"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";

type Decimal = { toString(): string } | string | number | null;

function num(val: Decimal): number {
  if (val === null || val === undefined) return 0;
  return Number(val.toString());
}

function dec(val: Decimal): string {
  if (val === null || val === undefined) return "\u2014";
  return Number(val.toString()).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

type CompSheetLine = {
  id: string;
  ticketLineId: string;
  benchmarkTotal: Decimal;
  ourCostTotal: Decimal;
  ourSaleTotal: Decimal;
  savingTotal: Decimal;
  marginTotal: Decimal;
  notes: string | null;
  ticketLine: { id: string; description: string };
};

type CompSheetData = {
  id: string;
  ticketId: string;
  versionNo: number;
  name: string;
  status: string;
  notes: string | null;
  lines: CompSheetLine[];
};

type TicketLine = { id: string; description: string };

interface CompSheetPanelProps {
  ticketId: string;
  compSheets: CompSheetData[];
  ticketLines: TicketLine[];
}

export function CompSheetPanel({
  ticketId,
  compSheets,
  ticketLines,
}: CompSheetPanelProps) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [addLineSheetId, setAddLineSheetId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [selectedLineId, setSelectedLineId] = useState("");

  async function handleCreateSheet(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    const fd = new FormData(e.currentTarget);
    try {
      const res = await fetch(`/api/tickets/${ticketId}/comp-sheets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: fd.get("name") as string,
          notes: (fd.get("notes") as string) || undefined,
        }),
      });
      if (res.ok) {
        setCreateOpen(false);
        router.refresh();
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAddLine(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!addLineSheetId) return;
    setSubmitting(true);
    const fd = new FormData(e.currentTarget);

    const benchmarkTotal = fd.get("benchmarkTotal") ? Number(fd.get("benchmarkTotal")) : null;
    const ourCostTotal = fd.get("ourCostTotal") ? Number(fd.get("ourCostTotal")) : null;
    const ourSaleTotal = fd.get("ourSaleTotal") ? Number(fd.get("ourSaleTotal")) : null;
    const saving =
      benchmarkTotal !== null && ourSaleTotal !== null
        ? benchmarkTotal - ourSaleTotal
        : null;
    const margin =
      ourSaleTotal !== null && ourCostTotal !== null
        ? ourSaleTotal - ourCostTotal
        : null;

    try {
      const res = await fetch(`/api/comp-sheets/${addLineSheetId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticketLineId: selectedLineId,
          benchmarkTotal,
          ourCostTotal,
          ourSaleTotal,
          savingTotal: saving,
          marginTotal: margin,
          notes: (fd.get("notes") as string) || undefined,
        }),
      });
      if (res.ok) {
        setAddLineSheetId(null);
        setSelectedLineId("");
        router.refresh();
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base">Comp Sheets</CardTitle>
        <Sheet open={createOpen} onOpenChange={setCreateOpen}>
          <SheetTrigger
            render={
              <Button size="sm" variant="outline">
                <Plus className="size-3.5 mr-1" />
                Create Comp Sheet
              </Button>
            }
          />
          <SheetContent side="right">
            <SheetHeader>
              <SheetTitle>Create Comp Sheet</SheetTitle>
              <SheetDescription>
                Create a competitive comparison sheet.
              </SheetDescription>
            </SheetHeader>
            <form
              onSubmit={handleCreateSheet}
              className="flex flex-col gap-4 px-4 flex-1 overflow-y-auto"
            >
              <div className="space-y-1.5">
                <Label htmlFor="cs-name">Name *</Label>
                <Input id="cs-name" name="name" required placeholder="e.g. Steel Comparison" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cs-notes">Notes</Label>
                <Textarea id="cs-notes" name="notes" placeholder="Optional" rows={3} />
              </div>
              <SheetFooter>
                <Button type="submit" disabled={submitting}>
                  {submitting ? "Creating..." : "Create"}
                </Button>
              </SheetFooter>
            </form>
          </SheetContent>
        </Sheet>
      </CardHeader>
      <CardContent className="space-y-6">
        {compSheets.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No comp sheets yet.
          </p>
        ) : (
          compSheets.map((cs) => (
            <div key={cs.id} className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{cs.name}</span>
                  <Badge variant="secondary">v{cs.versionNo}</Badge>
                  <Badge variant="outline">{cs.status}</Badge>
                </div>
                <Sheet
                  open={addLineSheetId === cs.id}
                  onOpenChange={(v) => setAddLineSheetId(v ? cs.id : null)}
                >
                  <SheetTrigger
                    render={
                      <Button size="sm" variant="ghost">
                        <Plus className="size-3.5 mr-1" />
                        Add Line
                      </Button>
                    }
                  />
                  <SheetContent side="right">
                    <SheetHeader>
                      <SheetTitle>Add Comp Sheet Line</SheetTitle>
                      <SheetDescription>
                        Add a line to {cs.name}.
                      </SheetDescription>
                    </SheetHeader>
                    <form
                      onSubmit={handleAddLine}
                      className="flex flex-col gap-4 px-4 flex-1 overflow-y-auto"
                    >
                      <div className="space-y-1.5">
                        <Label>Ticket Line</Label>
                        <Select value={selectedLineId} onValueChange={(v) => setSelectedLineId(v ?? "")}>
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Select line" />
                          </SelectTrigger>
                          <SelectContent>
                            {ticketLines.map((tl) => (
                              <SelectItem key={tl.id} value={tl.id}>
                                {tl.description}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="benchmarkTotal">Benchmark Total</Label>
                        <Input id="benchmarkTotal" name="benchmarkTotal" type="number" step="0.01" placeholder="0.00" />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="ourCostTotal">Our Cost Total</Label>
                        <Input id="ourCostTotal" name="ourCostTotal" type="number" step="0.01" placeholder="0.00" />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="ourSaleTotal">Our Sale Total</Label>
                        <Input id="ourSaleTotal" name="ourSaleTotal" type="number" step="0.01" placeholder="0.00" />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="cl-notes">Notes</Label>
                        <Textarea id="cl-notes" name="notes" placeholder="Optional" rows={2} />
                      </div>
                      <SheetFooter>
                        <Button type="submit" disabled={submitting || !selectedLineId}>
                          {submitting ? "Adding..." : "Add Line"}
                        </Button>
                      </SheetFooter>
                    </form>
                  </SheetContent>
                </Sheet>
              </div>
              {cs.lines.length > 0 && (
                <div className="rounded-lg border bg-background">
                  <Table>
                    <TableHeader>
                      <TableRow className="text-xs">
                        <TableHead>Description</TableHead>
                        <TableHead className="text-right">Benchmark</TableHead>
                        <TableHead className="text-right">Our Cost</TableHead>
                        <TableHead className="text-right">Our Sale</TableHead>
                        <TableHead className="text-right">Saving</TableHead>
                        <TableHead className="text-right">Margin</TableHead>
                        <TableHead>Notes</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {cs.lines.map((line) => (
                        <TableRow key={line.id} className="text-sm">
                          <TableCell className="font-medium">
                            {line.ticketLine.description}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {dec(line.benchmarkTotal)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {dec(line.ourCostTotal)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {dec(line.ourSaleTotal)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            <span
                              className={
                                num(line.savingTotal) >= 0
                                  ? "text-green-600"
                                  : "text-red-600"
                              }
                            >
                              {dec(line.savingTotal)}
                            </span>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            <span
                              className={
                                num(line.marginTotal) >= 0
                                  ? "text-green-600"
                                  : "text-red-600"
                              }
                            >
                              {dec(line.marginTotal)}
                            </span>
                          </TableCell>
                          <TableCell className="text-muted-foreground text-xs max-w-[120px] truncate">
                            {line.notes || "\u2014"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
