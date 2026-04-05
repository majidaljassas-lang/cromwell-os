import { prisma } from "@/lib/prisma";

/**
 * POST /api/admin/clear-tickets
 *
 * Clears enquiries, tickets (and all related entities), and suppliers.
 * Does NOT touch backlog, commercial reconciliation, or site data.
 */
export async function POST() {
  try {
    // Delete in dependency order (children first)

    // Ticket-related
    const salesInvoiceLines = await prisma.salesInvoiceLine.deleteMany({});
    const customerPOAllocations = await prisma.customerPOAllocation.deleteMany({});
    const salesInvoices = await prisma.salesInvoice.deleteMany({});
    const creditNoteAllocations = await prisma.creditNoteAllocation.deleteMany({});
    const returnLines = await prisma.returnLine.deleteMany({});
    const returns = await prisma.return.deleteMany({});
    const creditNotes = await prisma.creditNote.deleteMany({});
    const reallocationRecords = await prisma.reallocationRecord.deleteMany({});
    const stockExcessRecords = await prisma.stockExcessRecord.deleteMany({});
    const absorbedCostAllocations = await prisma.absorbedCostAllocation.deleteMany({});
    const costAllocations = await prisma.costAllocation.deleteMany({});
    const labourEntries = await prisma.labourEntry.deleteMany({});
    const cashSales = await prisma.cashSale.deleteMany({});
    const logisticsEvents = await prisma.logisticsEvent.deleteMany({});
    const evidencePackItems = await prisma.evidencePackItem.deleteMany({});
    const evidencePacks = await prisma.evidencePack.deleteMany({});
    const recoveryCases = await prisma.recoveryCase.deleteMany({});
    const tasks = await prisma.task.deleteMany({});
    const events = await prisma.event.deleteMany({});
    const evidenceFragments = await prisma.evidenceFragment.deleteMany({});
    const sitePackItems = await prisma.sitePackItem.deleteMany({});
    const sitePacks = await prisma.sitePack.deleteMany({});
    const materialsDrawdowns = await prisma.materialsDrawdownEntry.deleteMany({});
    const labourDrawdowns = await prisma.labourDrawdownEntry.deleteMany({});
    const customerPOLines = await prisma.customerPOLine.deleteMany({});
    const customerPOs = await prisma.customerPO.deleteMany({});
    const quoteLines = await prisma.quoteLine.deleteMany({});
    const quotes = await prisma.quote.deleteMany({});
    const compSheetLines = await prisma.compSheetLine.deleteMany({});
    const compSheets = await prisma.compSheet.deleteMany({});
    const dealSheetSnapshots = await prisma.dealSheetLineSnapshot.deleteMany({});
    const dealSheets = await prisma.dealSheet.deleteMany({});
    const benchmarks = await prisma.benchmark.deleteMany({});
    const salesBundleCostLinks = await prisma.salesBundleCostLink.deleteMany({});
    const salesBundles = await prisma.salesBundle.deleteMany({});
    const procurementOrderLines = await prisma.procurementOrderLine.deleteMany({});
    const procurementOrders = await prisma.procurementOrder.deleteMany({});
    const supplierOptions = await prisma.supplierOption.deleteMany({});
    const ticketLines = await prisma.ticketLine.deleteMany({});
    const ticketPhases = await prisma.ticketPhase.deleteMany({});
    const tickets = await prisma.ticket.deleteMany({});

    // Enquiries
    const ingestionLinks = await prisma.ingestionLink.deleteMany({});
    const workItems = await prisma.inquiryWorkItem.deleteMany({});
    const enquiries = await prisma.enquiry.deleteMany({});

    // Suppliers (and their bills)
    const supplierBillLines = await prisma.supplierBillLine.deleteMany({});
    const supplierBills = await prisma.supplierBill.deleteMany({});
    const suppliers = await prisma.supplier.deleteMany({});

    // Parent jobs (if any)
    const parentJobs = await prisma.parentJob.deleteMany({});

    return Response.json({
      cleared: true,
      counts: {
        enquiries: enquiries.count,
        workItems: workItems.count,
        tickets: tickets.count,
        ticketLines: ticketLines.count,
        ticketPhases: ticketPhases.count,
        salesInvoices: salesInvoices.count,
        salesInvoiceLines: salesInvoiceLines.count,
        quotes: quotes.count,
        quoteLines: quoteLines.count,
        suppliers: suppliers.count,
        supplierBills: supplierBills.count,
        supplierBillLines: supplierBillLines.count,
        procurementOrders: procurementOrders.count,
        procurementOrderLines: procurementOrderLines.count,
        costAllocations: costAllocations.count,
        customerPOs: customerPOs.count,
        recoveryCases: recoveryCases.count,
        parentJobs: parentJobs.count,
        ingestionLinks: ingestionLinks.count,
      },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("Clear failed:", msg);
    return Response.json({ error: "Clear failed", detail: msg }, { status: 500 });
  }
}
