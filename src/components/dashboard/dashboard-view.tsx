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
  const kpiCards: KpiCardDef[] = executive
    ? [
        {
          label: "Ready to Invoice",
          value: money(executive.readyToInvoice),
          tint: "bg-[#1A1A1A] border-[#333333]",
          href: "/invoices",
          icon: <DollarSign className="size-5 text-[#FF6600]" />,
        },
        {
          label: "Stuck Revenue",
          value: money(executive.stuckRevenue),
          tint: "bg-[#1A1A1A] border-[#333333]",
          href: "/recovery",
          icon: <AlertTriangle className="size-5 text-[#FF3333]" />,
        },
        {
          label: "Active PO Remaining",
          value: money(executive.activePORemaining),
          tint: "bg-[#1A1A1A] border-[#333333]",
          href: "/po-register",
          icon: <FileBarChart className="size-5 text-[#3399FF]" />,
        },
        {
          label: "Gross Profit This Month",
          value: money(executive.grossProfitThisMonth),
          tint: "bg-[#1A1A1A] border-[#333333]",
          icon: <TrendingUp className="size-5 text-[#00CC66]" />,
        },
        {
          label: "Absorbed Cost This Month",
          value: money(executive.absorbedCostThisMonth),
          tint: "bg-[#1A1A1A] border-[#333333]",
          href: "/procurement",
          icon: <ArrowDownCircle className="size-5 text-[#FF9900]" />,
        },
        {
          label: "Cash Sales This Month",
          value: money(executive.cashSalesThisMonth),
          tint: "bg-[#1A1A1A] border-[#333333]",
          icon: <Banknote className="size-5 text-[#FF6600]" />,
        },
        {
          label: "Open Recovery Cases",
          value: String(executive.openRecoveryCases ?? "\u2014"),
          tint: "bg-[#1A1A1A] border-[#333333]",
          href: "/recovery",
          icon: <Clock className={`size-5 ${(executive.openRecoveryCases ?? 0) > 0 ? "text-[#FF3333]" : "text-[#FF6600]"}`} />,
        },
        {
          label: "Unallocated Cost Value",
          value: money(executive.unallocatedCostValue),
          tint: "bg-[#1A1A1A] border-[#333333]",
          href: "/procurement",
          icon: <AlertCircle className={`size-5 ${Number(executive.unallocatedCostValue?.toString() ?? 0) > 0 ? "text-[#FF3333]" : "text-[#FF6600]"}`} />,
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
    <div className="space-y-6">
      {/* Executive KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {kpiCards.map((card) => {
          const inner = (
            <Card
              key={card.label}
              className={`border ${card.tint} rounded-none shadow-none`}
            >
              <CardContent className="pt-4 pb-4">
                <div className="flex items-center gap-2 mb-1">
                  {card.icon}
                  <p className="text-[10px] font-medium uppercase tracking-widest text-[#888888]">
                    {card.label}
                  </p>
                </div>
                <p className="text-xl font-bold bb-mono text-[#E0E0E0]">{card.value}</p>
              </CardContent>
            </Card>
          );
          if (card.href) {
            return (
              <a key={card.label} href={card.href} className="block hover:bg-[#222222] transition-colors">
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
          <h2 className="text-xs font-bold uppercase tracking-widest text-[#888888] mb-3 bb-mono">Operations</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {alertCards.map((card) => {
              const active = card.count > 0;
              return (
                <Card
                  key={card.label}
                  className={`border-l-4 rounded-none shadow-none bg-[#1A1A1A] border-[#333333] ${
                    active ? "border-l-[#FF9900]" : "border-l-[#333333]"
                  }`}
                >
                  <CardContent className="pt-3 pb-3">
                    <p
                      className={`text-[10px] font-medium uppercase tracking-widest ${
                        active ? "text-[#E0E0E0]" : "text-[#666666]"
                      }`}
                    >
                      {card.label}
                    </p>
                    <p
                      className={`text-xl font-bold bb-mono ${
                        active ? "text-[#E0E0E0]" : "text-[#666666]"
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
        <Card className="rounded-none shadow-none bg-[#1A1A1A] border-[#333333]">
          <CardContent className="py-12 text-center text-[#888888]">
            Unable to load dashboard data. Please check the API routes are
            running.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
