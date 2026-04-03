import { prisma } from "@/lib/prisma";
import { EvidenceType, SourceType } from "@/generated/prisma";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const fragments = await prisma.evidenceFragment.findMany({
      where: { ticketId: id },
      include: {
        ticketLine: true,
        sourceContact: true,
      },
      orderBy: { timestamp: "desc" },
    });

    return Response.json(fragments);
  } catch (error) {
    console.error("Failed to list evidence fragments:", error);
    return Response.json(
      { error: "Failed to list evidence fragments" },
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
      ticketLineId,
      sourceType,
      sourceRef,
      sourceContactId,
      timestamp,
      fragmentType,
      fragmentText,
      attachmentUrl,
      confidenceScore,
      isPrimaryEvidence,
    } = body;

    if (!sourceType || !fragmentType) {
      return Response.json(
        { error: "Missing required fields: sourceType, fragmentType" },
        { status: 400 }
      );
    }

    const fragment = await prisma.evidenceFragment.create({
      data: {
        ticketId: id,
        ticketLineId,
        sourceType: sourceType as SourceType,
        sourceRef,
        sourceContactId,
        timestamp: timestamp ? new Date(timestamp) : new Date(),
        fragmentType: fragmentType as EvidenceType,
        fragmentText,
        attachmentUrl,
        confidenceScore,
        isPrimaryEvidence: isPrimaryEvidence ?? false,
      },
      include: {
        ticketLine: true,
        sourceContact: true,
      },
    });

    return Response.json(fragment, { status: 201 });
  } catch (error) {
    console.error("Failed to create evidence fragment:", error);
    return Response.json(
      { error: "Failed to create evidence fragment" },
      { status: 500 }
    );
  }
}
