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
import fs from "fs";
import path from "path";

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
        case "BILL_DOCUMENT":
          results.push(await handleBillDocument(event.id, subject, text, fromEmail, fromName, data));
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
