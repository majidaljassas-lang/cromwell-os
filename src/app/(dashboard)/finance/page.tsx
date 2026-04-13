import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function fmt(val: number): string {
  return val.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default async function FinancePage() {
  const accounts = await prisma.chartOfAccount.findMany({
    where: { isActive: true },
    orderBy: { accountCode: "asc" },
  });

  const taxRates = await prisma.taxRate.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
  });

  const bankAccounts = await prisma.bankAccount.findMany({
    where: { isActive: true },
    include: { account: true },
  });

  // Group accounts by type
  const grouped: Record<string, typeof accounts> = {};
  for (const acct of accounts) {
    if (!grouped[acct.accountType]) grouped[acct.accountType] = [];
    grouped[acct.accountType].push(acct);
  }

  const typeOrder = ["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE"];
  const typeColors: Record<string, string> = {
    ASSET: "#3399FF",
    LIABILITY: "#FF3333",
    EQUITY: "#9966FF",
    INCOME: "#00CC66",
    EXPENSE: "#FF9900",
  };

  // Compute totals per type
  const typeTotals: Record<string, number> = {};
  for (const type of typeOrder) {
    typeTotals[type] = (grouped[type] || []).reduce((s, a) => s + Number(a.currentBalance), 0);
  }

  return (
    <div className="p-4 space-y-6">
      <h1 className="text-sm font-bold tracking-[0.3em] text-[#FF6600] uppercase bb-mono border-b border-[#333333] pb-2">
        FINANCE
      </h1>

      {/* Bank Accounts */}
      <div className="space-y-3">
        <h2 className="text-[11px] uppercase tracking-widest text-[#888888] font-bold">Bank Accounts</h2>
        <div className="grid grid-cols-3 gap-4">
          {bankAccounts.map((ba) => (
            <div key={ba.id} className="border border-[#333333] bg-[#1A1A1A] p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-[#888888]">{ba.bankName}</span>
                <span className="text-[10px] text-[#666666]">{ba.sortCode} / {ba.accountNumber}</span>
              </div>
              <div className="text-lg font-bold tabular-nums text-[#E0E0E0]">
                {"\u00A3"}{fmt(Number(ba.currentBalance))}
              </div>
              <div className="text-[10px] text-[#888888] mt-1">{ba.accountName}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Chart of Accounts */}
      <div className="space-y-3">
        <h2 className="text-[11px] uppercase tracking-widest text-[#888888] font-bold">Chart of Accounts</h2>

        {/* Summary Cards */}
        <div className="grid grid-cols-5 gap-3">
          {typeOrder.map((type) => (
            <div key={type} className="border border-[#333333] bg-[#1A1A1A] p-3">
              <div className="text-[10px] uppercase tracking-widest font-bold" style={{ color: typeColors[type] }}>
                {type}
              </div>
              <div className="text-sm font-bold tabular-nums text-[#E0E0E0] mt-1">
                {"\u00A3"}{fmt(typeTotals[type] || 0)}
              </div>
              <div className="text-[10px] text-[#888888]">{(grouped[type] || []).length} accounts</div>
            </div>
          ))}
        </div>

        {/* Account Tables by Type */}
        {typeOrder.map((type) => {
          const accts = grouped[type] || [];
          if (accts.length === 0) return null;
          return (
            <div key={type} className="border border-[#333333] bg-[#1A1A1A]">
              <div className="px-4 py-2 border-b border-[#333333]">
                <span className="text-[11px] uppercase tracking-widest font-bold" style={{ color: typeColors[type] }}>
                  {type}
                </span>
              </div>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-[#333333] text-[10px] uppercase tracking-widest text-[#888888]">
                    <th className="text-left px-4 py-2 font-semibold w-20">Code</th>
                    <th className="text-left px-4 py-2 font-semibold">Account Name</th>
                    <th className="text-left px-4 py-2 font-semibold w-36">Sub Type</th>
                    <th className="text-right px-4 py-2 font-semibold w-32">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {accts.map((acct) => (
                    <tr key={acct.id} className="border-b border-[#222222] hover:bg-[#222222]">
                      <td className="px-4 py-2 text-xs text-[#FF6600] font-mono">{acct.accountCode}</td>
                      <td className="px-4 py-2 text-xs text-[#E0E0E0]">
                        {acct.accountName}
                        {acct.isSystemAccount && (
                          <span className="ml-2 text-[8px] text-[#666666] border border-[#444444] px-1 py-0.5 rounded">SYSTEM</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-[10px] text-[#888888]">{acct.accountSubType?.replace(/_/g, " ") || "\u2014"}</td>
                      <td className="px-4 py-2 text-xs text-right tabular-nums text-[#E0E0E0]">
                        {"\u00A3"}{fmt(Number(acct.currentBalance))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>

      {/* Tax Rates */}
      <div className="space-y-3">
        <h2 className="text-[11px] uppercase tracking-widest text-[#888888] font-bold">Tax Rates</h2>
        <div className="border border-[#333333] bg-[#1A1A1A]">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[#333333] text-[10px] uppercase tracking-widest text-[#888888]">
                <th className="text-left px-4 py-2 font-semibold">Name</th>
                <th className="text-right px-4 py-2 font-semibold">Rate</th>
                <th className="text-left px-4 py-2 font-semibold">Type</th>
                <th className="text-left px-4 py-2 font-semibold">HMRC Box</th>
              </tr>
            </thead>
            <tbody>
              {taxRates.map((tr) => (
                <tr key={tr.id} className="border-b border-[#222222] hover:bg-[#222222]">
                  <td className="px-4 py-2 text-xs text-[#E0E0E0]">
                    {tr.name}
                    {tr.isDefault && <span className="ml-2 text-[8px] text-[#00CC66]">DEFAULT</span>}
                  </td>
                  <td className="px-4 py-2 text-xs text-right tabular-nums text-[#E0E0E0]">{Number(tr.rate)}%</td>
                  <td className="px-4 py-2 text-[10px] text-[#888888]">{tr.taxType}</td>
                  <td className="px-4 py-2 text-[10px] text-[#888888]">{tr.hmrcBoxNumber ? `Box ${tr.hmrcBoxNumber}` : "\u2014"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
