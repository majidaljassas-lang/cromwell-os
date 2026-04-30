import { InboxMessagesPanel } from "@/components/inbox/inbox-messages-panel";

export const dynamic = "force-dynamic";

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  return (
    <div className="p-4">
      <InboxMessagesPanel initialStatus={status} />
    </div>
  );
}
