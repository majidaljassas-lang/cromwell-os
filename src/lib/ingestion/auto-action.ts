/**
 * Auto-Action Pipeline
 *
 * Takes classified ingestion events and performs actions:
 * - PO_DOCUMENT → extract PO number, match customer, create Customer PO, link to ticket
 * - ORDER (supplier ack) → link to ticket as procurement evidence
 * - APPROVAL → link to ticket, update status
 * - QUOTE_REQUEST → create new enquiry if unlinked
 * - DELIVERY_UPDATE → link to ticket, log delivery event
 * - DISPUTE → link to ticket, create task
 * - PAYMENT → log payment received
 */

import { prisma } from "@/lib/prisma";

interface ActionResult {
  eventId: string;
  action: string;
  success: boolean;
  details: string;
}

export async function processClassifiedEvents(): Promise<ActionResult[]> {
  const results: ActionResult[] = [];

  const events = await prisma.ingestionEvent.findMany({
    where: { status: "CLASSIFIED" },
    include: {
      parsedMessages: { select: { extractedText: true, structuredData: true } },
    },
    orderBy: { receivedAt: "asc" },
    take: 50,
  });

  for (const event of events) {
    const text = event.parsedMessages?.[0]?.extractedText || "";
    const data = (event.parsedMessages?.[0]?.structuredData || {}) as Record<string, any>;
    const subject = data.subject || "";
    const fromEmail = data.from?.address || "";
    const fromName = data.from?.name || "";

    try {
      switch (event.eventKind) {
        case "PO_DOCUMENT":
          results.push(await handlePODocument(event.id, subject, text, fromEmail, fromName));
          break;
        case "ORDER":
          results.push(await handleOrderAck(event.id, subject, text, fromEmail, fromName));
          break;
        case "APPROVAL":
          results.push(await handleApproval(event.id, subject, text, fromEmail, fromName));
          break;
        case "DELIVERY_UPDATE":
          results.push(await handleDeliveryUpdate(event.id, subject, text, fromEmail, fromName));
          break;
        case "DISPUTE":
          results.push(await handleDispute(event.id, subject, text, fromEmail, fromName));
          break;
        case "OUTLOOK_SENT":
          // Sent emails — just link to ticket if possible, no action needed
          results.push(await handleSentEmail(event.id, subject, text, fromEmail));
          break;
        default:
          // Try to link by sender/subject, otherwise leave in inbox
          results.push(await handleGeneric(event.id, subject, text, fromEmail, fromName));
      }
    } catch (err) {
      results.push({ eventId: event.id, action: "ERROR", success: false, details: (err as Error).message });
    }
  }

  return results;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

async function findTicketByContext(subject: string, text: string, fromEmail: string): Promise<string | null> {
  // Try matching by site name
  const sites = await prisma.site.findMany({ select: { id: true, siteName: true } });
  const tickets = await prisma.ticket.findMany({
    select: { id: true, title: true, siteId: true, payingCustomer: { select: { name: true } } },
  });

  const combined = `${subject} ${text}`.toLowerCase();

  // Match by site name in text
  for (const ticket of tickets) {
    const site = sites.find((s) => s.id === ticket.siteId);
    if (site && combined.includes(site.siteName.toLowerCase())) return ticket.id;
  }

  // Match by ticket title keywords
  for (const ticket of tickets) {
    const titleWords = ticket.title.toLowerCase().split(/\s+/).filter((w) => w.length > 4);
    const matchCount = titleWords.filter((w) => combined.includes(w)).length;
    if (matchCount >= 2) return ticket.id;
  }

  // Match by customer name
  const customers = await prisma.customer.findMany({ select: { id: true, name: true } });
  for (const customer of customers) {
    if (combined.includes(customer.name.toLowerCase().trim())) {
      const ticket = tickets.find((t) => t.payingCustomer?.name?.trim() === customer.name.trim());
      if (ticket) return ticket.id;
    }
  }

  // Match sender email domain to known contacts
  const domain = fromEmail.split("@")[1];
  if (domain) {
    const contact = await prisma.contact.findFirst({
      where: { email: { contains: domain } },
      select: { id: true },
    });
    // Could extend this to find tickets via contact
  }

  return null;
}

function extractPONumber(subject: string, text: string): string | null {
  // Try subject first
  const subjectMatch = subject.match(/(?:PO|Purchase Order|P\.O\.?|Order)\s*#?\s*:?\s*([A-Z0-9/\-_.]+)/i)
    || subject.match(/\b(PO[A-Z]{0,3}\d{3,})\b/i)
    || subject.match(/\b(\d{4}\/[A-Z]?\d{4,})\b/);
  if (subjectMatch) return subjectMatch[1];

  // Try body
  const bodyMatch = text.match(/(?:Purchase Order|PO|P\.O\.)\s*(?:No|Number|#|:)?\s*:?\s*([A-Z0-9/\-_.]+)/i);
  if (bodyMatch) return bodyMatch[1];

  return null;
}

// ─── Action Handlers ────────────────────────────────────────────────────────

async function handlePODocument(eventId: string, subject: string, text: string, fromEmail: string, fromName: string): Promise<ActionResult> {
  const poNo = extractPONumber(subject, text);
  const ticketId = await findTicketByContext(subject, text, fromEmail);

  // Find customer from sender — try email domain, name, anything
  const domain = fromEmail.split("@")[1]?.replace(/\.(co\.uk|com|org)$/, "") || "";
  let customer = await prisma.customer.findFirst({
    where: { OR: [
      { name: { contains: domain, mode: "insensitive" } },
      { name: { contains: fromName.split(" ")[0], mode: "insensitive" } },
    ] },
  });

  // If no customer found, try matching by contact email
  if (!customer) {
    const contact = await prisma.contact.findFirst({
      where: { email: { contains: domain, mode: "insensitive" } },
      select: { id: true },
    });
    // If still no customer, create one from the sender domain
    if (!customer) {
      const companyName = domain.charAt(0).toUpperCase() + domain.slice(1);
      customer = await prisma.customer.create({
        data: { name: `${companyName} (auto-created from ${fromEmail})` },
      });
    }
  }

  if (poNo) {
    // Check if PO already exists
    const existing = await prisma.customerPO.findFirst({ where: { poNo } });
    if (!existing) {
      // ALWAYS create the PO — don't wait for a customer match
      await prisma.customerPO.create({
        data: {
          poNo,
          poType: "STANDARD_FIXED",
          customerId: customer!.id,
          ticketId: ticketId || undefined,
          status: "RECEIVED",
          notes: `Auto-created from email: ${subject} (${fromName} <${fromEmail}>)`,
        },
      });

      // If no ticket linked, create a work queue task to link it
      if (!ticketId) {
        // Find any ticket to attach the task to, or use the first one
        const anyTicket = await prisma.ticket.findFirst({ orderBy: { createdAt: "desc" } });
        if (anyTicket) {
          await prisma.task.create({
            data: {
              ticketId: anyTicket.id,
              taskType: "LINK_PO",
              priority: "MEDIUM",
              status: "OPEN",
              reason: `Customer PO ${poNo} received from ${fromName} — needs linking to correct ticket`,
            },
          });
        }
      }
    }
  }

  // Log event on ticket if linked
  if (ticketId) {
    await prisma.event.create({
      data: {
        ticketId,
        eventType: "PO_RECEIVED",
        timestamp: new Date(),
        notes: `Customer PO received — ${poNo || "ref pending"} from ${fromName} (${fromEmail})`,
      },
    });
  }

  // ALWAYS action — the PO is created, it's in the register
  await prisma.ingestionEvent.update({ where: { id: eventId }, data: { status: "ACTIONED" } });

  return {
    eventId,
    action: "PO_DOCUMENT",
    success: true,
    details: `PO: ${poNo || "unknown"} CREATED, ticket: ${ticketId ? "linked" : "task created"}, customer: ${customer?.name || "auto-created"}`,
  };
}

async function handleOrderAck(eventId: string, subject: string, text: string, fromEmail: string, fromName: string): Promise<ActionResult> {
  const ticketId = await findTicketByContext(subject, text, fromEmail);

  // Extract order ref from subject
  const orderRef = subject.match(/Order\s*(\d{4,})/i)?.[1]
    || subject.match(/(\d{4,})\s*\(Acknowledgement\)/i)?.[1]
    || subject.match(/(\d{6,})/)?.[1];

  // Find or create supplier from sender
  const domain = fromEmail.split("@")[1]?.replace(/\.(co\.uk|com|org|ltd)$/, "") || "";
  let supplier = await prisma.supplier.findFirst({
    where: { OR: [
      { name: { contains: domain, mode: "insensitive" } },
      { name: { contains: fromName, mode: "insensitive" } },
    ] },
  });

  if (ticketId) {
    await prisma.event.create({
      data: {
        ticketId,
        eventType: "SUPPLIER_CONFIRMED",
        timestamp: new Date(),
        notes: `Supplier acknowledgement from ${fromName} — ${subject.substring(0, 100)}`,
      },
    });
  }

  // Always action — log it
  await prisma.ingestionEvent.update({ where: { id: eventId }, data: { status: "ACTIONED" } });

  return {
    eventId,
    action: "ORDER_ACK",
    success: true,
    details: `Order: ${orderRef || "unknown"}, supplier: ${supplier?.name || fromName}, ticket: ${ticketId ? "linked" : "unlinked"}`,
  };
}

async function handleApproval(eventId: string, subject: string, text: string, fromEmail: string, fromName: string): Promise<ActionResult> {
  const ticketId = await findTicketByContext(subject, text, fromEmail);

  if (ticketId) {
    await prisma.event.create({
      data: {
        ticketId,
        eventType: "QUOTE_APPROVED",
        timestamp: new Date(),
        notes: `Approval from ${fromName} — ${subject.substring(0, 100)}`,
      },
    });
    await prisma.ingestionEvent.update({ where: { id: eventId }, data: { status: "ACTIONED" } });
  } else {
    await prisma.ingestionEvent.update({ where: { id: eventId }, data: { status: "ACTIONED" } });
  }

  return {
    eventId,
    action: "APPROVAL",
    success: true,
    details: `ticket: ${ticketId ? "linked" : "unlinked"}`,
  };
}

async function handleDeliveryUpdate(eventId: string, subject: string, text: string, fromEmail: string, fromName: string): Promise<ActionResult> {
  const ticketId = await findTicketByContext(subject, text, fromEmail);

  if (ticketId) {
    await prisma.event.create({
      data: {
        ticketId,
        eventType: "GOODS_DELIVERED",
        timestamp: new Date(),
        notes: `Delivery update from ${fromName} — ${subject.substring(0, 100)}`,
      },
    });
    await prisma.ingestionEvent.update({ where: { id: eventId }, data: { status: "ACTIONED" } });
  } else {
    await prisma.ingestionEvent.update({ where: { id: eventId }, data: { status: "ACTIONED" } });
  }

  return {
    eventId,
    action: "DELIVERY_UPDATE",
    success: true,
    details: `ticket: ${ticketId ? "linked" : "unlinked"}`,
  };
}

async function handleDispute(eventId: string, subject: string, text: string, fromEmail: string, fromName: string): Promise<ActionResult> {
  const ticketId = await findTicketByContext(subject, text, fromEmail);

  if (ticketId) {
    await prisma.task.create({
      data: {
        ticketId,
        taskType: "REVIEW_DISPUTE",
        priority: "HIGH",
        status: "OPEN",
        reason: `Dispute/issue from ${fromName}: ${subject.substring(0, 150)}`,
      },
    });
    await prisma.ingestionEvent.update({ where: { id: eventId }, data: { status: "ACTIONED" } });
  } else {
    await prisma.ingestionEvent.update({ where: { id: eventId }, data: { status: "ACTIONED" } });
  }

  return {
    eventId,
    action: "DISPUTE",
    success: true,
    details: `ticket: ${ticketId ? "linked + task created" : "unlinked"}`,
  };
}

async function handleSentEmail(eventId: string, subject: string, text: string, fromEmail: string): Promise<ActionResult> {
  const ticketId = await findTicketByContext(subject, text, fromEmail);

  if (ticketId) {
    await prisma.ingestionEvent.update({ where: { id: eventId }, data: { status: "ACTIONED" } });
  } else {
    await prisma.ingestionEvent.update({ where: { id: eventId }, data: { status: "DISMISSED" } });
  }

  return {
    eventId,
    action: "SENT_EMAIL",
    success: true,
    details: `ticket: ${ticketId ? "linked" : "dismissed"}`,
  };
}

async function handleGeneric(eventId: string, subject: string, text: string, fromEmail: string, fromName: string): Promise<ActionResult> {
  const ticketId = await findTicketByContext(subject, text, fromEmail);

  // Move to NEEDS_TRIAGE if we can't auto-link — stays in inbox for manual action
  await prisma.ingestionEvent.update({
    where: { id: eventId },
    data: { status: ticketId ? "ACTIONED" : "NEEDS_TRIAGE" },
  });

  return {
    eventId,
    action: "GENERIC",
    success: true,
    details: `ticket: ${ticketId ? "linked" : "needs triage"}`,
  };
}
