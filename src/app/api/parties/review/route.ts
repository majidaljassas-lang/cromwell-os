import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const items = await prisma.reviewQueueItem.findMany({
    where: {
      queueType: { in: ["UNRESOLVED_SUPPLIER", "UNRESOLVED_CUSTOMER"] },
      status: { in: ["OPEN_REVIEW", "IN_PROGRESS_REVIEW"] },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      queueType: true,
      status: true,
      rawValue: true,
      description: true,
      entityType: true,
      entityId: true,
      createdAt: true,
    },
  });

  const suppliers = items.filter((i) => i.queueType === "UNRESOLVED_SUPPLIER");
  const customers = items.filter((i) => i.queueType === "UNRESOLVED_CUSTOMER");

  return NextResponse.json({
    suppliers,
    customers,
    counts: { suppliers: suppliers.length, customers: customers.length },
  });
}
