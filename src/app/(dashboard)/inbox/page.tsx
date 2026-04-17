import { InboxThreadsPanel } from "@/components/inbox/inbox-threads-panel";

export const dynamic = "force-dynamic";

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  return (
    <div className="p-4">
      <InboxThreadsPanel initialStatus={status} />
    </div>
  );
}
