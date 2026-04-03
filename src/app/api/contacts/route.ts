import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const contacts = await prisma.contact.findMany({
      orderBy: { createdAt: "desc" },
    });
    return Response.json(contacts);
  } catch (error) {
    console.error("Failed to list contacts:", error);
    return Response.json(
      { error: "Failed to list contacts" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const contact = await prisma.contact.create({ data: body });
    return Response.json(contact, { status: 201 });
  } catch (error) {
    console.error("Failed to create contact:", error);
    return Response.json(
      { error: "Failed to create contact" },
      { status: 500 }
    );
  }
}
