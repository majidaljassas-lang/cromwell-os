import { prisma } from "@/lib/prisma";

async function main() {
  const ticketId = "82d29511-9db4-4d3c-bcdc-fcf980de642f";
  const tasks = await prisma.task.findMany({
    where: { ticketId },
    orderBy: { createdAt: "desc" },
  });
  for (const t of tasks) {
    console.log(JSON.stringify(t, null, 2));
    console.log("---");
  }

  console.log("\n=== Searching SupplierBills mentioning ticket clues ===");
  const bills = await prisma.supplierBill.findMany({
    where: {
      OR: [
        { customerRef: { contains: "C72", mode: "insensitive" } },
        { customerRef: { contains: "Roof Garden", mode: "insensitive" } },
        { customerRef: { contains: "A C UK", mode: "insensitive" } },
        { siteRef: { contains: "Roof Garden", mode: "insensitive" } },
        { siteRef: { contains: "C72", mode: "insensitive" } },
      ],
    },
    include: {
      supplier: { select: { name: true } },
      lines: { select: { description: true, qty: true, lineTotal: true, ticketId: true } },
    },
    take: 20,
  });
  console.log(`Found ${bills.length} bills mentioning A C UK / Roof Garden / C72`);
  for (const b of bills) {
    console.log(
      `\n${b.billNo}  ${b.supplier?.name}  ${b.billDate.toISOString().slice(0, 10)}  £${b.totalCost}  customerRef=${b.customerRef ?? "-"}  siteRef=${b.siteRef ?? "-"}`,
    );
    for (const l of b.lines.slice(0, 6)) {
      console.log(
        `  - ${l.description.slice(0, 80)}  qty=${l.qty}  £${l.lineTotal}  ticket=${l.ticketId ? l.ticketId.slice(0, 8) : "-"}`,
      );
    }
    if (b.lines.length > 6) console.log(`  + ${b.lines.length - 6} more lines`);
  }
}

main().finally(() => prisma.$disconnect());
