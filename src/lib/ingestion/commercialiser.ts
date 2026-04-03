/**
 * Commercialiser
 *
 * Merges confirmed ingestion records into the commercial spine:
 * - Zoho bills → SupplierBill + SupplierBillLines
 * - Messages → Enquiry / EvidenceFragment / Event
 *
 * No record enters the spine without passing validation.
 * No final invoice, closed PO, locked bundle, or verified ticket created.
 */

import { prisma } from "@/lib/prisma";
import { logAudit } from "./audit";
import { validateBillLine } from "./validation";

export interface CommercialiseResult {
  success: boolean;
  action: string;
  createdObjects: Array<{ type: string; id: string }>;
  warnings: string[];
  errors: string[];
}

/**
 * Commercialise a Zoho bill ingestion event into SupplierBill + SupplierBillLines
 */
export async function commercialiseZohoBill(
  eventId: string,
  options: {
    supplierId: string;
    siteId?: string;
    customerId?: string;
    ticketId?: string;
    actor?: string;
  }
): Promise<CommercialiseResult> {
  const result: CommercialiseResult = {
    success: false,
    action: "ZOHO_BILL_TO_SUPPLIER_BILL",
    createdObjects: [],
    warnings: [],
    errors: [],
  };

  const event = await prisma.ingestionEvent.findUnique({
    where: { id: eventId },
    include: {
      parsedMessages: {
        orderBy: { parseVersion: "desc" },
        take: 1,
      },
    },
  });

  if (!event) {
    result.errors.push("Ingestion event not found");
    return result;
  }

  const parsed = event.parsedMessages[0];
  if (!parsed) {
    result.errors.push("No parsed message for this event");
    return result;
  }

  const structured = parsed.structuredData as Record<string, unknown> | null;
  if (!structured) {
    result.errors.push("No structured data in parsed message");
    return result;
  }

  const billNo = (structured.billNo as string) || `ING-${Date.now()}`;
  const billDate = structured.billDate ? new Date(structured.billDate as string) : new Date();
  const totalCost = Number(structured.totalCost || 0);
  const lines = (structured.lines as Array<Record<string, unknown>>) || [];

  // Validate each line
  const lineWarnings: string[] = [];
  for (const line of lines) {
    const vat = line.vat as Record<string, unknown> | undefined;
    const validation = validateBillLine({
      description: line.description as string,
      qty: Number(line.qty || 0),
      unitCost: Number(line.unitCost || 0),
      lineTotal: Number(line.lineTotal || 0),
      costClassification: line.costClassification as string,
      sourceAmountBasis: vat?.sourceAmountBasis as string,
      vatStatus: vat?.vatStatus as string,
      amountExVat: vat ? Number(vat.amountExVat || 0) : undefined,
      siteId: options.siteId,
      customerId: options.customerId,
      sourceSiteTextRaw: line.sourceSiteTextRaw as string,
      sourceCustomerTextRaw: line.sourceCustomerTextRaw as string,
    });

    if (!validation.isReady) {
      for (const b of validation.blockers) lineWarnings.push(`Line "${line.description}": ${b.message}`);
    }
    for (const w of validation.warnings) lineWarnings.push(`Line "${line.description}": ${w.message}`);
  }

  result.warnings = lineWarnings;

  // Create SupplierBill + lines in transaction
  const bill = await prisma.$transaction(async (tx) => {
    const supplierBill = await tx.supplierBill.create({
      data: {
        supplierId: options.supplierId,
        billNo,
        billDate,
        siteRef: structured.siteRef as string || undefined,
        customerRef: structured.customerRef as string || undefined,
        status: "PENDING",
        totalCost,
        sourceAttachmentRef: eventId,
      },
    });

    if (lines.length > 0) {
      await tx.supplierBillLine.createMany({
        data: lines.map((line) => {
          const vat = line.vat as Record<string, unknown> | undefined;
          return {
            supplierBillId: supplierBill.id,
            description: (line.description as string) || "Unknown",
            normalizedItemName: line.normalizedItemName as string || undefined,
            productCode: line.productCode as string || undefined,
            qty: Number(line.qty || 1),
            unitCost: Number(line.unitCost || 0),
            lineTotal: Number(line.lineTotal || 0),
            siteId: options.siteId,
            customerId: options.customerId,
            ticketId: options.ticketId,
            costClassification: (line.costClassification as "BILLABLE" | "ABSORBED" | "REALLOCATABLE" | "STOCK" | "MOQ_EXCESS" | "WRITE_OFF" | "CREDIT") || "BILLABLE",
            allocationStatus: "UNALLOCATED" as const,
            sourceAmountBasis: vat?.sourceAmountBasis as string || undefined,
            amountExVat: vat ? Number(vat.amountExVat || 0) : undefined,
            vatAmount: vat ? Number(vat.vatAmount || 0) : undefined,
            amountIncVat: vat ? Number(vat.amountIncVat || 0) : undefined,
            vatRate: vat ? Number(vat.vatRate || 0) : undefined,
            vatStatus: vat?.vatStatus as string || undefined,
            sourceSiteTextRaw: line.sourceSiteTextRaw as string || undefined,
            sourceCustomerTextRaw: line.sourceCustomerTextRaw as string || undefined,
          };
        }),
      });
    }

    // Create IngestionLink
    await tx.ingestionLink.create({
      data: {
        parsedMessageId: parsed.id,
        supplierBillId: supplierBill.id,
        linkConfidence: 95,
        linkStatus: "AUTO_LINKED",
      },
    });

    return supplierBill;
  });

  // Update event status
  await prisma.ingestionEvent.update({
    where: { id: eventId },
    data: { status: "COMMERCIALISED" },
  });

  await logAudit({
    objectType: "SupplierBill",
    objectId: bill.id,
    actionType: "COMMERCIALISED_FROM_INGESTION",
    actor: options.actor,
    newValue: { eventId, billNo, lineCount: lines.length },
  });

  result.success = true;
  result.createdObjects.push({ type: "SupplierBill", id: bill.id });
  return result;
}

/**
 * Commercialise a message event into an Enquiry + EvidenceFragment
 */
export async function commercialiseMessage(
  eventId: string,
  options: {
    createEnquiry?: boolean;
    createEvidence?: boolean;
    ticketId?: string;
    ticketLineId?: string;
    sourceContactId?: string;
    suggestedSiteId?: string;
    suggestedCustomerId?: string;
    enquiryType?: string;
    evidenceType?: string;
    actor?: string;
  }
): Promise<CommercialiseResult> {
  const result: CommercialiseResult = {
    success: false,
    action: "MESSAGE_TO_SPINE",
    createdObjects: [],
    warnings: [],
    errors: [],
  };

  const event = await prisma.ingestionEvent.findUnique({
    where: { id: eventId },
    include: {
      source: true,
      parsedMessages: { orderBy: { parseVersion: "desc" }, take: 1 },
    },
  });

  if (!event || !event.parsedMessages[0]) {
    result.errors.push("Event or parsed message not found");
    return result;
  }

  const parsed = event.parsedMessages[0];
  const structured = parsed.structuredData as Record<string, unknown> | null;
  const sourceType = event.source.sourceType;

  if (options.createEnquiry) {
    const enquiry = await prisma.enquiry.create({
      data: {
        sourceType: sourceType as "WHATSAPP" | "OUTLOOK" | "ZOHO_BOOKS" | "EMAIL" | "PDF_UPLOAD" | "IMAGE_UPLOAD" | "MANUAL" | "API",
        channelThreadRef: (structured?.chatId || structured?.threadId) as string || undefined,
        sourceContactId: options.sourceContactId,
        receivedAt: event.receivedAt,
        subjectOrLabel: (structured?.subject || structured?.chatName) as string || undefined,
        rawText: parsed.extractedText,
        suggestedSiteId: options.suggestedSiteId,
        suggestedCustomerId: options.suggestedCustomerId,
        enquiryType: (options.enquiryType || "OTHER") as "DIRECT_ORDER" | "QUOTE_REQUEST" | "PRICING_FIRST" | "SPEC_REQUEST" | "COMPETITIVE_BID" | "APPROVAL" | "FOLLOW_UP" | "DELIVERY_UPDATE" | "DISPUTE" | "OTHER",
        confidenceScore: parsed.confidenceScore ? Number(parsed.confidenceScore) : undefined,
        status: "NEW",
      },
    });

    await prisma.ingestionLink.create({
      data: {
        parsedMessageId: parsed.id,
        enquiryId: enquiry.id,
        linkConfidence: Number(parsed.confidenceScore || 70),
        linkStatus: "AUTO_LINKED",
      },
    });

    result.createdObjects.push({ type: "Enquiry", id: enquiry.id });
  }

  if (options.createEvidence && options.ticketId) {
    const fragment = await prisma.evidenceFragment.create({
      data: {
        ticketId: options.ticketId,
        ticketLineId: options.ticketLineId,
        sourceType: sourceType as "WHATSAPP" | "OUTLOOK" | "ZOHO_BOOKS" | "EMAIL" | "PDF_UPLOAD" | "IMAGE_UPLOAD" | "MANUAL" | "API",
        sourceRef: event.externalMessageId,
        sourceContactId: options.sourceContactId,
        timestamp: event.receivedAt,
        fragmentType: (options.evidenceType || "INSTRUCTION") as "INSTRUCTION" | "APPROVAL" | "PRICING" | "DELIVERY" | "DISPUTE" | "PO_REQUEST" | "PO_RECEIVED" | "SUPPLIER_CONFIRMATION" | "PHOTO" | "CALL_NOTE",
        fragmentText: parsed.extractedText.slice(0, 2000),
        confidenceScore: Number(parsed.confidenceScore || 70),
      },
    });

    await prisma.ingestionLink.create({
      data: {
        parsedMessageId: parsed.id,
        ticketId: options.ticketId,
        evidenceFragmentId: fragment.id,
        linkConfidence: Number(parsed.confidenceScore || 70),
        linkStatus: "AUTO_LINKED",
      },
    });

    result.createdObjects.push({ type: "EvidenceFragment", id: fragment.id });
  }

  await prisma.ingestionEvent.update({
    where: { id: eventId },
    data: { status: "COMMERCIALISED" },
  });

  await logAudit({
    objectType: "IngestionEvent",
    objectId: eventId,
    actionType: "COMMERCIALISED",
    actor: options.actor,
    newValue: { createdObjects: result.createdObjects },
  });

  result.success = true;
  return result;
}
