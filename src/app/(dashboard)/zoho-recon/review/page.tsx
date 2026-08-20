import { ReviewQueueView } from "@/components/reconciliation/review-queue-view";

export const dynamic = "force-dynamic";

export default function ReviewQueuePage() {
  return (
    <div className="p-4 space-y-4">
      <h1 className="text-sm font-bold tracking-[0.3em] text-[#FF6600] uppercase bb-mono border-b border-[#333333] pb-2">
        REVIEW QUEUE  ·  AUTO-PROPOSED MATCHES
      </h1>
      <ReviewQueueView />
    </div>
  );
}
