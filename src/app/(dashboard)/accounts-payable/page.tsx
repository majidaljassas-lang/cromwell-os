import { AccountsPayableView } from "@/components/accounts-payable/accounts-payable-view";

export const dynamic = "force-dynamic";

export default function AccountsPayablePage() {
  // Data fetched client-side so the same page can refresh on payment without a full reload
  return (
    <div className="p-4 space-y-4">
      <h1 className="text-sm font-bold tracking-[0.3em] text-[#FF6600] uppercase bb-mono border-b border-[#333333] pb-2">
        ACCOUNTS PAYABLE
      </h1>
      <AccountsPayableView />
    </div>
  );
}
