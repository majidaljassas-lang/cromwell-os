import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const sitePacks = await prisma.sitePack.findMany({
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
      orderBy: { packDate: "desc" },
    });

    return Response.json(sitePacks);
  } catch (error) {
    console.error("Failed to list site packs:", error);
    return Response.json(
      { error: "Failed to list site packs" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      siteId,
      packDate,
      status = "DRAFT",
      summaryNotes,
    } = body;

    const sitePack = await prisma.sitePack.create({
      data: {
        siteId,
        packDate: packDate ? new Date(packDate) : new Date(),
        status,
        summaryNotes,
      },
      include: {
        site: true,
        items: true,
      },
    });

    return Response.json(sitePack, { status: 201 });
  } catch (error) {
    console.error("Failed to create site pack:", error);
    return Response.json(
      { error: "Failed to create site pack" },
      { status: 500 }
    );
  }
}
