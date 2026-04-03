import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const creditNotes = await prisma.creditNote.findMany({
      include: {
        supplier: true,
        allocations: {
          include: {
            returnLine: true,
            ticketLine: true,
          },
        },
      },
      orderBy: { dateReceived: "desc" },
    });

    return Response.json(creditNotes);
  } catch (error) {
    console.error("Failed to list credit notes:", error);
    return Response.json(
      { error: "Failed to list credit notes" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      supplierId,
      creditNoteNo,
      dateReceived,
      totalCredit,
      status = "PENDING",
      sourceAttachmentRef,
    } = body;

    if (!supplierId || !creditNoteNo || !dateReceived || totalCredit === undefined) {
      return Response.json(
        {
          error:
            "Missing required fields: supplierId, creditNoteNo, dateReceived, totalCredit",
        },
        { status: 400 }
      );
    }

    const creditNote = await prisma.creditNote.create({
      data: {
        supplierId,
        creditNoteNo,
        dateReceived: new Date(dateReceived),
        totalCredit,
        status,
        sourceAttachmentRef,
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

    return Response.json(creditNote, { status: 201 });
  } catch (error) {
    console.error("Failed to create credit note:", error);
    return Response.json(
      { error: "Failed to create credit note" },
      { status: 500 }
    );
  }
}
