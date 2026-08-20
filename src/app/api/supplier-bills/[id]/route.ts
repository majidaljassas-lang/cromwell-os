import { prisma } from "@/lib/prisma";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const bill = await prisma.supplierBill.findUnique({
      where: { id },
      include: {
        supplier: true,
        intakeDocument: { select: { id: true, rawText: true, fileRef: true, sourceRef: true } },
        lines: {
          include: {
            site: true,
            customer: true,
            ticket: true,
            costAllocations: true,
            glAccount: { select: { id: true, accountCode: true, accountName: true } },
            billLineMatches: {
              where: { action: "SUGGESTED" },
              orderBy: { overallConfidence: "desc" },
              take: 3,
            },
            billLineAllocations: {
              include: {
                site: { select: { id: true, siteName: true } },
                customer: { select: { id: true, name: true } },
                ticketLine: {
                  select: {
                    actualSaleUnit: true,
                    actualSaleTotal: true,
                    site: { select: { id: true, siteName: true } },
                    payingCustomer: { select: { id: true, name: true } },
                    ticket: {
                      select: {
                        site: { select: { id: true, siteName: true } },
                        payingCustomer: { select: { id: true, name: true } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (bill) {
      // Resolve BillLineMatch candidate entities (polymorphic candidateId).
      // BillMatchCandidateType today only has TICKET_LINE / PO_LINE / INVOICE_LINE / STOCK / RETURNS,
      // so customer/site suggestions are derived from the resolved TicketLine.
      const ticketLineIds = new Set<string>();
      for (const line of bill.lines) {
        for (const m of (line as unknown as { billLineMatches?: Array<{ candidateType: string; candidateId: string }> }).billLineMatches ?? []) {
          if (m.candidateType === "TICKET_LINE") ticketLineIds.add(m.candidateId);
        }
      }
      const ticketLineRows = ticketLineIds.size > 0
        ? await prisma.ticketLine.findMany({
            where: { id: { in: Array.from(ticketLineIds) } },
            select: {
              id: true,
              ticketId: true,
              ticket: {
                select: {
                  id: true,
                  ticketNo: true,
                  title: true,
                  payingCustomerId: true,
                  siteId: true,
                  payingCustomer: { select: { id: true, name: true } },
                  site: { select: { id: true, siteName: true } },
                },
              },
            },
          })
        : [];
      const ticketLineMap = new Map(ticketLineRows.map((r) => [r.id, r]));
      for (const line of bill.lines) {
        const matches = (line as unknown as { billLineMatches?: Array<Record<string, unknown> & { candidateType: string; candidateId: string }> }).billLineMatches ?? [];
        for (const m of matches) {
          if (m.candidateType === "TICKET_LINE") {
            const tl = ticketLineMap.get(m.candidateId);
            if (tl) {
              const ticket = tl.ticket;
              m.candidate = {
                ticketLineId: tl.id,
                ticketId: ticket?.id ?? tl.ticketId ?? null,
                ticketNo: ticket?.ticketNo ?? null,
                ticketTitle: ticket?.title ?? null,
                customer: ticket?.payingCustomer ?? null,
                site: ticket?.site ?? null,
              };
            } else {
              m.candidate = null;
            }
          } else {
            m.candidate = null;
          }
        }
      }

      for (const line of bill.lines) {
        for (const a of line.billLineAllocations as Array<Record<string, unknown> & {
          qtyAllocated: unknown;
          costAllocated: unknown;
          site: { id: string; siteName: string } | null;
          customer: { id: string; name: string } | null;
          ticketLine: {
            actualSaleUnit: unknown;
            actualSaleTotal: unknown;
            site: { id: string; siteName: string } | null;
            payingCustomer: { id: string; name: string } | null;
            ticket: {
              site: { id: string; siteName: string } | null;
              payingCustomer: { id: string; name: string } | null;
            } | null;
          } | null;
        }>) {
          const tl = a.ticketLine;
          a.resolvedSite =
            a.site ?? tl?.site ?? tl?.ticket?.site ?? null;
          a.resolvedCustomer =
            a.customer ?? tl?.payingCustomer ?? tl?.ticket?.payingCustomer ?? null;

          const saleUnit = tl?.actualSaleUnit != null ? Number(tl.actualSaleUnit) : null;
          const qty = Number(a.qtyAllocated);
          const cost = Number(a.costAllocated);
          const sale = saleUnit != null && Number.isFinite(qty) ? saleUnit * qty : null;
          a.saleAllocated = sale;
          a.marginAllocated = sale != null && Number.isFinite(cost) ? sale - cost : null;
        }
      }
    }

    if (!bill) {
      return Response.json(
        { error: "Supplier bill not found" },
        { status: 404 }
      );
    }

    return Response.json(bill);
  } catch (error) {
    console.error("Failed to fetch supplier bill:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to fetch supplier bill" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const existing = await prisma.supplierBill.findUnique({
      where: { id },
    });

    if (!existing) {
      return Response.json(
        { error: "Supplier bill not found" },
        { status: 404 }
      );
    }

    const { status, siteRef, customerRef, totalCost, sourceAttachmentRef } = body;

    const updated = await prisma.supplierBill.update({
      where: { id },
      data: {
        ...(status !== undefined && { status }),
        ...(siteRef !== undefined && { siteRef }),
        ...(customerRef !== undefined && { customerRef }),
        ...(totalCost !== undefined && { totalCost }),
        ...(sourceAttachmentRef !== undefined && { sourceAttachmentRef }),
      },
      include: {
        supplier: true,
        lines: {
          include: {
            site: true,
            customer: true,
            ticket: true,
            costAllocations: true,
          },
        },
      },
    });

    return Response.json(updated);
  } catch (error) {
    console.error("Failed to update supplier bill:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to update supplier bill" },
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
    // Get line IDs for cleanup
    const lineIds = (await prisma.supplierBillLine.findMany({
      where: { supplierBillId: id },
      select: { id: true },
    })).map(l => l.id);

    if (lineIds.length > 0) {
      // Clean up cost allocations and absorbed costs linked to these bill lines
      await prisma.costAllocation.deleteMany({ where: { supplierBillLineId: { in: lineIds } } });
      await prisma.absorbedCostAllocation.deleteMany({ where: { supplierBillLineId: { in: lineIds } } });
      await prisma.creditNoteAllocation.deleteMany({ where: { supplierBillLineId: { in: lineIds } } }).catch(() => {});
    }

    // Delete lines then bill
    await prisma.supplierBillLine.deleteMany({ where: { supplierBillId: id } });
    await prisma.supplierBill.delete({ where: { id } });

    return Response.json({ deleted: true, id });
  } catch (error) {
    console.error("Failed to delete supplier bill:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Failed to delete" }, { status: 500 });
  }
}
