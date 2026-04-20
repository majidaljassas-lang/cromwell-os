import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const ticketId = url.searchParams.get("ticketId");
  if (!ticketId) return Response.json({ error: "ticketId required" }, { status: 400 });

  const lines = await prisma.ticketLine.findMany({
    where: { ticketId },
    select: { id: true, description: true, sectionLabel: true, isBomParent: true, qty: true, expectedCostUnit: true },
    orderBy: { createdAt: "asc" },
  });

  return Response.json(lines);
}
