import { prisma } from "../src/lib/prisma";

async function main() {
  const inv = await prisma.salesInvoice.findFirst({
    where: { invoiceNo: "INV-1777546632358" },
    include: {
      customer: { select: { id: true, name: true, parentCustomerEntityId: true } },
      lines: { select: { id: true, description: true, lineTotal: true, vatAmount: true, poMatched: true, poMatchStatus: true, ticketLineId: true } },
    },
  });
  if (!inv) { console.log("not found"); return; }
  console.log({
    invoiceNo: inv.invoiceNo,
    poNo: inv.poNo,
    status: inv.status,
    customerId: inv.customerId,
    customerName: inv.customer.name,
    parentEntityId: inv.customer.parentCustomerEntityId,
    notes: inv.notes,
    lineCount: inv.lines.length,
    matchedLines: inv.lines.filter(l => l.poMatched).length,
  });
  for (const l of inv.lines) {
    console.log("  line:", { matched: l.poMatched, status: l.poMatchStatus, descr: l.description.slice(0, 60), tlid: l.ticketLineId?.slice(0, 8) });
  }

  if (inv.poNo) {
    const customerPO = await prisma.customerPO.findFirst({
      where: { poNo: inv.poNo },
      include: { customer: { select: { id: true, name: true } }, lines: { select: { id: true, description: true, ticketLineId: true } } },
    });
    console.log("\nCustomerPO matching poNo", inv.poNo, ":");
    if (!customerPO) console.log("  NONE FOUND");
    else console.log("  ", { id: customerPO.id.slice(0, 8), customerId: customerPO.customerId, customerName: customerPO.customer.name, lineCount: customerPO.lines.length });
  }
}
main().finally(() => prisma.$disconnect());
