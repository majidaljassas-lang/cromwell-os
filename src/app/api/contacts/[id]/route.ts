import { prisma } from "@/lib/prisma";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const contact = await prisma.contact.findUnique({
      where: { id },
    });
    if (!contact) {
      return Response.json({ error: "Contact not found" }, { status: 404 });
    }
    return Response.json(contact);
  } catch (error) {
    console.error("Failed to get contact:", error);
    return Response.json(
      { error: "Failed to get contact" },
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
    const contact = await prisma.contact.update({
      where: { id },
      data: body,
    });
    return Response.json(contact);
  } catch (error) {
    console.error("Failed to update contact:", error);
    return Response.json(
      { error: "Failed to update contact" },
      { status: 500 }
    );
  }
}
