import { BillDetailView } from "@/components/bills/bill-detail-view";

export const dynamic = "force-dynamic";

export default async function BillDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div className="p-4 space-y-4">
      <BillDetailView billId={id} />
    </div>
  );
}
