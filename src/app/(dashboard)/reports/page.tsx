import { ReportsView } from "@/components/reports/reports-view";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3001";

  const [siteRes, customerRes, poRes, recoveryRes, absorbedRes, unallocatedRes] = await Promise.all([
    fetch(`${baseUrl}/api/reports/site-profitability`, { cache: "no-store" }).catch(() => null),
    fetch(`${baseUrl}/api/reports/customer-profitability`, { cache: "no-store" }).catch(() => null),
    fetch(`${baseUrl}/api/reports/po-utilisation`, { cache: "no-store" }).catch(() => null),
    fetch(`${baseUrl}/api/reports/recovery-ageing`, { cache: "no-store" }).catch(() => null),
    fetch(`${baseUrl}/api/reports/absorbed-costs`, { cache: "no-store" }).catch(() => null),
    fetch(`${baseUrl}/api/reports/unallocated-costs`, { cache: "no-store" }).catch(() => null),
  ]);

  const siteProfitability = siteRes?.ok ? await siteRes.json() : [];
  const customerProfitability = customerRes?.ok ? await customerRes.json() : [];
  const poUtilisation = poRes?.ok ? await poRes.json() : [];
  const recoveryAgeing = recoveryRes?.ok ? await recoveryRes.json() : [];
  const absorbedCosts = absorbedRes?.ok ? await absorbedRes.json() : [];
  const unallocatedCosts = unallocatedRes?.ok ? await unallocatedRes.json() : [];

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-sm font-bold tracking-[0.3em] text-[#FF6600] uppercase bb-mono border-b border-[#333333] pb-2">REPORTS</h1>
      <ReportsView
        siteProfitability={siteProfitability}
        customerProfitability={customerProfitability}
        poUtilisation={poUtilisation}
        recoveryAgeing={recoveryAgeing}
        absorbedCosts={absorbedCosts}
        unallocatedCosts={unallocatedCosts}
      />
    </div>
  );
}
