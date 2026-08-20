/**
 * GS8 Forensic Backfill Engine
 *
 * Pulls ALL historical emails and WhatsApp messages related to GS8/Luc contacts
 * into the Backlog tables (NOT the live inbox). Parses each message for:
 * - Site references (addresses, project names)
 * - Financial data (amounts, order refs, invoice refs)
 * - Product names and quantities
 * - Links and attachments
 *
 * CRITICAL: This NEVER writes to IngestionEvent, InboxThread, or Ticket.
 * Everything goes into BacklogMessage under a BacklogCase tagged GS8-FORENSIC.
 */

import { prisma } from "@/lib/prisma";
import {
  refreshAccessToken,
  fetchEmails,
  graphGetByUrl,
  fetchAttachments,
} from "@/lib/microsoft/graph-client";

// ── GS8 Parent Customer ID ──
const GS8_PARENT_ID = "b4ce4961-7c8b-42dc-870e-c0accf734f24";

// ── Search terms for Outlook ──
const EMAIL_SEARCH_DOMAINS = ["gs8.co.uk", "lucconstruction.co.uk", "lucme.co.uk"];
const EMAIL_SEARCH_ADDRESSES = ["l.benjamin@gs8.co.uk"];
const BODY_SEARCH_TERMS = ["gs8", "thornwood", "luc construction", "luc m&e"];

// ── Contact names for WhatsApp matching ──
const WA_CONTACT_NAMES = [
  "Gabby", "Gabby Stan",
  "Ben Spencer",
  "Lee Benjamin", "Lee Paul Benjamin",
  "Bogdan", "Bogdan Flescan",
  "Bobby", "Bobby Stan",
  "Tetiana", "Tetiana Tatarchuk",
  "Nicolae", "Nicolae Pascu",
  "Alex Cocor",
  "Giorgo", "Giorgo Kotsi",
  "Vasille",
];

// ── Message parser: extracts structured data from text ──

interface ParsedForensicMessage {
  siteRefs: string[];
  amounts: { value: number; currency: string; context: string }[];
  orderRefs: string[];
  invoiceRefs: string[];
  productMentions: string[];
  links: string[];
  hasAttachment: boolean;
  attachmentNames: string[];
  messageType: "ORDER" | "QUOTE" | "DELIVERY" | "INVOICE" | "CHASE" | "GENERAL";
}

export function parseMessageContent(text: string, subject?: string): ParsedForensicMessage {
  const combined = `${subject || ""} ${text}`;
  const lower = combined.toLowerCase();

  // Site references — addresses, known project names, postcodes
  const siteRefs: string[] = [];
  const postcodeMatches = combined.match(/\b[A-Z]{1,2}\d{1,2}\s?\d[A-Z]{2}\b/gi) || [];
  siteRefs.push(...postcodeMatches.map(p => p.toUpperCase()));

  // Known site patterns
  const sitePatterns = [
    /\b(thornwood|baker\s*street|park\s*lane|park\s*hill)\b/gi,
    /\bsite[:\s]+([A-Za-z0-9 ]+)/gi,
    /\bproject[:\s]+([A-Za-z0-9 ]+)/gi,
    /\bflat\s*\d+/gi,
    /\bbatch\s*\d+/gi,
  ];
  for (const pat of sitePatterns) {
    const matches = combined.matchAll(pat);
    for (const m of matches) {
      siteRefs.push((m[1] || m[0]).trim());
    }
  }

  // Amounts — £, GBP, numbers with context
  const amounts: { value: number; currency: string; context: string }[] = [];
  const amountPatterns = [
    /£\s*([\d,]+\.?\d*)/g,
    /(\d[\d,]*\.\d{2})\s*(?:plus\s*vat|exc?\s*vat|\+\s*vat|per\s+(?:unit|sink|item|meter|metre|lm))/gi,
    /(?:price|cost|total|value|amount|charge|quote)[:\s]*£?\s*([\d,]+\.?\d*)/gi,
  ];
  for (const pat of amountPatterns) {
    const matches = combined.matchAll(pat);
    for (const m of matches) {
      const val = parseFloat(m[1].replace(/,/g, ""));
      if (val > 0 && val < 10000000) {
        const start = Math.max(0, (m.index || 0) - 30);
        const end = Math.min(combined.length, (m.index || 0) + m[0].length + 30);
        amounts.push({ value: val, currency: "GBP", context: combined.substring(start, end).trim() });
      }
    }
  }

  // Order/PO/Quote references
  const orderRefs: string[] = [];
  const orderPatterns = [
    /\b(?:PO|P\.O\.|purchase\s*order)[#:\s-]*(\w[\w\-/]*)/gi,
    /\b(?:order\s*(?:ref|no|number|#))[:\s-]*(\w[\w\-/]*)/gi,
    /\bSOE[- ]?\d+/gi,
    /\bUB\d+/gi,
  ];
  for (const pat of orderPatterns) {
    const matches = combined.matchAll(pat);
    for (const m of matches) {
      orderRefs.push((m[1] || m[0]).trim());
    }
  }

  // Invoice references
  const invoiceRefs: string[] = [];
  const invoicePatterns = [
    /\b(?:INV|invoice)[#:\s-]*(\w[\w\-/]*)/gi,
    /\b(?:credit\s*note|CN)[#:\s-]*(\w[\w\-/]*)/gi,
    /\bIR\d+/gi,
  ];
  for (const pat of invoicePatterns) {
    const matches = combined.matchAll(pat);
    for (const m of matches) {
      invoiceRefs.push((m[1] || m[0]).trim());
    }
  }

  // Product mentions
  const productMentions: string[] = [];
  const productPatterns = [
    /\b(\d+)\s*(?:x|no\.?|nos?\.?|pcs?|pieces?)\s+([A-Za-z][\w\s&-]{3,40})/gi,
    /\b(sink|tap|mixer|basin|toilet|bath|shower|pump|cable|pipe|valve|elbow|coupling|reducer|cement|clip)\b/gi,
    /\b(MDPE|UPVC|copper|stainless|butler)\b/gi,
  ];
  for (const pat of productPatterns) {
    const matches = combined.matchAll(pat);
    for (const m of matches) {
      productMentions.push(m[0].trim());
    }
  }

  // Links
  const links = (combined.match(/https?:\/\/[^\s<>"]+/gi) || []);

  // Message type classification
  let messageType: ParsedForensicMessage["messageType"] = "GENERAL";
  if (/\b(order|ordered|call\s*off|call-off|please\s*supply|please\s*send)\b/i.test(lower)) messageType = "ORDER";
  else if (/\b(quote|price|pricing|quotation|how\s*much|cost\s*for)\b/i.test(lower)) messageType = "QUOTE";
  else if (/\b(deliver|delivery|dispatch|shipped|tracking|eta|arrived|received)\b/i.test(lower)) messageType = "DELIVERY";
  else if (/\b(invoice|invoiced|bill|statement|payment|paid|overdue|reminder|outstanding)\b/i.test(lower)) messageType = "INVOICE";
  else if (/\b(chase|chasing|follow\s*up|following\s*up|where|update|urgent|asap)\b/i.test(lower)) messageType = "CHASE";

  return {
    siteRefs: [...new Set(siteRefs)],
    amounts,
    orderRefs: [...new Set(orderRefs)],
    invoiceRefs: [...new Set(invoiceRefs)],
    productMentions: [...new Set(productMentions)],
    links: [...new Set(links)],
    hasAttachment: false,
    attachmentNames: [],
    messageType,
  };
}

// ── Strip HTML to plain text ──
function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<td[^>]*>/gi, " | ")
    .replace(/<li[^>]*>/gi, "\n• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ── Get forensic source IDs ──
const FORENSIC_SOURCE_IDS: Record<string, string> = {
  EMAIL: "b723446c-6479-4495-ba50-3a8525a38c8a",
  WHATSAPP: "59ff8408-5efd-4fe8-8741-0144dd35be73",
};

async function getForensicSourceId(channel: "EMAIL" | "WHATSAPP"): Promise<string> {
  return FORENSIC_SOURCE_IDS[channel];
}

// ── Outlook Email Backfill ──
export async function backfillOutlookEmails(): Promise<{
  fetched: number;
  stored: number;
  skipped: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let fetched = 0;
  let stored = 0;
  let skipped = 0;

  // Get Outlook source with refresh token
  const source = await prisma.ingestionSource.findFirst({
    where: { sourceType: "OUTLOOK" },
  });
  if (!source?.refreshToken) {
    return { fetched: 0, stored: 0, skipped: 0, errors: ["No Outlook source with refresh token found"] };
  }

  // Refresh access token
  const tokens = await refreshAccessToken(source.refreshToken);
  const accessToken = tokens.access_token;

  // Update stored tokens
  await prisma.ingestionSource.update({
    where: { id: source.id },
    data: {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    },
  });

  const sourceId = await getForensicSourceId("EMAIL");

  // Search for GS8-related emails using Graph API $search
  // No date floor — pull EVERYTHING
  const searchQueries = [
    "gs8",
    "thornwood",
    "luc construction",
    "from:l.benjamin@gs8.co.uk",
  ];

  for (const query of searchQueries) {
    try {
      let url = `https://graph.microsoft.com/v1.0/me/messages?$search="${encodeURIComponent(query)}"&$top=200&$select=id,subject,from,toRecipients,ccRecipients,receivedDateTime,body,bodyPreview,hasAttachments,conversationId,internetMessageId`;
      let pageCount = 0;

      while (url && pageCount < 20) {
        const data = await graphGetByUrl(accessToken, url);
        const messages = data.value || [];
        fetched += messages.length;

        for (const msg of messages) {
          // Check if already in backlog
          const existing = await prisma.backlogMessage.findFirst({
            where: {
              sourceId: sourceId,
              rawText: { startsWith: `[EMAIL:${msg.internetMessageId || msg.id}]` },
            },
          });
          if (existing) { skipped++; continue; }

          const bodyText = msg.body?.content
            ? stripHtml(msg.body.content)
            : msg.bodyPreview || "";

          const parsed = parseMessageContent(bodyText, msg.subject);

          // Fetch attachment names if present
          if (msg.hasAttachments) {
            try {
              const attachments = await fetchAttachments(accessToken, msg.id);
              parsed.hasAttachment = true;
              parsed.attachmentNames = attachments.value
                .filter(a => !a.isInline)
                .map(a => a.name);
            } catch {}
          }

          const senderName = msg.from?.emailAddress?.name || "Unknown";
          const senderEmail = msg.from?.emailAddress?.address || "";

          // Determine line count for BacklogMessage
          const lines = bodyText.split("\n").filter((l: string) => l.trim());

          // Get next line number for this case
          const maxLine = await prisma.backlogMessage.aggregate({
            where: { sourceId: sourceId },
            _max: { lineNumber: true },
          });
          const lineNumber = (maxLine._max.lineNumber || 0) + 1;

          await prisma.backlogMessage.create({
            data: {
              sourceId: sourceId,
              lineNumber,
              rawTimestampText: msg.receivedDateTime,
              parsedTimestamp: new Date(msg.receivedDateTime),
              timestampConfidence: "HIGH",
              sender: `${senderName} <${senderEmail}>`,
              rawText: `[EMAIL:${msg.internetMessageId || msg.id}] Subject: ${msg.subject}\n\n${bodyText}`,
              parsedOk: true,
              isMultiline: lines.length > 1,
              lineCount: lines.length,
              messageType: parsed.messageType,
              hasAttachment: parsed.hasAttachment,
              attachmentRef: parsed.attachmentNames.length > 0 ? parsed.attachmentNames.join(", ") : null,
              hasMedia: false,
              relationType: "STANDALONE",
              notes: JSON.stringify({
                channel: "EMAIL",
                subject: msg.subject,
                from: senderEmail,
                to: (msg.toRecipients || []).map((r: any) => r.emailAddress?.address).join(", "),
                siteRefs: parsed.siteRefs,
                amounts: parsed.amounts,
                orderRefs: parsed.orderRefs,
                invoiceRefs: parsed.invoiceRefs,
                productMentions: parsed.productMentions,
                links: parsed.links,
              }),
            },
          });
          stored++;
        }

        url = data["@odata.nextLink"] || "";
        pageCount++;
      }
    } catch (err) {
      errors.push(`Search "${query}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { fetched, stored, skipped, errors };
}

// ── WhatsApp Backfill ──
// This triggers the QR server's backfill endpoint for each GS8 contact
// Messages get stored in BacklogMessage via a custom handler
export async function backfillWhatsApp(): Promise<{
  chatsFound: number;
  messagesStored: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let messagesStored = 0;

  const sourceId = await getForensicSourceId("WHATSAPP");

  // Get all WhatsApp messages already in the system from GS8 contacts
  // Search IngestionEvent for WhatsApp messages from known contacts
  const existingEvents = await prisma.ingestionEvent.findMany({
    where: {
      sourceRecordType: "WHATSAPP",
      rawPayload: { path: ["chat_name"], string_contains: "" }, // we'll filter in JS
    },
    select: {
      id: true,
      rawPayload: true,
      receivedAt: true,
    },
    orderBy: { receivedAt: "asc" },
  });

  // Filter for GS8-related messages
  const gs8Messages = existingEvents.filter(e => {
    const payload = e.rawPayload as any;
    if (!payload) return false;
    const chatName = (payload.chat_name || "").toLowerCase();
    const senderName = (payload.sender_name || "").toLowerCase();
    const body = (payload.body || payload.message_text || "").toLowerCase();

    // Check if from a GS8 contact
    for (const name of WA_CONTACT_NAMES) {
      if (chatName.includes(name.toLowerCase()) || senderName.includes(name.toLowerCase())) return true;
    }
    // Check if mentions GS8
    if (body.includes("gs8") || body.includes("thornwood") || body.includes("baker street")) return true;

    return false;
  });

  // Store each in BacklogMessage
  for (const event of gs8Messages) {
    const payload = event.rawPayload as any;
    const msgId = payload.message_id || event.id;

    // Check if already stored
    const existing = await prisma.backlogMessage.findFirst({
      where: {
        sourceId: sourceId,
        rawText: { startsWith: `[WA:${msgId}]` },
      },
    });
    if (existing) continue;

    const text = payload.body || payload.message_text || "";
    const sender = payload.sender_name || payload.chat_name || "Unknown";
    const timestamp = payload.timestamp ? new Date(payload.timestamp) : event.receivedAt;

    const parsed = parseMessageContent(text);

    const maxLine = await prisma.backlogMessage.aggregate({
      where: { sourceId: sourceId },
      _max: { lineNumber: true },
    });
    const lineNumber = (maxLine._max.lineNumber || 0) + 1;

    await prisma.backlogMessage.create({
      data: {
        sourceId: sourceId,
        lineNumber,
        rawTimestampText: timestamp.toISOString(),
        parsedTimestamp: timestamp,
        timestampConfidence: "HIGH",
        sender,
        rawText: `[WA:${msgId}] ${text}`,
        parsedOk: true,
        isMultiline: text.includes("\n"),
        lineCount: text.split("\n").length,
        messageType: parsed.messageType,
        hasAttachment: payload.has_media || false,
        hasMedia: payload.has_media || false,
        mediaType: payload.media_type || null,
        relationType: "STANDALONE",
        notes: JSON.stringify({
          channel: "WHATSAPP",
          chatId: payload.chat_id,
          chatName: payload.chat_name,
          senderPhone: payload.sender_phone,
          isSent: payload.is_sent || false,
          isGroup: payload.is_group || false,
          siteRefs: parsed.siteRefs,
          amounts: parsed.amounts,
          orderRefs: parsed.orderRefs,
          productMentions: parsed.productMentions,
          links: parsed.links,
        }),
      },
    });
    messagesStored++;
  }

  // Also pull from InboxThreadMessages where sender matches GS8 contacts
  const threadMessages = await prisma.inboxThreadMessage.findMany({
    where: {
      OR: WA_CONTACT_NAMES.map(name => ({
        sender: { contains: name, mode: "insensitive" as const },
      })),
    },
    select: {
      id: true,
      sender: true,
      snippet: true,
      occurredAt: true,
      hasAttachments: true,
      ingestionEventId: true,
    },
    orderBy: { occurredAt: "asc" },
  });

  for (const msg of threadMessages) {
    const msgId = msg.ingestionEventId || msg.id;

    const existing = await prisma.backlogMessage.findFirst({
      where: {
        sourceId: sourceId,
        rawText: { startsWith: `[WA:${msgId}]` },
      },
    });
    if (existing) continue;

    const text = msg.snippet || "";
    const parsed = parseMessageContent(text);

    const maxLine = await prisma.backlogMessage.aggregate({
      where: { sourceId: sourceId },
      _max: { lineNumber: true },
    });
    const lineNumber = (maxLine._max.lineNumber || 0) + 1;

    await prisma.backlogMessage.create({
      data: {
        sourceId: sourceId,
        lineNumber,
        rawTimestampText: msg.occurredAt.toISOString(),
        parsedTimestamp: msg.occurredAt,
        timestampConfidence: "HIGH",
        sender: msg.sender || "Unknown",
        rawText: `[WA:${msgId}] ${text}`,
        parsedOk: true,
        isMultiline: text.includes("\n"),
        lineCount: text.split("\n").length,
        messageType: parsed.messageType,
        hasAttachment: msg.hasAttachments || false,
        hasMedia: false,
        relationType: "STANDALONE",
        notes: JSON.stringify({
          channel: "WHATSAPP",
          siteRefs: parsed.siteRefs,
          amounts: parsed.amounts,
          orderRefs: parsed.orderRefs,
          productMentions: parsed.productMentions,
          links: parsed.links,
        }),
      },
    });
    messagesStored++;
  }

  return { chatsFound: gs8Messages.length + threadMessages.length, messagesStored, errors };
}

// ── Full backfill orchestrator ──
export async function runFullBackfill() {
  const emailResult = await backfillOutlookEmails();
  const waResult = await backfillWhatsApp();

  return {
    email: emailResult,
    whatsapp: waResult,
    totalStored: emailResult.stored + waResult.messagesStored,
    caseId: (await prisma.backlogCase.findFirst({ where: { name: "GS8-FORENSIC" } }))?.id || "unknown",
  };
}
