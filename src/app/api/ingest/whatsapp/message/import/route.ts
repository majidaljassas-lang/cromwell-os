import { prisma } from "@/lib/prisma";
import { parseWhatsAppMessage, type WhatsAppMessagePayload } from "@/lib/ingestion/whatsapp-parser";
import { logAudit } from "@/lib/ingestion/audit";
import crypto from "crypto";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { sourceId, messages } = body as {
      sourceId: string;
      messages: WhatsAppMessagePayload[];
    };

    if (!sourceId || !messages || !Array.isArray(messages)) {
      return Response.json({ error: "sourceId and messages array required" }, { status: 400 });
    }

    const results = { created: 0, skipped: 0, errors: 0, events: [] as string[] };

    for (const msgPayload of messages) {
      const payloadStr = JSON.stringify(msgPayload);
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
        const parsed = parseWhatsAppMessage(msgPayload);

        // Create IngestionEvent
        const event = await prisma.ingestionEvent.create({
          data: {
            sourceId,
            externalMessageId: parsed.externalMessageId,
            sourceRecordType: parsed.isVoiceNote ? "VOICE_NOTE" : "MESSAGE",
            eventKind: parsed.classification,
            rawPayload: msgPayload as object,
            payloadHash,
            receivedAt: new Date(parsed.timestamp),
            status: "PARSED",
          },
        });

        // Create ParsedMessage
        const parsedMsg = await prisma.parsedMessage.create({
          data: {
            ingestionEventId: event.id,
            extractedText: parsed.messageText.slice(0, 5000),
            structuredData: {
              chatId: parsed.chatId,
              chatName: parsed.chatName,
              senderName: parsed.senderName,
              senderPhone: parsed.senderPhone,
              isOutbound: parsed.isOutbound,
              isGroup: parsed.isGroup,
              isVoiceNote: parsed.isVoiceNote,
              voiceNoteDuration: parsed.voiceNoteDuration,
              mediaType: parsed.mediaType,
              mediaUrl: parsed.mediaUrl,
              classification: parsed.classification,
              confidence: parsed.classificationConfidence,
              reasons: parsed.classificationReasons,
              siteGuess: parsed.siteGuess,
              contactGuess: parsed.contactGuess,
              monetaryValues: parsed.monetaryValues,
              lineCandidates: parsed.lineCandidates,
            } as object,
            messageType: parsed.isVoiceNote ? "WHATSAPP_VOICE" : "WHATSAPP_MESSAGE",
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

        if (parsed.senderPhone) {
          entities.push({
            parsedMessageId: parsedMsg.id,
            entityType: "SENDER_PHONE",
            value: parsed.senderPhone,
            normalizedValue: parsed.senderName ?? undefined,
            confidenceScore: 99,
            spanStart: undefined as unknown as number,
            spanEnd: undefined as unknown as number,
          });
        }

        if (entities.length > 0) {
          await prisma.extractedEntity.createMany({ data: entities });
        }

        // Site match if guessed
        if (parsed.siteGuess) {
          await prisma.sourceSiteMatch.create({
            data: {
              sourceSystem: "WHATSAPP",
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
          reason: `WhatsApp ${parsed.isOutbound ? "outbound" : "inbound"} message imported`,
        });

        results.created++;
        results.events.push(event.id);
      } catch (err) {
        console.error("Failed to process message:", msgPayload.message_id, err);
        results.errors++;
      }
    }

    return Response.json(results, { status: 201 });
  } catch (error) {
    console.error("WhatsApp message import failed:", error);
    return Response.json({ error: "Import failed" }, { status: 500 });
  }
}
