/**
 * Reassign all data from an auto-intake Customer to a real Customer, then
 * delete the source. Built for cleaning up the residue of the old
 * "(auto-intake)" auto-creation behaviour in resolveCustomer().
 *
 * Guard rails:
 *   - source must have "(auto-intake)" in its name
 *   - target must NOT have "(auto-intake)" in its name
 *   - source and target must differ
 *   - SiteCommercialLink uniqueness on (siteId, customerId, role) is honoured:
 *     if the target already owns a link for the same (site, role), drop the
 *     source link; otherwise repoint customerId
 *
 * Skipped (deprecated per AGENTS.md / memory):
 *   - BacklogCase (protected)
 *   - Enquiry / InquiryWorkItem (writes return 410)
 */
import { prisma } from "@/lib/prisma";

type ReassignBody = {
  sourceId?: unknown;
  targetId?: unknown;
};

export async function POST(request: Request) {
  let body: ReassignBody;
  try {
    body = (await request.json()) as ReassignBody;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const sourceId = typeof body.sourceId === "string" ? body.sourceId : null;
  const targetId = typeof body.targetId === "string" ? body.targetId : null;
  if (!sourceId || !targetId) {
    return Response.json({ error: "sourceId and targetId are required" }, { status: 400 });
  }
  if (sourceId === targetId) {
    return Response.json({ error: "source and target must differ" }, { status: 400 });
  }

  const [source, target] = await Promise.all([
    prisma.customer.findUnique({ where: { id: sourceId }, select: { id: true, name: true } }),
    prisma.customer.findUnique({ where: { id: targetId }, select: { id: true, name: true } }),
  ]);
  if (!source) return Response.json({ error: "source customer not found" }, { status: 404 });
  if (!target) return Response.json({ error: "target customer not found" }, { status: 404 });
  const isAutoStub = (n: string) =>
    n.includes("(auto-intake)") || n.includes("(auto-created from");
  if (!isAutoStub(source.name)) {
    return Response.json(
      { error: "source is not an auto-intake / auto-created customer; refusing to merge" },
      { status: 400 }
    );
  }
  if (isAutoStub(target.name)) {
    return Response.json(
      { error: "target is itself an auto-created customer" },
      { status: 400 }
    );
  }

  const moved = await prisma.$transaction(async (tx) => {
    const ticket = await tx.ticket.updateMany({
      where: { payingCustomerId: sourceId },
      data: { payingCustomerId: targetId },
    });
    const ticketLine = await tx.ticketLine.updateMany({
      where: { payingCustomerId: sourceId },
      data: { payingCustomerId: targetId },
    });
    const invoice = await tx.salesInvoice.updateMany({
      where: { customerId: sourceId },
      data: { customerId: targetId },
    });
    const creditNote = await tx.salesCreditNote.updateMany({
      where: { customerId: sourceId },
      data: { customerId: targetId },
    });
    const alias = await tx.customerAlias.updateMany({
      where: { customerId: sourceId },
      data: { customerId: targetId },
    });
    const customerPO = await tx.customerPO.updateMany({
      where: { customerId: sourceId },
      data: { customerId: targetId },
    });
    const pricingHistory = await tx.pricingHistory.updateMany({
      where: { customerId: sourceId },
      data: { customerId: targetId },
    });
    const quote = await tx.quote.updateMany({
      where: { customerId: sourceId },
      data: { customerId: targetId },
    });
    const supplierBillLine = await tx.supplierBillLine.updateMany({
      where: { customerId: sourceId },
      data: { customerId: targetId },
    });
    const billLineAlloc = await tx.billLineAllocation.updateMany({
      where: { customerId: sourceId },
      data: { customerId: targetId },
    });
    const journalLine = await tx.journalLine.updateMany({
      where: { customerId: sourceId },
      data: { customerId: targetId },
    });
    const siteContactLink = await tx.siteContactLink.updateMany({
      where: { customerId: sourceId },
      data: { customerId: targetId },
    });

    // SiteCommercialLink: unique on (siteId, customerId, role). Skip rows
    // where target already owns the equivalent link.
    const sourceLinks = await tx.siteCommercialLink.findMany({
      where: { customerId: sourceId },
      select: { id: true, siteId: true, role: true },
    });
    let scLinkMoved = 0;
    let scLinkDroppedDup = 0;
    for (const link of sourceLinks) {
      const dup = await tx.siteCommercialLink.findFirst({
        where: { customerId: targetId, siteId: link.siteId, role: link.role },
        select: { id: true },
      });
      if (dup) {
        await tx.siteCommercialLink.delete({ where: { id: link.id } });
        scLinkDroppedDup++;
      } else {
        await tx.siteCommercialLink.update({
          where: { id: link.id },
          data: { customerId: targetId },
        });
        scLinkMoved++;
      }
    }

    // Customer hierarchy: if anyone listed source as parent, repoint to target.
    const subsidiaries = await tx.customer.updateMany({
      where: { parentCustomerEntityId: sourceId },
      data: { parentCustomerEntityId: targetId },
    });

    await tx.customer.delete({ where: { id: sourceId } });

    return {
      ticket: ticket.count,
      ticketLine: ticketLine.count,
      invoice: invoice.count,
      creditNote: creditNote.count,
      alias: alias.count,
      customerPO: customerPO.count,
      pricingHistory: pricingHistory.count,
      quote: quote.count,
      supplierBillLine: supplierBillLine.count,
      billLineAlloc: billLineAlloc.count,
      journalLine: journalLine.count,
      siteContactLink: siteContactLink.count,
      siteCommercialLinkMoved: scLinkMoved,
      siteCommercialLinkDroppedDup: scLinkDroppedDup,
      subsidiaries: subsidiaries.count,
    };
  });

  return Response.json({
    ok: true,
    source: { id: source.id, name: source.name },
    target: { id: target.id, name: target.name },
    moved,
  });
}
