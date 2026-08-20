/**
 * GET /api/tickets/picker?customerId=X&siteId=Y&openOnly=1
 *
 * Used by the inbox drawer's TicketLinkerForm: returns open tickets at the
 * given customer + (optional) site so the user can pick one to link the
 * thread to.
 *
 * "Open" excludes CLOSED / INVOICED / LOCKED.
 */
import { prisma } from "@/lib/prisma";
import type { TicketStatus } from "@/generated/prisma";

const CLOSED_STATUSES: TicketStatus[] = ["CLOSED", "INVOICED", "LOCKED"];

export async function GET(request: Request) {
  const url = new URL(request.url);
  const customerId = url.searchParams.get("customerId")?.trim();
  const siteId = url.searchParams.get("siteId")?.trim() || null;
  const openOnly = url.searchParams.get("openOnly") === "1";

  if (!customerId) {
    return Response.json({ tickets: [] });
  }

  const where: Record<string, unknown> = { payingCustomerId: customerId };
  if (siteId) where.siteId = siteId;
  if (openOnly) where.status = { notIn: CLOSED_STATUSES };

  const tickets = await prisma.ticket.findMany({
    where,
    orderBy: [{ lastActivityAt: "desc" }, { createdAt: "desc" }],
    take: 50,
    select: {
      id: true,
      ticketNo: true,
      title: true,
      status: true,
      site: { select: { id: true, siteName: true } },
    },
  });

  return Response.json({
    tickets: tickets.map((t) => ({
      id: t.id,
      ticketNo: t.ticketNo,
      title: t.title,
      status: t.status,
      siteName: t.site?.siteName ?? null,
    })),
  });
}
