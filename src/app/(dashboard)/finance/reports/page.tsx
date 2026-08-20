import Link from "next/link";

export const dynamic = "force-dynamic";

const REPORTS = [
  { slug: "p-and-l", title: "Profit & Loss", desc: "Revenue, COGS, expenses by period. Filterable by Customer, Site, Ticket." },
  { slug: "trial-balance", title: "Trial Balance", desc: "All accounts with debit/credit balance at a date." },
  { slug: "general-ledger", title: "General Ledger", desc: "Drill into any account — every JE, running balance, source link." },
  { slug: "aged-debtors", title: "Aged Debtors", desc: "Open invoices grouped by age (current / 30 / 60 / 90+)." },
  { slug: "aged-creditors", title: "Aged Creditors", desc: "Open supplier bills grouped by age (current / 30 / 60 / 90+)." },
  { slug: "vat", title: "VAT Returns", desc: "Generate, review, and submit MTD-style 9-box VAT returns." },
];

export default function ReportsHomePage() {
  return (
    <div className="p-4 space-y-4">
      <h1 className="text-sm font-bold tracking-[0.3em] text-[#FF6600] uppercase bb-mono border-b border-[#333333] pb-2">
        REPORTS
      </h1>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {REPORTS.map((r) => (
          <Link
            key={r.slug}
            href={`/finance/reports/${r.slug}`}
            className="block border border-[#333333] bg-[#1A1A1A] p-4 hover:border-[#FF6600] transition-colors"
          >
            <div className="text-xs uppercase tracking-widest text-[#FF6600] font-bold">
              {r.title}
            </div>
            <div className="text-[11px] text-[#888888] mt-2">{r.desc}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
