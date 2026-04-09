import { prisma } from "@/lib/prisma";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const po = await prisma.customerPO.findUnique({
      where: { id },
      include: {
        customer: true,
        site: true,
        ticket: true,
        lines: {
          include: { ticketLine: true },
        },
        allocations: {
          include: { ticketLine: true, salesInvoice: true },
        },
        labourDrawdowns: {
          orderBy: { workDate: "desc" },
        },
        materialsDrawdowns: {
          orderBy: { drawdownDate: "desc" },
        },
      },
    });

    if (!po) {
      return Response.json({ error: "Customer PO not found" }, { status: 404 });
    }

    return Response.json(po);
  } catch (error) {
    console.error("Failed to fetch customer PO:", error);
    return Response.json(
      { error: "Failed to fetch customer PO" },
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

    // Cast poType if provided
    if (body.poType) {
      body.poType = body.poType as
        | "STANDARD_FIXED"
        | "DRAWDOWN_LABOUR"
        | "DRAWDOWN_MATERIALS";
    }

    // Convert date strings
    if (body.poDate) {
      body.poDate = new Date(body.poDate);
    }

    // Allow clearing issuedByContactId
    if ("issuedByContactId" in body && !body.issuedByContactId) {
      body.issuedByContactId = null;
    }

    const po = await prisma.customerPO.update({
      where: { id },
      data: body,
      include: {
        customer: true,
        site: true,
        ticket: true,
        lines: true,
        _count: {
          select: {
            labourDrawdowns: true,
            materialsDrawdowns: true,
          },
        },
      },
    });

    return Response.json(po);
  } catch (error) {
    console.error("Failed to update customer PO:", error);
    return Response.json(
      { error: "Failed to update customer PO" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Delete related records first
    await prisma.customerPOAllocation.deleteMany({ where: { customerPOId: id } });
    await prisma.customerPOLine.deleteMany({ where: { customerPOId: id } });
    await prisma.labourDrawdownEntry.deleteMany({ where: { customerPOId: id } });
    await prisma.materialsDrawdownEntry.deleteMany({ where: { customerPOId: id } });
    await prisma.pOCashPayment.deleteMany({ where: { customerPOId: id } });
    await prisma.customerPO.delete({ where: { id } });

    return Response.json({ deleted: true });
  } catch (error) {
    console.error("Failed to delete customer PO:", error);
    return Response.json(
      { error: "Failed to delete customer PO" },
      { status: 500 }
    );
  }
}
