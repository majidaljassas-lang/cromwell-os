import { prisma } from "@/lib/prisma";
import { RunsListView } from "@/components/deliveries/runs-list-view";

export const dynamic = "force-dynamic";

export default async function DeliveriesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status: filterStatus } = await searchParams;

  const runs = await prisma.deliveryRun.findMany({
    where: filterStatus
      ? { status: filterStatus as "DRAFT" | "DISPATCHED" | "COMPLETED" | "CANCELLED" }
      : undefined,
    include: {
      cfSupplier: { select: { id: true, name: true } },
      _count: { select: { stops: true } },
      stops: {
        select: {
          id: true,
          status: true,
          type: true,
          sequence: true,
        },
      },
    },
    orderBy: [{ runDate: "desc" }, { createdAt: "desc" }],
  });

  // CF suppliers — anything currently used as a delivery carrier or anything
  // whose name contains 'cromwell freight'. Cheap surface area for the dropdown.
  const cfSuppliers = await prisma.supplier.findMany({
    where: {
      OR: [
        { deliveryRunsAsCarrier: { some: {} } },
        { name: { contains: "cromwell freight", mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  const s = (v: unknown) => JSON.parse(JSON.stringify(v));
  return (
    <div className="p-4 space-y-4">
      <RunsListView
        runs={s(runs)}
        cfSuppliers={cfSuppliers}
        filterStatus={filterStatus}
      />
    </div>
  );
}
