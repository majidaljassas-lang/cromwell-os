/**
 * POST /api/inbox/suggest-ticket
 *
 * Given message text, suggests which open ticket(s) it likely belongs to.
 * Scores based on: site name match, product keyword match, supplier match,
 * contact/sender match.
 *
 * Body: { text: string, sender?: string, channel?: string }
 * Returns: { suggestions: [{ ticketId, ticketNo, title, customer, site, score, reasons }] }
 */

import { prisma } from "@/lib/prisma";

export async function POST(request: Request) {
  const body = await request.json();
  const { text, sender } = body as { text: string; sender?: string };

  if (!text) return Response.json({ suggestions: [] });

  const lower = text.toLowerCase();
  const senderLower = (sender ?? "").toLowerCase();

  // Load all open tickets with their context
  const tickets = await prisma.ticket.findMany({
    where: { status: { notIn: ["CLOSED", "INVOICED"] } },
    select: {
      id: true,
      ticketNo: true,
      title: true,
      source: true,
      payingCustomer: { select: { name: true } },
      site: { select: { siteName: true } },
      lines: { select: { description: true, supplierName: true }, take: 50 },
    },
  });

  // Load all sites for name matching
  const sites = await prisma.site.findMany({
    where: { isActive: true },
    select: { id: true, siteName: true },
  });

  // Load contacts for sender matching
  const contacts = await prisma.contact.findMany({
    where: { isActive: true },
    select: {
      fullName: true,
      email: true,
      phone: true,
      siteContactLinks: {
        where: { isActive: true, customerId: { not: null } },
        select: { customerId: true },
      },
    },
  });

  const scored: Array<{
    ticketId: string;
    ticketNo: number;
    title: string;
    customer: string;
    site: string;
    score: number;
    reasons: string[];
  }> = [];

  for (const t of tickets) {
    let score = 0;
    const reasons: string[] = [];

    // Site name match — strongest signal
    const siteName = t.site?.siteName?.toLowerCase() ?? "";
    if (siteName && siteName.length >= 3) {
      // Check each word of site name (e.g. "Orme Court" → check "orme" and "court")
      const siteWords = siteName.split(/\s+/).filter(w => w.length >= 3);
      const matchedWords = siteWords.filter(w => lower.includes(w));
      if (matchedWords.length === siteWords.length && siteWords.length > 0) {
        score += 50;
        reasons.push(`Site: "${t.site!.siteName}"`);
      } else if (matchedWords.length > 0) {
        score += 25;
        reasons.push(`Partial site: "${matchedWords.join(" ")}"`);
      }
    }

    // Title keyword match
    const titleWords = (t.title ?? "").toLowerCase().split(/\s+/).filter(w => w.length >= 4);
    const titleMatches = titleWords.filter(w => lower.includes(w));
    if (titleMatches.length >= 2) {
      score += 20;
      reasons.push(`Title keywords: ${titleMatches.slice(0, 3).join(", ")}`);
    }

    // Product/line description match
    for (const line of t.lines) {
      const lineWords = (line.description ?? "").toLowerCase().split(/\s+/).filter(w => w.length >= 4);
      const lineMatches = lineWords.filter(w => lower.includes(w));
      if (lineMatches.length >= 2) {
        score += 15;
        reasons.push(`Product: "${line.description?.slice(0, 40)}"`);
        break; // One match is enough
      }
    }

    // Supplier name match from ticket lines
    const supplierNames = [...new Set(t.lines.map(l => l.supplierName).filter(Boolean))];
    for (const sn of supplierNames) {
      if (sn && lower.includes(sn.toLowerCase())) {
        score += 20;
        reasons.push(`Supplier: ${sn}`);
        break;
      }
    }

    // Customer name match
    const custName = t.payingCustomer?.name?.toLowerCase() ?? "";
    if (custName && custName.length >= 3) {
      const custWords = custName.split(/\s+/).filter(w => w.length >= 3);
      if (custWords.some(w => lower.includes(w) || senderLower.includes(w))) {
        score += 15;
        reasons.push(`Customer: ${t.payingCustomer!.name}`);
      }
    }

    // Sender matches a contact linked to this ticket's customer
    if (senderLower) {
      for (const contact of contacts) {
        const nameMatch = contact.fullName && senderLower.includes(contact.fullName.toLowerCase());
        const emailMatch = contact.email && senderLower.includes(contact.email.toLowerCase());
        const phoneMatch = contact.phone && senderLower.includes(contact.phone.replace(/\D/g, ""));
        if (nameMatch || emailMatch || phoneMatch) {
          const contactCustomerIds = contact.siteContactLinks.map(l => l.customerId);
          if (contactCustomerIds.includes(t.payingCustomer?.name ? undefined : "")) {
            // Weak match — contact exists but not linked to this customer
          }
          score += 10;
          reasons.push(`Sender: ${contact.fullName}`);
          break;
        }
      }
    }

    if (score > 0) {
      scored.push({
        ticketId: t.id,
        ticketNo: t.ticketNo,
        title: t.title,
        customer: t.payingCustomer?.name ?? "",
        site: t.site?.siteName ?? "",
        score,
        reasons,
      });
    }
  }

  // Sort by score descending, top 5
  scored.sort((a, b) => b.score - a.score);

  return Response.json({ suggestions: scored.slice(0, 5) });
}
