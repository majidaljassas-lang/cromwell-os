import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    // 1. openInquiriesNoSite: inquiry work items where siteId is null and status not CONVERTED/CLOSED
    const openInquiriesNoSite = await prisma.inquiryWorkItem.count({
      where: {
        siteId: null,
        status: { notIn: ["CONVERTED", "CLOSED_LOST", "CLOSED_NO_ACTION"] },
      },
    });

    // 2. openInquiriesNoCustomer: where customerId is null
    const openInquiriesNoCustomer = await prisma.inquiryWorkItem.count({
      where: {
        customerId: null,
        status: { notIn: ["CONVERTED", "CLOSED_LOST", "CLOSED_NO_ACTION"] },
      },
    });

    // 3. ticketsAwaitingCost: tickets in DELIVERED or COSTED with unallocated bill lines
    const ticketsWithUnallocated = await prisma.ticket.findMany({
      where: {
        status: { in: ["DELIVERED", "COSTED"] },
        supplierBillLines: {
          some: { allocationStatus: "UNALLOCATED" },
        },
      },
      select: { id: true },
    });
    const ticketsAwaitingCost = ticketsWithUnallocated.length;

    // 4. ticketsAwaitingPO: where poRequired = true and poStatus != RECEIVED
    const ticketsAwaitingPO = await prisma.ticket.count({
      where: {
        poRequired: true,
        NOT: { poStatus: "RECEIVED" },
      },
    });

    // 5. ticketsMissingEvidence: tickets in active statuses with zero evidence fragments
    const activeStatuses = [
      "CAPTURED",
      "PRICING",
      "QUOTED",
      "APPROVED",
      "ORDERED",
      "DELIVERED",
      "COSTED",
      "PENDING_PO",
      "RECOVERY",
      "VERIFIED",
    ] as ("CAPTURED" | "PRICING" | "QUOTED" | "APPROVED" | "ORDERED" | "DELIVERED" | "COSTED" | "PENDING_PO" | "RECOVERY" | "VERIFIED")[];
    const ticketsWithNoEvidence = await prisma.ticket.count({
      where: {
        status: { in: activeStatuses },
        evidenceFragments: { none: {} },
      },
    });
    const ticketsMissingEvidence = ticketsWithNoEvidence;

    // 6. unmatchedSupplierBills: count of supplier bill lines where allocationStatus = UNALLOCATED
    const unmatchedSupplierBills = await prisma.supplierBillLine.count({
      where: { allocationStatus: "UNALLOCATED" },
    });

    // 7. returnsNotCredited: count of return lines where status = PENDING
    const returnsNotCredited = await prisma.returnLine.count({
      where: { status: "PENDING" },
    });

    // 8. absorbedCostUnresolved: supplier bill lines where costClassification = ABSORBED and allocationStatus = UNALLOCATED
    const absorbedCostUnresolved = await prisma.supplierBillLine.count({
      where: {
        costClassification: "ABSORBED",
        allocationStatus: "UNALLOCATED",
      },
    });

    return Response.json({
      openInquiriesNoSite,
      openInquiriesNoCustomer,
      ticketsAwaitingCost,
      ticketsAwaitingPO,
      ticketsMissingEvidence,
      unmatchedSupplierBills,
      returnsNotCredited,
      absorbedCostUnresolved,
    });
  } catch (error) {
    console.error("Failed to compute operations dashboard:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to compute operations dashboard" },
      { status: 500 }
    );
  }
}
