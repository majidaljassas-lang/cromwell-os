import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/ingestion/audit";

/**
 * Controlled Unlink
 *
 * Allowed only after dependency checks.
 * Hard delete is PROHIBITED for records with downstream dependencies.
 * Returns dependency report before acting.
 */

export async function GET(
  request: Request,
  { params }: { params: Promise<{ objectType: string; id: string }> }
) {
  // GET returns dependency report without acting
  try {
    const { objectType, id } = await params;
    const report = await getDependencyReport(objectType, id);
    return Response.json(report);
  } catch (error) {
    console.error("Dependency check failed:", error);
    return Response.json({ error: "Check failed" }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ objectType: string; id: string }> }
) {
  try {
    const { objectType, id } = await params;
    const body = await request.json();
    const { confirm, actor, reason } = body as {
      confirm: boolean;
      actor?: string;
      reason?: string;
    };

    const report = await getDependencyReport(objectType, id);

    if (report.hasDownstreamDependencies && !confirm) {
      return Response.json({
        error: "Object has downstream dependencies — pass confirm: true to proceed",
        ...report,
      }, { status: 409 });
    }

    // Remove ingestion links for this object
    if (objectType === "enquiry") {
      await prisma.ingestionLink.deleteMany({ where: { enquiryId: id } });
    } else if (objectType === "ticket") {
      await prisma.ingestionLink.deleteMany({ where: { ticketId: id } });
    } else if (objectType === "evidence-fragment") {
      await prisma.ingestionLink.deleteMany({ where: { evidenceFragmentId: id } });
    } else if (objectType === "supplier-bill") {
      await prisma.ingestionLink.deleteMany({ where: { supplierBillId: id } });
    } else if (objectType === "supplier-bill-line") {
      await prisma.ingestionLink.deleteMany({ where: { supplierBillLineId: id } });
    } else {
      return Response.json({ error: `Unknown objectType: ${objectType}` }, { status: 400 });
    }

    await logAudit({
      objectType: objectType,
      objectId: id,
      actionType: "UNLINKED_FROM_INGESTION",
      actor,
      previousValue: report,
      reason,
    });

    return Response.json({ unlinked: true, objectType, objectId: id });
  } catch (error) {
    console.error("Unlink failed:", error);
    return Response.json({ error: "Unlink failed" }, { status: 500 });
  }
}

async function getDependencyReport(objectType: string, id: string) {
  const dependencies: Array<{ type: string; count: number }> = [];

  if (objectType === "enquiry") {
    const workItems = await prisma.inquiryWorkItem.count({ where: { enquiryId: id } });
    if (workItems > 0) dependencies.push({ type: "InquiryWorkItem", count: workItems });
    const links = await prisma.ingestionLink.count({ where: { enquiryId: id } });
    if (links > 0) dependencies.push({ type: "IngestionLink", count: links });
  } else if (objectType === "ticket") {
    const lines = await prisma.ticketLine.count({ where: { ticketId: id } });
    if (lines > 0) dependencies.push({ type: "TicketLine", count: lines });
    const invoices = await prisma.salesInvoice.count({ where: { ticketId: id } });
    if (invoices > 0) dependencies.push({ type: "SalesInvoice", count: invoices });
    const recovery = await prisma.recoveryCase.count({ where: { ticketId: id } });
    if (recovery > 0) dependencies.push({ type: "RecoveryCase", count: recovery });
  } else if (objectType === "supplier-bill") {
    const lines = await prisma.supplierBillLine.count({ where: { supplierBillId: id } });
    if (lines > 0) dependencies.push({ type: "SupplierBillLine", count: lines });
  } else if (objectType === "supplier-bill-line") {
    const allocations = await prisma.costAllocation.count({ where: { supplierBillLineId: id } });
    if (allocations > 0) dependencies.push({ type: "CostAllocation", count: allocations });
    const absorbed = await prisma.absorbedCostAllocation.count({ where: { supplierBillLineId: id } });
    if (absorbed > 0) dependencies.push({ type: "AbsorbedCostAllocation", count: absorbed });
  }

  return {
    objectType,
    objectId: id,
    dependencies,
    hasDownstreamDependencies: dependencies.some((d) => d.count > 0),
  };
}
