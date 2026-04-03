import { prisma } from "@/lib/prisma";
import { parseZohoBill } from "@/lib/ingestion/zoho-parser";
import { parseOutlookEmail } from "@/lib/ingestion/outlook-parser";
import { parseWhatsAppMessage } from "@/lib/ingestion/whatsapp-parser";
import { logAudit } from "@/lib/ingestion/audit";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const event = await prisma.ingestionEvent.findUnique({
      where: { id },
      include: { source: true },
    });

    if (!event) {
      return Response.json({ error: "Event not found" }, { status: 404 });
    }

    // Get latest parse version
    const latestParse = await prisma.parsedMessage.findFirst({
      where: { ingestionEventId: id },
      orderBy: { parseVersion: "desc" },
      select: { parseVersion: true },
    });
    const newVersion = (latestParse?.parseVersion ?? 0) + 1;

    // Re-parse based on source type
    const payload = event.rawPayload as Record<string, unknown>;
    let extractedText = "";
    let structuredData: object = {};
    let messageType = "UNKNOWN";
    let confidence = 50;

    const sourceType = event.source.sourceType;

    if (sourceType === "ZOHO_BOOKS" && event.sourceRecordType === "BILL") {
      const parsed = parseZohoBill(payload as never);
      extractedText = `${parsed.billNo} | ${parsed.supplierName} | ${parsed.totalCost}`;
      structuredData = parsed as unknown as object;
      messageType = "ZOHO_BILL";
      confidence = 90;
    } else if (sourceType === "OUTLOOK") {
      const parsed = parseOutlookEmail(payload as never);
      extractedText = parsed.bodyText.slice(0, 5000);
      structuredData = {
        subject: parsed.subject,
        classification: parsed.classification,
        confidence: parsed.classificationConfidence,
        siteGuess: parsed.siteGuess,
        customerGuess: parsed.customerGuess,
      };
      messageType = parsed.isSentMail ? "OUTLOOK_SENT" : "OUTLOOK_INBOUND";
      confidence = parsed.classificationConfidence;
    } else if (sourceType === "WHATSAPP") {
      const parsed = parseWhatsAppMessage(payload as never);
      extractedText = parsed.messageText.slice(0, 5000);
      structuredData = {
        classification: parsed.classification,
        confidence: parsed.classificationConfidence,
        siteGuess: parsed.siteGuess,
        contactGuess: parsed.contactGuess,
      };
      messageType = parsed.isVoiceNote ? "WHATSAPP_VOICE" : "WHATSAPP_MESSAGE";
      confidence = parsed.classificationConfidence;
    }

    // Create new parse version (old versions preserved)
    const parsedMsg = await prisma.parsedMessage.create({
      data: {
        ingestionEventId: id,
        extractedText,
        structuredData,
        messageType,
        confidenceScore: confidence,
        parseVersion: newVersion,
      },
    });

    // Update event status
    await prisma.ingestionEvent.update({
      where: { id },
      data: { status: "PARSED", processedAt: new Date() },
    });

    await logAudit({
      objectType: "IngestionEvent",
      objectId: id,
      actionType: "REPARSED",
      reason: `Reparsed to version ${newVersion}`,
    });

    return Response.json({ parsedMessage: parsedMsg, version: newVersion });
  } catch (error) {
    console.error("Failed to reparse event:", error);
    return Response.json({ error: "Reparse failed" }, { status: 500 });
  }
}
