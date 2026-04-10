import { prisma } from "@/lib/prisma";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const creditNote = await prisma.creditNote.findUnique({
      where: { id },
      include: {
        supplier: true,
        allocations: {
          include: {
            returnLine: true,
            ticketLine: true,
          },
        },
      },
    });

    if (!creditNote) {
      return Response.json(
        { error: "Credit note not found" },
        { status: 404 }
      );
    }

    return Response.json(creditNote);
  } catch (error) {
    console.error("Failed to fetch credit note:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to fetch credit note" },
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

    const existing = await prisma.creditNote.findUnique({
      where: { id },
    });

    if (!existing) {
      return Response.json(
        { error: "Credit note not found" },
        { status: 404 }
      );
    }

    const { status, totalCredit, sourceAttachmentRef } = body;

    const updated = await prisma.creditNote.update({
      where: { id },
      data: {
        ...(status !== undefined && { status }),
        ...(totalCredit !== undefined && { totalCredit }),
        ...(sourceAttachmentRef !== undefined && { sourceAttachmentRef }),
      },
      include: {
        supplier: true,
        allocations: {
          include: {
            returnLine: true,
            ticketLine: true,
          },
        },
      },
    });

    return Response.json(updated);
  } catch (error) {
    console.error("Failed to update credit note:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to update credit note" },
      { status: 500 }
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { returnLineId, ticketLineId, allocatedCredit } = body;

    if (!returnLineId || !ticketLineId || allocatedCredit === undefined) {
      return Response.json(
        {
          error:
            "Missing required fields: returnLineId, ticketLineId, allocatedCredit",
        },
        { status: 400 }
      );
    }

    const existing = await prisma.creditNote.findUnique({
      where: { id },
    });

    if (!existing) {
      return Response.json(
        { error: "Credit note not found" },
        { status: 404 }
      );
    }

    const allocation = await prisma.creditNoteAllocation.create({
      data: {
        creditNoteId: id,
        returnLineId,
        ticketLineId,
        allocatedCredit,
      },
      include: {
        creditNote: true,
        returnLine: true,
        ticketLine: true,
      },
    });

    return Response.json(allocation, { status: 201 });
  } catch (error) {
    console.error("Failed to add credit note allocation:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to add credit note allocation" },
      { status: 500 }
    );
  }
}
