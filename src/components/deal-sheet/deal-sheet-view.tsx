"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Plus, FileText, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { Separator } from "@/components/ui/separator";
import { SupplierOptionsPanel } from "./supplier-options-panel";
import { BenchmarksPanel } from "./benchmarks-panel";
import { CompSheetPanel } from "./comp-sheet-panel";

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

type TicketLine = {
  id: string;
  lineType: string;
  description: string;
  qty: Decimal;
  unit: string;
};

type LineSnapshot = {
  id: string;
  ticketLineId: string;
  versionNo: number;
  supplierSourceSummary: string | null;
  benchmarkUnit: Decimal;
  expectedCostUnit: Decimal;
  suggestedSaleUnit: Decimal;
  actualSaleUnit: Decimal;
  expectedMarginUnit: Decimal;
  notes: string | null;
  ticketLine: TicketLine;
};

type DealSheetData = {
  id: string;
  versionNo: number;
  mode: string;
  status: string;
  totalExpectedCost: Decimal;
  totalExpectedSell: Decimal;
  totalExpectedMargin: Decimal;
  totalActualCost: Decimal;
  totalActualSell: Decimal;
  totalActualMargin: Decimal;
  lineSnapshots: LineSnapshot[];
};

type SupplierOptionData = {
  id: string;
  ticketLineId: string;
  supplierId: string;
  sourceType: string;
  costUnit: Decimal;
  qtyAvailable: Decimal;
  leadTimeDays: number | null;
  isPreferred: boolean;
  notes: string | null;
  supplier: { id: string; name: string };
  ticketLine: { id: string; description: string };
};

type BenchmarkData = {
  id: string;
  ticketLineId: string;
  benchmarkSource: string;
  sourceRef: string | null;
  unitPrice: Decimal;
  qty: Decimal;
  totalPrice: Decimal;
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
  lines: {
    id: string;
    ticketLineId: string;
    benchmarkTotal: Decimal;
    ourCostTotal: Decimal;
    ourSaleTotal: Decimal;
    savingTotal: Decimal;
    marginTotal: Decimal;
    notes: string | null;
    ticketLine: { id: string; description: string };
  }[];
};

type SupplierData = { id: string; name: string };

type TicketData = {
  id: string;
  title: string;
  ticketMode: string;
  payingCustomer: { id: string; name: string };
  site: { id: string; siteName: string } | null;
  lines: TicketLine[];
};

interface DealSheetViewProps {
  ticket: TicketData;
  dealSheet: DealSheetData | null;
  supplierOptions: SupplierOptionData[];
  benchmarks: BenchmarkData[];
  compSheets: CompSheetData[];
  suppliers: SupplierData[];
}

export function DealSheetView({
  ticket,
  dealSheet,
  supplierOptions,
  benchmarks,
  compSheets,
  suppliers,
}: DealSheetViewProps) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  const createVersion = useCallback(
    async (mode?: string) => {
      setCreating(true);
      try {
        const res = await fetch(
          `/api/tickets/${ticket.id}/deal-sheet/version`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode: mode || ticket.ticketMode }),
          }
        );
        if (res.ok) router.refresh();
      } finally {
        setCreating(false);
      }
    },
    [ticket.id, ticket.ticketMode, router]
  );

  // Build a lookup: ticketLineId -> best supplier option
  const bestSupplierByLine: Record<
    string,
    { name: string; costUnit: number }
  > = {};
  for (const opt of supplierOptions) {
    const cost = num(opt.costUnit);
    const existing = bestSupplierByLine[opt.ticketLineId];
    if (!existing || cost < existing.costUnit) {
      bestSupplierByLine[opt.ticketLineId] = {
        name: opt.supplier.name,
        costUnit: cost,
      };
    }
  }

  if (!dealSheet) {
    return (
      <div className="space-y-6">
        <DealSheetHeader ticket={ticket} dealSheet={null} />
        <Card>
          <CardContent className="py-16 text-center">
            <p className="text-[#888888] mb-4">
              No deal sheet has been created for this ticket yet.
            </p>
            <Button onClick={() => createVersion()} disabled={creating}>
              {creating ? "Creating..." : "Create First Version"}
            </Button>
          </CardContent>
        </Card>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <SupplierOptionsPanel
            ticketId={ticket.id}
            supplierOptions={supplierOptions}
            ticketLines={ticket.lines}
            suppliers={suppliers}
          />
          <BenchmarksPanel
            ticketId={ticket.id}
            benchmarks={benchmarks}
            ticketLines={ticket.lines}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <DealSheetHeader
        ticket={ticket}
        dealSheet={dealSheet}
        onNewVersion={() => createVersion()}
        creating={creating}
      />

      {/* Main Pricing Table */}
      <div className="border border-[#333333] bg-[#1A1A1A] overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="text-xs">
              <TableHead className="min-w-[180px]">Description</TableHead>
              <TableHead>Type</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead>Unit</TableHead>
              <TableHead className="text-right">Supplier Best</TableHead>
              <TableHead className="text-right">Benchmark</TableHead>
              <TableHead className="text-right min-w-[100px] bg-[#222222]">
                Exp. Cost/Unit
              </TableHead>
              <TableHead className="text-right min-w-[100px] bg-[#222222]">
                Sugg. Sell/Unit
              </TableHead>
              <TableHead className="text-right min-w-[100px] bg-[#222222]">
                Actual Sell/Unit
              </TableHead>
              <TableHead className="text-right">Margin/Unit</TableHead>
              <TableHead className="min-w-[120px] bg-[#222222]">
                Notes
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {dealSheet.lineSnapshots.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={11}
                  className="text-center py-8 text-[#888888]"
                >
                  No line snapshots in this deal sheet version.
                </TableCell>
              </TableRow>
            ) : (
              dealSheet.lineSnapshots.map((snap) => (
                <DealSheetLineRow
                  key={snap.id}
                  snapshot={snap}
                  bestSupplier={bestSupplierByLine[snap.ticketLineId]}
                />
              ))
            )}
          </TableBody>
          {dealSheet.lineSnapshots.length > 0 && (
            <tfoot>
              <TotalsRow snapshots={dealSheet.lineSnapshots} />
            </tfoot>
          )}
        </Table>
      </div>

      {/* Side panels */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SupplierOptionsPanel
          ticketId={ticket.id}
          supplierOptions={supplierOptions}
          ticketLines={ticket.lines}
          suppliers={suppliers}
        />
        <BenchmarksPanel
          ticketId={ticket.id}
          benchmarks={benchmarks}
          ticketLines={ticket.lines}
        />
      </div>

      {/* Comp Sheets */}
      <CompSheetPanel
        ticketId={ticket.id}
        compSheets={compSheets}
        ticketLines={ticket.lines}
      />
    </div>
  );
}

function DealSheetHeader({
  ticket,
  dealSheet,
  onNewVersion,
  creating,
}: {
  ticket: { id: string; title: string; ticketMode: string; payingCustomer: { name: string }; site: { siteName: string } | null };
  dealSheet: DealSheetData | null;
  onNewVersion?: () => void;
  creating?: boolean;
}) {
  return (
    <div className="flex items-start justify-between flex-wrap gap-4">
      <div className="space-y-1">
        <h1 className="text-[11px] uppercase tracking-widest text-[#888888] font-bold">Deal Sheet</h1>
        <div className="flex items-center gap-2 text-sm text-[#888888]">
          <span>{ticket.title}</span>
          <span>/</span>
          <span>{ticket.payingCustomer.name}</span>
          {ticket.site && (
            <>
              <span>/</span>
              <span>{ticket.site.siteName}</span>
            </>
          )}
          <Badge variant="outline">
            {ticket.ticketMode.replace(/_/g, " ")}
          </Badge>
        </div>
        {dealSheet && (
          <div className="flex items-center gap-2 mt-1">
            <Badge variant="secondary">v{dealSheet.versionNo}</Badge>
            <Badge
              variant={
                dealSheet.status === "ACTIVE"
                  ? "default"
                  : dealSheet.status === "DRAFT"
                  ? "outline"
                  : "secondary"
              }
            >
              {dealSheet.status}
            </Badge>
          </div>
        )}
      </div>
      {dealSheet && onNewVersion && (
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onNewVersion}
            disabled={creating}
          >
            <RefreshCw className="size-4 mr-1" />
            {creating ? "Creating..." : "New Version"}
          </Button>
          <a href={`/tickets/${ticket.id}/deal-sheet`}>
            <Button size="sm">
              <FileText className="size-4 mr-1" />
              Generate Quote
            </Button>
          </a>
        </div>
      )}
    </div>
  );
}

function DealSheetLineRow({
  snapshot,
  bestSupplier,
}: {
  snapshot: LineSnapshot;
  bestSupplier?: { name: string; costUnit: number };
}) {
  const router = useRouter();
  const [expectedCost, setExpectedCost] = useState(
    snapshot.expectedCostUnit !== null ? num(snapshot.expectedCostUnit).toString() : ""
  );
  const [suggestedSell, setSuggestedSell] = useState(
    snapshot.suggestedSaleUnit !== null ? num(snapshot.suggestedSaleUnit).toString() : ""
  );
  const [actualSell, setActualSell] = useState(
    snapshot.actualSaleUnit !== null ? num(snapshot.actualSaleUnit).toString() : ""
  );
  const [notes, setNotes] = useState(snapshot.notes || "");

  const saveField = useCallback(
    async (field: string, value: string) => {
      const body: Record<string, unknown> = {};
      if (field === "notes") {
        body[field] = value;
      } else {
        body[field] = value ? Number(value) : null;
      }
      await fetch(`/api/deal-sheet-lines/${snapshot.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      router.refresh();
    },
    [snapshot.id, router]
  );

  const marginUnit = (Number(suggestedSell) || 0) - (Number(expectedCost) || 0);

  return (
    <TableRow className="text-sm">
      <TableCell className="font-medium max-w-[200px] truncate">
        {snapshot.ticketLine.description}
      </TableCell>
      <TableCell>
        <Badge variant="outline" className="text-xs">
          {snapshot.ticketLine.lineType.replace(/_/g, " ")}
        </Badge>
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {dec(snapshot.ticketLine.qty)}
      </TableCell>
      <TableCell className="text-[#888888] text-xs">
        {snapshot.ticketLine.unit}
      </TableCell>
      <TableCell className="text-right">
        {bestSupplier ? (
          <div>
            <span className="tabular-nums">{dec(bestSupplier.costUnit)}</span>
            <div className="text-xs text-[#888888]">{bestSupplier.name}</div>
          </div>
        ) : (
          <span className="text-[#888888]">&mdash;</span>
        )}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {dec(snapshot.benchmarkUnit)}
      </TableCell>
      <TableCell className="text-right bg-[#222222]">
        <Input
          type="number"
          step="0.01"
          value={expectedCost}
          onChange={(e) => setExpectedCost(e.target.value)}
          onBlur={() => saveField("expectedCostUnit", expectedCost)}
          className="h-7 w-24 text-right tabular-nums text-sm border-dashed ml-auto"
          placeholder="0.00"
        />
      </TableCell>
      <TableCell className="text-right bg-[#222222]">
        <Input
          type="number"
          step="0.01"
          value={suggestedSell}
          onChange={(e) => setSuggestedSell(e.target.value)}
          onBlur={() => saveField("suggestedSaleUnit", suggestedSell)}
          className="h-7 w-24 text-right tabular-nums text-sm border-dashed ml-auto"
          placeholder="0.00"
        />
      </TableCell>
      <TableCell className="text-right bg-[#222222]">
        <Input
          type="number"
          step="0.01"
          value={actualSell}
          onChange={(e) => setActualSell(e.target.value)}
          onBlur={() => saveField("actualSaleUnit", actualSell)}
          className="h-7 w-24 text-right tabular-nums text-sm border-dashed ml-auto"
          placeholder="0.00"
        />
      </TableCell>
      <TableCell className="text-right tabular-nums">
        <span className={marginUnit >= 0 ? "text-[#00CC66]" : "text-[#FF3333]"}>
          {marginUnit.toLocaleString("en-GB", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
        </span>
      </TableCell>
      <TableCell className="bg-[#222222]">
        <Input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => saveField("notes", notes)}
          className="h-7 w-28 text-xs border-dashed"
          placeholder="Notes..."
        />
      </TableCell>
    </TableRow>
  );
}

function TotalsRow({ snapshots }: { snapshots: LineSnapshot[] }) {
  let totalCost = 0;
  let totalSuggestedSell = 0;
  let totalMargin = 0;

  for (const snap of snapshots) {
    const qty = num(snap.ticketLine.qty);
    const cost = num(snap.expectedCostUnit);
    const sell = num(snap.suggestedSaleUnit);
    totalCost += cost * qty;
    totalSuggestedSell += sell * qty;
    totalMargin += (sell - cost) * qty;
  }

  const marginPct =
    totalSuggestedSell > 0
      ? ((totalMargin / totalSuggestedSell) * 100).toFixed(1)
      : "0.0";

  return (
    <tr className="border-t-2 font-semibold text-sm">
      <td colSpan={6} className="px-4 py-2 text-right">
        Totals
      </td>
      <td className="px-4 py-2 text-right tabular-nums">{dec(totalCost)}</td>
      <td className="px-4 py-2 text-right tabular-nums">
        {dec(totalSuggestedSell)}
      </td>
      <td className="px-4 py-2" />
      <td className="px-4 py-2 text-right tabular-nums">
        <span className={totalMargin >= 0 ? "text-[#00CC66]" : "text-[#FF3333]"}>
          {dec(totalMargin)} ({marginPct}%)
        </span>
      </td>
      <td className="px-4 py-2" />
    </tr>
  );
}
