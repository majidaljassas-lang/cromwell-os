import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { ConnectButton } from "./ConnectButton";
import { PlaidConnectButton } from "./PlaidConnectButton";
import { SyncButton } from "./SyncButton";

export const dynamic = "force-dynamic";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleString("en-GB");
}

function statusBadge(status: string): { bg: string; fg: string } {
  switch (status) {
    case "ACTIVE":
      return { bg: "#00CC66", fg: "#000000" };
    case "PENDING":
      return { bg: "#FF9900", fg: "#000000" };
    case "EXPIRED":
    case "REVOKED":
      return { bg: "#FF3333", fg: "#000000" };
    case "ERROR":
      return { bg: "#FF3333", fg: "#FFFFFF" };
    default:
      return { bg: "#444444", fg: "#CCCCCC" };
  }
}

export default async function BankingPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const sp = await searchParams;
  const tlConfigured = !!(
    process.env.TRUELAYER_CLIENT_ID && process.env.TRUELAYER_CLIENT_SECRET
  );
  const plaidConfigured = !!(
    process.env.PLAID_CLIENT_ID &&
    (process.env.PLAID_SECRET_SANDBOX ||
      process.env.PLAID_SECRET_DEVELOPMENT ||
      process.env.PLAID_SECRET_PRODUCTION)
  );

  const connections = await prisma.bankConnection.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      accounts: {
        select: {
          id: true,
          bankName: true,
          accountName: true,
          accountNumber: true,
          sortCode: true,
          currency: true,
          currentBalance: true,
          lastSyncedAt: true,
          _count: { select: { transactions: true } },
        },
      },
    },
  });

  const orphanAccounts = await prisma.bankAccount.findMany({
    where: { connectionId: null, isActive: true },
    select: {
      id: true,
      bankName: true,
      accountName: true,
      accountNumber: true,
      sortCode: true,
      currentBalance: true,
    },
  });

  const plaidEnv = (process.env.PLAID_ENV || "sandbox").toUpperCase();
  const tlEnv = process.env.TRUELAYER_ENV === "live" ? "LIVE" : "SANDBOX";

  return (
    <div className="p-4 space-y-6">
      <h1 className="text-sm font-bold tracking-[0.3em] text-[#FF6600] uppercase bb-mono border-b border-[#333333] pb-2">
        BANKING
        <span className="ml-3 text-[10px] text-[#888888]">
          PLAID:{plaidEnv} {tlConfigured && `· TL:${tlEnv}`}
        </span>
      </h1>

      {sp.connected && (
        <div className="border border-[#00CC66] bg-[#0A2A1A] p-3 text-[11px] text-[#00CC66]">
          Bank connected. Run a sync to fetch transactions.
        </div>
      )}
      {sp.error && (
        <div className="border border-[#FF3333] bg-[#2A0A0A] p-3 text-[11px] text-[#FF3333]">
          Connect failed: {sp.error}
        </div>
      )}

      {!plaidConfigured && (
        <div className="border border-[#FF9900] bg-[#2A1A0A] p-3 text-[11px] text-[#FF9900]">
          Plaid not configured. Set PLAID_CLIENT_ID and PLAID_SECRET_SANDBOX (or
          _PRODUCTION) in .env.local.
        </div>
      )}

      {/* Connect new bank */}
      <div className="border border-[#333333] bg-[#1A1A1A] p-4 space-y-3">
        <h2 className="text-[11px] uppercase tracking-widest text-[#888888] font-bold">
          Connect a Bank (Plaid)
        </h2>
        <p className="text-[10px] text-[#888888]">
          Each connection covers one institution. Barclays Business and Barclaycard
          Business are separate consents — connect both.
        </p>
        <div className="flex gap-3 flex-wrap">
          <PlaidConnectButton label="+ Connect Bank Account" />
        </div>
      </div>

      {/* Existing connections */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-[11px] uppercase tracking-widest text-[#888888] font-bold">
            Connections ({connections.length})
          </h2>
          <SyncButton />
        </div>
        {connections.length === 0 && (
          <div className="text-[11px] text-[#666666] italic">No connections yet.</div>
        )}
        {connections.map((c) => {
          const badge = statusBadge(c.status);
          const consentDue =
            c.consentExpiresAt &&
            c.consentExpiresAt.getTime() - Date.now() < SEVEN_DAYS_MS;
          const expired = c.status === "EXPIRED";
          return (
            <div
              key={c.id}
              className="border border-[#333333] bg-[#1A1A1A] p-4 space-y-2"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-bold text-[#E0E0E0]">
                    {c.displayName}
                  </span>
                  <span
                    className="text-[9px] px-1.5 py-0.5 font-bold"
                    style={{ background: badge.bg, color: badge.fg }}
                  >
                    {c.status}
                  </span>
                  <span className="text-[9px] text-[#666666]">{c.provider}</span>
                  <span className="text-[9px] text-[#666666]">{c.providerName}</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-[9px] text-[#666666]">
                    Last synced: {fmtDate(c.lastSyncedAt)}
                  </div>
                  {expired && c.provider === "PLAID" && (
                    <PlaidConnectButton
                      label="Reconnect"
                      mode="reauth"
                      connectionId={c.id}
                      variant="subtle"
                    />
                  )}
                </div>
              </div>

              {consentDue && !expired && (
                <div className="text-[10px] text-[#FF9900]">
                  ⚠ Consent expires {fmtDate(c.consentExpiresAt)} — reconnect required.
                </div>
              )}
              {c.lastSyncError && (
                <div className="text-[10px] text-[#FF3333]">{c.lastSyncError}</div>
              )}

              {c.accounts.length > 0 && (
                <table className="w-full mt-2">
                  <thead>
                    <tr className="border-b border-[#333333] text-[9px] uppercase tracking-widest text-[#888888]">
                      <th className="text-left px-2 py-1.5 font-semibold">Account</th>
                      <th className="text-left px-2 py-1.5 font-semibold w-32">Sort / No.</th>
                      <th className="text-right px-2 py-1.5 font-semibold w-24">Balance</th>
                      <th className="text-right px-2 py-1.5 font-semibold w-16">Txns</th>
                      <th className="text-right px-2 py-1.5 font-semibold w-16"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.accounts.map((a) => (
                      <tr key={a.id} className="border-b border-[#222222]">
                        <td className="px-2 py-1.5 text-[11px] text-[#E0E0E0]">
                          {a.bankName}
                          <span className="text-[#888888] ml-2">{a.accountName}</span>
                        </td>
                        <td className="px-2 py-1.5 text-[10px] text-[#888888] font-mono">
                          {a.sortCode || "—"} / {a.accountNumber || "—"}
                        </td>
                        <td className="px-2 py-1.5 text-[11px] text-right tabular-nums text-[#E0E0E0]">
                          {a.currency} {Number(a.currentBalance).toFixed(2)}
                        </td>
                        <td className="px-2 py-1.5 text-[10px] text-right text-[#888888]">
                          {a._count.transactions}
                        </td>
                        <td className="px-2 py-1.5 text-[10px] text-right">
                          <Link
                            href={`/banking/${a.id}`}
                            className="text-[#00CCFF] hover:underline uppercase tracking-widest text-[9px]"
                          >
                            Open →
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          );
        })}
      </div>

      {/* Orphan accounts */}
      {orphanAccounts.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-[11px] uppercase tracking-widest text-[#888888] font-bold">
            Unconnected Accounts ({orphanAccounts.length})
          </h2>
          <p className="text-[10px] text-[#666666]">
            These accounts exist in the ledger but have no live open-banking link.
            Connect a Plaid item with the matching mask to auto-link.
          </p>
          <div className="border border-[#333333] bg-[#1A1A1A]">
            <table className="w-full">
              <thead>
                <tr className="border-b border-[#333333] text-[9px] uppercase tracking-widest text-[#888888]">
                  <th className="text-left px-3 py-2 font-semibold">Bank</th>
                  <th className="text-left px-3 py-2 font-semibold">Account</th>
                  <th className="text-left px-3 py-2 font-semibold w-32">Sort / No.</th>
                  <th className="text-right px-3 py-2 font-semibold w-32">Balance</th>
                </tr>
              </thead>
              <tbody>
                {orphanAccounts.map((a) => (
                  <tr key={a.id} className="border-b border-[#222222]">
                    <td className="px-3 py-2 text-[11px] text-[#E0E0E0]">{a.bankName}</td>
                    <td className="px-3 py-2 text-[11px] text-[#888888]">{a.accountName}</td>
                    <td className="px-3 py-2 text-[10px] text-[#888888] font-mono">
                      {a.sortCode} / {a.accountNumber}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-right tabular-nums text-[#E0E0E0]">
                      £{Number(a.currentBalance).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Legacy TrueLayer connect kept inert; only show if creds set */}
      {tlConfigured && (
        <div className="border border-[#333333] bg-[#1A1A1A] p-4 space-y-3 opacity-50">
          <h2 className="text-[11px] uppercase tracking-widest text-[#888888] font-bold">
            Legacy TrueLayer (kept for reference)
          </h2>
          <div className="flex gap-3 flex-wrap">
            <ConnectButton
              providerName={tlEnv === "SANDBOX" ? "uk-cs-mock" : "uk-ob-barclays"}
              displayName="Barclays Business (TL)"
              label="+ Barclays via TrueLayer"
              variant="subtle"
            />
            <ConnectButton
              providerName={tlEnv === "SANDBOX" ? "uk-cs-mock" : "uk-ob-barclaycard"}
              displayName="Barclaycard Business (TL)"
              label="+ Barclaycard via TrueLayer"
              variant="subtle"
            />
          </div>
        </div>
      )}
    </div>
  );
}
