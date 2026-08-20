import { prisma } from "@/lib/prisma";
import { PeriodActions } from "./PeriodActions";

export const dynamic = "force-dynamic";

export default async function PeriodClosePage() {
  const periods = await prisma.fiscalPeriod.findMany({
    orderBy: { startDate: "desc" },
    include: { _count: { select: { entries: true } } },
  });

  return (
    <div className="p-4 space-y-4">
      <div className="border-b border-[#333333] pb-2">
        <h1 className="text-sm font-bold tracking-[0.3em] text-[#FF6600] uppercase bb-mono">
          PERIOD CLOSE
        </h1>
      </div>

      <div className="text-[11px] text-[#888888] grid grid-cols-3 gap-2">
        <div className="border border-[#333333] bg-[#1A1A1A] p-3">
          <span className="text-[#00CC66] font-bold">OPEN</span> — anything posts.
        </div>
        <div className="border border-[#333333] bg-[#1A1A1A] p-3">
          <span className="text-[#FFCC00] font-bold">CLOSED</span> — soft close. JEs still post but flagged.
        </div>
        <div className="border border-[#333333] bg-[#1A1A1A] p-3">
          <span className="text-[#FF3333] font-bold">LOCKED</span> — hard reject. No JEs accepted.
        </div>
      </div>

      <div className="border border-[#333333] bg-[#1A1A1A]">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[#333333] text-[10px] uppercase tracking-widest text-[#888888]">
              <th className="text-left px-4 py-2 font-semibold w-24">Period</th>
              <th className="text-left px-4 py-2 font-semibold w-32">Range</th>
              <th className="text-left px-4 py-2 font-semibold w-24">Status</th>
              <th className="text-right px-4 py-2 font-semibold w-24">JEs</th>
              <th className="text-left px-4 py-2 font-semibold w-32">Closed At</th>
              <th className="text-right px-4 py-2 font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {periods.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-[11px] text-[#666666]">
                  No periods yet — they auto-create when JEs are posted.
                </td>
              </tr>
            )}
            {periods.map((p) => (
              <tr key={p.id} className="border-b border-[#222222] hover:bg-[#222222]">
                <td className="px-4 py-2 text-xs text-[#FF6600] font-mono font-bold">{p.label}</td>
                <td className="px-4 py-2 text-[10px] text-[#888888] tabular-nums">
                  {p.startDate.toISOString().slice(0, 10)} → {p.endDate.toISOString().slice(0, 10)}
                </td>
                <td className="px-4 py-2 text-[10px]">
                  <span
                    className={`px-1.5 py-0.5 border font-bold ${
                      p.status === "LOCKED"
                        ? "border-[#FF3333] text-[#FF3333]"
                        : p.status === "CLOSED"
                        ? "border-[#FFCC00] text-[#FFCC00]"
                        : "border-[#00CC66] text-[#00CC66]"
                    }`}
                  >
                    {p.status}
                  </span>
                </td>
                <td className="px-4 py-2 text-xs text-right tabular-nums text-[#E0E0E0]">
                  {p._count.entries}
                </td>
                <td className="px-4 py-2 text-[10px] text-[#888888] tabular-nums">
                  {p.closedAt ? p.closedAt.toISOString().slice(0, 10) : "—"}
                </td>
                <td className="px-4 py-2 text-right">
                  <PeriodActions periodId={p.id} status={p.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
