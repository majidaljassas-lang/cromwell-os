import { prisma } from "@/lib/prisma";
import fs from "fs";
import path from "path";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const quote = await prisma.quote.findUnique({
      where: { id },
      include: {
        lines: {
          include: { ticketLine: true },
        },
        customer: true,
      },
    });

    if (!quote) {
      return Response.json({ error: "Quote not found" }, { status: 404 });
    }

    return Response.json(quote);
  } catch (error) {
    console.error("Failed to fetch quote:", error);
    return Response.json({ error: "Failed to fetch quote" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const quote = await prisma.quote.update({
      where: { id },
      data: body,
    });

    if (body.status === "SENT") {
      const fullQuote = await prisma.quote.findUnique({ where: { id }, select: { ticketId: true, quoteNo: true } });
      if (fullQuote) {
        await prisma.event.create({
          data: {
            ticketId: fullQuote.ticketId,
            eventType: "QUOTE_SENT",
            timestamp: new Date(),
            notes: `Quote ${fullQuote.quoteNo} sent to customer`,
          },
        });
      }
    } else if (body.status === "APPROVED") {
      const fullQuote = await prisma.quote.findUnique({
        where: { id },
        select: { ticketId: true, quoteNo: true },
      });
      if (fullQuote) {
        // Log event
        await prisma.event.create({
          data: {
            ticketId: fullQuote.ticketId,
            eventType: "QUOTE_APPROVED",
            timestamp: new Date(),
            notes: `Quote ${fullQuote.quoteNo} approved — procurement required`,
          },
        });

        // Update ticket status to APPROVED
        await prisma.ticket.update({
          where: { id: fullQuote.ticketId },
          data: { status: "APPROVED" },
        });
      }
    }

    return Response.json(quote);
  } catch (error) {
    console.error("Failed to update quote:", error);
    return Response.json({ error: "Failed to update quote" }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const quote = await prisma.quote.findUnique({
      where: { id },
      select: { pdfPath: true },
    });

    if (!quote) {
      return Response.json({ error: "Quote not found" }, { status: 404 });
    }

    // Delete quote lines first, then the quote
    await prisma.quoteLine.deleteMany({ where: { quoteId: id } });
    await prisma.quote.delete({ where: { id } });

    // Clean up PDF file if it exists
    if (quote.pdfPath) {
      const filePath = path.join(process.cwd(), "public", quote.pdfPath);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }

    return Response.json({ ok: true });
  } catch (error) {
    console.error("Failed to delete quote:", error);
    return Response.json({ error: "Failed to delete quote" }, { status: 500 });
  }
}
