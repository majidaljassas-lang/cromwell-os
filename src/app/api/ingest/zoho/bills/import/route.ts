import { prisma } from "@/lib/prisma";
import { parseZohoBill, type ZohoBillPayload } from "@/lib/ingestion/zoho-parser";
import { logAudit } from "@/lib/ingestion/audit";
import { matchCustomer } from "@/lib/ingestion/matching";
import crypto from "crypto";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { sourceId, bills, isHistorical } = body as {
      sourceId: string;
      bills: ZohoBillPayload[];
      isHistorical?: boolean;
    };

    if (!sourceId || !bills || !Array.isArray(bills)) {
      return Response.json({ error: "sourceId and bills array required" }, { status: 400 });
    }

    const results = { created: 0, skipped: 0, errors: 0, events: [] as string[] };

    for (const billPayload of bills) {
      const payloadStr = JSON.stringify(billPayload);
      const payloadHash = crypto.createHash("sha256").update(payloadStr).digest("hex");

      // Idempotency: skip if already ingested
      const existing = await prisma.ingestionEvent.findFirst({
        where: { sourceId, payloadHash },
      });
      if (existing) {
        results.skipped++;
        continue;
      }

      try {
        // Parse the bill
        const parsed = parseZohoBill(billPayload);

        // Create IngestionEvent with raw payload (immutable)
        const event = await prisma.ingestionEvent.create({
          data: {
            sourceId,
            externalMessageId: parsed.externalId,
            sourceRecordType: "BILL",
            eventKind: "BILL_DOCUMENT",
            rawPayload: billPayload as object,
            payloadHash,
            receivedAt: new Date(),
            status: "PARSED",
          },
        });

        // Create ParsedMessage with structured data
        const parsedMsg = await prisma.parsedMessage.create({
          data: {
            ingestionEventId: event.id,
            extractedText: `${parsed.billNo} | ${parsed.supplierName} | ${parsed.totalCost}`,
            structuredData: parsed as unknown as object,
            messageType: "ZOHO_BILL",
            confidenceScore: 90,
          },
        });

        // Create ExtractedEntities for key fields
        const entityData = [
          { entityType: "SUPPLIER_NAME", value: parsed.supplierName, confidence: 95 },
          { entityType: "BILL_NUMBER", value: parsed.billNo, confidence: 99 },
          { entityType: "BILL_DATE", value: parsed.billDate, confidence: 99 },
          { entityType: "TOTAL_COST", value: String(parsed.totalCost), confidence: 95 },
        ];
        if (parsed.siteRef) {
          entityData.push({ entityType: "SITE_REFERENCE", value: parsed.siteRef, confidence: 70 });
        }

        await prisma.extractedEntity.createMany({
          data: entityData.map((e) => ({
            parsedMessageId: parsedMsg.id,
            entityType: e.entityType,
            value: e.value,
            confidenceScore: e.confidence,
          })),
        });

        // Create SourceSiteMatch if site text found
        if (parsed.siteRef) {
          await prisma.sourceSiteMatch.create({
            data: {
              sourceSystem: "ZOHO_BOOKS",
              sourceRecordId: parsed.externalId,
              ingestionEventId: event.id,
              rawSiteText: parsed.siteRef,
              reviewStatus: "UNRESOLVED",
            },
          });
        }

        // Fix 3: Customer resolution — run matching on vendor name
        if (parsed.supplierName) {
          const customerMatches = await matchCustomer(parsed.supplierName);
          const bestMatch = customerMatches[0];
          if (bestMatch && bestMatch.confidence < 80) {
            // Low confidence — add entity for review queue visibility
            await prisma.extractedEntity.create({
              data: {
                parsedMessageId: parsedMsg.id,
                entityType: "UNRESOLVED_CUSTOMER",
                value: parsed.supplierName,
                normalizedValue: bestMatch ? `${bestMatch.entityName} (${bestMatch.confidence}%)` : undefined,
                confidenceScore: bestMatch?.confidence ?? 0,
              },
            });
          }
        }

        // Audit log
        await logAudit({
          objectType: "IngestionEvent",
          objectId: event.id,
          actionType: "CREATED",
          reason: isHistorical ? "Historical Zoho bill import" : "Live Zoho bill import",
        });

        results.created++;
        results.events.push(event.id);
      } catch (err) {
        console.error("Failed to process bill:", billPayload.bill_number, err);
        results.errors++;
      }
    }

    return Response.json(results, { status: 201 });
  } catch (error) {
    console.error("Zoho bills import failed:", error);
    return Response.json({ error: "Import failed" }, { status: 500 });
  }
}
