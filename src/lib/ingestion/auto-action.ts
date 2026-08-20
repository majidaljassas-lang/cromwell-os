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
 * - BILL_DOCUMENT → extract PDF text, parse bill, match supplier, create SupplierBill + AP journal
 */

import { prisma } from "@/lib/prisma";
import { parseBillText } from "@/lib/ingestion/bill-parser";
import { processBill } from "@/lib/finance/bill-processor";
import { parseYesssPoText, type ParsedYesssPO } from "@/lib/ingestion/yesss-po-parser";
import { parsePOWithAI, type ParsedAIPO } from "@/lib/ingestion/ai-po-parser";
import { generateSupplierPODrafts } from "@/lib/procurement/supplier-po-drafter";
import { triggerRegistry, type TriggerContext } from "@/lib/ingestion/trigger-registry";
import { intentForClassification, type MessageClassification } from "@/lib/ingestion/classifier";
import { enqueueUnresolvedParty } from "@/lib/parties/review-queue";
// Handler registration: importing the module triggers triggerRegistry.register()
// at the bottom of each handler file. Add new doctype handlers below.
import "@/lib/ingestion/handlers/statement-handler";
import "@/lib/ingestion/handlers/ack-handler";
import "@/lib/ingestion/handlers/credit-note-handler";
import "@/lib/ingestion/handlers/delivery-handler";
import "@/lib/ingestion/handlers/supplier-quote-handler";
import "@/lib/ingestion/handlers/return-request-handler";
import "@/lib/ingestion/handlers/po-handler";
import fs from "fs";
import path from "path";

interface ActionResult {
  eventId: string;
  action: string;
  success: boolean;
  details: string;
}

// Own-team senders that get classified as bills by accident (e.g. internal AP
// forwards). Blocks the self-bill loop where our own outgoing AP email would
// otherwise create a SupplierBill against ourselves.
const SELF_DOMAINS = [
  "cromwellplumbing.co.uk",
  "cromwellfreight.com",
  "cromwell-freight.com",
];

/**
 * Create a BILL_NEEDS_REVIEW Task so that a bill failing ingestion does not
 * become a silent NEEDS_REVIEW event. The task is attached to the most
 * recent ticket as a placeholder (Task.ticketId is required) so it surfaces
 * in the command centre queue. Exported so the cron path
 * (/api/automation/process-bills) can reuse the same helper.
 */
export async function createBillNeedsReviewTask(
  eventId: string,
  subject: string,
  fromEmail: string,
  fromName: string,
  failureReason: string,
): Promise<void> {
  try {
    const anyTicket = await prisma.ticket.findFirst({
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (!anyTicket) return;

    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    await prisma.task.create({
      data: {
        ticketId: anyTicket.id,
        taskType: "BILL_NEEDS_REVIEW",
        priority: "HIGH",
        status: "OPEN",
        dueAt: endOfToday,
        generatedReason:
          `Bill ingestion needs review: ${failureReason}. ` +
          `Event ${eventId.slice(0, 8)} from ${fromName || fromEmail || "unknown sender"}. ` +
          `Subject: ${subject || "(no subject)"}`,
      },
    });
  } catch (err) {
    console.warn(
      `[auto-action] createBillNeedsReviewTask failed for ${eventId}:`,
      err,
    );
  }
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
      // Registry-first dispatch: any (docType, intent) registered via
      // triggerRegistry.register() takes priority over the legacy switch
      // below. Legacy switch is the fallback for handlers not yet migrated.
      const classification = (event.eventKind ?? "UNKNOWN") as MessageClassification;
      const ctx: TriggerContext = {
        eventId: event.id,
        classification,
        intent: intentForClassification(classification),
        subject,
        text,
        fromEmail,
        fromName,
        data,
      };
      const registered = await triggerRegistry.dispatch(ctx);
      if (registered) {
        results.push({
          eventId: registered.eventId,
          action: registered.action,
          success: registered.success,
          details: registered.details,
        });
        continue;
      }

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
        case "BILL_DOCUMENT": {
          const lower = fromEmail.toLowerCase();
          if (SELF_DOMAINS.some((d) => lower.includes(d))) {
            await prisma.ingestionEvent.update({
              where: { id: event.id },
              data: { status: "DISMISSED", errorMessage: "Self-bill: own AP team email, not a supplier bill" },
            });
            results.push({ eventId: event.id, action: "BILL_DOCUMENT", success: true, details: "Skipped self-bill" });
            break;
          }
          // Auto-bill-parser disabled per classify-then-parse architecture —
          // Majid manually classifies in /inbox; the manual path calls
          // processBillThread directly. Auto-action only parks the event.
          await prisma.ingestionEvent.update({
            where: { id: event.id },
            data: {
              status: "NEEDS_TRIAGE",
              errorMessage: "Auto-bill-parser disabled — awaiting manual classify in /inbox",
            },
          });
          results.push({ eventId: event.id, action: "BILL_DOCUMENT", success: true, details: "Parked for manual classify" });
          break;
        }
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

export function extractPONumber(subject: string, text: string): string | null {
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

export async function handlePODocument(eventId: string, subject: string, text: string, fromEmail: string, fromName: string): Promise<ActionResult> {
  // 1. Load all PDF text (embedded + on-disk attachments)
  const pdfText = await loadEventPdfText(eventId, text);

  // 2. Try template parsers first (fast, deterministic, free). Yesss is wired;
  //    add more here (BES, Wolseley etc) as templates land. If no template
  //    matches, fall through to the AI fallback.
  let parsedYesss: ParsedYesssPO | null = null;
  let parsedAI: ParsedAIPO | null = null;
  if (pdfText) parsedYesss = parseYesssPoText(pdfText);

  // Defensive: if the PDF parses as a PO whose "Supplier" header names someone
  // other than Cromwell, it's not a sales PO to us.
  if (parsedYesss && parsedYesss.direction === "OUTBOUND_REFLECTION") {
    await prisma.ingestionEvent.update({
      where: { id: eventId },
      data: { status: "DISMISSED", errorMessage: `PO PDF names Cromwell as raiser, not supplier — skipped CustomerPO creation` },
    });
    return { eventId, action: "PO_DOCUMENT", success: true, details: `${parsedYesss.poNo} — outbound reflection, not a sales PO` };
  }

  if (!parsedYesss && pdfText) {
    parsedAI = await parsePOWithAI(pdfText);
  }

  // Unified view so downstream code doesn't care about the source
  const parsed: {
    poNo: string;
    poDate: string | null;
    issuer: string | null;
    totalExVat: number;
    lines: Array<{ productCode: string; description: string; qty: number; unitPrice: number; lineTotal: number }>;
    quoteRefCandidate: string | null;
    branch: string;
    source: "YESSS_TEMPLATE" | "AI_PARSER";
    confidence: "HIGH" | "MEDIUM" | "LOW";
  } | null = parsedYesss
    ? {
        poNo: parsedYesss.poNo,
        poDate: parsedYesss.poDate,
        issuer: parsedYesss.issuer,
        totalExVat: parsedYesss.totalExVat,
        lines: parsedYesss.lines,
        quoteRefCandidate: parsedYesss.quoteRefCandidate,
        branch: parsedYesss.branch,
        source: "YESSS_TEMPLATE",
        confidence: "HIGH",
      }
    : parsedAI
      ? {
          poNo: parsedAI.poNo,
          poDate: parsedAI.poDate,
          issuer: parsedAI.issuer,
          totalExVat: parsedAI.totalExVat,
          lines: parsedAI.lines,
          quoteRefCandidate: parsedAI.quoteRefCandidate,
          branch: parsedAI.customerName || "AI",
          source: "AI_PARSER",
          confidence: parsedAI.confidence,
        }
      : null;

  // 3. Extract PO number — parser-first, fallback to regex over subject/body
  const poNo = parsed?.poNo ?? extractPONumber(subject, pdfText || text);

  // 4. Ticket resolution priority:
  //    a. Q-number from the PDF (our quote reference — strongest signal)
  //    b. Existing context match (site/customer/keywords)
  const qRef = parsed?.quoteRefCandidate
    ?? (pdfText || text).match(/Q-(\d{10,})/)?.[0]
    ?? subject.match(/Q-(\d{10,})/)?.[0]
    ?? null;
  let ticketId: string | null = null;
  let linkSource: "QUOTE" | "CONTEXT" | "NONE" = "NONE";
  if (qRef) {
    const quote = await prisma.quote.findFirst({
      where: { quoteNo: qRef },
      orderBy: { versionNo: "desc" },
      select: { ticketId: true },
    });
    if (quote) { ticketId = quote.ticketId; linkSource = "QUOTE"; }
  }
  if (!ticketId) {
    ticketId = await findTicketByContext(subject, pdfText || text, fromEmail);
    if (ticketId) linkSource = "CONTEXT";
  }

  // 5. Customer resolution — sender domain, then name fallback. No auto-create:
  //    unknown senders park in ReviewQueue (UNRESOLVED_CUSTOMER) for triage.
  const domain = fromEmail.split("@")[1]?.replace(/\.(co\.uk|com|org)$/, "") || "";
  const customer = await prisma.customer.findFirst({
    where: { OR: [
      { name: { contains: domain, mode: "insensitive" } },
      { name: { contains: fromName.split(" ")[0], mode: "insensitive" } },
    ] },
  });
  if (!customer) {
    const rawValue = fromEmail;
    await enqueueUnresolvedParty({
      party: "CUSTOMER",
      rawValue,
      description: `PO email from "${fromName}" <${fromEmail}> (subject: "${subject}") — match to existing customer or create.`,
      entityType: "IngestionEvent",
      entityId: eventId,
    });
    await prisma.ingestionEvent.update({
      where: { id: eventId },
      data: { status: "NEEDS_TRIAGE" },
    });
    return { eventId, action: "PO_DOCUMENT", success: false, details: `Unresolved customer (${fromEmail}) — parked in ReviewQueue` };
  }

  if (!poNo) {
    await prisma.ingestionEvent.update({ where: { id: eventId }, data: { status: "ACTIONED" } });
    return { eventId, action: "PO_DOCUMENT", success: true, details: "No PO number extractable" };
  }

  // 6. Check if PO already exists (idempotent)
  const existing = await prisma.customerPO.findFirst({
    where: { poNo },
    include: { lines: true },
  });

  // Resolve site — from ticket first, then customer's single billable site
  let resolvedSiteId: string | null = null;
  if (ticketId) {
    const t = await prisma.ticket.findUnique({ where: { id: ticketId }, select: { siteId: true } });
    resolvedSiteId = t?.siteId ?? null;
  }
  if (!resolvedSiteId && customer) {
    const links = await prisma.siteCommercialLink.findMany({
      where: { customerId: customer.id, isActive: true, billingAllowed: true },
      orderBy: [{ defaultBillingCustomer: "desc" }],
      select: { siteId: true },
    });
    if (links.length === 1) resolvedSiteId = links[0].siteId;
  }

  if (!resolvedSiteId) {
    // Can't proceed without a site — park a review task
    const anyTicket = await prisma.ticket.findFirst({ orderBy: { createdAt: "desc" } });
    if (anyTicket) {
      await prisma.task.create({
        data: {
          ticketId: anyTicket.id,
          taskType: "LINK_PO",
          priority: "HIGH",
          status: "OPEN",
          generatedReason: `Customer PO ${poNo} from ${fromName} (${fromEmail}) — site could not be resolved automatically.`,
        },
      });
    }
    await prisma.ingestionEvent.update({ where: { id: eventId }, data: { status: "ACTIONED" } });
    return { eventId, action: "PO_DOCUMENT", success: true, details: `PO ${poNo} — site unresolved, review task raised` };
  }

  // 7. Create or enrich CustomerPO
  let po = existing;
  if (!po) {
    po = await prisma.customerPO.create({
      data: {
        poNo,
        poType: "STANDARD_FIXED",
        customerId: customer.id,
        siteId: resolvedSiteId,
        ticketId: ticketId || undefined,
        status: "RECEIVED",
        poDate: parsed?.poDate ? new Date(parsed.poDate) : null,
        poLimitValue: parsed?.totalExVat ?? null,
        issuedBy: parsed?.issuer || fromName,
        notes: parsed
          ? `Auto-parsed from ${parsed.branch} PO PDF. Issued by ${parsed.issuer} on ${parsed.poDate}.`
          : `Auto-created from email: ${subject} (${fromName} <${fromEmail}>)`,
      },
      include: { lines: true },
    });
  } else if (parsed && !existing!.poLimitValue) {
    // Shell exists (from an earlier run before parsing was enabled) — backfill
    po = await prisma.customerPO.update({
      where: { id: existing!.id },
      data: {
        poDate: parsed.poDate ? new Date(parsed.poDate) : existing!.poDate,
        poLimitValue: parsed.totalExVat,
        issuedBy: parsed.issuer || existing!.issuedBy,
        ticketId: ticketId || existing!.ticketId,
      },
      include: { lines: true },
    });
  }

  // 8. If we have parsed lines and the PO has none, create TicketLines +
  //    CustomerPOLines in one pass. LOW-confidence AI parses skip auto-
  //    creation — they land as a shell with a review task attached so the
  //    user can verify before money-side effects fire.
  let linesCreated = 0;
  const autoCreateAllowed = parsed && parsed.confidence !== "LOW";
  if (parsed && parsed.confidence === "LOW" && ticketId) {
    await prisma.task.create({
      data: {
        ticketId,
        taskType: "REVIEW_AUTO_PO",
        priority: "HIGH",
        status: "OPEN",
        generatedReason: `PO ${poNo} parsed by AI with LOW confidence — lines not auto-created. Review the PDF and populate manually.`,
      },
    });
  }
  if (parsed && autoCreateAllowed && po!.lines.length === 0 && ticketId) {
    for (const pl of parsed.lines) {
      const tl = await prisma.ticketLine.create({
        data: {
          ticketId,
          lineType: "MATERIAL",
          description: pl.description,
          productCode: pl.productCode || null,
          qty: pl.qty,
          unit: "EA",
          siteId: resolvedSiteId,
          payingCustomerId: customer.id,
          status: "ORDERED",
          actualSaleUnit: pl.unitPrice,
          actualSaleTotal: Math.round(pl.unitPrice * pl.qty * 100) / 100,
        },
      });
      await prisma.customerPOLine.create({
        data: {
          customerPOId: po!.id,
          ticketLineId: tl.id,
          description: pl.productCode ? `${pl.productCode} — ${pl.description}` : pl.description,
          qty: pl.qty,
          agreedUnitPrice: pl.unitPrice,
          agreedTotal: Math.round(pl.unitPrice * pl.qty * 100) / 100,
          remainingQty: pl.qty,
          remainingValue: Math.round(pl.unitPrice * pl.qty * 100) / 100,
        },
      });
      linesCreated++;
    }
  }

  // 9. Transition ticket QUOTED → ORDERED (only on quote-linked POs, to avoid
  //    forcing stub tickets out of PRICING prematurely)
  let draftCount = 0;
  if (ticketId && linkSource === "QUOTE") {
    await prisma.ticket.update({
      where: { id: ticketId },
      data: { status: "ORDERED", orderedAt: new Date() },
    }).catch(() => { /* ignore if the status enum value isn't ORDERED for this ticket mode */ });

    // 9b. Auto-generate DRAFT supplier POs for every line with a winning price
    try {
      const drafts = await generateSupplierPODrafts(ticketId);
      draftCount = drafts.drafts.length;
    } catch (err) {
      console.warn(`[auto-action] generateSupplierPODrafts failed for ${ticketId}:`, err);
    }
  }

  // 10. Timeline event on the ticket
  if (ticketId) {
    await prisma.event.create({
      data: {
        ticketId,
        eventType: "PO_RECEIVED",
        timestamp: new Date(),
        notes: `Customer PO ${poNo} received from ${fromName}${linkSource === "QUOTE" ? ` against ${qRef}` : ""}. ${linesCreated} lines auto-created.`,
      },
    });
  }

  // If no ticket linked, raise a review task so user can assign
  if (!ticketId) {
    const anyTicket = await prisma.ticket.findFirst({ orderBy: { createdAt: "desc" } });
    if (anyTicket) {
      await prisma.task.create({
        data: {
          ticketId: anyTicket.id,
          taskType: "LINK_PO",
          priority: "MEDIUM",
          status: "OPEN",
          generatedReason: `Customer PO ${poNo} received from ${fromName} — needs linking to correct ticket`,
        },
      });
    }
  }

  await prisma.ingestionEvent.update({ where: { id: eventId }, data: { status: "ACTIONED" } });

  const summary = parsed
    ? `PO ${poNo} — ${parsed.source} · ${parsed.branch} · ${parsed.lines.length} lines £${parsed.totalExVat.toFixed(2)} · confidence=${parsed.confidence} · ticket ${ticketId ? (linkSource === "QUOTE" ? `linked via ${qRef}` : "context-linked") : "review task"} · ${linesCreated} lines created · ${draftCount} supplier PO draft(s)`
    : `PO ${poNo} — shell only (PDF not parseable) · ticket ${ticketId ? "linked" : "review task"}`;
  return { eventId, action: "PO_DOCUMENT", success: true, details: summary };
}

/**
 * Load all PDF text for an ingestion event: first from the extractedText
 * (embedded attachment markers), then from on-disk email-attachments keyed
 * by the event id prefix.
 *
 * Returns empty string if nothing found.
 */
async function loadEventPdfText(eventId: string, extractedText: string): Promise<string> {
  // Option A — embedded after "--- filename ---" marker from the parsed message
  let out = "";
  const attachmentMarker = extractedText.indexOf("--- ");
  if (attachmentMarker >= 0) out += extractedText.substring(attachmentMarker);

  // Option B — on-disk PDFs keyed by the event id prefix
  const attachDir = path.join(process.cwd(), "public", "email-attachments");
  if (fs.existsSync(attachDir)) {
    const eventPrefix = eventId.slice(0, 8);
    const pdfs = fs.readdirSync(attachDir).filter(
      (f) => f.startsWith(eventPrefix) && f.toLowerCase().endsWith(".pdf"),
    );
    for (const pdfFile of pdfs) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const pdfParse = require("pdf-parse/lib/pdf-parse");
        const buffer = fs.readFileSync(path.join(attachDir, pdfFile));
        const { text: pdfTxt } = await pdfParse(buffer);
        out += `\n--- ${pdfFile} ---\n${pdfTxt || ""}`;
      } catch {
        // skip unreadable PDFs
      }
    }
  }
  return out;
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
        generatedReason: `Dispute/issue from ${fromName}: ${subject.substring(0, 150)}`,
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

// ─── Supplier Matching ─────────────────────────────────────────────────────

/**
 * Match an email sender to a known supplier.
 *
 * Checks email domain, fromName, and subject against the Supplier table.
 * Also handles known aliases (e.g. verdis/fwhipkin → F W Hipkin).
 *
 * Returns { supplierId, supplierName } or null if no match found.
 */
async function matchSupplierFromEmail(
  fromEmail: string,
  fromName: string,
  subject: string
): Promise<{ supplierId: string; supplierName: string } | null> {
  const domain = (fromEmail.split("@")[1] || "").toLowerCase();
  const domainBase = domain.replace(/\.(co\.uk|com|org|net|ltd|uk)$/g, "").replace(/\./g, " ");
  const combined = `${fromName} ${subject} ${domainBase}`.toLowerCase();

  // Known alias mappings — domain fragments → canonical supplier name fragments
  const ALIASES: Record<string, string[]> = {
    "f w hipkin": ["verdis", "fwhipkin", "hipkin"],
    "wolseley": ["wolseley", "plumb center", "plumbcenter"],
    "city plumbing": ["cityplumbing", "city plumbing"],
    "graham": ["?"/* placeholder — add real patterns as discovered */],
  };

  const suppliers = await prisma.supplier.findMany({ select: { id: true, name: true, email: true } });

  // Strategy 1: Direct match on supplier email domain
  if (domain) {
    for (const s of suppliers) {
      if (s.email && s.email.toLowerCase().includes(domain)) {
        return { supplierId: s.id, supplierName: s.name };
      }
    }
  }

  // Strategy 2: Supplier name words appear in domain/fromName/subject
  for (const s of suppliers) {
    const nameWords = s.name.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    const matchCount = nameWords.filter(
      (w) => combined.includes(w) || domainBase.includes(w)
    ).length;
    // Need at least 2 word hits, or 1 hit if the supplier name is a single word
    if (matchCount >= 2 || (matchCount >= 1 && nameWords.length <= 2)) {
      return { supplierId: s.id, supplierName: s.name };
    }
  }

  // Strategy 3: Known aliases
  for (const [canonicalFragment, aliases] of Object.entries(ALIASES)) {
    const aliasHit = aliases.some(
      (a) => combined.includes(a) || domainBase.includes(a)
    );
    if (aliasHit) {
      const supplier = suppliers.find((s) =>
        s.name.toLowerCase().includes(canonicalFragment)
      );
      if (supplier) {
        return { supplierId: supplier.id, supplierName: supplier.name };
      }
    }
  }

  // Strategy 4: Domain base directly matches a supplier name (fuzzy)
  if (domainBase.length >= 3) {
    for (const s of suppliers) {
      const lowerName = s.name.toLowerCase();
      if (lowerName.includes(domainBase) || domainBase.includes(lowerName.split(" ")[0])) {
        return { supplierId: s.id, supplierName: s.name };
      }
    }
  }

  return null;
}

// ─── Bill Document Handler ─────────────────────────────────────────────────

async function handleBillDocument(
  eventId: string,
  subject: string,
  text: string,
  fromEmail: string,
  fromName: string,
  structuredData: Record<string, any>
): Promise<ActionResult> {
  // The extractedText from ParsedMessage already contains PDF text (appended
  // by processEmailAttachments during Outlook sync or backfill). The text
  // variable passed in is that extractedText. We also check for on-disk
  // PDF files saved under public/email-attachments/.

  let pdfText = "";

  // Option A: The extractedText already includes attachment text markers
  // (the Outlook sync appends "--- filename.pdf ---\n<text>" blocks).
  const attachmentMarker = text.indexOf("--- ");
  if (attachmentMarker !== -1) {
    pdfText = text.substring(attachmentMarker);
  }

  // Option B: If no embedded PDF text, try reading from disk.
  // The backfill route saves files as <eventId-prefix>_<filename>.pdf
  // under public/email-attachments/.
  if (!pdfText) {
    const attachDir = path.join(process.cwd(), "public", "email-attachments");
    const eventPrefix = eventId.slice(0, 8);
    try {
      if (fs.existsSync(attachDir)) {
        const files = fs.readdirSync(attachDir);
        const pdfs = files.filter(
          (f) => f.startsWith(eventPrefix) && f.toLowerCase().endsWith(".pdf")
        );
        for (const pdfFile of pdfs) {
          try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports
            const pdfParse = require("pdf-parse/lib/pdf-parse");
            const buffer = fs.readFileSync(path.join(attachDir, pdfFile));
            const parsed = await pdfParse(buffer);
            pdfText += `\n--- ${pdfFile} ---\n${parsed.text || ""}`;
          } catch (pdfErr) {
            console.warn(`[auto-action] PDF parse failed for ${pdfFile}:`, pdfErr);
          }
        }
      }
    } catch {
      // Disk read failed — continue with what we have
    }
  }

  // If we still have no PDF text, fall back to the full extractedText body
  // (the classifier saw bill keywords in the body itself).
  const billText = pdfText || text;

  if (!billText.trim()) {
    await prisma.ingestionEvent.update({
      where: { id: eventId },
      data: { status: "NEEDS_REVIEW", errorMessage: "BILL_DOCUMENT classified but no text extractable" },
    });
    await createBillNeedsReviewTask(
      eventId, subject, fromEmail, fromName,
      "no PDF text could be extracted from the email attachment",
    );
    return {
      eventId,
      action: "BILL_DOCUMENT",
      success: false,
      details: "No extractable text found for bill",
    };
  }

  // Parse the bill text
  const parsed = parseBillText(billText);

  if (parsed.lines.length === 0 && !parsed.billNo) {
    await prisma.ingestionEvent.update({
      where: { id: eventId },
      data: { status: "NEEDS_REVIEW", errorMessage: "Bill text parsed but no lines or bill number found" },
    });
    await createBillNeedsReviewTask(
      eventId, subject, fromEmail, fromName,
      "bill parser returned no line items and no bill number",
    );
    return {
      eventId,
      action: "BILL_DOCUMENT",
      success: false,
      details: "Bill parser returned no lines and no bill number",
    };
  }

  // Match supplier from email
  const supplierMatch = await matchSupplierFromEmail(fromEmail, fromName, subject);

  if (!supplierMatch) {
    await prisma.ingestionEvent.update({
      where: { id: eventId },
      data: {
        status: "NEEDS_REVIEW",
        errorMessage: `No supplier match for ${fromName} <${fromEmail}>. Bill: ${parsed.billNo || "unknown"}`,
      },
    });
    await createBillNeedsReviewTask(
      eventId, subject, fromEmail, fromName,
      `no supplier match for ${fromName || fromEmail || "sender"} (parsed billNo: ${parsed.billNo || "unknown"})`,
    );
    return {
      eventId,
      action: "BILL_DOCUMENT",
      success: false,
      details: `No supplier match for ${fromEmail}. Parsed billNo: ${parsed.billNo || "unknown"}, ${parsed.lines.length} lines`,
    };
  }

  // Idempotency — check if bill already exists for this supplier + billNo
  const billNo = parsed.billNo || `AUTO-${eventId.slice(0, 8)}`;
  const existingBill = await prisma.supplierBill.findFirst({
    where: { supplierId: supplierMatch.supplierId, billNo },
  });

  if (existingBill) {
    // Already processed — just mark as actioned
    await prisma.ingestionEvent.update({
      where: { id: eventId },
      data: { status: "ACTIONED" },
    });
    return {
      eventId,
      action: "BILL_DOCUMENT",
      success: true,
      details: `Bill ${billNo} already exists (${existingBill.id}) for ${supplierMatch.supplierName} — skipped duplicate`,
    };
  }

  // Create the SupplierBill + lines
  const totalCost = parsed.grandTotal ?? parsed.lines.reduce((sum, l) => sum + l.lineTotal, 0);
  const billDate = parsed.billDate ? new Date(parsed.billDate) : new Date();

  const bill = await prisma.$transaction(async (tx) => {
    const created = await tx.supplierBill.create({
      data: {
        supplierId: supplierMatch.supplierId,
        billNo,
        billDate,
        status: "PENDING",
        totalCost,
        customerRef: parsed.customerRef ?? undefined,
        siteRef: parsed.siteRef ?? undefined,
        sourceAttachmentRef: `ingestion:${eventId}`,
      },
    });

    if (parsed.lines.length > 0) {
      await tx.supplierBillLine.createMany({
        data: parsed.lines.map((line) => ({
          supplierBillId: created.id,
          description: line.description,
          productCode: line.productCode,
          qty: line.qty,
          unitCost: line.unitCost,
          lineTotal: line.lineTotal,
          vatAmount: line.vatAmount,
          costClassification: "BILLABLE" as const,
          allocationStatus: "UNALLOCATED" as const,
        })),
      });
    }

    return created;
  });

  // Run the bill processor (AP journal + auto-match to ticket lines)
  let processingDetails = "";
  try {
    const result = await processBill(bill.id);
    processingDetails = `journal: ${result.journalEntryId ? "created" : "skipped"}, matched: ${result.matchSummary.matched}/${result.matchSummary.totalLines} lines`;
    if (result.errors.length > 0) {
      processingDetails += `, warnings: ${result.errors.join("; ")}`;
    }
  } catch (procErr) {
    processingDetails = `processBill error: ${procErr instanceof Error ? procErr.message : "unknown"}`;
    console.error(`[auto-action] processBill failed for ${bill.id}:`, procErr);
  }

  // Mark event as actioned
  await prisma.ingestionEvent.update({
    where: { id: eventId },
    data: { status: "ACTIONED" },
  });

  return {
    eventId,
    action: "BILL_DOCUMENT",
    success: true,
    details: `Bill ${billNo} created (${bill.id}) for ${supplierMatch.supplierName}. ${parsed.lines.length} lines, total £${totalCost.toFixed(2)}. ${processingDetails}`,
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
