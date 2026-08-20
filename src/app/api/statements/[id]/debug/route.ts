import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/** Diagnostic for a single statement IntakeDocument. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const doc = await prisma.intakeDocument.findUnique({
    where: { id },
    select: {
      id: true,
      createdAt: true,
      docType: true,
      sourceType: true,
      ingestionEventId: true,
      extracted: true,
      rawText: true,
    },
  });
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });

  const event = doc.ingestionEventId
    ? await prisma.ingestionEvent.findUnique({
        where: { id: doc.ingestionEventId },
        include: {
          parsedMessages: { orderBy: { createdAt: "desc" }, take: 1 },
        },
      })
    : null;

  const parsed = event?.parsedMessages?.[0] ?? null;
  const raw = (event?.rawPayload ?? {}) as Record<string, unknown>;

  return NextResponse.json({
    intakeDocument: {
      id: doc.id,
      createdAt: doc.createdAt,
      sourceType: doc.sourceType,
      docType: doc.docType,
    },
    extracted: doc.extracted,
    rawTextSnippet: (doc.rawText ?? "").slice(0, 1500),
    rawTextLength: (doc.rawText ?? "").length,
    event: event
      ? {
          id: event.id,
          status: event.status,
          subject: raw.subject ?? raw.Subject ?? null,
          fromEmail: raw.fromEmail ?? raw.from_email ?? raw.from ?? null,
          fromName: raw.fromName ?? raw.from_name ?? null,
          hasAttachmentsFlag: raw.hasAttachments ?? null,
          attachmentNames: Array.isArray(raw.attachments)
            ? (raw.attachments as Array<Record<string, unknown>>).map((a) => a.fileName ?? a.name ?? "?")
            : [],
          rawPayloadKeys: Object.keys(raw),
        }
      : null,
    parsedMessage: parsed
      ? {
          id: parsed.id,
          messageType: parsed.messageType,
          parseVersion: parsed.parseVersion,
          textLength: parsed.extractedText.length,
          textSnippet: parsed.extractedText.slice(0, 4000),
          textTail: parsed.extractedText.slice(-1500),
        }
      : null,
  });
}
