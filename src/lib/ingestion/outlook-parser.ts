/**
 * Outlook Email Parser
 *
 * Parses Outlook email payloads into structured commercial data.
 * Both inbound and sent mail are critical evidence.
 */

import { extractEntities, extractLineCandidates, extractMonetaryValues, type ParsedEntity, type ParsedLineCandidate } from "./parser";
import { classifyMessage, type MessageClassification } from "./classifier";

export interface OutlookEmailPayload {
  message_id: string;
  thread_id?: string;
  subject: string;
  from: { name?: string; email: string };
  to: Array<{ name?: string; email: string }>;
  cc?: Array<{ name?: string; email: string }>;
  sent_at: string;
  received_at?: string;
  body_text: string;
  body_html?: string;
  is_sent?: boolean;
  attachments?: Array<{
    filename: string;
    content_type: string;
    size: number;
    url?: string;
  }>;
}

export interface ParsedOutlookEmail {
  externalMessageId: string;
  threadId?: string;
  subject: string;
  senderName: string | null;
  senderEmail: string;
  recipientEmails: string[];
  sentAt: string;
  isSentMail: boolean;
  bodyText: string;
  classification: MessageClassification;
  classificationConfidence: number;
  classificationReasons: string[];
  entities: ParsedEntity[];
  lineCandidates: ParsedLineCandidate[];
  monetaryValues: { value: number; context: string }[];
  attachments: Array<{
    filename: string;
    contentType: string;
    size: number;
    url?: string;
    attachmentType: string;
  }>;
  siteGuess: string | null;
  customerGuess: string | null;
}

export function parseOutlookEmail(payload: OutlookEmailPayload): ParsedOutlookEmail {
  const bodyText = payload.body_text || "";
  const fullText = `${payload.subject}\n${bodyText}`;

  // Classify the message
  const { classification, confidence, reasons } = classifyMessage(fullText);

  // Extract entities from full text
  const entities = extractEntities(fullText);

  // Extract line candidates (pricing/quotes)
  const lineCandidates = extractLineCandidates(bodyText);

  // Extract monetary values
  const monetaryValues = extractMonetaryValues(fullText);

  // Classify attachments
  const attachments = (payload.attachments || []).map((att) => ({
    filename: att.filename,
    contentType: att.content_type,
    size: att.size,
    url: att.url,
    attachmentType: classifyAttachment(att.filename, att.content_type),
  }));

  // Guess site from subject line
  const siteGuess = guessSiteFromSubject(payload.subject);

  // Guess customer from sender
  const customerGuess = payload.is_sent
    ? guessCustomerFromRecipients(payload.to)
    : payload.from.name || null;

  return {
    externalMessageId: payload.message_id,
    threadId: payload.thread_id,
    subject: payload.subject,
    senderName: payload.from.name || null,
    senderEmail: payload.from.email,
    recipientEmails: payload.to.map((r) => r.email),
    sentAt: payload.sent_at,
    isSentMail: payload.is_sent ?? false,
    bodyText,
    classification,
    classificationConfidence: confidence,
    classificationReasons: reasons,
    entities,
    lineCandidates,
    monetaryValues,
    attachments,
    siteGuess,
    customerGuess,
  };
}

function classifyAttachment(filename: string, contentType: string): string {
  const lower = filename.toLowerCase();
  if (/po|purchase.?order/i.test(lower)) return "PO_DOCUMENT";
  if (/quote|quotation|estimate/i.test(lower)) return "QUOTE";
  if (/invoice|inv/i.test(lower)) return "INVOICE";
  if (/bill|credit.?note|cn/i.test(lower)) return "BILL_OR_CREDIT";
  if (/schedule|programme|program/i.test(lower)) return "SCHEDULE";
  if (/drawing|dwg|plan/i.test(lower)) return "DRAWING";
  if (contentType.startsWith("image/")) return "PHOTO";
  if (contentType === "application/pdf") return "PDF";
  return "OTHER";
}

function guessSiteFromSubject(subject: string): string | null {
  // Common patterns: "RE: Leicester Place - Basin taps" or "FW: Thornwood order"
  const cleaned = subject.replace(/^(re|fw|fwd):\s*/gi, "").trim();
  const dashSplit = cleaned.split(/\s*[-–—]\s*/);
  if (dashSplit.length >= 2) return dashSplit[0].trim();
  return null;
}

function guessCustomerFromRecipients(
  recipients: Array<{ name?: string; email: string }>
): string | null {
  if (recipients.length > 0 && recipients[0].name) {
    return recipients[0].name;
  }
  return null;
}
