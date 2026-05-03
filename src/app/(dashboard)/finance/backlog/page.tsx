import { prisma } from "@/lib/prisma";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function BacklogHomePage() {
  const [
    billsTotal,
    billsQuar,
    billsPromoted,
    billsRejected,
    invTotal,
    invQuar,
    invPromoted,
    invRejected,
    payTotal,
    payQuar,
    payPromoted,
    payRejected,
    cTotal,
    cQuar,
    cPromoted,
    cRejected,
  ] = await Promise.all([
    prisma.zohoImportedBill.count(),
    prisma.zohoImportedBill.count({ where: { importStatus: "QUARANTINED" } }),
    prisma.zohoImportedBill.count({ where: { importStatus: "PROMOTED" } }),
    prisma.zohoImportedBill.count({ where: { importStatus: "REJECTED" } }),
    prisma.zohoImportedInvoice.count(),
    prisma.zohoImportedInvoice.count({ where: { importStatus: "QUARANTINED" } }),
    prisma.zohoImportedInvoice.count({ where: { importStatus: "PROMOTED" } }),
    prisma.zohoImportedInvoice.count({ where: { importStatus: "REJECTED" } }),
    prisma.zohoImportedPayment.count(),
    prisma.zohoImportedPayment.count({ where: { importStatus: "QUARANTINED" } }),
    prisma.zohoImportedPayment.count({ where: { importStatus: "PROMOTED" } }),
    prisma.zohoImportedPayment.count({ where: { importStatus: "REJECTED" } }),
    prisma.zohoImportedContact.count(),
    prisma.zohoImportedContact.count({ where: { importStatus: "QUARANTINED" } }),
    prisma.zohoImportedContact.count({ where: { importStatus: "PROMOTED" } }),
    prisma.zohoImportedContact.count({ where: { importStatus: "REJECTED" } }),
  ]);

  const tabs = [
    { slug: "bills", title: "Bills", total: billsTotal, quar: billsQuar, promoted: billsPromoted, rejected: billsRejected },
    { slug: "invoices", title: "Invoices", total: invTotal, quar: invQuar, promoted: invPromoted, rejected: invRejected },
    { slug: "payments", title: "Payments", total: payTotal, quar: payQuar, promoted: payPromoted, rejected: payRejected },
    { slug: "contacts", title: "Contacts", total: cTotal, quar: cQuar, promoted: cPromoted, rejected: cRejected },
  ];

  const grandTotal = tabs.reduce((s, t) => s + t.total, 0);
  const grandQuar = tabs.reduce((s, t) => s + t.quar, 0);
  const cleared = grandTotal - grandQuar;
  const pct = grandTotal > 0 ? Math.round((cleared / grandTotal) * 100) : 0;

  return (
    <div className="p-4 space-y-6">
      <div className="border-b border-[#333333] pb-2">
        <h1 className="text-sm font-bold tracking-[0.3em] text-[#FF6600] uppercase bb-mono">
          BACKLOG CLEANUP
        </h1>
      </div>

      <div className="border border-[#333333] bg-[#1A1A1A] p-4 space-y-3">
        <div className="flex justify-between items-baseline">
          <span className="text-[10px] uppercase tracking-widest text-[#888888] font-bold">
            COMPLETENESS
          </span>
          <span className="text-xs text-[#E0E0E0] tabular-nums">
            {cleared} / {grandTotal} cleared · <span className="text-[#FF6600] font-bold">{pct}%</span>
          </span>
        </div>
        <div className="h-2 bg-[#0A0A0A] border border-[#333333] overflow-hidden">
          <div
            className="h-full bg-[#FF6600]"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="text-[10px] text-[#666666]">
          {grandQuar > 0
            ? `${grandQuar} record${grandQuar === 1 ? "" : "s"} still in quarantine.`
            : grandTotal > 0
            ? "All records cleared. Zoho is ready to be archived."
            : "No records imported. Zoho import is disabled (2026-05-02) — bills now flow via Outlook."}
        </div>
      </div>

      <Link
        href="/finance/backlog/cleanup"
        className="block border-2 border-[#FF6600] bg-[#FF66001A] p-4 hover:bg-[#FF66002A] transition-colors"
      >
        <div className="flex items-baseline justify-between">
          <span className="text-xs uppercase tracking-widest text-[#FF6600] font-bold">
            → Cleanup Workspace
          </span>
          <span className="text-[10px] tabular-nums text-[#888888]">
            insights · customer & site mapping · triage
          </span>
        </div>
        <div className="text-[10px] text-[#888888] mt-2">
          Unified dashboard for fixing data quality issues, mapping Zoho customers/sites to OS, and
          triaging stale drafts. Pointer-only mappings — Zoho data is never modified.
        </div>
      </Link>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {tabs.map((t) => (
          <Link
            key={t.slug}
            href={`/finance/backlog/${t.slug}`}
            className="block border border-[#333333] bg-[#1A1A1A] p-4 hover:border-[#FF6600] transition-colors"
          >
            <div className="flex items-baseline justify-between">
              <span className="text-xs uppercase tracking-widest text-[#FF6600] font-bold">
                {t.title}
              </span>
              <span className="text-[10px] tabular-nums text-[#888888]">
                {t.quar} of {t.total}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 mt-3 text-[10px]">
              <Stat label="QUARANTINED" value={t.quar} accent="#FF6600" />
              <Stat label="PROMOTED" value={t.promoted} accent="#00CC66" />
              <Stat label="REJECTED" value={t.rejected} accent="#FF3333" />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div>
      <div className="uppercase tracking-widest font-bold" style={{ color: accent }}>
        {label}
      </div>
      <div className="text-sm font-bold tabular-nums text-[#E0E0E0] mt-0.5">{value}</div>
    </div>
  );
}
