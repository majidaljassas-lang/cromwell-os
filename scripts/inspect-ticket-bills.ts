import { prisma } from "@/lib/prisma";

async function main() {
  const idPrefix = process.argv[2] ?? "82d29511";
  const ticket = await prisma.ticket.findFirst({
    where: { id: { startsWith: idPrefix } },
    select: { id: true, ticketNo: true, title: true },
  });
  if (!ticket) {
    console.log("ticket not found");
    return;
  }
  console.log(`Ticket #${ticket.ticketNo} ${ticket.id}`);
  console.log(`  ${ticket.title}\n`);

  // 1) SupplierBillLines that point directly at this ticket via ticketId
  const directLines = await prisma.supplierBillLine.findMany({
    where: { ticketId: ticket.id },
    include: {
      supplierBill: {
        include: { supplier: { select: { id: true, name: true } } },
      },
      billLineAllocations: {
        include: { ticketLine: { select: { displayOrder: true, description: true } } },
      },
    },
  });

  // 2) BillLineAllocations whose ticketLine belongs to this ticket
  //    (catches lines that don't have ticketId set on the bill line itself)
  const allocs = await prisma.billLineAllocation.findMany({
    where: { ticketLine: { ticketId: ticket.id } },
    include: {
      supplierBillLine: {
        include: {
          supplierBill: {
            include: { supplier: { select: { id: true, name: true } } },
          },
        },
      },
      ticketLine: { select: { displayOrder: true, description: true } },
    },
  });

  // Aggregate bills by id
  type BillRow = {
    id: string;
    billNo: string;
    supplier: string;
    billDate: Date;
    totalCost: string;
    paymentStatus: string;
    matchStatus: string | null;
    lines: { desc: string; qty: string; cost: string; ticketLine: string | null }[];
  };
  const bills = new Map<string, BillRow>();

  function ensureBill(b: NonNullable<typeof directLines>[number]["supplierBill"]) {
    if (!bills.has(b.id)) {
      bills.set(b.id, {
        id: b.id,
        billNo: b.billNo,
        supplier: b.supplier?.name ?? "?",
        billDate: b.billDate,
        totalCost: b.totalCost.toString(),
        paymentStatus: b.paymentStatus,
        matchStatus: b.matchStatus,
        lines: [],
      });
    }
    return bills.get(b.id)!;
  }

  for (const dl of directLines) {
    const row = ensureBill(dl.supplierBill);
    const tl = dl.billLineAllocations[0]?.ticketLine;
    row.lines.push({
      desc: dl.description,
      qty: dl.qty.toString(),
      cost: dl.lineTotal.toString(),
      ticketLine: tl ? `#${tl.displayOrder} ${tl.description}` : null,
    });
  }
  for (const a of allocs) {
    const row = ensureBill(a.supplierBillLine.supplierBill);
    row.lines.push({
      desc: a.supplierBillLine.description,
      qty: (a.allocatedQty ?? a.supplierBillLine.qty).toString(),
      cost: (a.allocatedCost ?? a.supplierBillLine.lineTotal).toString(),
      ticketLine: a.ticketLine
        ? `#${a.ticketLine.displayOrder} ${a.ticketLine.description}`
        : null,
    });
  }

  if (bills.size === 0) {
    console.log("No supplier bill lines linked to this ticket.\n");
    console.log("Checking BILL_NEEDS_REVIEW tasks for hints...");
    const tasks = await prisma.task.findMany({
      where: { ticketId: ticket.id, taskType: "BILL_NEEDS_REVIEW" },
      orderBy: { createdAt: "desc" },
    });
    const billIds = tasks
      .map((t) => t.supplierBillId)
      .filter((x): x is string => !!x);
    if (billIds.length) {
      const referenced = await prisma.supplierBill.findMany({
        where: { id: { in: billIds } },
        include: {
          supplier: { select: { name: true } },
          lines: {
            select: {
              description: true,
              qty: true,
              lineTotal: true,
              ticketId: true,
              allocationStatus: true,
            },
          },
        },
      });
      for (const b of referenced) {
        console.log(
          `\n${b.billNo}  ${b.supplier?.name ?? "?"}  ${b.billDate.toISOString().slice(0, 10)}  £${b.totalCost.toString()}  pay=${b.paymentStatus}  match=${b.matchStatus ?? "-"}`,
        );
        for (const l of b.lines) {
          console.log(
            `  - ${l.description.slice(0, 80)}  qty=${l.qty}  £${l.lineTotal.toString()}  alloc=${l.allocationStatus}  ticket=${l.ticketId ? l.ticketId.slice(0, 8) : "-"}`,
          );
        }
      }
    } else {
      for (const t of tasks) {
        console.log(`  task ${t.id}  status=${t.status}  draftBody=${(t.draftBody ?? "").slice(0, 200)}`);
      }
    }
    return;
  }

  console.log(`Found ${bills.size} bill(s):`);
  for (const b of bills.values()) {
    console.log(
      `\n${b.billNo}  ${b.supplier}  ${b.billDate.toISOString().slice(0, 10)}  £${b.totalCost}  pay=${b.paymentStatus}  match=${b.matchStatus ?? "-"}`,
    );
    for (const l of b.lines) {
      console.log(
        `  - ${l.desc.slice(0, 80)}  qty=${l.qty}  £${l.cost}  → ${l.ticketLine ?? "(unallocated)"}`,
      );
    }
  }
}

main().finally(() => prisma.$disconnect());
