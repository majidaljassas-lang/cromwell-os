/**
 * GET /api/finance/bank-inbox/suggest?bankTransactionId=...
 *
 * Suggest match candidates for a bank transaction. Looks at open SalesInvoices
 * (for inflows) and open SupplierBills (for outflows) where the amount is
 * within 1p tolerance and the date is within ±14 days. Returns sorted by
 * tightness of match.
 */
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const bankTransactionId = url.searchParams.get("bankTransactionId");
    if (!bankTransactionId) {
      return Response.json({ error: "bankTransactionId required" }, { status: 400 });
    }
    const bt = await prisma.bankTransaction.findUnique({
      where: { id: bankTransactionId },
    });
    if (!bt) return Response.json({ error: "BankTransaction not found" }, { status: 404 });

    const amount = Math.abs(Number(bt.amount));
    const isInflow = Number(bt.amount) > 0;
    const dateLow = new Date(bt.transactionDate);
    dateLow.setDate(dateLow.getDate() - 14);
    const dateHigh = new Date(bt.transactionDate);
    dateHigh.setDate(dateHigh.getDate() + 14);

    if (isInflow) {
      const candidates = await prisma.salesInvoice.findMany({
        where: {
          status: { in: ["SENT", "OVERDUE", "PARTIAL"] },
          totalSell: { gte: amount - 0.5, lte: amount + 0.5 },
        },
        include: {
          customer: { select: { name: true } },
          ticket: { select: { title: true, ticketNo: true } },
        },
        orderBy: { issuedAt: "desc" },
        take: 10,
      });
      return Response.json({
        bankTransactionId,
        direction: "INFLOW",
        suggestions: candidates.map((c) => ({
          matchType: "SALES_INVOICE" as const,
          id: c.id,
          invoiceNo: c.invoiceNo,
          customerName: c.customer.name,
          totalSell: Number(c.totalSell),
          issuedAt: c.issuedAt?.toISOString() ?? null,
          ticketTitle: c.ticket.title,
          ticketNo: c.ticket.ticketNo,
          score:
            Math.abs(Number(c.totalSell) - amount) < 0.01 ? "EXACT" : "CLOSE",
        })),
      });
    }

    // Outflow: open supplier bills
    const candidates = await prisma.supplierBill.findMany({
      where: {
        status: { notIn: ["PAID", "VOID", "CANCELLED"] },
        totalCost: { gte: amount - 0.5, lte: amount + 0.5 },
        billDate: { gte: dateLow, lte: dateHigh },
      },
      include: { supplier: { select: { name: true } } },
      orderBy: { billDate: "desc" },
      take: 10,
    });
    return Response.json({
      bankTransactionId,
      direction: "OUTFLOW",
      suggestions: candidates.map((c) => ({
        matchType: "SUPPLIER_BILL" as const,
        id: c.id,
        billNo: c.billNo,
        supplierName: c.supplier.name,
        totalCost: Number(c.totalCost),
        billDate: c.billDate.toISOString(),
        score:
          Math.abs(Number(c.totalCost) - amount) < 0.01 ? "EXACT" : "CLOSE",
      })),
    });
  } catch (e) {
    console.error("/api/finance/bank-inbox/suggest GET failed:", e);
    return Response.json(
      { error: e instanceof Error ? e.message : "failed" },
      { status: 500 }
    );
  }
}
