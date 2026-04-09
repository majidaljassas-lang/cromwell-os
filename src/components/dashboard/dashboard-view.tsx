"use client";

import Link from "next/link";
import {
  Inbox,
  Ticket,
  MessageSquareQuote,
  ClipboardList,
  Truck,
  FileText,
  AlertTriangle,
  Banknote,
  TrendingUp,
  ArrowDownCircle,
  PieChart,
  DollarSign,
  Wallet,
  Receipt,
  Package,
  ShieldAlert,
  FileWarning,
  CircleDollarSign,
  Undo2,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { type ReactNode } from "react";

// ── Types ────────────────────────────────────────────────────────────────────

type ActionCardsData = {
  inboxCount: number;
  openTickets: number;
  quotesAwaitingResponse: number;
  posAwaiting: number;
  deliveriesExpected: number;
  invoicesToSend: number;
  overdueInvoices: number;
  paymentsThisMonth: number;
};

type FinancialsData = {
  revenue: number;
  costs: number;
  grossProfit: number;
  marginPct: number;
  cashSalesThisMonth: number;
  outstandingReceivables: number;
};

type AlertsData = {
  inboxNeedsTriage: number;
  ticketsNoLines: number;
  linesNoCost: number;
  ordersNotAcknowledged: number;
  deliveriesOverdue: number;
  billsUnmatched: number;
  returnsAwaitingCredit: number;
};

type DashboardData = {
  actionCards: ActionCardsData;
  financials: FinancialsData;
  alerts: AlertsData;
} | null;

// ── Helpers ──────────────────────────────────────────────────────────────────

function money(val: number | null | undefined): string {
  if (val === null || val === undefined) return "\u2014";
  return `\u00A3${Number(val).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function pct(val: number | null | undefined): string {
  if (val === null || val === undefined) return "\u2014";
  return `${Number(val).toFixed(1)}%`;
}

// ── Sub-components ───────────────────────────────────────────────────────────

function ActionCard({
  label,
  value,
  icon,
  href,
  isAlert,
}: {
  label: string;
  value: string;
  icon: ReactNode;
  href?: string;
  isAlert?: boolean;
}) {
  const isZero = value === "0" || value === "\u00A30.00";
  const borderClass = isAlert
    ? "border-l-4 border-l-[#FF3333]"
    : isZero
      ? "border-l-4 border-l-[#333333]"
      : "border-l-4 border-l-[#FF6600]";

  const content = (
    <Card
      className={`${borderClass} rounded-none shadow-none bg-[#1A1A1A] border-[#333333]`}
    >
      <CardContent className="pt-4 pb-4">
        <div className="flex items-center gap-2 mb-1">
          {icon}
          <p className="text-[10px] font-medium uppercase tracking-widest text-[#888888]">
            {label}
          </p>
        </div>
        <p
          className={`text-2xl font-bold bb-mono ${
            isZero ? "text-[#555555]" : isAlert ? "text-[#FF3333]" : "text-[#E0E0E0]"
          }`}
        >
          {value}
        </p>
      </CardContent>
    </Card>
  );

  if (href) {
    return (
      <Link href={href} className="block hover:bg-[#222222] transition-colors">
        {content}
      </Link>
    );
  }
  return content;
}

function FinancialCard({
  label,
  value,
  icon,
  highlight,
}: {
  label: string;
  value: string;
  icon: ReactNode;
  highlight?: "green" | "red" | "orange";
}) {
  const isZero = value === "\u00A30.00" || value === "0.0%";
  const textColor = isZero
    ? "text-[#555555]"
    : highlight === "green"
      ? "text-[#00CC66]"
      : highlight === "red"
        ? "text-[#FF3333]"
        : highlight === "orange"
          ? "text-[#FF9900]"
          : "text-[#E0E0E0]";

  return (
    <Card className="rounded-none shadow-none bg-[#1A1A1A] border-[#333333]">
      <CardContent className="pt-4 pb-4">
        <div className="flex items-center gap-2 mb-1">
          {icon}
          <p className="text-[10px] font-medium uppercase tracking-widest text-[#888888]">
            {label}
          </p>
        </div>
        <p className={`text-xl font-bold bb-mono ${textColor}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

function AlertCard({
  label,
  count,
  icon,
  severity,
}: {
  label: string;
  count: number;
  icon: ReactNode;
  severity: "orange" | "red";
}) {
  const borderColor =
    severity === "red" ? "border-l-[#FF3333]" : "border-l-[#FF9900]";
  const textColor =
    severity === "red" ? "text-[#FF3333]" : "text-[#FF9900]";

  return (
    <Card
      className={`border-l-4 ${borderColor} rounded-none shadow-none bg-[#1A1A1A] border-[#333333]`}
    >
      <CardContent className="pt-3 pb-3">
        <div className="flex items-center gap-2 mb-1">
          {icon}
          <p className="text-[10px] font-medium uppercase tracking-widest text-[#E0E0E0]">
            {label}
          </p>
        </div>
        <p className={`text-xl font-bold bb-mono ${textColor}`}>{count}</p>
      </CardContent>
    </Card>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export function DashboardView({ executive }: { executive: DashboardData }) {
  if (!executive) {
    return (
      <Card className="rounded-none shadow-none bg-[#1A1A1A] border-[#333333]">
        <CardContent className="py-12 text-center text-[#888888]">
          Unable to load dashboard data. Please check the API routes are running.
        </CardContent>
      </Card>
    );
  }

  const { actionCards, financials, alerts } = executive;

  // Build active alerts (only show if count > 0)
  const activeAlerts: { label: string; count: number; icon: ReactNode; severity: "orange" | "red" }[] = [];

  if (alerts.inboxNeedsTriage > 0) {
    activeAlerts.push({
      label: "Inbox Needs Triage",
      count: alerts.inboxNeedsTriage,
      icon: <Inbox className="size-4 text-[#FF9900]" />,
      severity: "orange",
    });
  }
  if (alerts.ticketsNoLines > 0) {
    activeAlerts.push({
      label: "Tickets With No Lines",
      count: alerts.ticketsNoLines,
      icon: <FileWarning className="size-4 text-[#FF9900]" />,
      severity: "orange",
    });
  }
  if (alerts.linesNoCost > 0) {
    activeAlerts.push({
      label: "Lines With No Cost",
      count: alerts.linesNoCost,
      icon: <CircleDollarSign className="size-4 text-[#FF9900]" />,
      severity: "orange",
    });
  }
  if (alerts.ordersNotAcknowledged > 0) {
    activeAlerts.push({
      label: "Orders Not Acknowledged",
      count: alerts.ordersNotAcknowledged,
      icon: <Package className="size-4 text-[#FF9900]" />,
      severity: "orange",
    });
  }
  if (alerts.deliveriesOverdue > 0) {
    activeAlerts.push({
      label: "Deliveries Overdue",
      count: alerts.deliveriesOverdue,
      icon: <Truck className="size-4 text-[#FF3333]" />,
      severity: "red",
    });
  }
  if (alerts.billsUnmatched > 0) {
    activeAlerts.push({
      label: "Bills Unmatched",
      count: alerts.billsUnmatched,
      icon: <ShieldAlert className="size-4 text-[#FF9900]" />,
      severity: "orange",
    });
  }
  if (alerts.returnsAwaitingCredit > 0) {
    activeAlerts.push({
      label: "Returns Awaiting Credit",
      count: alerts.returnsAwaitingCredit,
      icon: <Undo2 className="size-4 text-[#FF3333]" />,
      severity: "red",
    });
  }

  return (
    <div className="space-y-8">
      {/* ── ROW 1: Key Action Cards ─────────────────────────────────────────── */}
      <div>
        <h2 className="text-xs font-bold uppercase tracking-widest text-[#888888] mb-3 bb-mono">
          What Needs Doing
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <ActionCard
            label="Inbox"
            value={String(actionCards.inboxCount)}
            icon={<Inbox className="size-5 text-[#FF6600]" />}
            href="/inbox"
          />
          <ActionCard
            label="Open Tickets"
            value={String(actionCards.openTickets)}
            icon={<Ticket className="size-5 text-[#3399FF]" />}
            href="/tickets"
          />
          <ActionCard
            label="Quotes Awaiting Response"
            value={String(actionCards.quotesAwaitingResponse)}
            icon={<MessageSquareQuote className="size-5 text-[#FF9900]" />}
            href="/tickets?filter=quotes-sent"
          />
          <ActionCard
            label="POs Awaiting"
            value={String(actionCards.posAwaiting)}
            icon={<ClipboardList className="size-5 text-[#FF9900]" />}
            href="/po-register"
          />
          <ActionCard
            label="Deliveries Expected"
            value={String(actionCards.deliveriesExpected)}
            icon={<Truck className="size-5 text-[#3399FF]" />}
          />
          <ActionCard
            label="Invoices to Send"
            value={String(actionCards.invoicesToSend)}
            icon={<FileText className="size-5 text-[#00CC66]" />}
            href="/invoices"
          />
          <ActionCard
            label="Overdue Invoices"
            value={String(actionCards.overdueInvoices)}
            icon={<AlertTriangle className="size-5 text-[#FF3333]" />}
            href="/invoices"
            isAlert={actionCards.overdueInvoices > 0}
          />
          <ActionCard
            label="Payments This Month"
            value={money(actionCards.paymentsThisMonth)}
            icon={<Banknote className="size-5 text-[#00CC66]" />}
          />
        </div>
      </div>

      {/* ── ROW 2: Financial Summary ────────────────────────────────────────── */}
      <div>
        <h2 className="text-xs font-bold uppercase tracking-widest text-[#888888] mb-3 bb-mono">
          Financial Summary &mdash; This Month
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
          <FinancialCard
            label="Revenue"
            value={money(financials.revenue)}
            icon={<TrendingUp className="size-5 text-[#00CC66]" />}
          />
          <FinancialCard
            label="Costs"
            value={money(financials.costs)}
            icon={<ArrowDownCircle className="size-5 text-[#FF9900]" />}
          />
          <FinancialCard
            label="Gross Profit"
            value={money(financials.grossProfit)}
            icon={<DollarSign className="size-5 text-[#00CC66]" />}
            highlight={financials.grossProfit > 0 ? "green" : financials.grossProfit < 0 ? "red" : undefined}
          />
          <FinancialCard
            label="Margin %"
            value={pct(financials.marginPct)}
            icon={<PieChart className="size-5 text-[#3399FF]" />}
            highlight={financials.marginPct >= 20 ? "green" : financials.marginPct > 0 ? "orange" : undefined}
          />
          <FinancialCard
            label="Cash Sales"
            value={money(financials.cashSalesThisMonth)}
            icon={<Wallet className="size-5 text-[#FF6600]" />}
          />
          <FinancialCard
            label="Outstanding Receivables"
            value={money(financials.outstandingReceivables)}
            icon={<Receipt className="size-5 text-[#FF9900]" />}
            highlight={financials.outstandingReceivables > 0 ? "orange" : undefined}
          />
        </div>
      </div>

      {/* ── ROW 3: Operations Alerts (only if any active) ──────────────────── */}
      {activeAlerts.length > 0 && (
        <div>
          <h2 className="text-xs font-bold uppercase tracking-widest text-[#FF9900] mb-3 bb-mono">
            Attention Required
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {activeAlerts.map((alert) => (
              <AlertCard
                key={alert.label}
                label={alert.label}
                count={alert.count}
                icon={alert.icon}
                severity={alert.severity}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
