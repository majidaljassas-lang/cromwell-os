import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { ReconciliationDetail } from "@/components/reconciliations/reconciliation-detail";

export default async function ReconciliationPage({
  params,
}: {
  params: Promise<{ id: string; reconId: string }>;
}) {
  const { id: ticketId, reconId } = await params;

  const reconciliation = await prisma.reconciliation.findUnique({
    where: { id: reconId },
    include: {
      lines: { orderBy: [{ section: "asc" }, { createdAt: "asc" }] },
      parentTicket: {
        select: {
          id: true,
          ticketNo: true,
          title: true,
          status: true,
          isLocked: true,
          payingCustomer: { select: { id: true, name: true } },
          site: { select: { id: true, siteName: true } },
        },
      },
    },
  });

  if (!reconciliation || reconciliation.parentTicketId !== ticketId) {
    notFound();
  }

  return (
    <div className="px-6 py-6">
      <div className="mb-4 text-sm text-muted-foreground">
        <Link className="hover:underline" href={`/tickets/${ticketId}`}>
          ← Back to CP-{String(reconciliation.parentTicket.ticketNo).padStart(4, "0")} · {reconciliation.parentTicket.title}
        </Link>
      </div>
      <ReconciliationDetail
        reconciliation={{
          id: reconciliation.id,
          reconciliationNo: reconciliation.reconciliationNo,
          title: reconciliation.title,
          type: reconciliation.type,
          workflowState: reconciliation.workflowState,
          notes: reconciliation.notes,
          customerListSize: reconciliation.customerListSize,
          discrepancy: reconciliation.discrepancy as { messages: string[] } | null,
          createdAt: reconciliation.createdAt.toISOString(),
          confirmedAt: reconciliation.confirmedAt?.toISOString() ?? null,
          appliedAt: reconciliation.appliedAt?.toISOString() ?? null,
          parentTicket: {
            id: reconciliation.parentTicket.id,
            ticketNo: reconciliation.parentTicket.ticketNo,
            title: reconciliation.parentTicket.title,
            status: reconciliation.parentTicket.status,
            customerName: reconciliation.parentTicket.payingCustomer?.name ?? null,
            siteName: reconciliation.parentTicket.site?.siteName ?? null,
          },
          lines: reconciliation.lines.map((l) => ({
            id: l.id,
            section: l.section,
            action: l.action,
            flag: l.flag,
            description: l.description,
            qty: Number(l.qty),
            unit: l.unit,
            oldCode: l.oldCode,
            newCode: l.newCode,
            note: l.note,
            keepFlag: l.keepFlag,
            appliedAt: l.appliedAt?.toISOString() ?? null,
          })),
        }}
      />
    </div>
  );
}
