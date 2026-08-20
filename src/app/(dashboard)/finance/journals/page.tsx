import { prisma } from "@/lib/prisma";
import Link from "next/link";

export const dynamic = "force-dynamic";

function fmt(n: number): string {
  return n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default async function JournalsPage() {
  const journals = await prisma.journalEntry.findMany({
    where: { sourceType: "MANUAL_JOURNAL" },
    orderBy: { entryDate: "desc" },
    take: 100,
    include: { lines: true },
  });

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-baseline justify-between border-b border-[#333333] pb-2">
        <h1 className="text-sm font-bold tracking-[0.3em] text-[#FF6600] uppercase bb-mono">
          MANUAL JOURNALS
        </h1>
        <Link
          href="/finance/journals/new"
          className="bg-[#FF6600] text-black text-[10px] uppercase tracking-widest px-3 py-1.5 font-bold"
        >
          + New
        </Link>
      </div>

      <div className="border border-[#333333] bg-[#1A1A1A]">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[#333333] text-[10px] uppercase tracking-widest text-[#888888]">
              <th className="text-left px-3 py-2 font-semibold w-24">Date</th>
              <th className="text-left px-3 py-2 font-semibold w-28">Reference</th>
              <th className="text-left px-3 py-2 font-semibold">Description</th>
              <th className="text-right px-3 py-2 font-semibold w-20">Lines</th>
              <th className="text-right px-3 py-2 font-semibold w-28">Total</th>
              <th className="text-right px-3 py-2 font-semibold w-24">Status</th>
            </tr>
          </thead>
          <tbody>
            {journals.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-[11px] text-[#666666]">
                  No manual journals yet.
                </td>
              </tr>
            )}
            {journals.map((j) => {
              const total = j.lines.reduce((s, l) => s + Number(l.debit), 0);
              return (
                <tr key={j.id} className="border-b border-[#222222] hover:bg-[#222222]">
                  <td className="px-3 py-2 text-xs tabular-nums text-[#888888]">
                    {j.entryDate.toISOString().slice(0, 10)}
                  </td>
                  <td className="px-3 py-2 text-xs text-[#FF6600] font-mono">
                    {j.reference ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-xs text-[#E0E0E0]">
                    <Link href={`/finance/journals/${j.id}`} className="hover:underline">
                      {j.description}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-xs text-right tabular-nums text-[#888888]">
                    {j.lines.length}
                  </td>
                  <td className="px-3 py-2 text-xs text-right tabular-nums text-[#E0E0E0]">
                    £{fmt(total)}
                  </td>
                  <td className="px-3 py-2 text-[10px] text-right">
                    <span
                      className={`px-1.5 py-0.5 border ${
                        j.status === "REVERSED"
                          ? "border-[#FF3333] text-[#FF3333]"
                          : "border-[#00CC66] text-[#00CC66]"
                      }`}
                    >
                      {j.status}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
