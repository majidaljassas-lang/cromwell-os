import { prisma } from "@/lib/prisma";
import { reverseJournal, postSalesInvoice } from "@/lib/finance/gl-posting";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const invoice = await prisma.salesInvoice.findUnique({
      where: { id },
      include: {
        ticket: true,
        customer: true,
        site: true,
        siteCommercialLink: true,
        lines: {
          include: {
            ticketLine: true,
          },
        },
        poAllocations: {
          include: {
            customerPO: true,
          },
        },
      },
    });

    if (!invoice) {
      return Response.json({ error: "Invoice not found" }, { status: 404 });
    }

    return Response.json(invoice);
  } catch (error) {
    console.error("Failed to get sales invoice:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to get sales invoice" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await request.json();
    const { status, invoiceNo, invoiceType, issuedAt, paidAt, notes, poNo } = body;

    const data: Record<string, unknown> = {};
    if (status !== undefined) data.status = status;
    if (invoiceNo !== undefined) data.invoiceNo = invoiceNo;
    if (invoiceType !== undefined) data.invoiceType = invoiceType;
    if (issuedAt !== undefined) data.issuedAt = issuedAt ? new Date(issuedAt) : null;
    if (paidAt !== undefined) data.paidAt = paidAt ? new Date(paidAt) : null;
    if (notes !== undefined) data.notes = notes;
    if (poNo !== undefined) data.poNo = poNo;

    const invoice = await prisma.$transaction(async (tx) => {
      const updated = await tx.salesInvoice.update({
        where: { id },
        data,
        include: {
          ticket: true,
          customer: true,
          site: true,
          lines: true,
          poAllocations: true,
        },
      });

      // If the invoice date moved and this invoice is already posted to the GL,
      // re-date its AR journal entry so the ledger sits in the correct fiscal
      // period. Reverse + re-post rebuilds the JE from the new issuedAt.
      if (issuedAt !== undefined && updated.issuedAt) {
        const existingJe = await tx.journalEntry.findFirst({
          where: { sourceType: "SALES_INVOICE", sourceId: id },
          select: { id: true },
        });
        if (existingJe) {
          await reverseJournal(tx, "SALES_INVOICE", id);
          await postSalesInvoice(id, tx);
        }
      }

      return updated;
    });

    // Auto-run PO match if poNo changed or was set
    if (poNo !== undefined && invoice.poNo) {
      try {
        const matchUrl = new URL(`/api/sales-invoices/${id}/match-po`, request.url);
        await fetch(matchUrl.toString(), { method: "POST" }).catch(() => {});
      } catch {}
    }

    return Response.json(invoice);
  } catch (error) {
    console.error("Failed to update sales invoice:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to update sales invoice" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const invoice = await prisma.salesInvoice.findUnique({
      where: { id },
      select: { id: true, status: true, invoiceNo: true },
    });

    if (!invoice) {
      return Response.json({ error: "Invoice not found" }, { status: 404 });
    }

    if (invoice.status !== "DRAFT" && invoice.status !== "VOIDED") {
      return Response.json({ error: "Only DRAFT or VOIDED invoices can be deleted" }, { status: 409 });
    }

    // Delete lines first, then PO allocations, then the invoice
    await prisma.$transaction([
      prisma.salesInvoiceLine.deleteMany({ where: { salesInvoiceId: id } }),
      prisma.customerPOAllocation.deleteMany({ where: { salesInvoiceId: id } }),
      prisma.payment.deleteMany({ where: { salesInvoiceId: id } }),
      prisma.salesInvoice.delete({ where: { id } }),
    ]);

    return Response.json({ deleted: true, id });
  } catch (error) {
    console.error("Failed to delete sales invoice:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to delete sales invoice" },
      { status: 500 }
    );
  }
}
