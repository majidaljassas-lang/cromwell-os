/**
 * Manual classification dispatcher.
 *
 * The user picks tags + tickets in the inbox. This module decides what
 * actually happens for each tag. Three patterns:
 *
 *   1. CREATE-OR-ATTACH (Order, Quote Request, etc.)
 *      - No ticket selected → create new ticket (customer/site/lines auto-resolved)
 *      - Ticket selected     → attach email as Event on that ticket
 *
 *   2. ATTACH-WITH-TASK (Site Issue, Dispute, Schedule, Return)
 *      - Always attach Event to selected ticket(s); also raise a Task
 *      - If no ticket selected and tag NEEDS one, return a clear error
 *
 *   3. ENGINE (Bill)
 *      - Hand off to the existing pipeline (bill parser → AP → allocation)
 *
 *   NOISE marks the whole thread as noise.
 */
import { prisma } from "@/lib/prisma";
import { processBillThread } from "@/lib/bills/pipeline";
import { resolveCustomer, resolveSite, extractLineItems, buildThreadText } from "@/lib/inbox/auto-ticket-creator";
import { ensureAttachmentsExtracted } from "@/lib/ingestion/ensure-attachments";
import { processManualAck } from "@/lib/inbox/process-manual-ack";
import { handleStatement } from "@/lib/ingestion/handlers/statement-handler";

export interface TagHandlerInput {
  tag: { id: string; name: string; label: string; routingHandler: string | null };
  ingestionEventId: string;
  threadId: string;
  messageId: string;
  ticketIds: string[];
  customerId?: string | null;
  siteId?: string | null;
  batchId: string;
}

export interface TagHandlerResult {
  handler: string | null;
  ok: boolean;
  message: string;
  data?: unknown;
}

// ── Public entry point ──────────────────────────────────────────────────────

export async function runTagHandler(input: TagHandlerInput): Promise<TagHandlerResult> {
  const handler = input.tag.routingHandler ?? input.tag.name.toLowerCase();
  try {
    switch (handler) {
      case "bill_parser":
        return await runBillHandler(input);

      case "noise":
        return await runNoiseHandler(input);

      case "order":
        // Customer order received → ticket CAPTURED + poRequired. Status only
        // moves to ORDERED once the supplier acknowledgement is parsed and
        // confirms the order in full.
        return await createOrAttach(input, { ticketMode: "DIRECT_ORDER", status: "CAPTURED",  eventType: "ORDER_PLACED", poRequired: true, poStatus: "PENDING" });
      case "quote_request":
        return await createOrAttach(input, { ticketMode: "PRICING_FIRST", status: "PRICING",   eventType: "QUOTE_REQUESTED" });
      case "competitive_bid":
        return await createOrAttach(input, { ticketMode: "COMPETITIVE_BID", status: "PRICING", eventType: "QUOTE_REQUESTED" });
      case "spec":
        return await createOrAttach(input, { ticketMode: "SPEC_DRIVEN", status: "CAPTURED", eventType: "COMMS_RECEIVED" });
      case "approval":
        return await createOrAttach(input, { ticketMode: "DIRECT_ORDER", status: "APPROVED", eventType: "APPROVAL_RECEIVED" });
      case "po_received":
        return await createOrAttach(input, { ticketMode: "DIRECT_ORDER", status: "CAPTURED", eventType: "PO_RECEIVED", poRequired: true, poStatus: "PENDING" });

      case "order_ack":
        return await runOrderAckHandler(input);
      case "quote_response":
        return await attachOnly(input, { eventType: "SUPPLIER_QUOTE_RECEIVED" });
      case "delivery_update":
        return await attachOnly(input, { eventType: "GOODS_DELIVERED" });
      case "note":
        return await attachOnly(input, { eventType: "COMMS_RECEIVED" });

      case "site_issue":
        return await attachAndTask(input, { eventType: "COMMS_RECEIVED", taskType: "SITE_ISSUE", priority: "HIGH" });
      case "dispute":
        return await attachAndTask(input, { eventType: "COMMS_RECEIVED", taskType: "DISPUTE", priority: "HIGH" });
      case "schedule":
        return await attachAndTask(input, { eventType: "DELIVERY_SCHEDULED", taskType: "SCHEDULE", priority: "MEDIUM" });
      case "return":
        return await attachAndTask(input, { eventType: "RETURN_CREATED", taskType: "RETURN_PROCESSING", priority: "MEDIUM" });

      case "credit_note":
        return await attachAndTask(input, { eventType: "CREDIT_RECEIVED", taskType: "CREDIT_NOTE_REVIEW", priority: "MEDIUM" });
      case "statement":
        return await runStatementHandler(input);
      case "remittance":
        return await attachAndTask(input, { eventType: "PAYMENT_RECEIVED", taskType: "ALLOCATE_PAYMENT", priority: "MEDIUM" });
      case "payment":
        return await attachAndTask(input, { eventType: "PAYMENT_RECEIVED", taskType: "ALLOCATE_PAYMENT", priority: "MEDIUM" });

      default:
        return { handler, ok: true, message: `Tag '${input.tag.name}' logged. No routing handler matched '${handler}'.` };
    }
  } catch (err) {
    return {
      handler,
      ok: false,
      message: `Handler '${handler}' threw: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ── Order Ack handler (calls existing ack-matcher engine) ──────────────────

async function runOrderAckHandler(input: TagHandlerInput): Promise<TagHandlerResult> {
  if (input.ticketIds.length === 0) {
    return {
      handler: "order_ack",
      ok: false,
      message: `Order Ack needs a ticket — pick the customer order this acknowledgement is against.`,
    };
  }

  // 1. Always-on PDF extraction.
  const ensureResult = await ensureAttachmentsExtracted(input.ingestionEventId);

  // 2. Attach as Event for audit trail (works even if parser fails).
  const events = await attachAsEvents(input, "ORDER_ACK_RECEIVED");

  // 3. Per ticket: parse + apply (no autonomous-mode threshold — user picked).
  const perTicket: Array<{ ticketNo: number; line: string }> = [];
  let totalLinesUpdated = 0;
  let totalOrdersCreated = 0;
  let supplierLabel: string | null = null;
  let orderRefLabel: string | null = null;

  for (const ticketId of input.ticketIds) {
    const ack = await processManualAck({
      ingestionEventId: input.ingestionEventId,
      ticketId,
      batchId: input.batchId,
    });
    totalLinesUpdated += ack.applied.linesUpdated;
    totalOrdersCreated += ack.applied.ordersCreated;
    if (!supplierLabel && ack.parsed.supplier) supplierLabel = ack.parsed.supplier;
    if (!orderRefLabel && ack.parsed.orderRef) orderRefLabel = ack.parsed.orderRef;

    const reconcile = await reconcileTicketAfterAck(ticketId, input.batchId);
    if (!ack.ok) {
      perTicket.push({ ticketNo: reconcile.ticketNo, line: `parse failed: ${ack.reason ?? "unknown"}` });
    } else {
      perTicket.push({
        ticketNo: reconcile.ticketNo,
        line: `${ack.parsed.lineCount} parsed → ${ack.applied.linesUpdated} priced · ${reconcile.message}`,
      });
    }
  }

  const extractSummary = ensureResult.extracted
    ? `extracted ${ensureResult.attachmentCount ?? 0} attachment(s)`
    : ensureResult.ok
      ? `attachments: ${ensureResult.reason ?? "n/a"}`
      : `attachment extract failed: ${ensureResult.reason ?? "unknown"}`;

  const supplierBit = supplierLabel ? ` · supplier=${supplierLabel}` : "";
  const refBit = orderRefLabel ? ` · ref=${orderRefLabel}` : "";

  return {
    handler: "order_ack",
    ok: totalLinesUpdated > 0,
    message:
      `${extractSummary}${supplierBit}${refBit} · ` +
      `${totalOrdersCreated} PO, ${totalLinesUpdated} line(s) priced · ` +
      perTicket.map((p) => `#${p.ticketNo}: ${p.line}`).join(" · "),
    data: { attached: events.length, ticketIds: input.ticketIds, ensureResult },
  };
}

async function reconcileTicketAfterAck(
  ticketId: string,
  batchId: string,
): Promise<{ ticketNo: number; message: string }> {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: {
      id: true,
      ticketNo: true,
      status: true,
      poStatus: true,
      orderedAt: true,
      lines: { select: { id: true, expectedCostUnit: true, qty: true, status: true } },
    },
  });
  if (!ticket) return { ticketNo: 0, message: "ticket not found" };

  const total = ticket.lines.length;
  const priced = ticket.lines.filter((l) => l.expectedCostUnit !== null).length;

  if (total === 0) return { ticketNo: ticket.ticketNo, message: "no lines on ticket" };

  // Full coverage: ensure status=ORDERED, poStatus=ACKNOWLEDGED, orderedAt set.
  // Idempotent — only writes the fields that are out of sync, so re-runs are safe.
  if (priced === total) {
    const updates: Record<string, unknown> = {};
    if (ticket.status !== "ORDERED") updates.status = "ORDERED";
    if (ticket.poStatus !== "ACKNOWLEDGED") updates.poStatus = "ACKNOWLEDGED";
    if (!ticket.orderedAt) updates.orderedAt = new Date();

    if (Object.keys(updates).length > 0) {
      await prisma.ticket.update({ where: { id: ticket.id }, data: updates });
      await prisma.event.create({
        data: {
          ticketId: ticket.id,
          eventType: "AUTO_STATUS_PROGRESSED" as never,
          timestamp: new Date(),
          notes:
            `Supplier acknowledgement reconciled. ${total} line(s) priced. ` +
            Object.entries(updates)
              .map(([k, v]) => `${k}=${v instanceof Date ? v.toISOString() : v}`)
              .join(", ") +
            ` (batch ${batchId})`,
          sourceRef: `manual-classify:${batchId}:${ticket.id}`,
        },
      });
      return {
        ticketNo: ticket.ticketNo,
        message: `${total}/${total} lines priced → ${Object.keys(updates).join(", ")}`,
      };
    }
    return { ticketNo: ticket.ticketNo, message: `${total}/${total} lines priced (already ORDERED + ACKNOWLEDGED)` };
  }

  // Partial → ensure poStatus=PARTIAL, raise review task.
  if (priced > 0 && priced < total) {
    if (ticket.poStatus !== "PARTIAL") {
      await prisma.ticket.update({ where: { id: ticket.id }, data: { poStatus: "PARTIAL" } });
    }
    const due = new Date();
    due.setHours(23, 59, 59, 999);
    await prisma.task.create({
      data: {
        ticketId: ticket.id,
        taskType: "ACK_PARTIAL_REVIEW",
        priority: "HIGH",
        status: "OPEN",
        dueAt: due,
        generatedReason: `Supplier ack parsed but only ${priced}/${total} lines confirmed. Review missing lines.`,
      },
    });
    return { ticketNo: ticket.ticketNo, message: `${priced}/${total} lines priced → poStatus=PARTIAL, REVIEW task raised` };
  }

  return { ticketNo: ticket.ticketNo, message: `parser found no line matches — see Event for raw ack text` };
}

// ── Bill handler (existing pipeline) ────────────────────────────────────────

async function runBillHandler(input: TagHandlerInput): Promise<TagHandlerResult> {
  await prisma.inboxThread.update({
    where: { id: input.threadId },
    data: { classification: "BILL" },
  });
  const result = await processBillThread(input.threadId);
  return {
    handler: "bill_parser",
    ok: result.errors.length === 0,
    message: result.errors.length
      ? `Bill pipeline finished with errors: ${result.errors.join("; ")}`
      : `Bill: ${result.extractedLines} lines, ${result.matched} matched, ${result.exceptions} exceptions${result.supplierBillId ? ` (bill ${result.supplierBillId.slice(0, 8)})` : ""}`,
    data: { ...result, manualTicketIds: input.ticketIds },
  };
}

// ── Statement → AP reconciler (existing engine, wired to manual classify) ──

async function runStatementHandler(input: TagHandlerInput): Promise<TagHandlerResult> {
  // Make sure attachments are extracted so the parser sees the PDF body, not
  // just the email cover text. Capture the result so the toast surfaces it.
  const ensureResult = await ensureAttachmentsExtracted(input.ingestionEventId);

  const event = await prisma.ingestionEvent.findUnique({
    where: { id: input.ingestionEventId },
    include: {
      parsedMessages: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
  if (!event) {
    return { handler: "statement", ok: false, message: `IngestionEvent ${input.ingestionEventId} not found.` };
  }

  const parsed = event.parsedMessages[0];
  const raw = (event.rawPayload ?? {}) as Record<string, unknown>;

  const { fromEmail, fromName } = extractSenderFromPayload(raw);
  const subject = typeof raw.subject === "string" ? raw.subject : (typeof raw.Subject === "string" ? raw.Subject : "");
  const text = parsed?.extractedText ?? "";

  // Tag the thread so the inbox shows the doctype clearly.
  await prisma.inboxThread.update({
    where: { id: input.threadId },
    data: { classification: "STATEMENT" },
  });

  const outcome = await handleStatement({
    eventId: event.id,
    classification: "STATEMENT",
    intent: "REACTION",
    subject,
    text,
    fromEmail,
    fromName,
    data: (parsed?.structuredData as Record<string, unknown>) ?? {},
  });

  const attachmentNote = ensureResult.extracted
    ? ` · attachment text +${ensureResult.textChars ?? 0} chars`
    : ensureResult.reason && ensureResult.reason !== "attachment text already present"
      ? ` · attachment skipped: ${ensureResult.reason}`
      : "";

  return {
    handler: "statement",
    ok: outcome.success,
    message: `${outcome.details}${attachmentNote}`,
    data: { intakeDocumentId: outcome.intakeDocumentId, action: outcome.action, ensureResult },
  };
}

/**
 * Pull sender email + name out of an IngestionEvent.rawPayload, handling the
 * shapes we see in practice:
 *   - Outlook (Microsoft Graph): { from: { emailAddress: { address, name } } }
 *   - Older / WhatsApp: { fromEmail: "x@y.com", fromName: "X" }
 *   - Plain string: { from: "x@y.com" }
 */
function extractSenderFromPayload(raw: Record<string, unknown>): { fromEmail: string; fromName: string } {
  // 1) explicit fromEmail / fromName fields (older shape, WhatsApp)
  const fromEmailField = typeof raw.fromEmail === "string" ? raw.fromEmail : null;
  const fromNameField = typeof raw.fromName === "string" ? raw.fromName : null;
  if (fromEmailField || fromNameField) {
    return { fromEmail: fromEmailField ?? "", fromName: fromNameField ?? "" };
  }

  // 2) Outlook shape: from = { emailAddress: { address, name } }
  const fromObj = raw.from as { emailAddress?: { address?: string; name?: string } } | string | undefined;
  if (fromObj && typeof fromObj === "object" && fromObj.emailAddress) {
    return {
      fromEmail: fromObj.emailAddress.address ?? "",
      fromName: fromObj.emailAddress.name ?? "",
    };
  }

  // 3) Plain string fallback
  if (typeof fromObj === "string") {
    return { fromEmail: fromObj, fromName: "" };
  }

  return { fromEmail: "", fromName: "" };
}

// ── Noise: archive thread ───────────────────────────────────────────────────

async function runNoiseHandler(input: TagHandlerInput): Promise<TagHandlerResult> {
  await prisma.inboxThread.update({
    where: { id: input.threadId },
    data: { status: "NOISE", noisedAt: new Date() },
  });
  return { handler: "noise", ok: true, message: "Thread marked as NOISE." };
}

// ── Pattern 1: create-or-attach ─────────────────────────────────────────────

async function createOrAttach(
  input: TagHandlerInput,
  spec: { ticketMode: string; status: string; eventType: string; poRequired?: boolean; poStatus?: string },
): Promise<TagHandlerResult> {
  if (input.ticketIds.length > 0) {
    return await attachOnly(input, { eventType: spec.eventType });
  }

  const created = await createTicketFromThread(input, spec);
  return created;
}

// ── Pattern 2: attach Event(s) on selected ticket(s) only ───────────────────

async function attachOnly(
  input: TagHandlerInput,
  spec: { eventType: string },
): Promise<TagHandlerResult> {
  if (input.ticketIds.length === 0) {
    return {
      handler: input.tag.routingHandler,
      ok: false,
      message: `Tag '${input.tag.name}' needs a ticket. None selected — picked an inbox row but no ticket linked.`,
    };
  }
  const events = await attachAsEvents(input, spec.eventType);
  return {
    handler: input.tag.routingHandler,
    ok: true,
    message: `Attached as ${spec.eventType} to ${events.length} ticket(s).`,
    data: { ticketIds: input.ticketIds },
  };
}

// ── Pattern 3: attach Event + create Task ───────────────────────────────────

async function attachAndTask(
  input: TagHandlerInput,
  spec: { eventType: string; taskType: string; priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" },
): Promise<TagHandlerResult> {
  if (input.ticketIds.length === 0) {
    return {
      handler: input.tag.routingHandler,
      ok: false,
      message: `Tag '${input.tag.name}' needs a ticket. None selected.`,
    };
  }
  await attachAsEvents(input, spec.eventType);
  const tasks = await createTasks(input, spec.taskType, spec.priority);
  return {
    handler: input.tag.routingHandler,
    ok: true,
    message: `Attached + ${tasks.length} ${spec.priority} ${spec.taskType} task(s) raised.`,
    data: { ticketIds: input.ticketIds, taskCount: tasks.length },
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function attachAsEvents(input: TagHandlerInput, eventType: string) {
  const message = await prisma.inboxThreadMessage.findUnique({
    where: { id: input.messageId },
    select: { sender: true, snippet: true, occurredAt: true, hasAttachments: true },
  });

  const events = [];
  for (const ticketId of input.ticketIds) {
    const evt = await prisma.event.create({
      data: {
        ticketId,
        eventType: eventType as never,
        timestamp: message?.occurredAt ?? new Date(),
        notes:
          `[${input.tag.label}] from ${message?.sender ?? "(unknown)"}${message?.hasAttachments ? " (with attachments)" : ""}` +
          (message?.snippet ? `\n\n${message.snippet.slice(0, 500)}` : ""),
        sourceRef: `manual-classify:${input.batchId}:${ticketId}`,
      },
    });
    events.push(evt);
  }

  // Link the thread to the first ticket if no link yet (so future emails on the
  // same conversation auto-attach via thread-appender).
  if (input.ticketIds.length > 0) {
    const thread = await prisma.inboxThread.findUnique({
      where: { id: input.threadId },
      select: {
        linkedTicketId: true,
        channel: true,
        conversationKey: true,
        subject: true,
      },
    });
    if (!thread?.linkedTicketId) {
      await prisma.inboxThread.update({
        where: { id: input.threadId },
        data: {
          linkedTicketId: input.ticketIds[0],
          linkSource: "MANUAL",
          linkConfidence: "HIGH",
          status: "LINKED",
          triagedAt: new Date(),
        },
      });
    }

    // Learn: if this is a WhatsApp group, save chatId → customer/site so the
    // next message from the same group auto-resolves and auto-creates.
    if (thread?.channel === "WHATSAPP_GROUP") {
      await learnWhatsAppGroupLink({
        chatId: canonicalChatId(thread.conversationKey),
        groupName: thread.subject,
        ticketId: input.ticketIds[0],
      });
    }
  }

  return events;
}

function canonicalChatId(conversationKey: string): string {
  return conversationKey.split("::")[0];
}

async function learnWhatsAppGroupLink(args: { chatId: string; groupName: string | null; ticketId: string }) {
  const ticket = await prisma.ticket.findUnique({
    where: { id: args.ticketId },
    select: { payingCustomerId: true, siteId: true, siteCommercialLinkId: true },
  });
  if (!ticket?.payingCustomerId) return;

  await prisma.whatsAppGroupLink.upsert({
    where: { chatId: args.chatId },
    create: {
      chatId: args.chatId,
      groupName: args.groupName,
      customerId: ticket.payingCustomerId,
      siteId: ticket.siteId,
      siteCommercialLinkId: ticket.siteCommercialLinkId,
      source: "INFERRED_FROM_TICKET",
    },
    update: {
      customerId: ticket.payingCustomerId,
      siteId: ticket.siteId ?? undefined,
      siteCommercialLinkId: ticket.siteCommercialLinkId ?? undefined,
    },
  });
}

async function createTasks(
  input: TagHandlerInput,
  taskType: string,
  priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
) {
  const tasks = [];
  const due = new Date();
  due.setHours(23, 59, 59, 999);
  for (const ticketId of input.ticketIds) {
    const t = await prisma.task.create({
      data: {
        ticketId,
        taskType,
        priority,
        status: "OPEN",
        dueAt: due,
        generatedReason: `User classified inbox email as ${input.tag.label}.`,
      },
    });
    tasks.push(t);
  }
  return tasks;
}

async function createTicketFromThread(
  input: TagHandlerInput,
  spec: { ticketMode: string; status: string; eventType: string; poRequired?: boolean; poStatus?: string },
): Promise<TagHandlerResult> {
  const thread = await prisma.inboxThread.findUnique({
    where: { id: input.threadId },
    select: {
      id: true,
      channel: true,
      conversationKey: true,
      participants: true,
      subject: true,
      aiEntities: true,
      aiSummary: true,
    },
  });
  if (!thread) {
    return { handler: input.tag.routingHandler, ok: false, message: "Thread not found." };
  }

  let customer: { customerId: string; customerName: string } | null = null;
  let siteId: string | null = null;
  let siteCommercialLinkId: string | undefined;

  // 1. User-supplied customer/site wins (modal pickers).
  if (input.customerId) {
    const c = await prisma.customer.findUnique({
      where: { id: input.customerId },
      select: { id: true, name: true },
    });
    if (c) customer = { customerId: c.id, customerName: c.name };
    if (input.siteId) siteId = input.siteId;
  }

  // 2. WhatsApp group: learned group→customer/site mapping.
  if (!customer && thread.channel === "WHATSAPP_GROUP") {
    const link = await prisma.whatsAppGroupLink.findUnique({
      where: { chatId: canonicalChatId(thread.conversationKey) },
    });
    if (link?.customerId) {
      const c = await prisma.customer.findUnique({
        where: { id: link.customerId },
        select: { id: true, name: true },
      });
      if (c) {
        customer = { customerId: c.id, customerName: c.name };
        siteId = link.siteId;
        siteCommercialLinkId = link.siteCommercialLinkId ?? undefined;
      }
    }
  }

  // 3. Standard resolver (email contact / 1:1 phone / AI-extracted name).
  if (!customer) {
    customer = await resolveCustomer({
      channel: thread.channel,
      conversationKey: thread.conversationKey,
      participants: thread.participants,
      aiEntities: (thread.aiEntities as Record<string, unknown> | null) ?? null,
    });
  }

  if (!customer) {
    if (thread.channel === "WHATSAPP_GROUP") {
      return {
        handler: input.tag.routingHandler,
        ok: false,
        message: `WhatsApp group not mapped yet. Pick a Customer (and Site) in the modal, or pick an existing ticket — the OS will remember the group from there.`,
      };
    }
    return {
      handler: input.tag.routingHandler,
      ok: false,
      message: `Couldn't resolve customer from sender. Pick a Customer in the modal or attach to an existing ticket.`,
    };
  }

  // 4. Site: user-supplied → group link → AI entities.
  if (siteId === null) {
    siteId = await resolveSite((thread.aiEntities as Record<string, unknown> | null) ?? null);
  }
  if (siteId && !siteCommercialLinkId) {
    const link = await prisma.siteCommercialLink.findFirst({
      where: { customerId: customer.customerId, siteId, isActive: true },
      select: { id: true },
    });
    siteCommercialLinkId = link?.id;
  }

  // 5. Learn the WhatsApp group mapping for next time.
  if (thread.channel === "WHATSAPP_GROUP") {
    await prisma.whatsAppGroupLink.upsert({
      where: { chatId: canonicalChatId(thread.conversationKey) },
      create: {
        chatId: canonicalChatId(thread.conversationKey),
        groupName: thread.subject,
        customerId: customer.customerId,
        siteId: siteId ?? undefined,
        siteCommercialLinkId,
        source: "INFERRED_FROM_USER_PICK",
      },
      update: {
        customerId: customer.customerId,
        siteId: siteId ?? undefined,
        siteCommercialLinkId: siteCommercialLinkId ?? undefined,
      },
    });
  }

  const threadText = await buildThreadText(thread.id);
  const lines = await extractLineItems(threadText);

  // Pull the originating message for commercial-proof title + sourceRef.
  const message = await prisma.inboxThreadMessage.findUnique({
    where: { id: input.messageId },
    select: { sender: true, snippet: true, occurredAt: true },
  });
  const siteName = siteId
    ? (await prisma.site.findUnique({ where: { id: siteId }, select: { siteName: true } }))?.siteName ?? null
    : null;

  const title = buildCommercialTitle({
    tagLabel: input.tag.label,
    customer: customer.customerName,
    site: siteName,
    sender: message?.sender,
    occurredAt: message?.occurredAt ?? new Date(),
    channel: thread.channel,
    snippet: message?.snippet ?? null,
  });

  const sourceCode = thread.channel; // EMAIL, WHATSAPP, WHATSAPP_GROUP, SMS, OTHER
  const sourceRef = JSON.stringify({
    channel: thread.channel,
    conversationKey: canonicalChatId(thread.conversationKey),
    threadId: thread.id,
    messageId: input.messageId,
    ingestionEventId: input.ingestionEventId,
    sender: message?.sender ?? null,
    occurredAt: (message?.occurredAt ?? new Date()).toISOString(),
    classifiedAt: new Date().toISOString(),
    classifiedTag: input.tag.name,
    batchId: input.batchId,
  });

  const ticket = await prisma.$transaction(async (tx) => {
    const newTicket = await tx.ticket.create({
      data: {
        title,
        description: message?.snippet ?? thread.aiSummary ?? undefined,
        ticketMode: spec.ticketMode as never,
        status: spec.status as never,
        poRequired: spec.poRequired ?? false,
        poStatus: spec.poStatus,
        payingCustomerId: customer.customerId,
        siteId: siteId ?? undefined,
        siteCommercialLinkId,
        source: sourceCode,
        sourceRef,
        autoCreatedByAi: false,
        manualMode: false,
        revenueState: "OPERATIONAL",
      },
    });

    if (lines.length > 0) {
      await tx.ticketLine.createMany({
        data: lines.map((line) => ({
          ticketId: newTicket.id,
          lineType: "MATERIAL" as never,
          description: line.description,
          qty: line.qty,
          unit: line.unit as never,
          payingCustomerId: customer.customerId,
          siteId: siteId ?? undefined,
          siteCommercialLinkId,
          status: "CAPTURED" as never,
        })),
      });
    }

    await tx.inboxThread.update({
      where: { id: thread.id },
      data: {
        linkedTicketId: newTicket.id,
        linkSource: "MANUAL",
        linkConfidence: "HIGH",
        status: "LINKED",
        triagedAt: new Date(),
      },
    });

    await tx.event.create({
      data: {
        ticketId: newTicket.id,
        eventType: spec.eventType as never,
        timestamp: message?.occurredAt ?? new Date(),
        notes:
          `User classified inbox message as ${input.tag.label} → created ticket.\n` +
          `Source: ${thread.channel} from ${message?.sender ?? "(unknown)"} at ${(message?.occurredAt ?? new Date()).toISOString()}\n` +
          `${lines.length} line item(s) extracted.`,
        sourceRef: `manual-classify:${input.batchId}:${newTicket.id}`,
      },
    });

    return newTicket;
  });

  return {
    handler: input.tag.routingHandler,
    ok: true,
    message: `Ticket #${ticket.ticketNo} "${title}" created — ${lines.length} line(s)${siteId ? "" : ", no site"}.`,
    data: { ticketId: ticket.id, ticketNo: ticket.ticketNo, title, customer: customer.customerName, siteId, lines: lines.length },
  };
}

function buildCommercialTitle(args: {
  tagLabel: string;
  customer: string;
  site: string | null;
  sender: string | null | undefined;
  occurredAt: Date;
  channel: string;
  snippet: string | null;
}): string {
  // Format: "[ORDER] Yesss Electrical / London City — 27 Apr 14:46 — req: Majid Al Jassas (WA Group)"
  const dateStr = args.occurredAt.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/London",
  });
  const channelShort: Record<string, string> = {
    EMAIL: "Email",
    WHATSAPP: "WA",
    WHATSAPP_GROUP: "WA Group",
    SMS: "SMS",
    OTHER: "Other",
  };
  const customerSite = args.site ? `${args.customer.trim()} / ${args.site}` : args.customer.trim();
  const requisitioner = args.sender?.trim() ? `req: ${args.sender.trim()}` : "req: (unknown)";
  const channel = channelShort[args.channel] ?? args.channel;
  const head = `[${args.tagLabel}] ${customerSite} — ${dateStr} — ${requisitioner} (${channel})`;

  // Append a brief content hint from the snippet (first non-empty line, ≤60 chars).
  const hint = (args.snippet ?? "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .find((s) => s.length > 0 && !s.toLowerCase().startsWith("***order***"));
  const tail = hint ? ` — ${hint.slice(0, 60)}` : "";

  return (head + tail).slice(0, 200);
}
