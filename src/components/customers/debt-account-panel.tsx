import { DebtRecoveryForm } from "./debt-recovery-form";

// All debt invoices and recoveries here are UK standard-rated (20%), so net and
// VAT are derived from the authoritative gross figure. If a non-20% item ever
// enters a tracker this must move to stored per-line net/VAT.
const VAT_RATE = 0.2;
const netOf = (gross: number) => Math.round((gross / (1 + VAT_RATE)) * 100) / 100;
const vatOf = (gross: number) => Math.round((gross - netOf(gross)) * 100) / 100;

type Repayment = {
  id: string;
  paidAt: string;
  amount: string; // gross
  salesInvoiceId: string | null;
  note: string | null;
};

type SourceInvoice = {
  id: string;
  invoiceNumber: string;
  invoiceDate: string | null;
  originalTotal: string; // gross
  currentBalance: string; // gross
  note: string | null;
};

type Tracker = {
  id: string;
  label: string;
  internalNotes: string | null;
  openingBalance: string; // gross
  currency: string;
  repayments: Repayment[];
  sourceInvoices: SourceInvoice[];
};

type InvoiceInfo = { invoiceNo: string | null; status: string };
type InvoiceOption = { id: string; invoiceNo: string | null };

const gbp = (n: number, ccy: string) =>
  new Intl.NumberFormat("en-GB", { style: "currency", currency: ccy || "GBP" }).format(n);

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });

function MatchedRow({
  label,
  gross,
  ccy,
  tone,
  bold,
}: {
  label: string;
  gross: number;
  ccy: string;
  tone?: string;
  bold?: boolean;
}) {
  const cls = `${tone ?? "text-[#E0E0E0]"} ${bold ? "font-semibold" : ""}`;
  return (
    <tr className="border-t border-[#333333]">
      <td className="py-1 text-[#888888]">{label}</td>
      <td className={`py-1 text-right tabular-nums ${cls}`}>{gbp(netOf(gross), ccy)}</td>
      <td className="py-1 text-right tabular-nums text-[#888888]">{gbp(vatOf(gross), ccy)}</td>
      <td className={`py-1 text-right tabular-nums ${cls}`}>{gbp(gross, ccy)}</td>
    </tr>
  );
}

export function DebtAccountPanel({
  customerId,
  trackers,
  invoiceMap,
  invoiceOptions,
}: {
  customerId: string;
  trackers: Tracker[];
  invoiceMap: Record<string, InvoiceInfo>;
  invoiceOptions: InvoiceOption[];
}) {
  if (trackers.length === 0) return null;

  return (
    <div className="space-y-4">
      {trackers.map((t) => {
        const openingGross = Number(t.openingBalance);
        const recoveredGross = t.repayments.reduce((s, r) => s + Number(r.amount), 0);
        const remainingGross = openingGross - recoveredGross;
        const zohoGross = t.sourceInvoices.reduce((s, si) => s + Number(si.currentBalance), 0);
        const pendingGross = zohoGross - remainingGross;
        return (
          <div key={t.id} className="border border-[#333333] bg-[#1A1A1A] p-6 text-[#E0E0E0]">
            <div className="flex items-baseline justify-between">
              <h3 className="text-sm font-semibold">Debt account — {t.label}</h3>
              <span className="text-[10px] text-[#888888]">{t.repayments.length} recovery(ies)</span>
            </div>

            {/* Net · VAT · Gross matched register */}
            <table className="mt-3 w-full text-[11px]">
              <thead>
                <tr className="text-[#888888]">
                  <th className="py-1 text-left font-normal"></th>
                  <th className="py-1 text-right font-normal">Net</th>
                  <th className="py-1 text-right font-normal">VAT</th>
                  <th className="py-1 text-right font-normal">Gross</th>
                </tr>
              </thead>
              <tbody>
                <MatchedRow label="Opening debt" gross={openingGross} ccy={t.currency} />
                <MatchedRow label="Recovered" gross={recoveredGross} ccy={t.currency} tone="text-[#00CC66]" />
                <MatchedRow label="Remaining" gross={remainingGross} ccy={t.currency} tone="text-[#FF9900]" bold />
                <MatchedRow label="Still in Zoho (dead account)" gross={zohoGross} ccy={t.currency} />
                {pendingGross > 0.005 && (
                  <MatchedRow label="Pending write-off in Zoho" gross={pendingGross} ccy={t.currency} tone="text-[#FF6600]" />
                )}
              </tbody>
            </table>

            {t.internalNotes && (
              <div className="mt-3 border border-[#333333] bg-[#222222] p-2 text-[10px] text-[#888888]">
                <span className="text-[#FFCC00]">Internal note:</span> {t.internalNotes}
              </div>
            )}

            {t.sourceInvoices.length > 0 && (
              <div className="mt-3">
                <div className="text-[10px] text-[#888888]">
                  Dead-account invoices (Zoho Books) — outstanding {gbp(zohoGross, t.currency)} gross /{" "}
                  {gbp(netOf(zohoGross), t.currency)} net
                </div>
                <table className="mt-1 w-full text-[11px]">
                  <thead>
                    <tr className="text-left text-[#888888]">
                      <th className="py-1 font-normal">Zoho invoice</th>
                      <th className="py-1 font-normal">Date</th>
                      <th className="py-1 text-right font-normal">Original (gross)</th>
                      <th className="py-1 text-right font-normal">Outstanding (net)</th>
                      <th className="py-1 text-right font-normal">Outstanding (gross)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {t.sourceInvoices.map((si) => {
                      const bal = Number(si.currentBalance);
                      return (
                        <tr key={si.id} className="border-t border-[#333333]">
                          <td className="py-1">{si.invoiceNumber}</td>
                          <td className="py-1">{si.invoiceDate ? fmtDate(si.invoiceDate) : "—"}</td>
                          <td className="py-1 text-right tabular-nums text-[#888888]">
                            {gbp(Number(si.originalTotal), t.currency)}
                          </td>
                          <td className="py-1 text-right tabular-nums text-[#888888]">{gbp(netOf(bal), t.currency)}</td>
                          <td className="py-1 text-right tabular-nums">{gbp(bal, t.currency)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {t.repayments.length > 0 && (
              <div className="mt-3">
                <div className="text-[10px] text-[#888888]">Recoveries (via our invoices to the payer)</div>
                <table className="mt-1 w-full text-[11px]">
                  <thead>
                    <tr className="text-left text-[#888888]">
                      <th className="py-1 font-normal">Date</th>
                      <th className="py-1 text-right font-normal">Net</th>
                      <th className="py-1 text-right font-normal">VAT</th>
                      <th className="py-1 text-right font-normal">Gross</th>
                      <th className="py-1 font-normal">Our invoice</th>
                      <th className="py-1 font-normal">Note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {t.repayments.map((r) => {
                      const g = Number(r.amount);
                      const inv = r.salesInvoiceId ? invoiceMap[r.salesInvoiceId] : undefined;
                      return (
                        <tr key={r.id} className="border-t border-[#333333]">
                          <td className="py-1">{fmtDate(r.paidAt)}</td>
                          <td className="py-1 text-right tabular-nums">{gbp(netOf(g), t.currency)}</td>
                          <td className="py-1 text-right tabular-nums text-[#888888]">{gbp(vatOf(g), t.currency)}</td>
                          <td className="py-1 text-right tabular-nums">{gbp(g, t.currency)}</td>
                          <td className="py-1">
                            {inv ? (
                              <span>
                                {inv.invoiceNo} <span className="text-[9px] text-[#888888]">({inv.status})</span>
                              </span>
                            ) : (
                              <span className="text-[#888888]">—</span>
                            )}
                          </td>
                          <td className="py-1 text-[#888888]">{r.note ?? ""}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <DebtRecoveryForm customerId={customerId} trackerId={t.id} invoices={invoiceOptions} />
          </div>
        );
      })}
    </div>
  );
}
