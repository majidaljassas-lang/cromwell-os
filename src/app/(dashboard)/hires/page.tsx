import { prisma } from "@/lib/prisma";
import Link from "next/link";

export const dynamic = "force-dynamic";

const HIRE_KEYWORDS = ["hire", "hired", "hiring", "rental", "core drill", "core-drill"];

export default async function HiresPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; mode?: string }>;
}) {
  const params = await searchParams;
  const statusFilter = (params.status ?? "").trim().toUpperCase();
  const modeFilter = (params.mode ?? "").trim().toUpperCase();

  // A hire is either:
  //  (a) ticketMode = NON_SITE (company-wide hire per memory feedback_hire_is_feature.md)
  //  (b) title/description contains a hire keyword
  // Query both and merge.
  const orClauses: Record<string, unknown>[] = [{ ticketMode: "NON_SITE" }];
  for (const kw of HIRE_KEYWORDS) {
    orClauses.push({ title: { contains: kw, mode: "insensitive" } });
    orClauses.push({ description: { contains: kw, mode: "insensitive" } });
  }

  const where: Record<string, unknown> = { OR: orClauses };
  if (statusFilter) where.status = statusFilter;
  if (modeFilter) where.ticketMode = modeFilter;

  const tickets = await prisma.ticket.findMany({
    where,
    orderBy: [{ lastActivityAt: "desc" }, { createdAt: "desc" }],
    include: {
      payingCustomer: { select: { id: true, name: true } },
      site: { select: { id: true, siteName: true } },
      _count: { select: { lines: true, events: true, logisticsEvents: true } },
    },
    take: 200,
  });

  // Recent activity across hire tickets. Dedicated MOVED_TO_LOCATION /
  // OFFHIRED event types don't exist yet (per feedback_hire_is_feature.md);
  // surfacing the generic event stream gives the user a per-asset timeline
  // until the model is built.
  const movements = tickets.length === 0 ? [] : await prisma.event.findMany({
    where: { ticketId: { in: tickets.map((t) => t.id) } },
    orderBy: { timestamp: "desc" },
    take: 30,
    select: {
      id: true,
      ticketId: true,
      eventType: true,
      timestamp: true,
      notes: true,
    },
  });
  const ticketById = new Map(tickets.map((t) => [t.id, t] as const));

  const byMode = new Map<string, number>();
  for (const t of tickets) byMode.set(t.ticketMode, (byMode.get(t.ticketMode) ?? 0) + 1);

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-baseline justify-between border-b border-[#333333] pb-2">
        <h1 className="text-sm font-bold tracking-[0.3em] text-[#FF6600] uppercase bb-mono">HIRES</h1>
        <span className="text-[10px] tracking-widest text-[#888888] bb-mono">
          {tickets.length} ticket{tickets.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="border border-[#FF9900] bg-[#1A1A1A] px-4 py-2 text-[10px] text-[#FFCC00] bb-mono">
        Hires are surfaced from tickets with mode <code className="text-[#FF6600]">NON_SITE</code> or
        hire keywords in title/description. A dedicated <code className="text-[#FF6600]">HIRE</code>{" "}
        TicketMode + asset/movement model is the target — see{" "}
        <code className="text-[#FF6600]">feedback_hire_is_feature.md</code>.
      </div>

      <form method="get" className="flex gap-2 items-end flex-wrap">
        <label className="flex flex-col">
          <span className="text-[9px] uppercase tracking-widest text-[#666] mb-1">Status</span>
          <select
            name="status"
            defaultValue={statusFilter}
            className="bg-[#0A0A0A] border border-[#333] text-[11px] text-[#E0E0E0] px-2 py-1 min-w-[160px]"
          >
            <option value="">All</option>
            <option value="CAPTURED">CAPTURED</option>
            <option value="ORDERED">ORDERED</option>
            <option value="DELIVERED">DELIVERED</option>
            <option value="PRICING">PRICING</option>
            <option value="QUOTED">QUOTED</option>
            <option value="LOCKED">LOCKED</option>
            <option value="VERIFIED">VERIFIED</option>
            <option value="COSTED">COSTED</option>
            <option value="APPROVED">APPROVED</option>
            <option value="RECOVERY">RECOVERY</option>
          </select>
        </label>
        <label className="flex flex-col">
          <span className="text-[9px] uppercase tracking-widest text-[#666] mb-1">Mode</span>
          <select
            name="mode"
            defaultValue={modeFilter}
            className="bg-[#0A0A0A] border border-[#333] text-[11px] text-[#E0E0E0] px-2 py-1 min-w-[160px]"
          >
            <option value="">All</option>
            <option value="NON_SITE">NON_SITE (company-wide)</option>
            <option value="DIRECT_ORDER">DIRECT_ORDER</option>
            <option value="PRICING_FIRST">PRICING_FIRST</option>
            <option value="SPEC_DRIVEN">SPEC_DRIVEN</option>
            <option value="COMPETITIVE_BID">COMPETITIVE_BID</option>
          </select>
        </label>
        <button type="submit" className="bg-[#FF6600] text-black text-[10px] uppercase tracking-widest px-3 py-1.5 font-bold">
          Apply
        </button>
        {(statusFilter || modeFilter) && (
          <Link href="/hires" className="text-[10px] uppercase tracking-widest text-[#888] hover:text-[#FF6600] px-3 py-1.5">
            Clear
          </Link>
        )}
      </form>

      <div className="grid grid-cols-4 gap-2 text-[10px]">
        {[...byMode.entries()].map(([mode, n]) => (
          <div key={mode} className="border border-[#333] bg-[#0B0B0B] p-2 bb-mono">
            <div className="text-[9px] uppercase tracking-widest text-[#888]">{mode}</div>
            <div className="text-base font-black text-[#FF6600] tabular-nums">{n}</div>
          </div>
        ))}
      </div>

      <div className="border border-[#2A2A2A]">
        <table className="w-full text-[11px] bb-mono">
          <thead className="bg-[#1A1A1A] text-[#888] uppercase tracking-widest">
            <tr>
              <th className="text-left px-3 py-2">Ticket</th>
              <th className="text-left px-3 py-2">Title</th>
              <th className="text-left px-3 py-2">Customer</th>
              <th className="text-left px-3 py-2">Site</th>
              <th className="text-left px-3 py-2">Mode</th>
              <th className="text-left px-3 py-2">Status</th>
              <th className="text-right px-3 py-2">Lines</th>
              <th className="text-right px-3 py-2">Events</th>
              <th className="text-left px-3 py-2">Last activity</th>
            </tr>
          </thead>
          <tbody>
            {tickets.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-[#666]">
                  No hire-like tickets match.
                </td>
              </tr>
            ) : (
              tickets.map((t) => (
                <tr key={t.id} className="border-t border-[#222] hover:bg-[#1A1A1A]">
                  <td className="px-3 py-2 text-[#FF6600]">
                    <Link href={`/tickets/${t.id}`} className="hover:underline">
                      T-{t.ticketNo}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-[#CCCCCC]">{t.title}</td>
                  <td className="px-3 py-2 text-[#FFCC00]">{t.payingCustomer?.name ?? "—"}</td>
                  <td className="px-3 py-2 text-[#888]">{t.site?.siteName ?? "—"}</td>
                  <td className="px-3 py-2 text-[#888]">{t.ticketMode}</td>
                  <td className="px-3 py-2 text-[#CCCCCC]">{t.status}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-[#CCCCCC]">
                    {t._count.lines}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-[#888]">
                    {t._count.events + t._count.logisticsEvents}
                  </td>
                  <td className="px-3 py-2 text-[10px] text-[#666]">
                    {t.lastActivityAt
                      ? new Date(t.lastActivityAt).toLocaleDateString("en-GB")
                      : new Date(t.createdAt).toLocaleDateString("en-GB")}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {movements.length > 0 && (
        <div className="border border-[#2A2A2A]">
          <div className="bg-[#1A1A1A] px-3 py-2 text-[10px] uppercase tracking-widest text-[#FF6600]">
            Recent Movements
          </div>
          <table className="w-full text-[11px] bb-mono">
            <thead className="text-[#888] uppercase tracking-widest">
              <tr>
                <th className="text-left px-3 py-1.5">Date</th>
                <th className="text-left px-3 py-1.5">Ticket</th>
                <th className="text-left px-3 py-1.5">Event</th>
                <th className="text-left px-3 py-1.5">Summary</th>
              </tr>
            </thead>
            <tbody>
              {movements.map((m) => {
                const t = ticketById.get(m.ticketId);
                return (
                  <tr key={m.id} className="border-t border-[#222]">
                    <td className="px-3 py-1.5 text-[#666]">
                      {new Date(m.timestamp).toLocaleString("en-GB")}
                    </td>
                    <td className="px-3 py-1.5 text-[#FF6600]">
                      {t ? <Link href={`/tickets/${t.id}`} className="hover:underline">T-{t.ticketNo}</Link> : "—"}
                    </td>
                    <td className="px-3 py-1.5 text-[#FFCC00]">{m.eventType}</td>
                    <td className="px-3 py-1.5 text-[#CCCCCC]">{m.notes ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
