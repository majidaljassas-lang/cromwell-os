import { prisma } from "@/lib/prisma";
import { WorkQueue } from "@/components/work-queue/work-queue";

export const dynamic = 'force-dynamic';

export default async function WorkQueuePage() {
  const workItems = await prisma.inquiryWorkItem.findMany({
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
  });
  const activeTickets = await prisma.ticket.findMany({
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
  });
  const recoveryCases = await prisma.recoveryCase.findMany({
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
  });

  const s = (v: unknown) => JSON.parse(JSON.stringify(v));

  return (
    <div className="p-4 space-y-4">
      <WorkQueue
        workItems={s(workItems)}
        activeTickets={s(activeTickets)}
        recoveryCases={s(recoveryCases)}
      />
    </div>
  );
}
