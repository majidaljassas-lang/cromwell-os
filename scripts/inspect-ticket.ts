import { prisma } from "@/lib/prisma";

async function main() {
  const idPrefix = process.argv[2] ?? "82d29511";
  const ticket = await prisma.ticket.findFirst({
    where: { id: { startsWith: idPrefix } },
    include: {
      site: true,
      payingCustomer: { select: { id: true, name: true } },
      lines: {
        orderBy: { displayOrder: "asc" },
        include: {
          supplier: { select: { id: true, name: true } },
          prices: {
            include: { supplier: { select: { id: true, name: true } } },
          },
          components: true,
          parentLine: { select: { id: true, displayOrder: true } },
        },
      },
      tasks: { orderBy: { createdAt: "desc" } },
      events: { orderBy: { createdAt: "desc" }, take: 30 },
      evidenceFragments: { orderBy: { createdAt: "desc" }, take: 30 },
      procurementOrders: {
        include: {
          supplier: { select: { name: true } },
        },
      },
      customerPOs: { include: { allocations: true } },
    },
  });
  if (!ticket) {
    console.log(`ticket prefix ${idPrefix} not found`);
    return;
  }

  console.log("=== TICKET ===");
  console.log({
    id: ticket.id,
    ticketNo: ticket.ticketNo,
    title: ticket.title,
    status: ticket.status,
    quoteStatus: ticket.quoteStatus,
    poStatus: ticket.poStatus,
    site: ticket.site
      ? { id: ticket.site.id, name: ticket.site.siteName }
      : null,
    customer: ticket.payingCustomer,
    quotedAt: ticket.quotedAt?.toISOString().slice(0, 10) ?? "-",
    orderedAt: ticket.orderedAt?.toISOString().slice(0, 10) ?? "-",
    deliveredAt: ticket.deliveredAt?.toISOString().slice(0, 10) ?? "-",
    invoicedAt: ticket.invoicedAt?.toISOString().slice(0, 10) ?? "-",
  });

  console.log(`\n=== LINES (${ticket.lines.length}) ===`);
  for (const l of ticket.lines) {
    const parent = l.parentLine ? `  (BOM child of #${l.parentLine.displayOrder})` : "";
    console.log(
      `\n#${l.displayOrder} [${l.lineType}] ${l.description}${parent}`,
    );
    console.log(
      `   qty=${l.qty} ${l.unit}  status=${l.status}  fromStock=${l.fromStock ?? 0}  toOrder=${l.toOrder ?? 0}`,
    );
    console.log(
      `   supplier=${l.supplier?.name ?? l.supplierName ?? "-"}  ref=${l.supplierReference ?? "-"}`,
    );
    console.log(
      `   expCost/u=${l.expectedCostUnit?.toString() ?? "-"}  actCostTot=${l.actualCostTotal?.toString() ?? "-"}  saleUnit=${l.actualSaleUnit?.toString() ?? "-"}`,
    );
    if (l.internalNotes) {
      console.log(`   notes: ${l.internalNotes}`);
    }
    if (l.prices.length) {
      console.log(`   quotes:`);
      for (const p of l.prices) {
        console.log(
          `     - ${p.supplier?.name ?? p.supplierName} £${p.costPerUnit.toString()}/u ${p.isWinner ? "★winner" : ""} ${p.notes ? `(${p.notes})` : ""}`,
        );
      }
    }
    if (l.components.length) {
      for (const c of l.components) {
        console.log(
          `   └─ [${c.lineType}] ${c.description}  qty=${c.qty} ${c.unit}  cost=${c.expectedCostUnit?.toString() ?? "-"}/u`,
        );
      }
    }
  }

  console.log(`\n=== PROCUREMENT ORDERS (${ticket.procurementOrders.length}) ===`);
  for (const po of ticket.procurementOrders) {
    console.log(
      `  #${po.poNumber ?? "-"}  ${po.supplier?.name ?? "?"}  status=${po.status}  placedAt=${po.placedAt?.toISOString().slice(0, 10) ?? "-"}`,
    );
  }

  console.log(`\n=== CUSTOMER POs (${ticket.customerPOs.length}) ===`);
  for (const po of ticket.customerPOs) {
    console.log(
      `  ${po.poNumber}  status=${po.status}  ${po.allocations.length} allocations`,
    );
  }

  console.log(`\n=== TASKS (${ticket.tasks.length}) ===`);
  for (const t of ticket.tasks) {
    console.log(`  [${t.status}] ${t.taskType} — ${t.title} (${t.priority})`);
  }

  console.log(`\n=== EVENTS (${ticket.events.length}) ===`);
  for (const e of ticket.events) {
    console.log(
      `  ${e.createdAt.toISOString().slice(0, 16)}  ${e.eventType}  ${e.title ?? ""}`,
    );
  }

  console.log(`\n=== EVIDENCE (${ticket.evidenceFragments.length}) ===`);
  for (const e of ticket.evidenceFragments) {
    console.log(
      `  ${e.createdAt.toISOString().slice(0, 16)}  ${e.fragmentType}  ${(e.summary ?? "").slice(0, 80)}`,
    );
  }
}

main().finally(() => prisma.$disconnect());
