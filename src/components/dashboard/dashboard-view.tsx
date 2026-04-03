"use client";

import {
  DollarSign,
  AlertTriangle,
  FileBarChart,
  TrendingUp,
  ArrowDownCircle,
  Banknote,
  Clock,
  AlertCircle,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { type ReactNode } from "react";

type Decimal = { toString(): string } | string | number | null;

function money(val: Decimal): string {
  if (val === null || val === undefined) return "\u2014";
  return `\u00A3${Number(val || 0).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

type ExecutiveData = {
  readyToInvoice: Decimal;
  stuckRevenue: Decimal;
  activePORemaining: Decimal;
  grossProfitThisMonth: Decimal;
  absorbedCostThisMonth: Decimal;
  cashSalesThisMonth: Decimal;
  openRecoveryCases: number | null;
  unallocatedCostValue: Decimal;
};

type OperationsData = {
  openInquiriesNoSite: number | null;
  openInquiriesNoCustomer: number | null;
  ticketsAwaitingCost: number | null;
  ticketsAwaitingPO: number | null;
  ticketsMissingEvidence: number | null;
  unmatchedSupplierBills: number | null;
  returnsNotCredited: number | null;
  absorbedCostUnresolved: number | null;
};

type KpiCardDef = {
  label: string;
  value: string;
  tint: string;
  href?: string;
  icon: ReactNode;
};

type AlertCardDef = {
  label: string;
  count: number;
};

export function DashboardView({
  executive,
  operations,
}: {
  executive: ExecutiveData | null;
  operations: OperationsData | null;
}) {
  const iconClass = "size-5 text-muted-foreground";

  const kpiCards: KpiCardDef[] = executive
    ? [
        {
          label: "Ready to Invoice",
          value: money(executive.readyToInvoice),
          tint: "bg-green-50 border-green-200",
          href: "/invoices",
          icon: <DollarSign className={iconClass} />,
        },
        {
          label: "Stuck Revenue",
          value: money(executive.stuckRevenue),
          tint: "bg-red-50 border-red-200",
          href: "/recovery",
          icon: <AlertTriangle className={iconClass} />,
        },
        {
          label: "Active PO Remaining",
          value: money(executive.activePORemaining),
          tint: "bg-blue-50 border-blue-200",
          href: "/po-register",
          icon: <FileBarChart className={iconClass} />,
        },
        {
          label: "Gross Profit This Month",
          value: money(executive.grossProfitThisMonth),
          tint: "bg-green-50 border-green-200",
          icon: <TrendingUp className={iconClass} />,
        },
        {
          label: "Absorbed Cost This Month",
          value: money(executive.absorbedCostThisMonth),
          tint: "bg-amber-50 border-amber-200",
          href: "/procurement",
          icon: <ArrowDownCircle className={iconClass} />,
        },
        {
          label: "Cash Sales This Month",
          value: money(executive.cashSalesThisMonth),
          tint: "bg-slate-50",
          icon: <Banknote className={iconClass} />,
        },
        {
          label: "Open Recovery Cases",
          value: String(executive.openRecoveryCases ?? "\u2014"),
          tint:
            (executive.openRecoveryCases ?? 0) > 0
              ? "bg-red-50 border-red-200"
              : "bg-slate-50",
          href: "/recovery",
          icon: <Clock className={iconClass} />,
        },
        {
          label: "Unallocated Cost Value",
          value: money(executive.unallocatedCostValue),
          tint:
            Number(executive.unallocatedCostValue?.toString() ?? 0) > 0
              ? "bg-red-50 border-red-200"
              : "bg-slate-50",
          href: "/procurement",
          icon: <AlertCircle className={iconClass} />,
        },
      ]
    : [];

  const alertCards: AlertCardDef[] = operations
    ? [
        { label: "Inquiries: No Site", count: operations.openInquiriesNoSite ?? 0 },
        { label: "Inquiries: No Customer", count: operations.openInquiriesNoCustomer ?? 0 },
        { label: "Tickets: Awaiting Cost", count: operations.ticketsAwaitingCost ?? 0 },
        { label: "Tickets: Awaiting PO", count: operations.ticketsAwaitingPO ?? 0 },
        { label: "Tickets: Missing Evidence", count: operations.ticketsMissingEvidence ?? 0 },
        { label: "Costs: Unmatched Bills", count: operations.unmatchedSupplierBills ?? 0 },
        { label: "Costs: Returns Not Credited", count: operations.returnsNotCredited ?? 0 },
        { label: "Costs: Absorbed Unresolved", count: operations.absorbedCostUnresolved ?? 0 },
      ]
    : [];

  return (
    <div className="space-y-8">
      {/* Executive KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpiCards.map((card) => {
          const inner = (
            <Card
              key={card.label}
              className={`border ${card.tint} transition-shadow hover:shadow-md`}
            >
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-2 mb-1">
                  {card.icon}
                  <p className="text-xs font-medium text-muted-foreground">
                    {card.label}
                  </p>
                </div>
                <p className="text-2xl font-bold tabular-nums">{card.value}</p>
              </CardContent>
            </Card>
          );
          if (card.href) {
            return (
              <a key={card.label} href={card.href} className="block">
                {inner}
              </a>
            );
          }
          return <div key={card.label}>{inner}</div>;
        })}
      </div>

      {/* Operations Alert Grid */}
      {alertCards.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-3">Operations</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {alertCards.map((card) => {
              const active = card.count > 0;
              return (
                <Card
                  key={card.label}
                  className={`border-l-4 ${
                    active ? "border-l-amber-400" : "border-l-gray-200"
                  }`}
                >
                  <CardContent className="pt-3 pb-3">
                    <p
                      className={`text-xs font-medium ${
                        active ? "text-foreground" : "text-muted-foreground"
                      }`}
                    >
                      {card.label}
                    </p>
                    <p
                      className={`text-2xl font-bold tabular-nums ${
                        active ? "text-foreground" : "text-muted-foreground"
                      }`}
                    >
                      {card.count}
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {!executive && !operations && (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Unable to load dashboard data. Please check the API routes are
            running.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
