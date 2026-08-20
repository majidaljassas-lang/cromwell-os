/**
 * POST /api/sales-invoices/[id]/change-entity
 *
 * Re-point a SalesInvoice at any other customer (e.g. wrong entity was
 * billed, or the account moved). No corporate-group restriction — the
 * target can be any customer in the system.
 *
 * Works on PAID invoices too — the payment-receipt journal is re-attributed
 * alongside the AR entry so debtor analytics stay consistent.
 *
 * Side-effects:
 *   - SalesInvoice.customerId  → new
 *   - SalesInvoice.siteCommercialLinkId → cleared (re-link if needed)
 *   - JournalLine.customerId on the AR entry AND every payment-receipt entry
 *     → new (so analytics and aged-debtors reports reattribute cleanly)
 *   - Event row records the swap for audit
 *
 * Body: { customerId: string; reason?: string }
 */
import { prisma } from "@/lib/prisma";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = (await request.json()) as { customerId?: string; reason?: string };
    const newCustomerId = body.customerId;
    if (!newCustomerId) {
      return Response.json({ error: "customerId required" }, { status: 400 });
    }

    const result = await prisma.$transaction(async (tx) => {
      const inv = await tx.salesInvoice.findUnique({
        where: { id },
        include: {
          customer: { select: { id: true, name: true } },
          payments: { select: { id: true } },
        },
      });
      if (!inv) throw new Error("Invoice not found");

      if (inv.customerId === newCustomerId) {
        return { changed: false, customerId: inv.customerId };
      }

      const newCustomer = await tx.customer.findUnique({
        where: { id: newCustomerId },
        select: { id: true, name: true },
      });
      if (!newCustomer) throw new Error("Target customer not found");

      // Update the invoice
      await tx.salesInvoice.update({
        where: { id: inv.id },
        data: {
          customerId: newCustomerId,
          // Clear the old commercial link — it pointed at the old customer.
          // User can re-attach a link in a follow-up if needed.
          siteCommercialLinkId: null,
        },
      });

      // Re-attribute the journal lines to the new customer (analytic dim only —
      // debit/credit unchanged). Covers both the invoice's AR entry and, for a
      // PAID invoice, every payment-receipt entry that settled it — otherwise
      // the payment would stay attributed to the old customer.
      const paymentIds = inv.payments.map((p) => p.id);
      const updatedLines = await tx.journalLine.updateMany({
        where: {
          customerId: inv.customerId,
          journalEntry: {
            OR: [
              { sourceType: "SALES_INVOICE", sourceId: inv.id },
              { sourceType: "PAYMENT_RECEIVED", sourceId: { in: paymentIds } },
            ],
          },
        },
        data: { customerId: newCustomerId },
      });

      // Audit event
      await tx.event.create({
        data: {
          ticketId: inv.ticketId,
          eventType: "INVOICE_RAISED", // closest existing type
          timestamp: new Date(),
          notes:
            `Billing entity changed on ${inv.invoiceNo ?? inv.id}: ` +
            `${inv.customer.name} → ${newCustomer.name}` +
            (body.reason ? ` (reason: ${body.reason})` : ""),
        },
      });

      return {
        changed: true,
        from: inv.customer.name,
        to: newCustomer.name,
        journalLinesUpdated: updatedLines.count,
      };
    });

    return Response.json({ ok: true, ...result });
  } catch (e) {
    console.error("/api/sales-invoices/[id]/change-entity failed:", e);
    return Response.json(
      { error: e instanceof Error ? e.message : "Failed" },
      { status: 500 }
    );
  }
}
