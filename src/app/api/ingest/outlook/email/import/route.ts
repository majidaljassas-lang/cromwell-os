import { prisma } from "@/lib/prisma";
import { parseOutlookEmail, type OutlookEmailPayload } from "@/lib/ingestion/outlook-parser";
import { logAudit } from "@/lib/ingestion/audit";
import crypto from "crypto";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { sourceId, emails } = body as {
      sourceId: string;
      emails: OutlookEmailPayload[];
    };

    if (!sourceId || !emails || !Array.isArray(emails)) {
      return Response.json({ error: "sourceId and emails array required" }, { status: 400 });
    }

    const results = { created: 0, skipped: 0, errors: 0, events: [] as string[] };

    for (const emailPayload of emails) {
      const payloadStr = JSON.stringify(emailPayload);
      const payloadHash = crypto.createHash("sha256").update(payloadStr).digest("hex");

      // Idempotency check
      const existing = await prisma.ingestionEvent.findFirst({
        where: { sourceId, payloadHash },
      });
      if (existing) {
        results.skipped++;
        continue;
      }

      try {
        const parsed = parseOutlookEmail(emailPayload);

        // Create IngestionEvent
        const event = await prisma.ingestionEvent.create({
          data: {
            sourceId,
            externalMessageId: parsed.externalMessageId,
            sourceRecordType: parsed.isSentMail ? "SENT_EMAIL" : "INBOUND_EMAIL",
            eventKind: parsed.classification,
            rawPayload: emailPayload as object,
            payloadHash,
            receivedAt: new Date(parsed.sentAt),
            status: "PARSED",
          },
        });

        // Create ParsedMessage
        const parsedMsg = await prisma.parsedMessage.create({
          data: {
            ingestionEventId: event.id,
            extractedText: parsed.bodyText.slice(0, 5000),
            structuredData: {
              subject: parsed.subject,
              senderName: parsed.senderName,
              senderEmail: parsed.senderEmail,
              classification: parsed.classification,
              confidence: parsed.classificationConfidence,
              reasons: parsed.classificationReasons,
              siteGuess: parsed.siteGuess,
              customerGuess: parsed.customerGuess,
              attachmentCount: parsed.attachments.length,
              monetaryValues: parsed.monetaryValues,
              lineCandidates: parsed.lineCandidates,
            } as object,
            messageType: parsed.isSentMail ? "OUTLOOK_SENT" : "OUTLOOK_INBOUND",
            confidenceScore: parsed.classificationConfidence,
          },
        });

        // Create entities
        const entities = parsed.entities.map((e) => ({
          parsedMessageId: parsedMsg.id,
          entityType: e.entityType,
          value: e.value,
          normalizedValue: e.normalizedValue,
          confidenceScore: e.confidence,
          spanStart: e.spanStart,
          spanEnd: e.spanEnd,
        }));

        // Add sender/recipient as entities
        entities.push({
          parsedMessageId: parsedMsg.id,
          entityType: "SENDER_EMAIL",
          value: parsed.senderEmail,
          normalizedValue: parsed.senderName ?? undefined,
          confidenceScore: 99,
          spanStart: undefined as unknown as number,
          spanEnd: undefined as unknown as number,
        });

        if (entities.length > 0) {
          await prisma.extractedEntity.createMany({ data: entities });
        }

        // Site match if guessed
        if (parsed.siteGuess) {
          await prisma.sourceSiteMatch.create({
            data: {
              sourceSystem: "OUTLOOK",
              sourceRecordId: parsed.externalMessageId,
              ingestionEventId: event.id,
              rawSiteText: parsed.siteGuess,
              reviewStatus: "UNRESOLVED",
            },
          });
        }

        await logAudit({
          objectType: "IngestionEvent",
          objectId: event.id,
          actionType: "CREATED",
          reason: `Outlook ${parsed.isSentMail ? "sent" : "inbound"} email imported`,
        });

        results.created++;
        results.events.push(event.id);
      } catch (err) {
        console.error("Failed to process email:", emailPayload.message_id, err);
        results.errors++;
      }
    }

    return Response.json(results, { status: 201 });
  } catch (error) {
    console.error("Outlook email import failed:", error);
    return Response.json({ error: "Import failed" }, { status: 500 });
  }
}
