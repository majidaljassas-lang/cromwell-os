"use client";

import { Fragment, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

type Decimal = { toString(): string } | string | number | null;

function money(val: Decimal): string {
  if (val === null || val === undefined) return "\u2014";
  return `\u00A3${Number(val.toString()).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function num(val: Decimal): number {
  if (val === null || val === undefined) return 0;
  return Number(val.toString());
}

function pct(val: Decimal): string {
  if (val === null || val === undefined) return "\u2014";
  return `${Number(val.toString()).toFixed(1)}%`;
}

function marginColor(margin: number): string {
  if (margin >= 20) return "text-green-600 dark:text-green-400";
  if (margin >= 10) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

type SiteProfit = {
  siteId: string;
  siteName: string;
  totalRevenue: Decimal;
  totalCost: Decimal;
  absorbedCosts: Decimal;
  profit: Decimal;
  marginPct: Decimal;
};

type CustomerProfit = {
  customerId: string;
  customerName: string;
  totalRevenue: Decimal;
  totalCost: Decimal;
  absorbedCosts: Decimal;
  profit: Decimal;
  marginPct: Decimal;
};

type POUtil = {
  id: string;
  poNo: string;
  poType: string;
  customerName: string;
  ticketTitle: string | null;
  limit: Decimal;
  consumed: Decimal;
  remaining: Decimal;
  profit: Decimal;
  utilisationPct: number;
  status: string;
};

type RecoveryAge = {
  id: string;
  ticketId: string;
  ticketTitle: string;
  customerName: string;
  recoveryStatus: string;
  stuckValue: Decimal;
  daysOpen: number | null;
  daysInCurrentStage: number | null;
  nextAction: string | null;
};

type AbsorbedCost = {
  ticketId: string;
  ticketTitle: string;
  totalAbsorbed: Decimal;
  lineItems: {
    id: string;
    description: string | null;
    amount: Decimal;
    basis: string | null;
    supplierBillLine: { description: string | null; lineTotal: Decimal } | null;
  }[];
};

type UnallocatedCost = {
  id: string;
  description: string | null;
  quantity: Decimal;
  unitCost: Decimal;
  lineTotal: Decimal;
  allocationStatus: string;
  supplierBill: {
    billNo: string;
    supplier: { name: string };
  };
};

function statusBadgeColor(status: string): string {
  switch (status) {
    case "OPEN":
      return "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300";
    case "EVIDENCE_BUILDING":
      return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300";
    case "PACK_READY":
    case "PACK_SENT_FOR_PO":
      return "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300";
    case "AWAITING_PO":
      return "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300";
    case "PO_RECEIVED":
    case "PO_ALLOCATED":
      return "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300";
    case "CLOSED":
      return "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300";
    default:
      return "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300";
  }
}

export function ReportsView({
  siteProfitability,
  customerProfitability,
  poUtilisation,
  recoveryAgeing,
  absorbedCosts,
  unallocatedCosts,
}: {
  siteProfitability: SiteProfit[];
  customerProfitability: CustomerProfit[];
  poUtilisation: POUtil[];
  recoveryAgeing: RecoveryAge[];
  absorbedCosts: AbsorbedCost[];
  unallocatedCosts: UnallocatedCost[];
}) {
  const [expandedTicket, setExpandedTicket] = useState<string | null>(null);

  const siteTotals = {
    revenue: siteProfitability.reduce((s, r) => s + num(r.totalRevenue), 0),
    cost: siteProfitability.reduce((s, r) => s + num(r.totalCost), 0),
    absorbed: siteProfitability.reduce((s, r) => s + num(r.absorbedCosts), 0),
    profit: siteProfitability.reduce((s, r) => s + num(r.profit), 0),
  };
  const siteMarginTotal = siteTotals.revenue ? (siteTotals.profit / siteTotals.revenue) * 100 : 0;

  const custTotals = {
    revenue: customerProfitability.reduce((s, r) => s + num(r.totalRevenue), 0),
    cost: customerProfitability.reduce((s, r) => s + num(r.totalCost), 0),
    absorbed: customerProfitability.reduce((s, r) => s + num(r.absorbedCosts), 0),
    profit: customerProfitability.reduce((s, r) => s + num(r.profit), 0),
  };
  const custMarginTotal = custTotals.revenue ? (custTotals.profit / custTotals.revenue) * 100 : 0;

  return (
    <Tabs defaultValue="site-profitability">
      <TabsList>
        <TabsTrigger value="site-profitability">Site Profitability</TabsTrigger>
        <TabsTrigger value="customer-profitability">Customer Profitability</TabsTrigger>
        <TabsTrigger value="po-utilisation">PO Utilisation</TabsTrigger>
        <TabsTrigger value="recovery-ageing">Recovery Ageing</TabsTrigger>
        <TabsTrigger value="absorbed-costs">Absorbed Costs</TabsTrigger>
        <TabsTrigger value="unallocated-costs">Unallocated Costs</TabsTrigger>
      </TabsList>

      {/* Site Profitability */}
      <TabsContent value="site-profitability">
        <div className="rounded-lg border bg-background mt-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Site Name</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">Absorbed</TableHead>
                <TableHead className="text-right">Profit</TableHead>
                <TableHead className="text-right">Margin %</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {siteProfitability.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    No site profitability data available.
                  </TableCell>
                </TableRow>
              ) : (
                siteProfitability.map((s) => (
                  <TableRow key={s.siteId}>
                    <TableCell className="font-medium">{s.siteName}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(s.totalRevenue)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(s.totalCost)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(s.absorbedCosts)}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium">{money(s.profit)}</TableCell>
                    <TableCell className={`text-right tabular-nums font-medium ${marginColor(num(s.marginPct))}`}>
                      {pct(s.marginPct)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
            {siteProfitability.length > 0 && (
              <TableFooter>
                <TableRow>
                  <TableCell className="font-bold">Totals</TableCell>
                  <TableCell className="text-right tabular-nums font-bold">{money(siteTotals.revenue)}</TableCell>
                  <TableCell className="text-right tabular-nums font-bold">{money(siteTotals.cost)}</TableCell>
                  <TableCell className="text-right tabular-nums font-bold">{money(siteTotals.absorbed)}</TableCell>
                  <TableCell className="text-right tabular-nums font-bold">{money(siteTotals.profit)}</TableCell>
                  <TableCell className={`text-right tabular-nums font-bold ${marginColor(siteMarginTotal)}`}>
                    {pct(siteMarginTotal)}
                  </TableCell>
                </TableRow>
              </TableFooter>
            )}
          </Table>
        </div>
      </TabsContent>

      {/* Customer Profitability */}
      <TabsContent value="customer-profitability">
        <div className="rounded-lg border bg-background mt-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Customer Name</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">Absorbed</TableHead>
                <TableHead className="text-right">Profit</TableHead>
                <TableHead className="text-right">Margin %</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {customerProfitability.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    No customer profitability data available.
                  </TableCell>
                </TableRow>
              ) : (
                customerProfitability.map((c) => (
                  <TableRow key={c.customerId}>
                    <TableCell className="font-medium">{c.customerName}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(c.totalRevenue)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(c.totalCost)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(c.absorbedCosts)}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium">{money(c.profit)}</TableCell>
                    <TableCell className={`text-right tabular-nums font-medium ${marginColor(num(c.marginPct))}`}>
                      {pct(c.marginPct)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
            {customerProfitability.length > 0 && (
              <TableFooter>
                <TableRow>
                  <TableCell className="font-bold">Totals</TableCell>
                  <TableCell className="text-right tabular-nums font-bold">{money(custTotals.revenue)}</TableCell>
                  <TableCell className="text-right tabular-nums font-bold">{money(custTotals.cost)}</TableCell>
                  <TableCell className="text-right tabular-nums font-bold">{money(custTotals.absorbed)}</TableCell>
                  <TableCell className="text-right tabular-nums font-bold">{money(custTotals.profit)}</TableCell>
                  <TableCell className={`text-right tabular-nums font-bold ${marginColor(custMarginTotal)}`}>
                    {pct(custMarginTotal)}
                  </TableCell>
                </TableRow>
              </TableFooter>
            )}
          </Table>
        </div>
      </TabsContent>

      {/* PO Utilisation */}
      <TabsContent value="po-utilisation">
        <div className="rounded-lg border bg-background mt-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>PO No</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Ticket</TableHead>
                <TableHead className="text-right">Limit</TableHead>
                <TableHead className="text-right">Consumed</TableHead>
                <TableHead className="text-right">Remaining</TableHead>
                <TableHead className="text-right">Profit</TableHead>
                <TableHead className="w-[140px]">Utilisation</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {poUtilisation.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                    No PO utilisation data available.
                  </TableCell>
                </TableRow>
              ) : (
                poUtilisation.map((po) => (
                  <TableRow key={po.id}>
                    <TableCell className="font-medium">{po.poNo}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{po.poType}</Badge>
                    </TableCell>
                    <TableCell>{po.customerName}</TableCell>
                    <TableCell className="max-w-[150px] truncate text-muted-foreground">
                      {po.ticketTitle || "\u2014"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{money(po.limit)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(po.consumed)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(po.remaining)}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium">{money(po.profit)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              po.utilisationPct >= 90
                                ? "bg-red-500"
                                : po.utilisationPct >= 75
                                ? "bg-amber-500"
                                : "bg-green-500"
                            }`}
                            style={{ width: `${Math.min(po.utilisationPct, 100)}%` }}
                          />
                        </div>
                        <span className="text-xs tabular-nums text-muted-foreground w-10 text-right">
                          {po.utilisationPct}%
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </TabsContent>

      {/* Recovery Ageing */}
      <TabsContent value="recovery-ageing">
        <div className="rounded-lg border bg-background mt-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ticket</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Stuck Value</TableHead>
                <TableHead className="text-right">Days Open</TableHead>
                <TableHead className="text-right">Days in Stage</TableHead>
                <TableHead>Next Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recoveryAgeing.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    No recovery ageing data available.
                  </TableCell>
                </TableRow>
              ) : (
                recoveryAgeing.map((rc) => (
                  <TableRow key={rc.id}>
                    <TableCell className="font-medium max-w-[180px] truncate">
                      {rc.ticketTitle}
                    </TableCell>
                    <TableCell>{rc.customerName}</TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${statusBadgeColor(rc.recoveryStatus)}`}>
                        {rc.recoveryStatus.replace(/_/g, " ")}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium text-red-600">
                      {money(rc.stuckValue)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {rc.daysOpen !== null ? `${rc.daysOpen}d` : "\u2014"}
                    </TableCell>
                    <TableCell className={`text-right tabular-nums ${rc.daysInCurrentStage !== null && rc.daysInCurrentStage > 14 ? "text-red-600 font-bold" : rc.daysInCurrentStage !== null && rc.daysInCurrentStage > 7 ? "text-amber-600 font-medium" : ""}`}>
                      {rc.daysInCurrentStage !== null ? `${rc.daysInCurrentStage}d` : "\u2014"}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm max-w-[180px] truncate">
                      {rc.nextAction || "\u2014"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </TabsContent>

      {/* Absorbed Costs */}
      <TabsContent value="absorbed-costs">
        <div className="rounded-lg border bg-background mt-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Ticket</TableHead>
                <TableHead className="text-right">Total Absorbed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {absorbedCosts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-center py-8 text-muted-foreground">
                    No absorbed costs data available.
                  </TableCell>
                </TableRow>
              ) : (
                absorbedCosts.map((ac) => {
                  const isExpanded = expandedTicket === ac.ticketId;
                  return (
                    <Fragment key={ac.ticketId}>
                      <TableRow
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() =>
                          setExpandedTicket(isExpanded ? null : ac.ticketId)
                        }
                      >
                        <TableCell>
                          {isExpanded ? (
                            <ChevronDown className="size-4" />
                          ) : (
                            <ChevronRight className="size-4" />
                          )}
                        </TableCell>
                        <TableCell className="font-medium">{ac.ticketTitle}</TableCell>
                        <TableCell className="text-right tabular-nums font-medium text-amber-600">
                          {money(ac.totalAbsorbed)}
                        </TableCell>
                      </TableRow>
                      {isExpanded && ac.lineItems.map((item) => (
                        <TableRow key={item.id} className="bg-muted/30">
                          <TableCell />
                          <TableCell className="text-sm text-muted-foreground pl-8">
                            {item.description || item.supplierBillLine?.description || "Allocation"}
                            {item.basis && (
                              <span className="ml-2 text-xs">({item.basis})</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-sm">
                            {money(item.amount)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </Fragment>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </TabsContent>

      {/* Unallocated Costs */}
      <TabsContent value="unallocated-costs">
        <div className="rounded-lg border bg-background mt-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Supplier</TableHead>
                <TableHead>Bill No</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Unit Cost</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {unallocatedCosts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                    No unallocated costs found.
                  </TableCell>
                </TableRow>
              ) : (
                unallocatedCosts.map((uc) => (
                  <TableRow key={uc.id}>
                    <TableCell className="font-medium">{uc.supplierBill.supplier.name}</TableCell>
                    <TableCell>{uc.supplierBill.billNo}</TableCell>
                    <TableCell className="max-w-[200px] truncate text-muted-foreground">
                      {uc.description || "\u2014"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{num(uc.quantity)}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(uc.unitCost)}</TableCell>
                    <TableCell className="text-right tabular-nums font-medium">{money(uc.lineTotal)}</TableCell>
                    <TableCell>
                      <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300">
                        {uc.allocationStatus}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <a href="/procurement" className="text-sm text-primary underline underline-offset-2 hover:text-primary/80">
                        Allocate
                      </a>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </TabsContent>
    </Tabs>
  );
}
