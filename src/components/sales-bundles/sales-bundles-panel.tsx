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

function dec(val: Decimal): string {
  if (val === null || val === undefined) return "\u2014";
  return Number(val.toString()).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

const BUNDLE_TYPES = [
  "SINGLE_ITEM",
  "GROUPED_MATERIALS",
  "LABOUR_BUNDLE",
  "MIXED_SCOPE",
] as const;

const PRICING_MODES = [
  "COST_PLUS",
  "MANUAL_FIXED",
  "BENCHMARK_MATCHED",
  "STRATEGIC",
] as const;

type CostLink = {
  id: string;
  ticketLineId: string;
  linkedCostValue: Decimal;
  linkedQty: Decimal;
  contributionType: string;
  ticketLine: { id: string; description: string };
};

type BundleData = {
  id: string;
  name: string;
  description: string | null;
  bundleType: string;
  pricingMode: string;
  targetSellTotal: Decimal;
  actualSellTotal: Decimal;
  status: string;
  costLinks: CostLink[];
};

type TicketLine = { id: string; description: string };

interface SalesBundlesPanelProps {
  ticketId: string;
  bundles: BundleData[];
  ticketLines: TicketLine[];
}

export function SalesBundlesPanel({
  ticketId,
  bundles,
  ticketLines,
}: SalesBundlesPanelProps) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [addLinkBundleId, setAddLinkBundleId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [bundleType, setBundleType] = useState("SINGLE_ITEM");
  const [pricingMode, setPricingMode] = useState("COST_PLUS");
  const [selectedLineId, setSelectedLineId] = useState("");

  async function handleCreateBundle(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    const fd = new FormData(e.currentTarget);
    try {
      const res = await fetch(`/api/tickets/${ticketId}/sales-bundles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: fd.get("name") as string,
          description: (fd.get("description") as string) || undefined,
          bundleType,
          pricingMode,
          targetSellTotal: fd.get("targetSellTotal")
            ? Number(fd.get("targetSellTotal"))
            : undefined,
        }),
      });
      if (res.ok) {
        setCreateOpen(false);
        setBundleType("SINGLE_ITEM");
        setPricingMode("COST_PLUS");
        router.refresh();
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAddLink(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!addLinkBundleId) return;
    setSubmitting(true);
    const fd = new FormData(e.currentTarget);
    try {
      const res = await fetch(`/api/sales-bundles/${addLinkBundleId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticketLineId: selectedLineId,
          linkedCostValue: fd.get("linkedCostValue")
            ? Number(fd.get("linkedCostValue"))
            : undefined,
          linkedQty: fd.get("linkedQty")
            ? Number(fd.get("linkedQty"))
            : undefined,
          contributionType:
            (fd.get("contributionType") as string) || "DIRECT",
        }),
      });
      if (res.ok) {
        setAddLinkBundleId(null);
        setSelectedLineId("");
        router.refresh();
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Sales Bundles</h2>
        <Sheet open={createOpen} onOpenChange={setCreateOpen}>
          <SheetTrigger
            render={
              <Button size="sm">
                <Plus className="size-4 mr-1" />
                Create Bundle
              </Button>
            }
          />
          <SheetContent side="right">
            <SheetHeader>
              <SheetTitle>Create Sales Bundle</SheetTitle>
              <SheetDescription>
                Group cost lines into a sellable bundle.
              </SheetDescription>
            </SheetHeader>
            <form
              onSubmit={handleCreateBundle}
              className="flex flex-col gap-4 px-4 flex-1 overflow-y-auto"
            >
              <div className="space-y-1.5">
                <Label htmlFor="bundle-name">Name *</Label>
                <Input
                  id="bundle-name"
                  name="name"
                  required
                  placeholder="e.g. Rebar Supply Package"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bundle-desc">Description</Label>
                <Textarea
                  id="bundle-desc"
                  name="description"
                  placeholder="Optional"
                  rows={2}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Bundle Type</Label>
                <Select value={bundleType} onValueChange={(v) => setBundleType(v ?? "SINGLE_ITEM")}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BUNDLE_TYPES.map((bt) => (
                      <SelectItem key={bt} value={bt}>
                        {bt.replace(/_/g, " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Pricing Mode</Label>
                <Select value={pricingMode} onValueChange={(v) => setPricingMode(v ?? "COST_PLUS")}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRICING_MODES.map((pm) => (
                      <SelectItem key={pm} value={pm}>
                        {pm.replace(/_/g, " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="targetSellTotal">Target Sell Total</Label>
                <Input
                  id="targetSellTotal"
                  name="targetSellTotal"
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                />
              </div>
              <SheetFooter>
                <Button type="submit" disabled={submitting}>
                  {submitting ? "Creating..." : "Create Bundle"}
                </Button>
              </SheetFooter>
            </form>
          </SheetContent>
        </Sheet>
      </div>

      {bundles.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No sales bundles yet. Create one to group cost lines.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {bundles.map((bundle) => (
            <Card key={bundle.id}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base">{bundle.name}</CardTitle>
                    <Badge variant="outline">
                      {bundle.bundleType.replace(/_/g, " ")}
                    </Badge>
                    <Badge variant="secondary">
                      {bundle.pricingMode.replace(/_/g, " ")}
                    </Badge>
                    <Badge
                      variant={
                        bundle.status === "ACTIVE" ? "default" : "outline"
                      }
                    >
                      {bundle.status}
                    </Badge>
                  </div>
                  <Sheet
                    open={addLinkBundleId === bundle.id}
                    onOpenChange={(v) =>
                      setAddLinkBundleId(v ? bundle.id : null)
                    }
                  >
                    <SheetTrigger
                      render={
                        <Button size="sm" variant="ghost">
                          <Plus className="size-3.5 mr-1" />
                          Add Cost Link
                        </Button>
                      }
                    />
                    <SheetContent side="right">
                      <SheetHeader>
                        <SheetTitle>Add Cost Link</SheetTitle>
                        <SheetDescription>
                          Link a ticket line to {bundle.name}.
                        </SheetDescription>
                      </SheetHeader>
                      <form
                        onSubmit={handleAddLink}
                        className="flex flex-col gap-4 px-4 flex-1 overflow-y-auto"
                      >
                        <div className="space-y-1.5">
                          <Label>Ticket Line</Label>
                          <Select
                            value={selectedLineId}
                            onValueChange={(v) => setSelectedLineId(v ?? "")}
                          >
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
                          <Label htmlFor="linkedCostValue">
                            Linked Cost Value
                          </Label>
                          <Input
                            id="linkedCostValue"
                            name="linkedCostValue"
                            type="number"
                            step="0.01"
                            placeholder="0.00"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="linkedQty">Linked Qty</Label>
                          <Input
                            id="linkedQty"
                            name="linkedQty"
                            type="number"
                            step="0.01"
                            placeholder="Optional"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="contributionType">
                            Contribution Type
                          </Label>
                          <Input
                            id="contributionType"
                            name="contributionType"
                            defaultValue="DIRECT"
                            placeholder="DIRECT"
                          />
                        </div>
                        <SheetFooter>
                          <Button
                            type="submit"
                            disabled={submitting || !selectedLineId}
                          >
                            {submitting ? "Adding..." : "Add Link"}
                          </Button>
                        </SheetFooter>
                      </form>
                    </SheetContent>
                  </Sheet>
                </div>
                <div className="flex gap-4 text-sm text-muted-foreground mt-1">
                  <span>
                    Target: <strong>{dec(bundle.targetSellTotal)}</strong>
                  </span>
                  <span>
                    Actual: <strong>{dec(bundle.actualSellTotal)}</strong>
                  </span>
                </div>
              </CardHeader>
              {bundle.costLinks.length > 0 && (
                <CardContent className="pt-0">
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow className="text-xs">
                          <TableHead>Line</TableHead>
                          <TableHead className="text-right">
                            Linked Cost
                          </TableHead>
                          <TableHead>Contribution</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {bundle.costLinks.map((link) => (
                          <TableRow key={link.id} className="text-sm">
                            <TableCell className="font-medium">
                              {link.ticketLine.description}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {dec(link.linkedCostValue)}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-xs">
                                {link.contributionType}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
