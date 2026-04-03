import { prisma } from "@/lib/prisma";
import { EvidenceType } from "@/generated/prisma";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const fragment = await prisma.evidenceFragment.findUnique({
      where: { id },
      include: {
        ticket: true,
        ticketLine: true,
        sourceContact: true,
      },
    });

    if (!fragment) {
      return Response.json(
        { error: "Evidence fragment not found" },
        { status: 404 }
      );
    }

    return Response.json(fragment);
  } catch (error) {
    console.error("Failed to get evidence fragment:", error);
    return Response.json(
      { error: "Failed to get evidence fragment" },
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
    const { fragmentText, attachmentUrl, isPrimaryEvidence, fragmentType } =
      body;

    const data: Record<string, unknown> = {};
    if (fragmentText !== undefined) data.fragmentText = fragmentText;
    if (attachmentUrl !== undefined) data.attachmentUrl = attachmentUrl;
    if (isPrimaryEvidence !== undefined)
      data.isPrimaryEvidence = isPrimaryEvidence;
    if (fragmentType !== undefined)
      data.fragmentType = fragmentType as EvidenceType;

    const fragment = await prisma.evidenceFragment.update({
      where: { id },
      data,
      include: {
        ticket: true,
        ticketLine: true,
        sourceContact: true,
      },
    });

    return Response.json(fragment);
  } catch (error) {
    console.error("Failed to update evidence fragment:", error);
    return Response.json(
      { error: "Failed to update evidence fragment" },
      { status: 500 }
    );
  }
}
