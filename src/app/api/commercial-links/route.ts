/**
 * GET   /api/commercial-links  — list all active customer↔site links
 * POST  /api/commercial-links  — create a new link { customerId, siteId }
 */

import { prisma } from "@/lib/prisma";

export async function GET() {
  const links = await prisma.siteCommercialLink.findMany({
    where: { isActive: true },
    select: { id: true, customerId: true, siteId: true },
  });
  return Response.json(links);
}

export async function POST(request: Request) {
  const body = await request.json();
  const { customerId, siteId } = body;

  if (!customerId || !siteId) {
    return Response.json({ error: "customerId and siteId required" }, { status: 400 });
  }

  // Don't duplicate
  const existing = await prisma.siteCommercialLink.findFirst({
    where: { customerId, siteId, isActive: true },
  });
  if (existing) return Response.json(existing);

  const link = await prisma.siteCommercialLink.create({
    data: { customerId, siteId, role: body.role ?? "MAIN_CONTRACTOR", billingAllowed: true, isActive: true },
  });

  return Response.json(link);
}
