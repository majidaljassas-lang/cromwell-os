import { prisma } from "@/lib/prisma";
import { STANDARD_VAT_RATE, lineVat } from "@/lib/finance/invoice-totals";

const r2 = (n: number) => Math.round(n * 100) / 100;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await request.json();
    const {
      customerId,
      siteId,
      invoiceType = "STANDARD",
      notes,
      lineIds,
    } = body;

    const ticket = await prisma.ticket.findUnique({
      where: { id },
      include: {
        // Include BOM children too — they appear on the invoice as
        // sub-items beneath their parent so the customer sees the bill
        // of materials. Pricing stays on the parent (children keep £0)
        // so totals don't double-count.
        lines: {
          orderBy: [{ displayOrder: "asc" }, { id: "asc" }],
        },
        payingCustomer: true,
        site: true,
        siteCommercialLink: true,
      },
    });

    if (!ticket) {
      return Response.json({ error: "Ticket not found" }, { status: 404 });
    }

    const readinessWarnings: string[] = [];

    // Check lines with status CAPTURED or missing pricing — BOM children
    // legitimately carry no price (parent absorbs cost) so exclude them.
    const unpricedLines = ticket.lines.filter(
      (line) =>
        line.parentLineId === null &&
        (line.status === "CAPTURED" ||
          line.actualSaleTotal === null ||
          Number(line.actualSaleTotal) === 0)
    );
    if (unpricedLines.length > 0) {
      readinessWarnings.push(
        `${unpricedLines.length} line(s) have status CAPTURED or missing sale total`
      );
    }

    // Fix 1: Check for BLOCKED_VAT_UNKNOWN bill lines on this ticket
    const blockedVatLines = await prisma.supplierBillLine.findMany({
      where: { ticketId: id, commercialStatus: "BLOCKED_VAT_UNKNOWN" },
      select: { id: true, description: true },
    });
    if (blockedVatLines.length > 0) {
      readinessWarnings.push(
        `${blockedVatLines.length} bill line(s) have UNKNOWN VAT basis and are blocked: ${blockedVatLines.map((l) => l.description).join(", ")}`
      );
    }

    // Check open blocker tasks
    const openBlockerTasks = await prisma.task.findMany({
      where: {
        ticketId: id,
        status: { notIn: ["COMPLETED", "CLOSED"] },
      },
    });
    if (openBlockerTasks.length > 0) {
      readinessWarnings.push(
        `${openBlockerTasks.length} open task(s) not yet completed or closed`
      );
    }

    // Check PO requirement
    if (ticket.poRequired) {
      const linkedPOs = await prisma.customerPO.findMany({
        where: {
          ticketId: id,
          status: { contains: "RECEIVED" },
        },
      });
      if (linkedPOs.length === 0) {
        readinessWarnings.push(
          "Ticket requires PO but no linked PO with RECEIVED status found"
        );
      }
    }

    // Build invoice lines.
    //
    // 1. Pick the priced top-level lines (or whatever the user selected).
    // 2. For each top-level line that's a BOM parent, pull its children
    //    along too — they appear on the invoice as "Included" component
    //    rows so the customer sees the bill of materials. Children carry
    //    £0 line totals; only the parent contributes to totalSell.
    const topLines = ticket.lines.filter((line) => {
      if (line.parentLineId !== null) return false; // parents/standalones only here
      if (lineIds && lineIds.length > 0) return lineIds.includes(line.id);
      return line.actualSaleUnit !== null || line.actualSaleTotal !== null;
    });

    const childrenByParent = new Map<string, typeof ticket.lines>();
    for (const line of ticket.lines) {
      if (line.parentLineId) {
        const arr = childrenByParent.get(line.parentLineId) ?? [];
        arr.push(line);
        childrenByParent.set(line.parentLineId, arr);
      }
    }

    // Flat list in display order: each parent followed by its BOM children.
    const orderedLines: Array<{ line: typeof ticket.lines[number]; isBomChild: boolean }> = [];
    for (const parent of topLines) {
      orderedLines.push({ line: parent, isBomChild: false });
      const kids = childrenByParent.get(parent.id) ?? [];
      kids.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      for (const k of kids) orderedLines.push({ line: k, isBomChild: true });
    }

    // Totals: only top-level priced lines contribute (children are absorbed).
    const totalNet = r2(topLines.reduce(
      (sum, line) => sum + Number(line.actualSaleTotal || 0),
      0
    ));
    // Overseas / outside-UK-VAT-scope customers are zero-rated. Mirror the
    // quote flows (convert-to-invoice / generate-proforma) rather than always
    // assuming the UK standard rate.
    const vatRate = ticket.payingCustomer?.outsideUkVatScope ? 0 : STANDARD_VAT_RATE;
    const totalVat = r2(totalNet * (vatRate / 100));
    const totalGross = r2(totalNet + totalVat);

    const invoiceNo = `INV-${Date.now()}`;
    const resolvedCustomerId = customerId || ticket.payingCustomerId;
    const resolvedSiteId = siteId || ticket.siteId;
    if (!resolvedSiteId) {
      return Response.json(
        {
          error: "SITE_REQUIRED",
          message: "Cannot draft an invoice without a site. Assign a site to the ticket " +
            "(or pass siteId in the request body) before generating the invoice.",
          field: "siteId",
        },
        { status: 422 }
      );
    }

    // Auto-pull PO reference from linked CustomerPOs
    const linkedPO = await prisma.customerPO.findFirst({
      where: { ticketId: id },
      orderBy: { createdAt: "desc" },
      select: { poNo: true },
    });
    const poRef = linkedPO?.poNo || null;

    const issuedAt = new Date();
    const dueDate = new Date(issuedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
    const invoice = await prisma.$transaction(async (tx) => {
      const created = await tx.salesInvoice.create({
        data: {
          ticketId: id,
          invoiceNo,
          customerId: resolvedCustomerId,
          siteId: resolvedSiteId,
          siteCommercialLinkId: ticket.siteCommercialLinkId,
          poNo: poRef,
          invoiceType,
          status: "DRAFT",
          issuedAt,
          dueDate,
          totalSell: totalGross,
          totalNet,
          totalVat,
          totalGross,
          notes,
        },
      });

      if (orderedLines.length > 0) {
        await tx.salesInvoiceLine.createMany({
          data: orderedLines.map(({ line, isBomChild }, i) => {
            const lineNet = isBomChild ? 0 : Number(line.actualSaleTotal || 0);
            return {
              salesInvoiceId: created.id,
              ticketLineId: line.id,
              description: line.description,
              qty: line.qty,
              unitPrice: isBomChild ? 0 : line.actualSaleUnit || 0,
              lineTotal: isBomChild ? 0 : line.actualSaleTotal || 0,
              vatRate,
              vatAmount: lineVat(lineNet, vatRate),
              displayMode: isBomChild ? "BOM_CHILD" : "LINE",
              displayOrder: i + 1,
            };
          }),
        });
      }

      return tx.salesInvoice.findUnique({
        where: { id: created.id },
        include: {
          ticket: true,
          customer: true,
          site: true,
          siteCommercialLink: true,
          lines: {
            include: { ticketLine: true },
          },
          poAllocations: true,
        },
      });
    });

    await prisma.event.create({
      data: {
        ticketId: id,
        eventType: "INVOICE_RAISED",
        timestamp: new Date(),
        notes: `Invoice ${invoice?.invoiceNo || invoiceNo} generated — £${totalGross.toFixed(2)} gross to ${ticket.payingCustomer?.name ?? "customer"}`,
      },
    });

    // Auto-progress ticket → INVOICED
    await prisma.ticket.update({
      where: { id },
      data: {
        status: "INVOICED",
        invoicedAt: new Date(),
        lastActivityAt: new Date(),
        ...(ticket.revenueState === "RECOVERY_PIPELINE" ? { revenueState: "REALISED" } : {}),
      },
    });

    // Close MARKUP_AND_INVOICE task, open CHASE_PAYMENT
    await prisma.task.updateMany({
      where: { ticketId: id, taskType: "MARKUP_AND_INVOICE", status: "OPEN" },
      data: { status: "DONE" },
    });
    const existingChase = await prisma.task.findFirst({
      where: { ticketId: id, taskType: "CHASE_PAYMENT", status: "OPEN" },
    });
    if (!existingChase) {
      await prisma.task.create({
        data: {
          ticketId: id,
          taskType: "CHASE_PAYMENT",
          priority: "MEDIUM",
          status: "OPEN",
          generatedReason: `Invoice ${invoice?.invoiceNo || invoiceNo} sent — chase payment if not received`,
        },
      });
    }

    // Auto-trigger PO line-level match (same pattern as customer-pos build-invoice)
    if (invoice && invoice.poNo) {
      try {
        const matchUrl = new URL(`/api/sales-invoices/${invoice.id}/match-po`, request.url);
        await fetch(matchUrl.toString(), { method: "POST" }).catch(() => {});
      } catch {}
    }

    return Response.json(
      { ...invoice, readinessWarnings },
      { status: 201 }
    );
  } catch (error) {
    console.error("Failed to generate invoice draft:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to generate invoice draft" },
      { status: 500 }
    );
  }
}
