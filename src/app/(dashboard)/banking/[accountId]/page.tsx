import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { ReconcileView } from "./ReconcileView";

export const dynamic = "force-dynamic";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

interface PageProps {
  params: Promise<{ accountId: string }>;
  searchParams: Promise<{ tab?: string; q?: string }>;
}

export default async function AccountReconciliationPage({ params, searchParams }: PageProps) {
  const { accountId } = await params;
  const sp = await searchParams;
  const tab = (sp.tab as "all" | "recognised" | "excluded") || "all";

  const account = await prisma.bankAccount.findUnique({
    where: { id: accountId },
    include: {
      connection: true,
      account: true, // ChartOfAccount
    },
  });
  if (!account) return notFound();

  // Reconciliation status filter per tab.
  const statusFilter =
    tab === "recognised"
      ? { reconciliationStatus: "RECONCILED" }
      : tab === "excluded"
        ? { reconciliationStatus: "EXCLUDED" }
        : { reconciliationStatus: { in: ["UNRECONCILED", "MATCHED"] } };

  const [transactions, counts, ledgerBalance] = await Promise.all([
    prisma.bankTransaction.findMany({
      where: { bankAccountId: accountId, ...statusFilter },
      orderBy: { transactionDate: "desc" },
      take: 200,
      include: {
        matches: {
          where: { dismissedAt: null },
          orderBy: { confidenceScore: "desc" },
          take: 10,
        },
      },
    }),
    Promise.all([
      prisma.bankTransaction.count({
        where: {
          bankAccountId: accountId,
          reconciliationStatus: { in: ["UNRECONCILED", "MATCHED"] },
        },
      }),
      prisma.bankTransaction.count({
        where: { bankAccountId: accountId, reconciliationStatus: "RECONCILED" },
      }),
      prisma.bankTransaction.count({
        where: { bankAccountId: accountId, reconciliationStatus: "EXCLUDED" },
      }),
    ]),
    // ChartOfAccount.currentBalance is the books balance
    Promise.resolve(account.account?.currentBalance ?? 0),
  ]);

  // Hydrate match candidate refs (invoice/bill rows) so client doesn't re-fetch.
  const invoiceIds = new Set<string>();
  const billIds = new Set<string>();
  for (const t of transactions) {
    for (const m of t.matches) {
      if (m.matchType === "INVOICE") invoiceIds.add(m.matchedRecordId);
      else if (m.matchType === "BILL") billIds.add(m.matchedRecordId);
    }
  }

  const [invoiceRows, billRows] = await Promise.all([
    invoiceIds.size
      ? prisma.salesInvoice.findMany({
          where: { id: { in: Array.from(invoiceIds) } },
          select: {
            id: true,
            invoiceNo: true,
            poNo: true,
            issuedAt: true,
            totalGross: true,
            customer: { select: { name: true } },
          },
        })
      : Promise.resolve([]),
    billIds.size
      ? prisma.supplierBill.findMany({
          where: { id: { in: Array.from(billIds) } },
          select: {
            id: true,
            billNo: true,
            billDate: true,
            totalCost: true,
            supplier: { select: { name: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  const chartAccounts = await prisma.chartOfAccount.findMany({
    where: { isActive: true },
    select: { id: true, accountCode: true, accountName: true, accountType: true },
    orderBy: { accountCode: "asc" },
  });

  const [unrecCount, recCount, exclCount] = counts;

  const consentDue =
    account.connection?.consentExpiresAt &&
    account.connection.consentExpiresAt.getTime() - Date.now() < SEVEN_DAYS_MS;

  const txnPayload = transactions.map((t) => ({
    id: t.id,
    date: t.transactionDate.toISOString(),
    description: t.description,
    reference: t.reference,
    amount: Number(t.amount),
    type: t.transactionType,
    matches: t.matches.map((m) => {
      const inv = invoiceRows.find((r) => r.id === m.matchedRecordId);
      const bill = billRows.find((r) => r.id === m.matchedRecordId);
      return {
        id: m.id,
        type: m.matchType as "INVOICE" | "BILL",
        recordId: m.matchedRecordId,
        ref: m.matchedRecordRef,
        score: m.confidenceScore,
        confirmed: !!m.confirmedAt,
        // Display fields
        amount: inv ? Number(inv.totalGross) : bill ? Number(bill.totalCost) : 0,
        date: inv?.issuedAt?.toISOString() ?? bill?.billDate.toISOString() ?? null,
        partyName: inv?.customer?.name ?? bill?.supplier?.name ?? null,
        invoiceNo: inv?.invoiceNo ?? null,
        billNo: bill?.billNo ?? null,
        poNo: inv?.poNo ?? null,
      };
    }),
  }));

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-2 text-[10px] text-[#888888]">
        <Link href="/banking" className="hover:text-[#FF6600] uppercase tracking-widest">
          ← Banking
        </Link>
      </div>

      {consentDue && (
        <div className="border border-[#FF9900] bg-[#2A1A0A] p-3 text-[11px] text-[#FF9900]">
          ⚠ Your connection expires{" "}
          {account.connection?.consentExpiresAt?.toLocaleDateString("en-GB")}. Reconnect
          to keep fetching feeds.{" "}
          <Link href="/banking" className="underline">
            Reconnect now
          </Link>
        </div>
      )}

      {/* Header: account + KPIs */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-sm font-bold tracking-[0.3em] text-[#FF6600] uppercase bb-mono">
            {account.bankName} · {account.accountName}
          </h1>
          <div className="text-[10px] text-[#888888] mt-1 font-mono">
            Account: {account.sortCode || "—"} / xxxx{account.accountNumber || ""}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="border border-[#333333] bg-[#1A1A1A] p-3">
          <div className="text-[9px] uppercase tracking-widest text-[#888888]">
            Books Balance
          </div>
          <div className="text-lg font-bold text-[#E0E0E0] tabular-nums">
            {account.currency} {Number(ledgerBalance).toFixed(2)}
          </div>
        </div>
        <div className="border border-[#333333] bg-[#1A1A1A] p-3">
          <div className="text-[9px] uppercase tracking-widest text-[#888888]">
            Bank Balance
          </div>
          <div className="text-lg font-bold text-[#E0E0E0] tabular-nums">
            {account.currency} {Number(account.currentBalance).toFixed(2)}
          </div>
        </div>
        <div className="border border-[#333333] bg-[#1A1A1A] p-3">
          <div className="text-[9px] uppercase tracking-widest text-[#888888]">
            Last Feed Date
          </div>
          <div className="text-lg font-bold text-[#E0E0E0]">
            {account.lastSyncedAt
              ? account.lastSyncedAt.toLocaleDateString("en-GB", {
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                })
              : "—"}
          </div>
        </div>
      </div>

      {/* Uncategorised highlight */}
      <div className="border border-[#FF6600] bg-[#1A0F00] p-3 flex items-baseline gap-3">
        <div className="text-2xl font-bold text-[#FF6600] tabular-nums">{unrecCount}</div>
        <div>
          <div className="text-[11px] text-[#FF6600] font-bold uppercase tracking-widest">
            Uncategorised Transactions
          </div>
          <div className="text-[10px] text-[#888888]">From bank statements</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-[#333333]">
        <TabLink href={`/banking/${accountId}?tab=all`} active={tab === "all"}>
          All ({unrecCount})
        </TabLink>
        <TabLink href={`/banking/${accountId}?tab=recognised`} active={tab === "recognised"}>
          Recognised ({recCount})
        </TabLink>
        <TabLink href={`/banking/${accountId}?tab=excluded`} active={tab === "excluded"}>
          Excluded ({exclCount})
        </TabLink>
      </div>

      <ReconcileView
        accountId={accountId}
        transactions={txnPayload}
        chartAccounts={chartAccounts}
      />
    </div>
  );
}

function TabLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={
        "px-3 py-2 text-[10px] uppercase tracking-widest font-bold border-b-2 -mb-px " +
        (active
          ? "border-[#FF6600] text-[#FF6600]"
          : "border-transparent text-[#888888] hover:text-[#E0E0E0]")
      }
    >
      {children}
    </Link>
  );
}
