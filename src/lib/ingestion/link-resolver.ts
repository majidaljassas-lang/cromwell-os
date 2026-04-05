/**
 * LinkResolver — Automatic linking of inbound communications to work items
 *
 * Every enquiry/ticket/order/backlog job acts as a persistent anchor.
 * On each new inbound event, the resolver scores against all active anchors.
 *
 * Signals (weighted):
 *   1. Sender phone/email match          (+30)
 *   2. Contact / sender name match       (+20)
 *   3. Customer match                    (+15)
 *   4. Site match                        (+25)
 *   5. Subject / thread continuity       (+15)
 *   6. Reference number (quote/ticket/inv) (+35)
 *   7. Product overlap                   (+10)
 *   8. Timeline proximity (last 72h)     (+10)
 *   9. Prior conversation history        (+15)
 *
 * Output:
 *   score >= 70 → LINKED_HIGH_CONFIDENCE  (auto-link)
 *   score >= 40 → LINKED_MEDIUM_CONFIDENCE (provisional link + review task)
 *   score >= 20 → NEEDS_REVIEW            (review queue, no link)
 *   score < 20  → NEW_ENQUIRY_CANDIDATE   (potential new enquiry)
 */

import { prisma } from "@/lib/prisma";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface InboundEventInput {
  eventType: string;
  sourceType: string;
  sender?: string | null;
  senderPhone?: string | null;
  senderEmail?: string | null;
  receivedAt: Date;
  rawText?: string | null;
  subject?: string | null;
  attachmentRef?: string | null;
  ingestionEventId?: string | null;
  backlogMessageId?: string | null;
  mediaEvidenceId?: string | null;
}

export interface LinkCandidate {
  entityType: "Ticket" | "Enquiry" | "OrderGroup" | "BacklogCase";
  entityId: string;
  label: string;
  score: number;
  reasons: string[];
  siteId: string | null;
  customerId: string | null;
}

export interface LinkResult {
  inboundEventId: string;
  linkStatus: "LINKED_HIGH" | "LINKED_MEDIUM" | "NEEDS_REVIEW" | "NEW_ENQUIRY_CANDIDATE";
  linkConfidence: number;
  linkReasons: string[];
  linkedEntityType: string | null;
  linkedEntityId: string | null;
  linkedTicketId: string | null;
  linkedEnquiryId: string | null;
  linkedOrderGroupId: string | null;
  linkedBacklogCaseId: string | null;
  provisionalLink: boolean;
  allCandidates: LinkCandidate[];
}

// ─── Signal weights ─────────────────────────────────────────────────────────

const WEIGHTS = {
  SENDER_PHONE_EMAIL: 30,
  SENDER_NAME: 20,
  CUSTOMER: 15,
  SITE: 25,
  SUBJECT_THREAD: 15,
  REFERENCE_NUMBER: 35,
  PRODUCT_OVERLAP: 10,
  TIMELINE_PROXIMITY: 10,
  PRIOR_CONVERSATION: 15,
};

// ─── Reference patterns ─────────────────────────────────────────────────────

const REF_PATTERNS = [
  { pattern: /\bTK[-#]?\s*(\d{3,})/i, type: "ticket" },
  { pattern: /\bENQ[-#]?\s*(\d{3,})/i, type: "enquiry" },
  { pattern: /\bQU[-#]?\s*(\d{3,})/i, type: "quote" },
  { pattern: /\bINV[-#]?\s*(\d{3,})/i, type: "invoice" },
  { pattern: /\bPO[-#]?\s*(\d{3,})/i, type: "po" },
  { pattern: /\bA\d{10,}/i, type: "selco_order" },
];

// ─── Core Resolver ──────────────────────────────────────────────────────────

export async function resolveLink(input: InboundEventInput): Promise<LinkResult> {
  // Create the InboundEvent record
  const inboundEvent = await prisma.inboundEvent.create({
    data: {
      eventType: input.eventType as any,
      sourceType: input.sourceType as any,
      sender: input.sender,
      senderPhone: input.senderPhone,
      senderEmail: input.senderEmail,
      receivedAt: input.receivedAt,
      rawText: input.rawText,
      subject: input.subject,
      attachmentRef: input.attachmentRef,
      linkStatus: "UNPROCESSED",
      ingestionEventId: input.ingestionEventId,
      backlogMessageId: input.backlogMessageId,
      mediaEvidenceId: input.mediaEvidenceId,
    },
  });

  // Gather all active anchors
  const candidates: LinkCandidate[] = [];

  // Score against tickets
  const tickets = await prisma.ticket.findMany({
    where: { status: { notIn: ["CLOSED"] } },
    include: {
      site: true,
      payingCustomer: true,
      requestedByContact: true,
      actingOnBehalfOfContact: true,
      lines: { take: 20, select: { normalizedItemName: true, productCode: true } },
    },
    take: 100,
  });

  for (const ticket of tickets) {
    const { score, reasons } = scoreAgainstTicket(input, ticket);
    if (score > 0) {
      candidates.push({
        entityType: "Ticket",
        entityId: ticket.id,
        label: ticket.title,
        score,
        reasons,
        siteId: ticket.siteId,
        customerId: ticket.payingCustomerId,
      });
    }
  }

  // Score against enquiries
  const enquiries = await prisma.enquiry.findMany({
    where: { status: { notIn: ["CONVERTED", "CLOSED_LOST", "CLOSED_NO_ACTION"] } },
    include: {
      sourceContact: true,
      suggestedSite: true,
      suggestedCustomer: true,
    },
    take: 100,
  });

  for (const enquiry of enquiries) {
    const { score, reasons } = scoreAgainstEnquiry(input, enquiry);
    if (score > 0) {
      candidates.push({
        entityType: "Enquiry",
        entityId: enquiry.id,
        label: enquiry.subjectOrLabel || "Enquiry",
        score,
        reasons,
        siteId: enquiry.suggestedSiteId,
        customerId: enquiry.suggestedCustomerId,
      });
    }
  }

  // Score against order groups
  const orderGroups = await prisma.orderGroup.findMany({
    where: {
      closureStatus: { not: "CLOSED" },
      approvalStatus: { in: ["AUTO_APPROVED", "APPROVED", "PENDING_REVIEW"] },
    },
    include: {
      site: true,
      orderEvents: { take: 10, include: { canonicalProduct: true } },
    },
    take: 100,
  });

  for (const group of orderGroups) {
    const { score, reasons } = scoreAgainstOrderGroup(input, group);
    if (score > 0) {
      candidates.push({
        entityType: "OrderGroup",
        entityId: group.id,
        label: group.label,
        score,
        reasons,
        siteId: group.siteId,
        customerId: group.customerId,
      });
    }
  }

  // Score against backlog cases
  const backlogCases = await prisma.backlogCase.findMany({
    where: { status: "ACTIVE" },
    include: { site: true },
    take: 20,
  });

  for (const bc of backlogCases) {
    const { score, reasons } = scoreAgainstBacklogCase(input, bc);
    if (score > 0) {
      candidates.push({
        entityType: "BacklogCase",
        entityId: bc.id,
        label: bc.name,
        score,
        reasons,
        siteId: bc.siteId,
        customerId: null,
      });
    }
  }

  // Sort by score descending
  candidates.sort((a, b) => b.score - a.score);

  // Determine link status
  const best = candidates[0];
  let linkStatus: LinkResult["linkStatus"] = "NEW_ENQUIRY_CANDIDATE";
  let provisionalLink = false;

  if (best) {
    if (best.score >= 70) linkStatus = "LINKED_HIGH";
    else if (best.score >= 40) { linkStatus = "LINKED_MEDIUM"; provisionalLink = true; }
    else if (best.score >= 20) linkStatus = "NEEDS_REVIEW";
  }

  // Build result
  const result: LinkResult = {
    inboundEventId: inboundEvent.id,
    linkStatus,
    linkConfidence: best?.score || 0,
    linkReasons: best?.reasons || [],
    linkedEntityType: best && linkStatus !== "NEW_ENQUIRY_CANDIDATE" ? best.entityType : null,
    linkedEntityId: best && linkStatus !== "NEW_ENQUIRY_CANDIDATE" ? best.entityId : null,
    linkedTicketId: best?.entityType === "Ticket" && linkStatus !== "NEW_ENQUIRY_CANDIDATE" ? best.entityId : null,
    linkedEnquiryId: best?.entityType === "Enquiry" && linkStatus !== "NEW_ENQUIRY_CANDIDATE" ? best.entityId : null,
    linkedOrderGroupId: best?.entityType === "OrderGroup" && linkStatus !== "NEW_ENQUIRY_CANDIDATE" ? best.entityId : null,
    linkedBacklogCaseId: best?.entityType === "BacklogCase" && linkStatus !== "NEW_ENQUIRY_CANDIDATE" ? best.entityId : null,
    provisionalLink,
    allCandidates: candidates.slice(0, 10),
  };

  // Persist link resolution
  await prisma.inboundEvent.update({
    where: { id: inboundEvent.id },
    data: {
      linkStatus: result.linkStatus as any,
      linkConfidence: result.linkConfidence,
      linkReasons: result.linkReasons,
      linkedEntityType: result.linkedEntityType,
      linkedEntityId: result.linkedEntityId,
      linkedTicketId: result.linkedTicketId,
      linkedEnquiryId: result.linkedEnquiryId,
      linkedOrderGroupId: result.linkedOrderGroupId,
      linkedBacklogCaseId: result.linkedBacklogCaseId,
      provisionalLink: result.provisionalLink,
      siteId: best?.siteId || null,
      customerId: best?.customerId || null,
    },
  });

  // Create review task for provisional links
  if (provisionalLink) {
    await prisma.reviewQueueItem.create({
      data: {
        queueType: "MISSING_ORDER_EVIDENCE",
        status: "OPEN_REVIEW",
        description: `Provisional link: "${input.sender}" → ${best!.entityType} "${best!.label}" (score ${best!.score}). Reasons: ${best!.reasons.join(", ")}`,
        siteId: best?.siteId,
        entityId: inboundEvent.id,
        entityType: "InboundEvent",
      },
    });

    await prisma.inboundEvent.update({
      where: { id: inboundEvent.id },
      data: { reviewTaskCreated: true },
    });
  }

  return result;
}

// ─── Scoring functions ──────────────────────────────────────────────────────

function scoreAgainstTicket(
  input: InboundEventInput,
  ticket: any
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  const text = (input.rawText || "") + " " + (input.subject || "");

  // Sender match via contacts
  if (input.sender && ticket.requestedByContact) {
    if (fuzzyNameMatch(input.sender, ticket.requestedByContact.fullName)) {
      score += WEIGHTS.SENDER_NAME;
      reasons.push(`Sender "${input.sender}" matches contact "${ticket.requestedByContact.fullName}"`);
    }
  }
  if (input.sender && ticket.actingOnBehalfOfContact) {
    if (fuzzyNameMatch(input.sender, ticket.actingOnBehalfOfContact.fullName)) {
      score += WEIGHTS.SENDER_NAME;
      reasons.push(`Sender matches acting contact`);
    }
  }

  // Phone match
  if (input.senderPhone && ticket.requestedByContact?.phone) {
    if (normalizePhone(input.senderPhone) === normalizePhone(ticket.requestedByContact.phone)) {
      score += WEIGHTS.SENDER_PHONE_EMAIL;
      reasons.push("Phone number match");
    }
  }

  // Site match
  if (ticket.site && input.rawText) {
    if (textMentionsSite(text, ticket.site.siteName, ticket.site.aliases || [])) {
      score += WEIGHTS.SITE;
      reasons.push(`Text references site "${ticket.site.siteName}"`);
    }
  }

  // Customer match
  if (ticket.payingCustomer && input.rawText) {
    if (text.toLowerCase().includes(ticket.payingCustomer.name.toLowerCase().slice(0, 10))) {
      score += WEIGHTS.CUSTOMER;
      reasons.push(`Text references customer "${ticket.payingCustomer.name}"`);
    }
  }

  // Reference number match
  const refs = extractReferences(text);
  if (refs.length > 0) {
    score += WEIGHTS.REFERENCE_NUMBER;
    reasons.push(`Reference found: ${refs.join(", ")}`);
  }

  // Product overlap
  if (ticket.lines && input.rawText) {
    const ticketProducts = ticket.lines
      .map((l: any) => l.normalizedItemName || l.productCode)
      .filter(Boolean);
    const overlap = ticketProducts.some((p: string) =>
      text.toLowerCase().includes(p.toLowerCase().slice(0, 8))
    );
    if (overlap) {
      score += WEIGHTS.PRODUCT_OVERLAP;
      reasons.push("Product overlap with ticket lines");
    }
  }

  // Timeline proximity (within 72h of ticket creation or last update)
  const hoursSinceTicket = (input.receivedAt.getTime() - new Date(ticket.updatedAt).getTime()) / (1000 * 60 * 60);
  if (Math.abs(hoursSinceTicket) <= 72) {
    score += WEIGHTS.TIMELINE_PROXIMITY;
    reasons.push("Within 72h of ticket activity");
  }

  return { score, reasons };
}

function scoreAgainstEnquiry(
  input: InboundEventInput,
  enquiry: any
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  const text = (input.rawText || "") + " " + (input.subject || "");

  // Sender match
  if (input.sender && enquiry.sourceContact) {
    if (fuzzyNameMatch(input.sender, enquiry.sourceContact.fullName)) {
      score += WEIGHTS.SENDER_NAME;
      reasons.push(`Sender matches enquiry contact`);
    }
  }

  // Site match
  if (enquiry.suggestedSite && input.rawText) {
    if (textMentionsSite(text, enquiry.suggestedSite.siteName, enquiry.suggestedSite.aliases || [])) {
      score += WEIGHTS.SITE;
      reasons.push(`Text references site "${enquiry.suggestedSite.siteName}"`);
    }
  }

  // Subject/thread continuity
  if (enquiry.channelThreadRef && input.subject) {
    if (input.subject.includes(enquiry.channelThreadRef)) {
      score += WEIGHTS.SUBJECT_THREAD;
      reasons.push("Thread reference match");
    }
  }

  // Raw text similarity to enquiry text
  if (enquiry.rawText && input.rawText) {
    const overlap = textOverlapScore(enquiry.rawText, input.rawText);
    if (overlap > 0.3) {
      score += WEIGHTS.PRIOR_CONVERSATION;
      reasons.push("Text content similarity with enquiry");
    }
  }

  return { score, reasons };
}

function scoreAgainstOrderGroup(
  input: InboundEventInput,
  group: any
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  const text = (input.rawText || "") + " " + (input.subject || "");

  // Sender match
  if (input.sender && group.primarySender) {
    if (fuzzyNameMatch(input.sender, group.primarySender)) {
      score += WEIGHTS.SENDER_NAME;
      reasons.push(`Sender matches order group contact "${group.primarySender}"`);
    }
  }

  // Site match
  if (group.site && input.rawText) {
    if (textMentionsSite(text, group.site.siteName, group.site.aliases || [])) {
      score += WEIGHTS.SITE;
      reasons.push(`Text references site "${group.site.siteName}"`);
    }
  }

  // Product overlap
  if (group.orderEvents && input.rawText) {
    const groupProducts = group.orderEvents
      .map((e: any) => e.canonicalProduct?.code)
      .filter(Boolean);
    const textLower = text.toLowerCase();
    const overlap = groupProducts.some((p: string) =>
      textLower.includes(p.toLowerCase().replace(/_/g, " ").slice(0, 8))
    );
    if (overlap) {
      score += WEIGHTS.PRODUCT_OVERLAP;
      reasons.push("Product overlap with order group");
    }
  }

  // Timeline proximity
  const recentEvent = group.orderEvents?.[group.orderEvents.length - 1];
  if (recentEvent) {
    const hoursSince = (input.receivedAt.getTime() - new Date(recentEvent.timestamp).getTime()) / (1000 * 60 * 60);
    if (hoursSince >= 0 && hoursSince <= 168) { // 7 days
      score += WEIGHTS.TIMELINE_PROXIMITY;
      reasons.push("Within 7 days of last order event");
    }
  }

  return { score, reasons };
}

function scoreAgainstBacklogCase(
  input: InboundEventInput,
  bc: any
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  const text = (input.rawText || "") + " " + (input.subject || "");

  // Site match
  if (bc.site && input.rawText) {
    if (textMentionsSite(text, bc.site.siteName, bc.site.aliases || [])) {
      score += WEIGHTS.SITE;
      reasons.push(`Text references backlog site "${bc.site.siteName}"`);
    }
  }

  // Name match
  if (bc.name && text.toLowerCase().includes(bc.name.toLowerCase().slice(0, 8))) {
    score += WEIGHTS.SITE;
    reasons.push(`Text references backlog case "${bc.name}"`);
  }

  return { score, reasons };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function fuzzyNameMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  const aLower = a.toLowerCase().trim();
  const bLower = b.toLowerCase().trim();
  if (aLower === bLower) return true;
  // First name match
  const aFirst = aLower.split(/\s+/)[0];
  const bFirst = bLower.split(/\s+/)[0];
  if (aFirst.length >= 3 && aFirst === bFirst) return true;
  // Contains match
  if (aLower.includes(bLower) || bLower.includes(aLower)) return true;
  return false;
}

function normalizePhone(phone: string): string {
  return phone.replace(/[\s\-\(\)\+]/g, "").replace(/^0/, "44").replace(/^44/, "");
}

function textMentionsSite(text: string, siteName: string, aliases: string[]): boolean {
  const lower = text.toLowerCase();
  if (lower.includes(siteName.toLowerCase().slice(0, 8))) return true;
  for (const alias of aliases) {
    if (lower.includes(alias.toLowerCase())) return true;
  }
  return false;
}

function extractReferences(text: string): string[] {
  const refs: string[] = [];
  for (const { pattern, type } of REF_PATTERNS) {
    const match = text.match(pattern);
    if (match) refs.push(`${type}:${match[0]}`);
  }
  return refs;
}

function textOverlapScore(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter((w) => w.length > 3));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter((w) => w.length > 3));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let overlap = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) overlap++;
  }
  return overlap / Math.min(wordsA.size, wordsB.size);
}

// ─── Batch resolver for existing messages ───────────────────────────────────

/**
 * Resolve links for a batch of existing backlog messages.
 * Used to retroactively link messages that were ingested before the resolver existed.
 */
export async function resolveBatch(
  messageIds: string[]
): Promise<{ processed: number; linked: number; review: number; newEnquiry: number }> {
  let linked = 0, review = 0, newEnquiry = 0;

  for (const msgId of messageIds) {
    const msg = await prisma.backlogMessage.findUnique({ where: { id: msgId } });
    if (!msg) continue;

    // Check if already processed
    const existing = await prisma.inboundEvent.findFirst({
      where: { backlogMessageId: msgId },
    });
    if (existing) continue;

    const result = await resolveLink({
      eventType: "WHATSAPP_MESSAGE",
      sourceType: "WHATSAPP",
      sender: msg.sender,
      receivedAt: msg.parsedTimestamp,
      rawText: msg.rawText,
      backlogMessageId: msgId,
    });

    if (result.linkStatus === "LINKED_HIGH" || result.linkStatus === "LINKED_MEDIUM") linked++;
    else if (result.linkStatus === "NEEDS_REVIEW") review++;
    else newEnquiry++;
  }

  return { processed: messageIds.length, linked, review, newEnquiry };
}
