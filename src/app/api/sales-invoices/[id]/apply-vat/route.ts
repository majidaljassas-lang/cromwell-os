import { prisma } from "@/lib/prisma";
import { STANDARD_VAT_RATE, lineVat, recomputeInvoiceTotals } from "@/lib/finance/invoice-totals";
import { postSalesInvoice, reverseJournal } from "@/lib/finance/gl-posting";

/**
 * POST /api/sales-invoices/[id]/apply-vat
 *
 * Applies VAT to every line of an invoice that currently has no VAT
 * recorded. Used to fix legacy invoices created before VAT was captured
 * at line level.
 *
 * - DRAFT: just updates lines + recomputes totals.
 * - SENT/OVERDUE/PARTIALLY_PAID: also reverses the existing AR JE and
 *   re-posts it so debtors / sales / VAT-output all reflect the new
 *   line state. Period must be open. Payments are not touched.
 * - PAID/CREDITED/VOIDED: refused.
 *
 * Body (optional): { rate?: number }  // defaults to 20
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let rate = STANDARD_VAT_RATE;
  try {
    const body = await _request.json().catch(() => ({})) as { rate?: number };
    if (typeof body.rate === "number" && body.rate >= 0 && body.rate <= 100) {
      rate = body.rate;
    }
  } catch {}

  const invoice = await prisma.salesInvoice.findUnique({
    where: { id },
    include: { lines: true, payments: true, salesCreditNotes: true },
  });
  if (!invoice) return Response.json({ error: "Invoice not found" }, { status: 404 });

  const REPOST_STATUSES = new Set(["SENT", "OVERDUE", "PARTIALLY_PAID"]);
  const ALLOWED = new Set(["DRAFT", ...REPOST_STATUSES]);
  if (!ALLOWED.has(invoice.status)) {
    return Response.json(
      { error: `Cannot apply VAT to invoice in status ${invoice.status}.` },
      { status: 422 }
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    for (const line of invoice.lines) {
      const net = Number(line.lineTotal);
      await tx.salesInvoiceLine.update({
        where: { id: line.id },
        data: { vatRate: rate, vatAmount: lineVat(net, rate) },
      });
    }
    const totals = await recomputeInvoiceTotals(tx, id);

    let reposted = false;
    let statusChanged = false;
    if (REPOST_STATUSES.has(invoice.status)) {
      const { reversed } = await reverseJournal(tx, "SALES_INVOICE", id);
      if (reversed) {
        await postSalesInvoice(id, tx);
        reposted = true;
      }

      // Changing the VAT changes the gross the customer owes, so the
      // payment status can go stale (e.g. a partially-paid invoice becomes
      // fully paid once VAT is removed). Re-evaluate it the same way the
      // payments route does: paid vs gross less active credit notes.
      const paid = invoice.payments.reduce((s, p) => s + Number(p.amount), 0);
      const credits = invoice.salesCreditNotes
        .filter((c) => !["DRAFT", "VOID", "VOIDED", "CANCELLED"].includes(c.status))
        .reduce((s, c) => s + Number(c.total), 0);
      const target = totals.totalGross - credits;
      if (paid > 0 && paid + 0.005 >= target && invoice.status !== "PAID") {
        const latestPayment = invoice.payments
          .map((p) => p.paymentDate)
          .sort((a, b) => b.getTime() - a.getTime())[0];
        await tx.salesInvoice.update({
          where: { id },
          data: { status: "PAID", paidAt: latestPayment ?? new Date() },
        });
        statusChanged = true;
      }
    }

    return { ...totals, reposted, statusChanged };
  });

  return Response.json({ ok: true, ...result });
}
