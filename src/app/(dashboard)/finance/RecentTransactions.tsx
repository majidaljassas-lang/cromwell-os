"use client";

interface TransactionData {
  id: string;
  transactionDate: string;
  amount: number;
  description: string;
  transactionType: string;
  reconciliationStatus: string;
  runningBalance: number | null;
  notes: string | null;
  bankName: string;
}

interface Props {
  transactions: TransactionData[];
}

function fmt(val: number): string {
  return val.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const statusColors: Record<string, string> = {
  UNRECONCILED: "#FF6600",
  MATCHED: "#3399FF",
  RECONCILED: "#00CC66",
  EXCLUDED: "#666666",
};

export function RecentTransactions({ transactions }: Props) {
  return (
    <div className="space-y-3">
      <h2 className="text-[11px] uppercase tracking-widest text-[#888888] font-bold">
        Recent Transactions
      </h2>
      <div className="border border-[#333333] bg-[#1A1A1A]">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[#333333] text-[10px] uppercase tracking-widest text-[#888888]">
              <th className="text-left px-4 py-2 font-semibold w-24">Date</th>
              <th className="text-left px-4 py-2 font-semibold">Description</th>
              <th className="text-left px-4 py-2 font-semibold w-20">Type</th>
              <th className="text-right px-4 py-2 font-semibold w-28">Amount</th>
              <th className="text-right px-4 py-2 font-semibold w-28">Balance</th>
              <th className="text-left px-4 py-2 font-semibold w-28">Status</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((txn) => {
              const isPositive = txn.amount >= 0;
              return (
                <tr
                  key={txn.id}
                  className="border-b border-[#222222] hover:bg-[#222222]"
                >
                  <td className="px-4 py-2 text-xs text-[#888888] tabular-nums">
                    {new Date(txn.transactionDate).toLocaleDateString("en-GB")}
                  </td>
                  <td className="px-4 py-2 text-xs text-[#E0E0E0]">
                    <div className="truncate max-w-[400px]">{txn.description}</div>
                    {txn.notes && (
                      <div className="text-[9px] text-[#666666] mt-0.5 truncate max-w-[400px]">
                        {txn.notes}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2 text-[10px] text-[#888888]">
                    {txn.transactionType}
                  </td>
                  <td
                    className={`px-4 py-2 text-xs text-right tabular-nums font-mono ${
                      isPositive ? "text-[#00CC66]" : "text-[#FF3333]"
                    }`}
                  >
                    {isPositive ? "+" : ""}
                    {"\u00A3"}{fmt(txn.amount)}
                  </td>
                  <td className="px-4 py-2 text-xs text-right tabular-nums text-[#888888]">
                    {txn.runningBalance !== null
                      ? `\u00A3${fmt(txn.runningBalance)}`
                      : "\u2014"}
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className="text-[9px] font-bold px-1.5 py-0.5"
                      style={{
                        color: statusColors[txn.reconciliationStatus] || "#888888",
                        borderWidth: 1,
                        borderStyle: "solid",
                        borderColor: statusColors[txn.reconciliationStatus] || "#888888",
                      }}
                    >
                      {txn.reconciliationStatus}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {transactions.length === 0 && (
          <div className="px-4 py-8 text-center text-[11px] text-[#666666]">
            No transactions yet. Import a CSV or connect via Open Banking.
          </div>
        )}
      </div>
    </div>
  );
}
