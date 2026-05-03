import { findClusters } from "@/lib/suppliers/dedupe";
import { DedupeView } from "@/components/suppliers/dedupe-view";

export const dynamic = "force-dynamic";

export default async function SuppliersDedupePage({
  searchParams,
}: {
  searchParams: Promise<{ threshold?: string }>;
}) {
  const { threshold: rawT } = await searchParams;
  const threshold = rawT ? Math.max(0.3, Math.min(0.95, Number(rawT))) : 0.65;
  const clusters = await findClusters(threshold);

  const s = (v: unknown) => JSON.parse(JSON.stringify(v));
  return (
    <div className="p-4 space-y-4">
      <DedupeView clusters={s(clusters)} threshold={threshold} />
    </div>
  );
}
