/**
 * GET    /api/inbox/threads/:id           — full thread with all messages
 * PATCH  /api/inbox/threads/:id           — { action: "ACCEPT" | "NOISE" | "LINK" | "UNDO"; ticketId?: string }
 *
 * ACCEPT  → create a new Ticket from the thread (or link to ticketId if provided), status=LINKED
 * NOISE   → status=NOISE, hidden from default inbox view
 * LINK    → status=LINKED, linkedTicketId=ticketId (caller supplies existing ticket)
 * UNDO    → status=NEW, clear linkedTicketId
 */
import { prisma } from "@/lib/prisma";

type CustomerResolution =
  | { ok: true; customerId: string }
  | { ok: false; error: string };

function phoneDigits(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 7 ? digits : null;
}

/**
 * Resolve a single payingCustomerId from a thread's sender. Mirror of the
 * contact-walk in thread-builder.ts so ACCEPT and the auto-linker stay
 * consistent: same Contact lookup, same SiteContactLink walk.
 */
async function deriveCustomerFromThread(thread: {
  channel: string;
  conversationKey: string;
  participants: string[];
}): Promise<CustomerResolution> {
  let contactIds: string[] = [];

  if (thread.channel === "EMAIL") {
    const emails = (thread.participants || [])
      .map((p) => p.trim().toLowerCase())
      .filter((p) => p.includes("@"));
    if (emails.length === 0) return { ok: false, error: "no email participants on thread" };
    const contacts = await prisma.contact.findMany({
      where: { email: { in: emails, mode: "insensitive" }, isActive: true },
      select: { id: true },
    });
    contactIds = contacts.map((c) => c.id);
  } else if (thread.channel === "WHATSAPP" || thread.channel === "SMS") {
    const localPart = thread.conversationKey.split("@")[0] ?? "";
    const digits = phoneDigits(localPart);
    if (!digits) return { ok: false, error: "could not parse phone from conversationKey" };
    const candidates = await prisma.contact.findMany({
      where: { phone: { not: null }, isActive: true },
      select: { id: true, phone: true },
    });
    contactIds = candidates
      .filter((c) => {
        const d = phoneDigits(c.phone);
        if (!d) return false;
        return d === digits || d.endsWith(digits) || digits.endsWith(d);
      })
      .map((c) => c.id);
  } else {
    return { ok: false, error: `cannot auto-derive customer for channel ${thread.channel} — use LINK instead` };
  }

  if (contactIds.length === 0) {
    // Auto-create contact + customer from sender details
    const senderEmail = (thread.participants || []).find((p) => p.includes("@"))?.trim().toLowerCase();
    const senderName = senderEmail
      ? senderEmail.split("@")[0]!.replace(/[._-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
      : thread.conversationKey.split("@")[0] ?? "Unknown";

    const contact = await prisma.contact.create({
      data: {
        fullName: senderName,
        email: senderEmail ?? null,
        phone: thread.channel !== "EMAIL" ? thread.conversationKey.split("@")[0] : null,

        isActive: true,
      },
    });

    const customer = await prisma.customer.create({
      data: {
        name: `${senderName} (auto-intake)`,
        isBillingEntity: false,
      },
    });

    // SiteContactLink requires a siteId — find or create a placeholder site
    let site = await prisma.site.findFirst({ where: { isActive: true }, select: { id: true } });
    if (!site) {
      site = await prisma.site.create({ data: { siteName: "Unassigned", isActive: true } });
    }

    await prisma.siteContactLink.create({
      data: {
        contact: { connect: { id: contact.id } },
        customer: { connect: { id: customer.id } },
        site: { connect: { id: site.id } },
        isActive: true,
      },
    });

    return { ok: true, customerId: customer.id };
  }

  const links = await prisma.siteContactLink.findMany({
    where: { contactId: { in: contactIds }, customerId: { not: null }, isActive: true },
    select: { customerId: true },
  });
  const customerIds = Array.from(new Set(links.map((l) => l.customerId!).filter(Boolean)));

  if (customerIds.length === 0) {
    // Contact exists but has no customer link — auto-create customer and link
    const senderEmail = (thread.participants || []).find((p) => p.includes("@"))?.trim().toLowerCase();
    const senderName = senderEmail
      ? senderEmail.split("@")[0]!.replace(/[._-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
      : thread.conversationKey.split("@")[0] ?? "Unknown";

    const customer = await prisma.customer.create({
      data: {
        name: `${senderName} (auto-intake)`,
        isBillingEntity: false,
      },
    });

    let site2 = await prisma.site.findFirst({ where: { isActive: true }, select: { id: true } });
    if (!site2) {
      site2 = await prisma.site.create({ data: { siteName: "Unassigned", isActive: true } });
    }

    await prisma.siteContactLink.create({
      data: {
        contact: { connect: { id: contactIds[0] } },
        customer: { connect: { id: customer.id } },
        site: { connect: { id: site2.id } },
        isActive: true,
      },
    });

    return { ok: true, customerId: customer.id };
  }
  if (customerIds.length > 1) {
    return { ok: false, error: `sender resolves to ${customerIds.length} customers — use LINK to specify which ticket` };
  }
  return { ok: true, customerId: customerIds[0] };
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const thread = await prisma.inboxThread.findUnique({
    where: { id },
    include: {
      messages: {
        orderBy: { occurredAt: "asc" },
      },
      linkedTicket: { select: { id: true, ticketNo: true, title: true, status: true } },
    },
  });
  if (!thread) return Response.json({ error: "thread not found" }, { status: 404 });
  return Response.json({ thread });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
  const { id } = await params;
  const body = await request.json() as { action?: string; ticketId?: string; title?: string };
  const thread = await prisma.inboxThread.findUnique({
    where: { id },
    include: { messages: { take: 1, orderBy: { occurredAt: "asc" } } },
  });
  if (!thread) return Response.json({ error: "thread not found" }, { status: 404 });

  if (body.action === "NOISE") {
    await prisma.inboxThread.update({
      where: { id },
      data: { status: "NOISE", noisedAt: new Date(), triagedAt: new Date() },
    });
    return Response.json({ ok: true, status: "NOISE" });
  }

  if (body.action === "UNDO") {
    await prisma.inboxThread.update({
      where: { id },
      data: { status: "NEW", noisedAt: null, triagedAt: null, linkedTicketId: null },
    });
    return Response.json({ ok: true, status: "NEW" });
  }

  if (body.action === "LINK") {
    if (!body.ticketId) return Response.json({ error: "ticketId required" }, { status: 400 });
    await prisma.inboxThread.update({
      where: { id },
      data: { status: "LINKED", linkedTicketId: body.ticketId, triagedAt: new Date() },
    });

    // Get all messages + classify the thread content
    const allMessages = await prisma.inboxThreadMessage.findMany({
      where: { threadId: id },
      orderBy: { occurredAt: "asc" },
      select: { id: true, sender: true, snippet: true, occurredAt: true, hasAttachments: true, ingestionEventId: true },
    });

    const fullText = allMessages.map(m => m.snippet ?? "").join(" ").toLowerCase();

    // Detect what type of communication this is
    // Maps to EvidenceType enum: INSTRUCTION, APPROVAL, PRICING, DELIVERY, DISPUTE,
    // PO_REQUEST, PO_RECEIVED, SUPPLIER_CONFIRMATION, PHOTO, CALL_NOTE
    let evidenceType: string = "INSTRUCTION";
    let taskType: string | null = null;
    let taskPriority = "MEDIUM";
    let taskReason = "";

    if (/order\s*ack|acknowledgement|order\s*confirm|we confirm your order|your order has been/i.test(fullText)) {
      evidenceType = "SUPPLIER_CONFIRMATION";
      taskType = "CHECK_DELIVERY_DATE";
      taskReason = "Supplier order acknowledgement received — check expected delivery date";
    } else if (/dispatch|dispatched|shipped|tracking|out for delivery|delivery.*monday|delivery.*tuesday|delivery.*wednesday|delivery.*thursday|delivery.*friday|deliver.*tomorrow|collection.*ready/i.test(fullText)) {
      evidenceType = "DELIVERY";
      taskType = "CONFIRM_DELIVERY_RECEIPT";
      taskReason = "Delivery update received — confirm goods arrive on site";
    } else if (/invoice|bill|amount due|payment terms|net total|inv[\s-]*no/i.test(fullText)) {
      evidenceType = "INSTRUCTION";
      taskType = "MATCH_BILL_TO_TICKET";
      taskPriority = "HIGH";
      taskReason = "Supplier bill received — match to PO, check costs, allocate";
    } else if (/approved|go ahead|proceed|confirm.*order|send.*po|place.*order/i.test(fullText)) {
      evidenceType = "APPROVAL";
      taskType = "PLACE_ORDER_WITH_SUPPLIER";
      taskPriority = "HIGH";
      taskReason = "Customer approval received — place order with supplier";
    } else if (/quote|quotation|pricing|price list|we can offer/i.test(fullText)) {
      evidenceType = "PRICING";
      taskType = "REVIEW_SUPPLIER_PRICING";
      taskReason = "Supplier pricing received — review and update ticket costs";
    } else if (/please.*order|can you.*supply|need.*asap|urgent.*order|please.*send/i.test(fullText)) {
      evidenceType = "INSTRUCTION";
      taskType = "PLACE_ORDER_WITH_SUPPLIER";
      taskPriority = "HIGH";
      taskReason = "Customer order received — source from supplier and confirm";
    } else if (/po|purchase order/i.test(fullText)) {
      evidenceType = "PO_RECEIVED";
      taskType = "LINK_PO";
      taskReason = "Purchase order reference received — link to ticket";
    } else if (/dispute|wrong|damaged|missing|short|incorrect/i.test(fullText)) {
      evidenceType = "DISPUTE";
      taskType = "REVIEW_DISPUTE";
      taskPriority = "HIGH";
      taskReason = "Dispute or issue flagged — review and resolve";
    }

    // Process EACH message individually — classify, create evidence + event + task
    let evidenceCount = 0;
    let eventCount = 0;
    const tasksCreated: string[] = [];

    for (const msg of allMessages) {
      const isSent = (msg.sender ?? "").toLowerCase().includes("majid");
      const sourceType = thread.channel === "EMAIL" ? "OUTLOOK" : "WHATSAPP";
      const msgText = (msg.snippet ?? "").toLowerCase();
      const rawSnippet = (msg.snippet ?? "").trim();
      const displayText = `${isSent ? "[SENT] " : ""}${msg.sender ?? "Unknown"}: ${rawSnippet.slice(0, 500)}${msg.hasAttachments ? " [📎]" : ""}`;

      // Skip pure chatter — messages with no commercial content at all.
      // BUT keep anything that mentions: products, quantities, prices, sites, orders, delivery.
      const hasCommercialContent = /\d+\s*(x|no|nr|box|pack|roll|length|m\b|mm\b|£|\bqty)/i.test(rawSnippet)
        || /order|deliver|invoice|bill|quote|price|site|collection|dispatch|po\b|ack/i.test(msgText)
        || /\b\d{2,}mm\b/i.test(rawSnippet)  // product sizes like 15mm, 22mm
        || msg.hasAttachments;  // attachments are always commercial

      if (!hasCommercialContent && rawSnippet.length < 80) {
        // Pure chatter — skip evidence + event creation but don't block
        continue;
      }

      // Classify THIS individual message
      let msgEvidenceType: string = "INSTRUCTION";
      let msgEventType = "COMMS_RECEIVED";
      let msgTaskType: string | null = null;
      let msgTaskReason = "";
      let msgTaskPriority = "MEDIUM";
      let closeTaskType: string | null = null; // auto-close a previous task

      if (isSent && /order|can i order|please.*supply|following.*to.*orme|following.*to.*site/i.test(msgText)) {
        // You sent an order to a supplier
        msgEvidenceType = "INSTRUCTION";
        msgEventType = "ORDER_PLACED";
        closeTaskType = "PLACE_ORDER_WITH_SUPPLIER";
        msgTaskType = "AWAIT_ORDER_ACK";
        msgTaskReason = "Order placed with supplier — awaiting acknowledgement";
      } else if (isSent && /confirm|go ahead|approved|proceed/i.test(msgText)) {
        // You confirmed/sent a sale
        msgEvidenceType = "INSTRUCTION";
        msgEventType = "SALE_CONFIRMED";
        msgTaskType = "PLACE_ORDER_WITH_SUPPLIER";
        msgTaskPriority = "HIGH";
        msgTaskReason = "Sale confirmed to customer — place order with supplier";
      } else if (!isSent && /loaded|delivery.*monday|delivery.*tomorrow|dispatch|can get it there|deliver.*to|collection.*ready|shipped/i.test(msgText)) {
        // Supplier confirmed delivery
        msgEvidenceType = "DELIVERY";
        msgEventType = "DELIVERY_SCHEDULED";
        closeTaskType = "AWAIT_ORDER_ACK";
        msgTaskType = "CONFIRM_DELIVERY_RECEIPT";
        msgTaskReason = "Delivery scheduled — confirm goods arrive on site";
      } else if (!isSent && /delivered|on site|arrived|signed|received.*goods|goods.*received/i.test(msgText)) {
        // Delivery confirmed
        msgEvidenceType = "DELIVERY";
        msgEventType = "GOODS_DELIVERED";
        closeTaskType = "CONFIRM_DELIVERY_RECEIPT";
        msgTaskType = "MATCH_BILL_TO_TICKET";
        msgTaskReason = "Goods delivered — await supplier bill, match costs";
      } else if (!isSent && /order.*ack|acknowledgement|confirm.*order|your order/i.test(msgText)) {
        // Supplier order ack
        msgEvidenceType = "SUPPLIER_CONFIRMATION";
        msgEventType = "ORDER_ACK_RECEIVED";
        closeTaskType = "AWAIT_ORDER_ACK";
        msgTaskType = "CHECK_DELIVERY_DATE";
        msgTaskReason = "Order acknowledged by supplier — check delivery date";
      } else if (!isSent && /invoice|bill|amount due|payment|inv[\s-]*no/i.test(msgText)) {
        // Bill received
        msgEvidenceType = "INSTRUCTION";
        msgEventType = "BILL_RECEIVED";
        closeTaskType = "MATCH_BILL_TO_TICKET";
        msgTaskType = "MARKUP_AND_INVOICE";
        msgTaskPriority = "HIGH";
        msgTaskReason = "Bill received and matched — review costs, apply markup, draft invoice to customer";
      } else if (isSent && /invoice|inv.*attached|please find.*invoice|as per.*invoice/i.test(msgText)) {
        // You sent the invoice to customer
        msgEvidenceType = "INSTRUCTION";
        msgEventType = "INVOICE_RAISED";
        closeTaskType = "MARKUP_AND_INVOICE";
        msgTaskType = "CHASE_PAYMENT";
        msgTaskReason = "Invoice sent to customer — chase payment if not received";
      } else if (!isSent && /paid|payment.*received|bacs|bank transfer.*confirm|remittance/i.test(msgText)) {
        // Payment received
        msgEvidenceType = "INSTRUCTION";
        msgEventType = "PAYMENT_RECEIVED";
        closeTaskType = "CHASE_PAYMENT";
        // No next task — job complete. Close the ticket.
      } else if (!isSent && /approved|go ahead|proceed|yes.*please/i.test(msgText)) {
        // Customer approval
        msgEvidenceType = "APPROVAL";
        msgEventType = "APPROVAL_RECEIVED";
        msgTaskType = "PLACE_ORDER_WITH_SUPPLIER";
        msgTaskPriority = "HIGH";
        msgTaskReason = "Customer approval received — place order";
      } else if (!isSent && /quote|pricing|price|we can offer/i.test(msgText)) {
        // Supplier quote
        msgEvidenceType = "PRICING";
        msgEventType = "SUPPLIER_QUOTE_RECEIVED";
        msgTaskType = "REVIEW_SUPPLIER_PRICING";
        msgTaskReason = "Supplier pricing received — review and update costs";
      } else if (isSent) {
        msgEventType = "COMMS_SENT";
      }

      // 1. Evidence
      await prisma.evidenceFragment.create({
        data: {
          ticketId: body.ticketId,
          sourceType,
          fragmentType: msgEvidenceType as any,
          fragmentText: displayText,
          sourceRef: `msg:${msg.id}`,
          timestamp: msg.occurredAt,
          isPrimaryEvidence: !isSent,
        },
      });
      evidenceCount++;

      // 2. Event
      await prisma.event.create({
        data: {
          ticketId: body.ticketId,
          eventType: msgEventType as any,
          timestamp: msg.occurredAt,
          notes: displayText,
          sourceRef: `thread:${id}:msg:${msg.id}`,
        },
      });
      eventCount++;

      // 3. Auto-close previous task if this message completes it
      if (closeTaskType) {
        await prisma.task.updateMany({
          where: { ticketId: body.ticketId, taskType: closeTaskType, status: "OPEN" },
          data: { status: "DONE" },
        });
      }

      // 4. Create next task
      if (msgTaskType) {
        const existing = await prisma.task.findFirst({
          where: { ticketId: body.ticketId, taskType: msgTaskType, status: "OPEN" },
        });
        if (!existing) {
          await prisma.task.create({
            data: {
              ticketId: body.ticketId,
              taskType: msgTaskType,
              priority: msgTaskPriority,
              status: "OPEN",
              generatedReason: msgTaskReason,
            },
          });
          tasksCreated.push(msgTaskType);
        }
      }
    }

    // Update ticket lastActivityAt + auto-progress status based on events
    const statusUpdate: Record<string, unknown> = { lastActivityAt: new Date() };

    // Check what we just logged and progress the ticket
    const latestEventTypes = allMessages.map(m => {
      const t = (m.snippet ?? "").toLowerCase();
      const sent = (m.sender ?? "").toLowerCase().includes("majid");
      if (!sent && /paid|payment.*received|remittance/i.test(t)) return "PAYMENT";
      if (sent && /invoice|inv.*attached/i.test(t)) return "INVOICED";
      if (!sent && /delivered|on site|arrived/i.test(t)) return "DELIVERED";
      if (!sent && /loaded|delivery.*monday|dispatch|can get it there/i.test(t)) return "DELIVERY_SCHEDULED";
      if (sent && /can i order|order.*please/i.test(t)) return "ORDER_PLACED";
      return null;
    }).filter(Boolean);

    // Progress to the furthest stage
    if (latestEventTypes.includes("PAYMENT")) {
      statusUpdate.status = "CLOSED";
      statusUpdate.closedAt = new Date();
    } else if (latestEventTypes.includes("INVOICED")) {
      statusUpdate.status = "INVOICED";
      statusUpdate.invoicedAt = new Date();
    } else if (latestEventTypes.includes("DELIVERED")) {
      statusUpdate.status = "DELIVERED";
      statusUpdate.deliveredAt = new Date();
    }

    await prisma.ticket.update({
      where: { id: body.ticketId },
      data: statusUpdate,
    });

    return Response.json({
      ok: true,
      status: "LINKED",
      ticketId: body.ticketId,
      evidenceCreated: evidenceCount,
      eventsCreated: eventCount,
      taskCreated: taskType,
      taskId,
    });
  }

  if (body.action === "ACCEPT") {
    const { customerId, siteId, ticketMode, title: userTitle, description: userDescription, source: userSource } = body as {
      customerId?: string;
      siteId?: string;
      ticketMode?: string;
      title?: string;
      description?: string;
      source?: string;
    };

    // Customer: use provided, or try auto-derive, or fail with helpful error
    let resolvedCustomerId = customerId;
    if (!resolvedCustomerId) {
      const customerResolution = await deriveCustomerFromThread(thread);
      if (customerResolution.ok) {
        resolvedCustomerId = customerResolution.customerId;
      }
      // If no customer provided and can't derive, still create — user can set it later
    }

    const title = userTitle ?? thread.subject ?? `Thread ${thread.id.slice(0, 8)}`;

    // Pull the full email/message body from parsed messages for the description
    let description = userDescription ?? "";
    if (!description) {
      const threadMessages = await prisma.inboxThreadMessage.findMany({
        where: { threadId: id },
        orderBy: { occurredAt: "asc" },
        select: { ingestionEventId: true, snippet: true },
      });
      const eventIds = threadMessages.map((m) => m.ingestionEventId);
      if (eventIds.length > 0) {
        const parsedMessages = await prisma.parsedMessage.findMany({
          where: { ingestionEventId: { in: eventIds } },
          select: { extractedText: true },
          orderBy: { createdAt: "asc" },
        });
        description = parsedMessages.map((p) => p.extractedText ?? "").join("\n\n---\n\n").slice(0, 32000);
      }
      if (!description) {
        description = threadMessages.map((m) => m.snippet ?? "").join("\n\n").slice(0, 16000);
      }
    }

    // Source: user override > thread channel > unknown
    const sourceMap: Record<string, string> = { EMAIL: "EMAIL", WHATSAPP: "WHATSAPP", WHATSAPP_GROUP: "WHATSAPP", SMS: "SMS" };
    const source = userSource ?? sourceMap[thread.channel] ?? "OTHER";
    const sourceRef = thread.participants[0] ?? null;

    const ticket = await prisma.ticket.create({
      data: {
        title: title.slice(0, 200),
        description,
        ticketMode: (ticketMode as any) ?? "DIRECT_ORDER",
        status: "CAPTURED",
        source,
        sourceRef,
        lastActivityAt: new Date(),
        ...(resolvedCustomerId ? { payingCustomer: { connect: { id: resolvedCustomerId } } } : {}),
        ...(siteId ? { site: { connect: { id: siteId } } } : {}),
      },
    });
    await prisma.inboxThread.update({
      where: { id },
      data: {
        status: "LINKED",
        linkedTicketId: ticket.id,
        triagedAt: new Date(),
      },
    });

    // Create an event on the ticket for audit trail
    await prisma.event.create({
      data: {
        ticketId: ticket.id,
        eventType: "TICKET_CREATED",
        timestamp: new Date(),
        notes: `Created from inbox ${thread.channel.toLowerCase()} thread: "${thread.subject ?? "(no subject)"}"`,
      },
    });

    return Response.json({
      ok: true,
      status: "LINKED",
      ticket: { id: ticket.id, ticketNo: ticket.ticketNo, title: ticket.title },
    });
  }

  return Response.json({ error: "unknown action" }, { status: 400 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("PATCH /api/inbox/threads/[id] failed:", err);
    return Response.json({ error: msg }, { status: 500 });
  }
}

/**
 * DELETE /api/inbox/threads/:id
 *
 * Permanently removes the thread + its messages + the underlying IngestionEvents
 * (plus any ParsedMessage / IntakeDocument / ExtractedEntity / IngestionLink
 * derived from those events) from Cromwell OS.
 *
 * Safety rails:
 *   - Only threads with status = NOISE can be hard-deleted (or pass ?force=1 to override)
 *   - NEVER deletes IngestionEvents that have a SupplierBill derived from them
 *     (those are accounting records we must keep)
 *   - Email itself remains in Outlook — we only wipe OS-side state
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(request.url);
  const force = url.searchParams.get("force") === "1";

  const thread = await prisma.inboxThread.findUnique({
    where: { id },
    include: { messages: { select: { ingestionEventId: true } } },
  });
  if (!thread) return Response.json({ error: "thread not found" }, { status: 404 });
  if (thread.status !== "NOISE" && !force) {
    return Response.json({ error: `refusing — thread is ${thread.status}; must be NOISE or pass ?force=1` }, { status: 409 });
  }

  const eventIds = thread.messages.map((m) => m.ingestionEventId);

  // Detect events that have accounting records derived from them — keep those.
  const protectedEventIds = new Set<string>();
  if (eventIds.length) {
    const bills = await prisma.supplierBill.findMany({
      where: { sourceAttachmentRef: { in: eventIds } },
      select: { sourceAttachmentRef: true },
    });
    for (const b of bills) if (b.sourceAttachmentRef) protectedEventIds.add(b.sourceAttachmentRef);

    const intakeDocs = await prisma.intakeDocument.findMany({
      where: { ingestionEventId: { in: eventIds }, supplierBillId: { not: null } },
      select: { ingestionEventId: true },
    });
    for (const d of intakeDocs) if (d.ingestionEventId) protectedEventIds.add(d.ingestionEventId);
  }
  const deletableEventIds = eventIds.filter((id) => !protectedEventIds.has(id));

  // Cascade delete in the right order. Wrap in a transaction.
  const deleted = await prisma.$transaction(async (tx) => {
    // 1. Delete IntakeDocument rows for these events (not yet promoted to bills)
    const intake = await tx.intakeDocument.deleteMany({
      where: { ingestionEventId: { in: deletableEventIds }, supplierBillId: null },
    });

    // 2. Delete ExtractedEntity + IngestionLink via ParsedMessage (need the parsedMessage ids first)
    const parsed = await tx.parsedMessage.findMany({
      where: { ingestionEventId: { in: deletableEventIds } },
      select: { id: true },
    });
    const parsedIds = parsed.map((p) => p.id);
    const entities = await tx.extractedEntity.deleteMany({ where: { parsedMessageId: { in: parsedIds } } });
    const links    = await tx.ingestionLink.deleteMany({ where: { parsedMessageId: { in: parsedIds } } });

    // 3. Delete ParsedMessage rows
    const parsedDel = await tx.parsedMessage.deleteMany({ where: { id: { in: parsedIds } } });

    // 4. Delete SourceSiteMatch rows
    const sourceSite = await tx.sourceSiteMatch.deleteMany({ where: { ingestionEventId: { in: deletableEventIds } } });

    // 5. Delete DraftInvoiceRecoveryItem rows (if any)
    let draftRecovery = { count: 0 };
    try {
      draftRecovery = await tx.draftInvoiceRecoveryItem.deleteMany({ where: { ingestionEventId: { in: deletableEventIds } } });
    } catch { /* optional */ }

    // 6. Delete the InboxThreadMessage rows (cascade will also run, but explicit is safer)
    const threadMsgs = await tx.inboxThreadMessage.deleteMany({ where: { threadId: id } });

    // 7. Delete InboundEvent rows
    const inbound = await tx.inboundEvent.deleteMany({ where: { ingestionEventId: { in: deletableEventIds } } });

    // 8. Record external message IDs before deleting so sync won't re-ingest
    const eventsToDelete = await tx.ingestionEvent.findMany({
      where: { id: { in: deletableEventIds } },
      select: { externalMessageId: true },
    });
    for (const e of eventsToDelete) {
      if (e.externalMessageId) {
        await tx.deletedMessageId.create({ data: { externalMessageId: e.externalMessageId } }).catch(() => {});
      }
    }

    // 9. Delete IngestionEvent rows completely
    const events = await tx.ingestionEvent.deleteMany({ where: { id: { in: deletableEventIds } } });

    // 8. Finally drop the thread itself
    await tx.inboxThread.delete({ where: { id } });

    return { intake, entities, links, parsed: parsedDel, sourceSite, draftRecovery, threadMsgs, events };
  });

  return Response.json({
    ok: true,
    threadId: id,
    eventsDeleted: deleted.events.count,
    eventsProtected: protectedEventIds.size,
    details: deleted,
  });
}
