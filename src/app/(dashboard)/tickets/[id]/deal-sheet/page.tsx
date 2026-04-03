import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { DealSheetView } from "@/components/deal-sheet/deal-sheet-view";
import Link from "next/link";

export default async function DealSheetPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const ticket = await prisma.ticket.findUnique({
    where: { id },
    include: {
      payingCustomer: true,
      site: true,
      lines: {
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!ticket) {
    notFound();
  }

  // Fetch latest deal sheet
  const dealSheet = await prisma.dealSheet.findFirst({
    where: { ticketId: id },
    orderBy: { versionNo: "desc" },
    include: {
      lineSnapshots: {
        include: {
          ticketLine: true,
        },
      },
    },
  });

  // Fetch supplier options for this ticket's lines
  const supplierOptions = await prisma.supplierOption.findMany({
    where: {
      ticketLine: {
        ticketId: id,
      },
    },
    include: {
      supplier: true,
      ticketLine: true,
    },
  });

  // Fetch benchmarks for this ticket's lines
  const benchmarks = await prisma.benchmark.findMany({
    where: {
      ticketLine: {
        ticketId: id,
      },
    },
    include: {
      ticketLine: true,
    },
  });

  // Fetch comp sheets
  const compSheets = await prisma.compSheet.findMany({
    where: { ticketId: id },
    include: {
      lines: {
        include: {
          ticketLine: true,
        },
      },
    },
    orderBy: { versionNo: "desc" },
  });

  // Fetch all suppliers for the add supplier option form
  const suppliers = await prisma.supplier.findMany({
    orderBy: { name: "asc" },
  });

  return (
    <div className="p-8">
      <div className="mb-4">
        <Link
          href={`/tickets/${id}`}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          &larr; Back to Ticket
        </Link>
      </div>
      <DealSheetView
        ticket={ticket as any}
        dealSheet={dealSheet as any}
        supplierOptions={supplierOptions as any}
        benchmarks={benchmarks as any}
        compSheets={compSheets as any}
        suppliers={suppliers as any}
      />
    </div>
  );
}
