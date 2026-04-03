import { prisma } from "@/lib/prisma";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: siteId } = await params;
  try {
    const body = await request.json();

    const link = await prisma.siteContactLink.create({
      data: {
        siteId,
        ...body,
      },
    });
    return Response.json(link, { status: 201 });
  } catch (error) {
    console.error("Failed to create contact link:", error);
    return Response.json(
      { error: "Failed to create contact link" },
      { status: 500 }
    );
  }
}
