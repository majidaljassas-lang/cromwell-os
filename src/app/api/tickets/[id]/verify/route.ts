import { prisma } from "@/lib/prisma";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const ticket = await prisma.ticket.findUnique({
      where: { id },
      include: {
        lines: {
          include: {
            costAllocations: true,
          },
        },
        evidenceFragments: true,
      },
    });

    if (!ticket) {
      return Response.json({ error: "Ticket not found" }, { status: 404 });
    }

    const warnings: string[] = [];

    // Check 1: All ticket lines must have actualSaleTotal or actualSaleUnit set
    const linesWithoutSale = ticket.lines.filter(
      (line) => line.actualSaleTotal === null && line.actualSaleUnit === null
    );
    if (linesWithoutSale.length > 0) {
      warnings.push(
        `${linesWithoutSale.length} line(s) missing actualSaleTotal or actualSaleUnit: ${linesWithoutSale.map((l) => l.description).join(", ")}`
      );
    }

    // Check 2: All billable cost allocations must be resolved (no UNALLOCATED supplier bill lines for this ticket's lines)
    const unallocatedBillLines = await prisma.supplierBillLine.findMany({
      where: {
        ticketId: id,
        costClassification: "BILLABLE",
        allocationStatus: "UNALLOCATED",
      },
    });
    if (unallocatedBillLines.length > 0) {
      warnings.push(
        `${unallocatedBillLines.length} billable supplier bill line(s) still UNALLOCATED for this ticket`
      );
    }

    // Check 3: At least one evidence fragment must exist
    if (ticket.evidenceFragments.length === 0) {
      warnings.push("No evidence fragments found for this ticket");
    }

    if (warnings.length > 0) {
      return Response.json({ verified: false, warnings });
    }

    // All checks pass - update ticket status to VERIFIED
    await prisma.ticket.update({
      where: { id },
      data: { status: "VERIFIED" },
    });

    return Response.json({ verified: true, warnings: [] });
  } catch (error) {
    console.error("Failed to verify ticket:", error);
    return Response.json(
      { error: "Failed to verify ticket" },
      { status: 500 }
    );
  }
}
