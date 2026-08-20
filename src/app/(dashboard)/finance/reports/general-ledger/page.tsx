import { prisma } from "@/lib/prisma";
import Link from "next/link";

export const dynamic = "force-dynamic";

function fmt(n: number): string {
  return n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function dateShort(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export default async function GeneralLedgerPage({
  searchParams,
}: {
  searchParams: Promise<{
    accountId?: string;
    from?: string;
    to?: string;
    customerId?: string;
    siteId?: string;
    ticketId?: string;
  }>;
}) {
  const params = await searchParams;
  const accounts = await prisma.chartOfAccount.findMany({
    where: { isActive: true },
    orderBy: { accountCode: "asc" },
  });

  let lines: Awaited<ReturnType<typeof prisma.journalLine.findMany>> = [];
  let account: { id: string; accountCode: string; accountName: string; accountType: string } | null = null;
  let openingBalance = 0;

  if (params.accountId) {
    account = accounts.find((a) => a.id === params.accountId) ?? null;
    if (account) {
      const from = params.from ? new Date(params.from) : null;
      const to = params.to ? new Date(`${params.to}T23:59:59.999Z`) : null;

      // Opening balance = sum of debit-credit before `from`
      if (from) {
        const ob = await prisma.journalLine.aggregate({
          where: {
            accountId: account.id,
            journalEntry: { entryDate: { lt: from }, status: "POSTED" },
          },
          _sum: { debit: true, credit: true },
        });
        openingBalance = Number(ob._sum.debit ?? 0) - Number(ob._sum.credit ?? 0);
      }

      const where: Record<string, unknown> = {
        accountId: account.id,
        journalEntry: { status: "POSTED" } as Record<string, unknown>,
      };
      const dateRange: Record<string, Date> = {};
      if (from) dateRange.gte = from;
      if (to) dateRange.lte = to;
      if (Object.keys(dateRange).length > 0) {
        (where.journalEntry as Record<string, unknown>).entryDate = dateRange;
      }
      if (params.customerId) where.customerId = params.customerId;
      if (params.siteId) where.siteId = params.siteId;
      if (params.ticketId) where.ticketId = params.ticketId;

      lines = await prisma.journalLine.findMany({
        where,
        include: {
          journalEntry: true,
          customer: { select: { name: true } },
          site: { select: { siteName: true } },
        },
        orderBy: [{ journalEntry: { entryDate: "asc" } }, { id: "asc" }],
      });
    }
  }

  let running = openingBalance;
  const rowsWithRunning = lines.map((l) => {
    running += Number(l.debit) - Number(l.credit);
    return { line: l, running };
  });

  const closing = running;

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-baseline justify-between border-b border-[#333333] pb-2">
        <h1 className="text-sm font-bold tracking-[0.3em] text-[#FF6600] uppercase bb-mono">
          GENERAL LEDGER
        </h1>
        {account && (
          <div className="text-[11px] text-[#E0E0E0] uppercase tracking-widest">
            <span className="text-[#FF6600] font-mono">{account.accountCode}</span>{" "}
            {account.accountName}
          </div>
        )}
      </div>

      {/* Account picker + filters */}
      <form method="get" className="flex gap-2 items-end text-[11px] flex-wrap">
        <label className="flex flex-col">
          <span className="text-[9px] uppercase tracking-widest text-[#666666] mb-1">Account</span>
          <select
            name="accountId"
            defaultValue={params.accountId ?? ""}
            className="bg-[#0A0A0A] border border-[#333333] text-[11px] text-[#E0E0E0] px-2 py-1 min-w-[260px]"
          >
            <option value="">— pick account —</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.accountCode} · {a.accountName}
              </option>
            ))}
          </select>
        </label>
        <Field label="From" name="from" defaultValue={params.from ?? ""} type="date" />
        <Field label="To" name="to" defaultValue={params.to ?? ""} type="date" />
        <Field label="Customer ID" name="customerId" defaultValue={params.customerId ?? ""} />
        <Field label="Site ID" name="siteId" defaultValue={params.siteId ?? ""} />
        <Field label="Ticket ID" name="ticketId" defaultValue={params.ticketId ?? ""} />
        <button
          type="submit"
          className="bg-[#FF6600] text-black text-[10px] uppercase tracking-widest px-3 py-1.5 font-bold"
        >
          Apply
        </button>
      </form>

      {!account ? (
        <div className="text-[11px] text-[#666666]">Pick an account to view its ledger.</div>
      ) : (
        <div className="border border-[#333333] bg-[#1A1A1A]">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#333333] text-[10px] uppercase tracking-widest text-[#888888]">
                <th className="text-left px-3 py-2 font-semibold w-24">Date</th>
                <th className="text-left px-3 py-2 font-semibold w-28">Reference</th>
                <th className="text-left px-3 py-2 font-semibold">Description</th>
                <th className="text-left px-3 py-2 font-semibold w-32">Customer / Site</th>
                <th className="text-right px-3 py-2 font-semibold w-24">Debit</th>
                <th className="text-right px-3 py-2 font-semibold w-24">Credit</th>
                <th className="text-right px-3 py-2 font-semibold w-28">Running</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-[#222222] bg-[#222222]">
                <td colSpan={6} className="px-3 py-2 text-[10px] uppercase text-[#888888] font-bold">
                  OPENING BALANCE
                </td>
                <td className="px-3 py-2 text-xs text-right tabular-nums text-[#E0E0E0]">
                  £{fmt(openingBalance)}
                </td>
              </tr>
              {rowsWithRunning.map(({ line, running }) => (
                <tr key={line.id} className="border-b border-[#222222] hover:bg-[#222222]">
                  <td className="px-3 py-2 text-[10px] tabular-nums text-[#888888]">
                    {dateShort(line.journalEntry.entryDate)}
                  </td>
                  <td className="px-3 py-2 text-[10px] text-[#FF6600] font-mono">
                    {line.journalEntry.reference ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-xs text-[#E0E0E0]">
                    {line.description ?? line.journalEntry.description}
                  </td>
                  <td className="px-3 py-2 text-[10px] text-[#888888]">
                    {[line.customer?.name, line.site?.siteName].filter(Boolean).join(" · ") || "—"}
                  </td>
                  <td className="px-3 py-2 text-xs text-right tabular-nums text-[#E0E0E0]">
                    {Number(line.debit) > 0 ? `£${fmt(Number(line.debit))}` : "—"}
                  </td>
                  <td className="px-3 py-2 text-xs text-right tabular-nums text-[#E0E0E0]">
                    {Number(line.credit) > 0 ? `£${fmt(Number(line.credit))}` : "—"}
                  </td>
                  <td className="px-3 py-2 text-xs text-right tabular-nums text-[#E0E0E0] font-bold">
                    £{fmt(running)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-[#FF6600] bg-[#1F1F1F]">
                <td colSpan={6} className="px-3 py-3 text-[10px] uppercase tracking-widest text-[#FF6600] font-bold">
                  CLOSING BALANCE
                </td>
                <td className="px-3 py-3 text-xs text-right tabular-nums text-[#FF6600] font-bold">
                  £{fmt(closing)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  name,
  defaultValue,
  type = "text",
}: {
  label: string;
  name: string;
  defaultValue: string;
  type?: string;
}) {
  return (
    <label className="flex flex-col">
      <span className="text-[9px] uppercase tracking-widest text-[#666666] mb-1">{label}</span>
      <input
        type={type}
        name={name}
        defaultValue={defaultValue}
        className="bg-[#0A0A0A] border border-[#333333] text-[11px] text-[#E0E0E0] px-2 py-1 min-w-[140px]"
      />
    </label>
  );
}
