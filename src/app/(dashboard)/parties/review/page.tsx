import { prisma } from "@/lib/prisma";
import { ReviewQueueClient } from "@/components/parties/review-queue-client";

export const dynamic = "force-dynamic";

export default async function PartiesReviewPage() {
  const [items, suppliers, customers] = await Promise.all([
    prisma.reviewQueueItem.findMany({
      where: {
        queueType: { in: ["UNRESOLVED_SUPPLIER", "UNRESOLVED_CUSTOMER"] },
        status: { in: ["OPEN_REVIEW", "IN_PROGRESS_REVIEW"] },
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        queueType: true,
        rawValue: true,
        description: true,
        entityType: true,
        entityId: true,
        createdAt: true,
      },
    }),
    prisma.supplier.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.customer.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const s = (v: unknown) => JSON.parse(JSON.stringify(v));

  return (
    <div className="p-4">
      <ReviewQueueClient
        items={s(items)}
        suppliers={suppliers}
        customers={customers}
      />
    </div>
  );
}
