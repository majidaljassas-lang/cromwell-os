import { prisma } from "@/lib/prisma";
import { WorkQueue } from "@/components/work-queue/work-queue";

export const dynamic = 'force-dynamic';

export default async function WorkQueuePage() {
  const [workItems, activeTickets, recoveryCases] = await Promise.all([
    prisma.inquiryWorkItem.findMany({
      where: {
        status: {
          notIn: ["CONVERTED", "CLOSED_LOST", "CLOSED_NO_ACTION"],
        },
      },
      include: {
        enquiry: true,
        site: true,
        customer: true,
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.ticket.findMany({
      where: {
        status: {
          notIn: ["CLOSED", "INVOICED"],
        },
      },
      include: {
        payingCustomer: true,
        site: true,
        _count: {
          select: { lines: true },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.recoveryCase.findMany({
      where: {
        recoveryStatus: {
          not: "CLOSED",
        },
      },
      include: {
        ticket: {
          include: {
            payingCustomer: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return (
    <div className="p-4 space-y-4">
      <WorkQueue
        workItems={workItems}
        activeTickets={activeTickets}
        recoveryCases={recoveryCases}
      />
    </div>
  );
}
