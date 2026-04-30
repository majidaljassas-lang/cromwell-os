/**
 * Inline PDF / image attachment extraction for a single IngestionEvent.
 *
 * Mirrors the logic in /api/automation/sync/outlook/backfill-attachments
 * but operates on one event so handlers (order_ack, bill_parser, etc.)
 * can call it on demand instead of waiting for the cron pass.
 *
 * Idempotent — if the event already has attachment text in ParsedMessage,
 * we skip and return ok:true with extracted=false.
 */
import { prisma } from "@/lib/prisma";
import { refreshAccessToken } from "@/lib/microsoft/graph-client";
import { processEmailAttachments } from "@/lib/ingestion/email-attachments";

export interface EnsureAttachmentsResult {
  ok: boolean;
  extracted: boolean;
  reason?: string;
  attachmentCount?: number;
  textChars?: number;
}

const ATTACHMENT_TEXT_RE = /--- [^\n]+\.(pdf|png|jpe?g|tiff?|bmp|webp|docx?|xlsx?|csv) ---/i;

export async function ensureAttachmentsExtracted(
  ingestionEventId: string,
): Promise<EnsureAttachmentsResult> {
  const event = await prisma.ingestionEvent.findUnique({
    where: { id: ingestionEventId },
    select: {
      id: true,
      sourceId: true,
      sourceRecordType: true,
      rawPayload: true,
      source: { select: { sourceType: true, refreshToken: true } },
      parsedMessages: { select: { id: true, extractedText: true }, take: 1 },
    },
  });
  if (!event) return { ok: false, extracted: false, reason: "event not found" };

  // Only Outlook emails for now — WhatsApp / SMS attachments live elsewhere.
  if (event.source?.sourceType !== "OUTLOOK") {
    return { ok: true, extracted: false, reason: "non-outlook source" };
  }

  const raw = (event.rawPayload ?? {}) as Record<string, unknown>;
  const hasAttachments =
    raw.hasAttachments === true ||
    (Array.isArray(raw.attachments) && (raw.attachments as unknown[]).length > 0);
  if (!hasAttachments) return { ok: true, extracted: false, reason: "no attachments on event" };

  const existingText = event.parsedMessages[0]?.extractedText ?? "";
  if (ATTACHMENT_TEXT_RE.test(existingText)) {
    return { ok: true, extracted: false, reason: "attachment text already present" };
  }

  const outlookId = (raw.id as string | undefined) ?? null;
  if (!outlookId) return { ok: false, extracted: false, reason: "no outlook id in rawPayload" };

  const refreshToken = event.source?.refreshToken;
  if (!refreshToken) return { ok: false, extracted: false, reason: "no refresh token on source" };

  // Refresh token + persist
  let accessToken: string;
  try {
    const tokens = await refreshAccessToken(refreshToken);
    accessToken = tokens.access_token;
    await prisma.ingestionSource.update({
      where: { id: event.sourceId },
      data: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      },
    });
  } catch (err) {
    return { ok: false, extracted: false, reason: `token refresh: ${err instanceof Error ? err.message : err}` };
  }

  // Pull + extract
  const attResult = await processEmailAttachments(accessToken, outlookId, event.id);
  if (attResult.attachmentText.length === 0) {
    return { ok: true, extracted: false, reason: "no extractable text in attachments", attachmentCount: attResult.count };
  }

  // Merge into ParsedMessage
  const existing = await prisma.parsedMessage.findFirst({
    where: { ingestionEventId: event.id },
    select: { id: true, extractedText: true },
  });
  const subject = (raw.subject as string | undefined) ?? "";
  const merged =
    (existing?.extractedText || `Subject: ${subject}`) + "\n\n" + attResult.attachmentText;

  if (existing) {
    await prisma.parsedMessage.update({
      where: { id: existing.id },
      data: {
        extractedText: merged.substring(0, 32000),
        structuredData: {
          attachmentCount: attResult.count,
          hasAttachmentText: true,
          extractedInline: true,
          extractedAt: new Date().toISOString(),
        },
      },
    });
  } else {
    await prisma.parsedMessage.create({
      data: {
        ingestionEventId: event.id,
        messageType: "EMAIL",
        extractedText: merged.substring(0, 32000),
        structuredData: {
          attachmentCount: attResult.count,
          hasAttachmentText: true,
          extractedInline: true,
          extractedAt: new Date().toISOString(),
        },
      },
    });
  }

  return {
    ok: true,
    extracted: true,
    attachmentCount: attResult.count,
    textChars: attResult.attachmentText.length,
  };
}
