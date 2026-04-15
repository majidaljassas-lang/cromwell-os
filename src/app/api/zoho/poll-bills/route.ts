/**
 * GET /api/zoho/poll-bills?since=YYYY-MM-DD
 *
 * Pulls all bills from Zoho since the given date (default = last sync timestamp on the
 * ZOHO_BOOKS IngestionSource, or 7 days ago for first run), fetches full detail for each,
 * pushes through ingest → commercialise → auto-link.
 *
 * Idempotent — bills already ingested are skipped via payloadHash.
 * Designed to be called by cron every N hours until Zoho phase-out.
 */

import { prisma } from "@/lib/prisma";
import { listBills, getBill } from "@/lib/zoho/client";
import { commercialiseZohoBill } from "@/lib/ingestion/commercialiser";
import { parseZohoBill } from "@/lib/ingestion/zoho-parser";
import crypto from "crypto";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const since = searchParams.get("since"); // optional override, YYYY-MM-DD

    const source = await prisma.ingestionSource.findFirst({ where: { sourceType: "ZOHO_BOOKS" } });
    if (!source) return Response.json({ error: "ZOHO_BOOKS source not configured" }, { status: 500 });

    // Default cutoff: last sync minus 1 day, or 7 days ago for first run
    const cutoffDate = since
      ? new Date(since)
      : source.lastSyncAt
        ? new Date(source.lastSyncAt.getTime() - 86_400_000)
        : new Date(Date.now() - 7 * 86_400_000);
    const cutoffStr = cutoffDate.toISOString().slice(0, 10);

    // Pull bill headers (Zoho doesn't take date filters reliably via MCP — we filter after)
    const list = await listBills({ per_page: 200, sort_column: "date", sort_order: "D" });
    const heads = (list.bills as Array<{ bill_id: string; bill_number: string; date: string; vendor_name: string; total: number; status: string }>) ?? [];
    const fresh = heads.filter((b) => b.date >= cutoffStr);

    const summary = {
      cutoff: cutoffStr,
      headersScanned: heads.length,
      candidates: fresh.length,
      ingested: 0,
      skipped: 0,
      errors: 0,
      commercialised: 0,
      autoLinked: 0,
    };

    for (const head of fresh) {
      try {
        const detail = await getBill(head.bill_id);
        const payloadStr = JSON.stringify(detail);
        const payloadHash = crypto.createHash("sha256").update(payloadStr).digest("hex");
        const exists = await prisma.ingestionEvent.findFirst({ where: { sourceId: source.id, payloadHash } });
        if (exists) { summary.skipped++; continue; }

        const parsed = parseZohoBill(detail as Parameters<typeof parseZohoBill>[0]);

        const event = await prisma.ingestionEvent.create({
          data: {
            sourceId: source.id,
            externalMessageId: parsed.externalId,
            sourceRecordType: "BILL",
            eventKind: "BILL_DOCUMENT",
            rawPayload: detail as object,
            payloadHash,
            receivedAt: new Date(),
            status: "PARSED",
          },
        });
        await prisma.parsedMessage.create({
          data: {
            ingestionEventId: event.id,
            extractedText: `${parsed.billNo} | ${parsed.supplierName} | ${parsed.totalCost}`,
            structuredData: parsed as unknown as object,
            messageType: "ZOHO_BILL",
            confidenceScore: 90,
          },
        });
        summary.ingested++;

        // Find/create supplier (case-insensitive on name)
        let supplier = await prisma.supplier.findFirst({
          where: { name: { equals: parsed.supplierName, mode: "insensitive" } },
        });
        if (!supplier) supplier = await prisma.supplier.create({ data: { name: parsed.supplierName, notes: "Auto-created by Zoho poll" } });

        // Commercialise (this also runs autoLinkBillLine for each line internally)
        const cm = await commercialiseZohoBill(event.id, { supplierId: supplier.id, actor: "zoho-cron" });
        if (cm.success) {
          summary.commercialised++;
          summary.autoLinked += cm.createdObjects.filter((o) => o.type === "AutoLink_Bill").length;
        }
      } catch (e) {
        console.error(`poll-bills failed on ${head.bill_number}:`, e);
        summary.errors++;
      }
    }

    await prisma.ingestionSource.update({
      where: { id: source.id },
      data: { lastSyncAt: new Date(), connectorStatus: "OK" },
    });

    return Response.json(summary);
  } catch (e) {
    console.error("poll-bills failed:", e);
    return Response.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
