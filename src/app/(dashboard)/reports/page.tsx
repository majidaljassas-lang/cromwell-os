import Link from "next/link";

export const dynamic = "force-dynamic";

type ReportLink = { slug: string; href: string; title: string; desc: string };
type ReportSection = { label: string; reports: ReportLink[] };

const SECTIONS: ReportSection[] = [
  {
    label: "PROFITABILITY",
    reports: [
      { slug: "site-profitability", href: "/reports/operational", title: "Site Profitability", desc: "Revenue, cost, absorbed cost, profit, margin per Site." },
      { slug: "customer-profitability", href: "/reports/operational", title: "Customer Profitability", desc: "Revenue, cost, absorbed cost, profit, margin per paying Customer." },
      { slug: "ticket-profitability", href: "/reports/ticket-profitability", title: "Ticket Profitability", desc: "Revenue, cost, profit, margin per Ticket — top earners and loss-makers." },
      { slug: "pnl-by-site", href: "/reports/pnl-by-site", title: "P&L by Site", desc: "Site-level P&L: invoiced revenue minus billed cost minus absorbed." },
      { slug: "pnl-by-customer", href: "/reports/pnl-by-customer", title: "P&L by Customer", desc: "Customer-level P&L from posted invoices and bills." },
      { slug: "margin-by-gl", href: "/reports/margin-by-gl", title: "Margin by GL Bucket", desc: "Materials / Labour / Plant Hire / Logistics — revenue, cost and margin per bucket." },
    ],
  },
  {
    label: "RECEIVABLES",
    reports: [
      { slug: "aged-debtors", href: "/finance/reports/aged-debtors", title: "Aged Debtors", desc: "Open invoices by age (current / 30 / 60 / 90+)." },
      { slug: "dso", href: "/reports/dso", title: "Days Sales Outstanding", desc: "DSO trend, overall and per top customer." },
      { slug: "top-customers", href: "/reports/top-customers", title: "Top Customers by Balance", desc: "Top 20 customers ranked by open invoice balance." },
      { slug: "recovery-ageing", href: "/reports/operational", title: "Recovery Ageing", desc: "Stuck-value cases by stage and days open." },
      { slug: "unbilled-deliveries", href: "/reports/unbilled-deliveries", title: "Unbilled Deliveries", desc: "TicketLines delivered but not yet on a SalesInvoiceLine." },
    ],
  },
  {
    label: "PAYABLES",
    reports: [
      { slug: "aged-creditors", href: "/finance/reports/aged-creditors", title: "Aged Creditors", desc: "Open supplier bills by age (current / 30 / 60 / 90+)." },
      { slug: "top-suppliers", href: "/reports/top-suppliers", title: "Top Suppliers by Balance", desc: "Top 20 suppliers ranked by open bill balance." },
      { slug: "unallocated-costs", href: "/reports/operational", title: "Unallocated Costs", desc: "Bill lines not yet allocated to a Ticket / TicketLine." },
      { slug: "three-way-exceptions", href: "/reports/three-way-exceptions", title: "3-Way Match Exceptions", desc: "Bills where PO ↔ Delivery ↔ Bill match failed or has variance." },
      { slug: "bank-detail-alerts", href: "/reports/bank-detail-alerts", title: "Bank-Detail Change Alerts", desc: "Open fraud alerts: supplier bank details that changed in a recent doc." },
    ],
  },
  {
    label: "CASH & BANKING",
    reports: [
      { slug: "cash-position", href: "/reports/cash-position", title: "Cash Position", desc: "Current balance per BankAccount and grand total." },
      { slug: "cash-flow", href: "/reports/cash-flow", title: "Cash In / Out by Month", desc: "Monthly bank deposits vs withdrawals across all accounts." },
      { slug: "bank-recon", href: "/reports/bank-recon", title: "Reconciliation Status", desc: "Per-account counts of unreconciled / matched / reconciled / excluded transactions." },
    ],
  },
  {
    label: "ACCOUNTING",
    reports: [
      { slug: "p-and-l", href: "/finance/reports/p-and-l", title: "Profit & Loss", desc: "Revenue, COGS, expenses by period." },
      { slug: "trial-balance", href: "/finance/reports/trial-balance", title: "Trial Balance", desc: "All accounts with debit/credit balance at a date." },
      { slug: "general-ledger", href: "/finance/reports/general-ledger", title: "General Ledger", desc: "Drill into any account — every JE, running balance, source link." },
      { slug: "journals", href: "/reports/journals", title: "Journal Listing", desc: "Recent journal entries with sourceType, period and reversal status." },
    ],
  },
  {
    label: "OPERATIONS FINANCE",
    reports: [
      { slug: "po-utilisation", href: "/reports/operational", title: "PO Utilisation", desc: "Customer PO consumption and remaining headroom." },
      { slug: "absorbed-costs", href: "/reports/operational", title: "Absorbed Costs", desc: "Costs allocated to a ticket but not billed back to the customer." },
      { slug: "stock-value", href: "/reports/stock-value", title: "Stock Value", desc: "Per-ticket excess stock items still on the register and total value." },
      { slug: "surplus-ageing", href: "/reports/surplus-ageing", title: "Surplus Stock Ageing", desc: "Unresolved StockExcessRecords by days open." },
      { slug: "moq-overage", href: "/reports/moq-overage", title: "MOQ Overage Cost", desc: "Cost of qty bought above ticket-line need due to supplier MOQ rules." },
    ],
  },
  {
    label: "TAX / COMPLIANCE",
    reports: [
      { slug: "vat", href: "/finance/reports/vat", title: "VAT Returns", desc: "Generate, review, and submit MTD-style 9-box VAT returns." },
      { slug: "ct", href: "/ct", title: "Corporation Tax", desc: "CT computations, reliefs, and current-year accruals." },
    ],
  },
];

export default function ReportsHubPage() {
  return (
    <div className="p-4 space-y-6">
      <h1 className="text-sm font-bold tracking-[0.3em] text-[#FF6600] uppercase bb-mono border-b border-[#333333] pb-2">
        REPORTS
      </h1>
      {SECTIONS.map((section) => (
        <div key={section.label} className="space-y-2">
          <div className="text-[11px] font-bold tracking-[0.25em] text-[#888888] uppercase bb-mono">
            {section.label}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {section.reports.map((r) => (
              <Link
                key={`${section.label}-${r.slug}`}
                href={r.href}
                className="block border border-[#333333] bg-[#1A1A1A] p-3 hover:border-[#FF6600] transition-colors"
              >
                <div className="text-xs uppercase tracking-widest text-[#FF6600] font-bold">
                  {r.title}
                </div>
                <div className="text-[11px] text-[#888888] mt-1.5 leading-snug">{r.desc}</div>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
