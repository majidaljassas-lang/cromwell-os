/**
 * Return Request → arrange collection (Universal Ingestion, Phase C step 3)
 *
 * A customer asks to return goods. This is an ACTION (opens a loop), not a
 * REACTION. The handler captures the request, attaches it to an existing
 * ticket where possible, and opens an ARRANGE_COLLECTION task so logistics
 * can act on it.
 *
 * Pipeline:
 *   1. extractFromText → structured.lines (items + qty)
 *   2. Resolve customer (sender domain / extracted name) and ticket (most
 *      recent for that customer, since returns reference past orders)
 *   3. Persist IntakeDocument(docType=RETURN_REQUEST)
 *   4. Open Task(ARRANGE_COLLECTION) on the resolved (or anchor) ticket
 *
 * No signal emit — return requests don't close loops, they create them. The
 * downstream Return record is created when collection is arranged (manual
 * step), so we don't auto-create a Return row here.
 */
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/ingestion/audit";
import { triggerRegistry, type TriggerHandler } from "@/lib/ingestion/trigger-registry";
import { extractFromText } from "@/lib/ingestion/extract-any";

async function resolveCustomer(
  fromEmail: string,
  fromName: string,
): Promise<{ id: string; name: string } | null> {
  const domain = (fromEmail.split("@")[1] || "").toLowerCase().split(".")[0];
  const candidates = [fromName, domain].filter(Boolean) as string[];
  for (const cand of candidates) {
    const customer = await prisma.customer.findFirst({
      where: { name: { contains: cand, mode: "insensitive" } },
      select: { id: true, name: true },
    });
    if (customer) return customer;
  }
  return null;
}

async function resolveTicket(customerId: string | null, text: string): Promise<{ id: string } | null> {
  if (customerId) {
    // Most recent ticket for that customer is usually the one being referenced.
    const t = await prisma.ticket.findFirst({
      where: { payingCustomerId: customerId },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (t) return t;
  }
  // Site-name fallback
  const sites = await prisma.site.findMany({ select: { id: true, siteName: true } });
  const lower = text.toLowerCase();
  for (const s of sites) {
    if (lower.includes(s.siteName.toLowerCase())) {
      const t = await prisma.ticket.findFirst({
        where: { siteId: s.id },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      if (t) return t;
    }
  }
  return null;
}

export const handleReturnRequest: TriggerHandler = async (ctx) => {
  const extracted = await extractFromText(`${ctx.subject}\n${ctx.text}`);
  const customer = await resolveCustomer(ctx.fromEmail, ctx.fromName);
  const ticket = await resolveTicket(customer?.id ?? null, `${ctx.subject}\n${ctx.text}`);

  const intake = await prisma.intakeDocument.create({
    data: {
      sourceType: "EMAIL_RETURN_REQUEST",
      sourceRef: ctx.eventId,
      ingestionEventId: ctx.eventId,
      rawText: ctx.text.slice(0, 100_000),
      docType: "RETURN_REQUEST",
      intent: "ACTION",
      intentConfidence: 80,
      status: "PARSED",
      extracted: JSON.parse(
        JSON.stringify({
          parsed: {
            documentRef: extracted.structured.documentRef,
            lines: extracted.structured.lines,
          },
          resolvedCustomerId: customer?.id ?? null,
          resolvedTicketId: ticket?.id ?? null,
          sender: { email: ctx.fromEmail, name: ctx.fromName },
          subject: ctx.subject,
        }),
      ),
      linkedTicketId: ticket?.id ?? null,
      triggerStatus: "FIRED",
    },
  });

  let taskId: string | null = null;
  const anchorTicket =
    ticket ?? (await prisma.ticket.findFirst({ orderBy: { createdAt: "desc" }, select: { id: true } }));

  if (anchorTicket) {
    const lineSummary = extracted.structured.lines
      .slice(0, 5)
      .map((l) => `${l.qty}× ${l.description}`)
      .join("; ");
    const t = await prisma.task.create({
      data: {
        ticketId: anchorTicket.id,
        taskType: "ARRANGE_COLLECTION",
        priority: "MEDIUM",
        status: "OPEN",
        generatedReason:
          `Return requested by ${customer?.name ?? ctx.fromName ?? ctx.fromEmail}: ${lineSummary || "see attached"}`,
        draftBody: ctx.text.slice(0, 2000),
      },
    });
    taskId = t.id;
    await prisma.intakeDocument.update({
      where: { id: intake.id },
      data: { linkedTaskId: taskId },
    });
  }

  await logAudit({
    objectType: "IntakeDocument",
    objectId: intake.id,
    actionType: "RETURN_REQUEST_RECEIVED",
    newValue: {
      eventId: ctx.eventId,
      customerId: customer?.id ?? null,
      ticketId: ticket?.id ?? null,
      taskId,
      lineCount: extracted.structured.lines.length,
    },
    reason: ticket
      ? `Return request linked to ticket ${ticket.id}`
      : "Return request received but ticket unresolved — review needed",
  });

  await prisma.ingestionEvent.update({
    where: { id: ctx.eventId },
    data: { status: "ACTIONED" },
  });

  return {
    eventId: ctx.eventId,
    action: "RETURN_REQUEST",
    success: true,
    details:
      `customer=${customer?.name ?? "?"} ticket=${ticket?.id ?? "?"} ` +
      `lines=${extracted.structured.lines.length} task=${taskId ? "created" : "skipped"}`,
    intakeDocumentId: intake.id,
  };
};

triggerRegistry.register("RETURN_REQUEST", "ACTION", handleReturnRequest);
