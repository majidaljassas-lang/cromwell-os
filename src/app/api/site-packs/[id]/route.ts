import { prisma } from "@/lib/prisma";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const sitePack = await prisma.sitePack.findUnique({
      where: { id },
      include: {
        site: true,
        items: {
          include: {
            ticket: true,
            salesInvoice: true,
            evidencePack: true,
          },
        },
      },
    });

    if (!sitePack) {
      return Response.json({ error: "Site pack not found" }, { status: 404 });
    }

    return Response.json(sitePack);
  } catch (error) {
    console.error("Failed to get site pack:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to get site pack" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await request.json();
    const { status, summaryNotes } = body;

    const data: Record<string, unknown> = {};
    if (status !== undefined) data.status = status;
    if (summaryNotes !== undefined) data.summaryNotes = summaryNotes;

    const sitePack = await prisma.sitePack.update({
      where: { id },
      data,
      include: {
        site: true,
        items: {
          include: {
            ticket: true,
            salesInvoice: true,
            evidencePack: true,
          },
        },
      },
    });

    return Response.json(sitePack);
  } catch (error) {
    console.error("Failed to update site pack:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to update site pack" },
      { status: 500 }
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await request.json();
    const {
      ticketId,
      salesInvoiceId,
      evidencePackId,
      status = "INCLUDED",
    } = body;

    // Validate: ticket must be LOCKED or VERIFIED
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
    });

    if (!ticket) {
      return Response.json({ error: "Ticket not found" }, { status: 404 });
    }

    if (ticket.status !== "LOCKED" && ticket.status !== "VERIFIED") {
      return Response.json(
        { error: "Ticket must be LOCKED or VERIFIED to be included in a site pack" },
        { status: 400 }
      );
    }

    const item = await prisma.sitePackItem.create({
      data: {
        sitePackId: id,
        ticketId,
        salesInvoiceId,
        evidencePackId,
        status,
      },
      include: {
        ticket: true,
        salesInvoice: true,
        evidencePack: true,
      },
    });

    return Response.json(item, { status: 201 });
  } catch (error) {
    console.error("Failed to add item to site pack:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to add item to site pack" },
      { status: 500 }
    );
  }
}
