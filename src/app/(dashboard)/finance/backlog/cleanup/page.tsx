import { getCleanupInsights } from "@/lib/zoho/cleanup-insights";
import { CleanupView } from "./CleanupView";

export const dynamic = "force-dynamic";

export default async function CleanupPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const initialInsights = await getCleanupInsights();
  return (
    <div className="p-4 space-y-4">
      <div className="flex items-baseline justify-between border-b border-[#333333] pb-2">
        <h1 className="text-sm font-bold tracking-[0.3em] text-[#FF6600] uppercase bb-mono">
          BACKLOG · CLEANUP
        </h1>
        <a
          href="/finance/backlog"
          className="text-[10px] uppercase tracking-widest text-[#888888] hover:text-[#E0E0E0]"
        >
          ← Backlog
        </a>
      </div>
      <CleanupView initialInsights={initialInsights} initialTab={tab ?? "overview"} />
    </div>
  );
}
