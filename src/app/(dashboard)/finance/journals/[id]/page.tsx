import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { ReverseButton } from "./ReverseButton";

export const dynamic = "force-dynamic";

function fmt(n: number): string {
  return n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default async function JournalDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const je = await prisma.journalEntry.findUnique({
    where: { id },
    include: {
      lines: { include: { account: true, customer: true, site: true, ticket: true, supplier: true } },
      period: true,
    },
  });
  if (!je) notFound();

  const totalDebit = je.lines.reduce((s, l) => s + Number(l.debit), 0);
  const totalCredit = je.lines.reduce((s, l) => s + Number(l.credit), 0);

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-baseline justify-between border-b border-[#333333] pb-2">
        <h1 className="text-sm font-bold tracking-[0.3em] text-[#FF6600] uppercase bb-mono">
          JOURNAL · {je.reference ?? je.id.slice(0, 8)}
        </h1>
        <div className="flex gap-2 items-baseline">
          <span
            className={`px-1.5 py-0.5 border text-[10px] ${
              je.status === "REVERSED"
                ? "border-[#FF3333] text-[#FF3333]"
                : "border-[#00CC66] text-[#00CC66]"
            }`}
          >
            {je.status}
          </span>
          {je.sourceType === "MANUAL_JOURNAL" && !je.isReversed && (
            <ReverseButton id={je.id} />
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 text-[11px]">
        <Meta label="Entry Date" value={je.entryDate.toISOString().slice(0, 10)} />
        <Meta label="Period" value={je.period?.label ?? "—"} />
        <Meta label="Source" value={je.sourceType} />
      </div>

      <div className="border border-[#333333] bg-[#1A1A1A]">
        <div className="px-4 py-2 border-b border-[#333333]">
          <div className="text-[10px] uppercase tracking-widest text-[#888888]">DESCRIPTION</div>
          <div className="text-sm text-[#E0E0E0] mt-1">{je.description}</div>
        </div>
        <table className="w-full">
          <thead>
            <tr className="border-b border-[#333333] text-[10px] uppercase tracking-widest text-[#888888]">
              <th className="text-left px-3 py-2 font-semibold w-20">Code</th>
              <th className="text-left px-3 py-2 font-semibold">Account</th>
              <th className="text-left px-3 py-2 font-semibold">Description</th>
              <th className="text-left px-3 py-2 font-semibold w-40">Analytics</th>
              <th className="text-right px-3 py-2 font-semibold w-28">Debit</th>
              <th className="text-right px-3 py-2 font-semibold w-28">Credit</th>
            </tr>
          </thead>
          <tbody>
            {je.lines.map((l) => (
              <tr key={l.id} className="border-b border-[#222222]">
                <td className="px-3 py-2 text-xs text-[#FF6600] font-mono">
                  {l.account.accountCode}
                </td>
                <td className="px-3 py-2 text-xs text-[#E0E0E0]">{l.account.accountName}</td>
                <td className="px-3 py-2 text-xs text-[#888888]">{l.description ?? "—"}</td>
                <td className="px-3 py-2 text-[10px] text-[#888888]">
                  {[
                    l.customer?.name && `Cust: ${l.customer.name}`,
                    l.site?.siteName && `Site: ${l.site.siteName}`,
                    l.ticket?.title && `Ticket #${l.ticket.ticketNo}`,
                    l.supplier?.name && `Supp: ${l.supplier.name}`,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "—"}
                </td>
                <td className="px-3 py-2 text-xs text-right tabular-nums text-[#E0E0E0]">
                  {Number(l.debit) > 0 ? `£${fmt(Number(l.debit))}` : "—"}
                </td>
                <td className="px-3 py-2 text-xs text-right tabular-nums text-[#E0E0E0]">
                  {Number(l.credit) > 0 ? `£${fmt(Number(l.credit))}` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-[#FF6600] bg-[#1F1F1F]">
              <td colSpan={4} className="px-3 py-3 text-[10px] uppercase tracking-widest text-[#FF6600] font-bold">
                TOTALS
              </td>
              <td className="px-3 py-3 text-xs text-right tabular-nums font-bold text-[#E0E0E0]">
                £{fmt(totalDebit)}
              </td>
              <td className="px-3 py-3 text-xs text-right tabular-nums font-bold text-[#E0E0E0]">
                £{fmt(totalCredit)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-[#333333] bg-[#1A1A1A] p-3">
      <div className="text-[9px] uppercase tracking-widest text-[#888888]">{label}</div>
      <div className="text-sm text-[#E0E0E0] tabular-nums mt-1">{value}</div>
    </div>
  );
}
