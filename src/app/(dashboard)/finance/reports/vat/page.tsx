import { prisma } from "@/lib/prisma";
import { VatReturnPanel, SubmitButtonClient } from "./VatReturnPanel";

export const dynamic = "force-dynamic";

function fmt(n: number): string {
  return n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default async function VatReturnsPage() {
  const returns = await prisma.vATReturn.findMany({
    orderBy: { periodStart: "desc" },
    take: 24,
  });

  // Default suggested period: current quarter
  const today = new Date();
  const month = today.getUTCMonth();
  const quarterStartMonth = Math.floor(month / 3) * 3;
  const suggestedStart = new Date(Date.UTC(today.getUTCFullYear(), quarterStartMonth, 1));
  const suggestedEnd = new Date(
    Date.UTC(today.getUTCFullYear(), quarterStartMonth + 3, 0, 23, 59, 59, 999)
  );

  return (
    <div className="p-4 space-y-4">
      <div className="border-b border-[#333333] pb-2">
        <h1 className="text-sm font-bold tracking-[0.3em] text-[#FF6600] uppercase bb-mono">
          VAT RETURNS
        </h1>
      </div>

      <VatReturnPanel
        suggestedStart={suggestedStart.toISOString().slice(0, 10)}
        suggestedEnd={suggestedEnd.toISOString().slice(0, 10)}
      />

      <div className="border border-[#333333] bg-[#1A1A1A]">
        <div className="px-4 py-2 border-b border-[#333333]">
          <span className="text-[10px] uppercase tracking-widest text-[#888888] font-bold">
            HISTORY
          </span>
        </div>
        <table className="w-full">
          <thead>
            <tr className="border-b border-[#333333] text-[10px] uppercase tracking-widest text-[#888888]">
              <th className="text-left px-3 py-2 font-semibold">Period</th>
              <th className="text-left px-3 py-2 font-semibold w-24">Status</th>
              <th className="text-right px-3 py-2 font-semibold w-24">Box 1</th>
              <th className="text-right px-3 py-2 font-semibold w-24">Box 4</th>
              <th className="text-right px-3 py-2 font-semibold w-24">Box 5</th>
              <th className="text-right px-3 py-2 font-semibold w-24">Box 6</th>
              <th className="text-right px-3 py-2 font-semibold w-24">Box 7</th>
              <th className="text-right px-3 py-2 font-semibold w-24">—</th>
            </tr>
          </thead>
          <tbody>
            {returns.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-[11px] text-[#666666]">
                  No returns yet — generate one above.
                </td>
              </tr>
            )}
            {returns.map((r) => (
              <tr key={r.id} className="border-b border-[#222222] hover:bg-[#222222]">
                <td className="px-3 py-2 text-xs text-[#E0E0E0] tabular-nums">
                  {r.periodStart.toISOString().slice(0, 10)} → {r.periodEnd.toISOString().slice(0, 10)}
                </td>
                <td className="px-3 py-2 text-[10px]">
                  <span
                    className={`px-1.5 py-0.5 border ${
                      r.status === "SUBMITTED" || r.status === "ACCEPTED"
                        ? "border-[#00CC66] text-[#00CC66]"
                        : "border-[#FFCC00] text-[#FFCC00]"
                    }`}
                  >
                    {r.status}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs text-right tabular-nums text-[#E0E0E0]">
                  £{fmt(Number(r.box1))}
                </td>
                <td className="px-3 py-2 text-xs text-right tabular-nums text-[#E0E0E0]">
                  £{fmt(Number(r.box4))}
                </td>
                <td className="px-3 py-2 text-xs text-right tabular-nums text-[#FF6600] font-bold">
                  £{fmt(Number(r.box5))}
                </td>
                <td className="px-3 py-2 text-xs text-right tabular-nums text-[#888888]">
                  £{fmt(Number(r.box6))}
                </td>
                <td className="px-3 py-2 text-xs text-right tabular-nums text-[#888888]">
                  £{fmt(Number(r.box7))}
                </td>
                <td className="px-3 py-2 text-right">
                  {r.status === "CALCULATED" || r.status === "DRAFT" ? (
                    <SubmitButtonClient id={r.id} />
                  ) : (
                    <span className="text-[10px] text-[#666666]">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

