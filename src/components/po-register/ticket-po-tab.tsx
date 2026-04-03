"use client";

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

function utilisationColor(pct: number): string {
  if (pct > 90) return "bg-[#FF3333]";
  if (pct > 75) return "bg-[#FF9900]";
  return "bg-[#00CC66]";
}

type CustomerPOForTicket = {
  id: string;
  poNo: string;
  poType: string;
  status: string;
  totalValue: Decimal;
  poLimitValue: Decimal;
  poConsumedValue: Decimal;
  poRemainingValue: Decimal;
  profitToDate: Decimal;
  customer: { id: string; name: string };
  site: { id: string; siteName: string } | null;
  lines: any[];
  labourDrawdowns: any[];
  materialsDrawdowns: any[];
};

type TicketLineOption = { id: string; description: string };

export function TicketPOTab({
  ticketId,
  customerPOs,
  ticketLines = [],
}: {
  ticketId: string;
  customerPOs: CustomerPOForTicket[];
  ticketLines?: TicketLineOption[];
}) {
  const totalValue = customerPOs.reduce(
    (s, po) => s + n(po.poLimitValue ?? po.totalValue),
    0
  );
  const totalConsumed = customerPOs.reduce(
    (s, po) => s + n(po.poConsumedValue),
    0
  );
  const totalRemaining = customerPOs.reduce(
    (s, po) => s + n(po.poRemainingValue),
    0
  );

  return (
    <div className="space-y-4">
      <h2 className="text-[11px] uppercase tracking-widest text-[#888888] font-bold">Purchase Orders</h2>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-[#888888] uppercase tracking-wide">
              Total PO Value
            </p>
            <p className="text-xl font-semibold tabular-nums mt-1">
              {fmt(totalValue)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-[#888888] uppercase tracking-wide">
              Total Consumed
            </p>
            <p className="text-xl font-semibold tabular-nums mt-1">
              {fmt(totalConsumed)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-[#888888] uppercase tracking-wide">
              Total Remaining
            </p>
            <p className="text-xl font-semibold tabular-nums mt-1">
              {fmt(totalRemaining)}
            </p>
          </CardContent>
        </Card>
      </div>

      {customerPOs.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-[#888888]">
            No purchase orders linked to this ticket.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {customerPOs.map((po) => {
            const limit = n(po.poLimitValue ?? po.totalValue);
            const consumed = n(po.poConsumedValue);
            const remaining = n(po.poRemainingValue);
            const profit = n(po.profitToDate);
            const utilPct = limit > 0 ? (consumed / limit) * 100 : 0;

            return (
              <Card key={po.id}>
                <CardContent className="pt-4 pb-3 space-y-3">
                  {/* PO Header */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{po.poNo}</span>
                      {poTypeBadge(po.poType)}
                      <Badge variant="outline">{po.status}</Badge>
                      <span className="text-sm text-[#888888]">
                        {po.customer.name}
                      </span>
                    </div>
                    <span
                      className={`text-sm font-medium tabular-nums ${
                        profit >= 0 ? "text-[#00CC66]" : "text-[#FF3333]"
                      }`}
                    >
                      Profit: {fmt(profit)}
                    </span>
                  </div>

                  {/* Utilisation bar */}
                  <div className="flex items-center gap-3">
                    <div className="flex-1">
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
                    </div>
                    <span className="text-xs tabular-nums text-[#888888] w-10 text-right">
                      {utilPct.toFixed(0)}%
                    </span>
                  </div>

                  {/* Financials row */}
                  <div className="flex gap-6 text-sm tabular-nums">
                    <span>
                      <span className="text-[#888888]">Limit:</span>{" "}
                      {fmt(limit)}
                    </span>
                    <span>
                      <span className="text-[#888888]">Consumed:</span>{" "}
                      {fmt(consumed)}
                    </span>
                    <span>
                      <span className="text-[#888888]">Remaining:</span>{" "}
                      {fmt(remaining)}
                    </span>
                  </div>

                  {/* Recent drawdown entries */}
                  {po.poType === "DRAWDOWN_LABOUR" &&
                    po.labourDrawdowns.length > 0 && (
                      <div className="mt-2">
                        <p className="text-xs text-[#888888] mb-1">
                          Recent Labour ({po.labourDrawdowns.length} entries)
                        </p>
                        <div className="border border-[#333333] bg-[#1A1A1A]">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Date</TableHead>
                                <TableHead>Day Type</TableHead>
                                <TableHead className="text-right">
                                  Plumbers
                                </TableHead>
                                <TableHead className="text-right">
                                  Billable
                                </TableHead>
                                <TableHead className="text-right">
                                  Profit
                                </TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {po.labourDrawdowns.slice(0, 5).map((d: any) => (
                                <TableRow key={d.id}>
                                  <TableCell className="tabular-nums">
                                    {new Date(d.workDate).toLocaleDateString(
                                      "en-GB"
                                    )}
                                  </TableCell>
                                  <TableCell>
                                    <Badge
                                      variant={
                                        d.dayType === "WEEKEND"
                                          ? "destructive"
                                          : "outline"
                                      }
                                    >
                                      {d.dayType}
                                    </Badge>
                                  </TableCell>
                                  <TableCell className="text-right tabular-nums">
                                    {d.plumberCount}
                                  </TableCell>
                                  <TableCell className="text-right tabular-nums">
                                    {fmt(d.billableValue)}
                                  </TableCell>
                                  <TableCell
                                    className={`text-right tabular-nums ${
                                      n(d.grossProfitValue) >= 0
                                        ? "text-[#00CC66]"
                                        : "text-[#FF3333]"
                                    }`}
                                  >
                                    {fmt(d.grossProfitValue)}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      </div>
                    )}

                  {po.poType === "DRAWDOWN_MATERIALS" &&
                    po.materialsDrawdowns.length > 0 && (
                      <div className="mt-2">
                        <p className="text-xs text-[#888888] mb-1">
                          Recent Materials ({po.materialsDrawdowns.length}{" "}
                          entries)
                        </p>
                        <div className="border border-[#333333] bg-[#1A1A1A]">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Date</TableHead>
                                <TableHead>Description</TableHead>
                                <TableHead className="text-right">
                                  Sell
                                </TableHead>
                                <TableHead className="text-right">
                                  Cost
                                </TableHead>
                                <TableHead className="text-right">
                                  Profit
                                </TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {po.materialsDrawdowns
                                .slice(0, 5)
                                .map((d: any) => (
                                  <TableRow key={d.id}>
                                    <TableCell className="tabular-nums">
                                      {new Date(
                                        d.drawdownDate
                                      ).toLocaleDateString("en-GB")}
                                    </TableCell>
                                    <TableCell className="max-w-[150px] truncate">
                                      {d.description}
                                    </TableCell>
                                    <TableCell className="text-right tabular-nums">
                                      {fmt(d.sellValue)}
                                    </TableCell>
                                    <TableCell className="text-right tabular-nums">
                                      {fmt(d.costValueActual)}
                                    </TableCell>
                                    <TableCell
                                      className={`text-right tabular-nums ${
                                        n(d.grossProfitValue) >= 0
                                          ? "text-[#00CC66]"
                                          : "text-[#FF3333]"
                                      }`}
                                    >
                                      {fmt(d.grossProfitValue)}
                                    </TableCell>
                                  </TableRow>
                                ))}
                            </TableBody>
                          </Table>
                        </div>
                      </div>
                    )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
