/**
 * Supply Builder — Constructs SupplyEvents from timeline evidence
 *
 * Supply is derived from:
 * 1. Delivery messages in timeline ("delivered", "on site", "arrived", "received")
 * 2. Bills from suppliers (bill line = supply proxy)
 * 3. Delivery media evidence (POD photos, delivery notes)
 * 4. Order confirmation screenshots (Selco order received, etc.)
 *
 * Each SupplyEvent must link to a product and carry evidence.
 */

import { prisma } from "@/lib/prisma";
import { normalizeProduct, extractQtyUnit } from "@/lib/reconciliation/normalizer";
import { normaliseUom } from "./uom";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SupplyBuildResult {
  totalSources: number;
  fromMessages: number;
  fromBills: number;
  fromMedia: number;
  eventsCreated: number;
  productsSeen: string[];
}

// ─── Delivery detection patterns ────────────────────────────────────────────

const DELIVERY_PATTERNS = [
  /deliver(ed|y)/i, /arrived/i, /on\s*site/i, /received/i,
  /pod\b/i, /been\s*drop/i, /outside/i, /unload/i,
  /collect(ed)?/i, /picked\s*up/i,
];

const DELIVERY_QTY_PATTERNS = [
  /(\d+)\s*(?:pallet|pallets)\s+(?:of\s+)?(.+)/i,
  /(\d+)\s*(?:no|sheets|boards|lengths|bags|boxes|rolls|packs)\s+(?:of\s+)?(.+)/i,
  /deliver(?:ed|y)\s+(\d+)\s+(.+)/i,
];

// ─── Core Builder ───────────────────────────────────────────────────────────

export async function buildSupplyEvents(siteId: string, caseId: string): Promise<SupplyBuildResult> {
  const result: SupplyBuildResult = {
    totalSources: 0,
    fromMessages: 0,
    fromBills: 0,
    fromMedia: 0,
    eventsCreated: 0,
    productsSeen: [],
  };

  const productsSeen = new Set<string>();

  // ─── Source 1: Delivery messages from timeline ──────────────────────

  const backlogCase = await prisma.backlogCase.findFirst({
    where: { id: caseId },
    include: { sourceGroups: { include: { sources: true } } },
  });

  if (backlogCase) {
    const sourceIds = backlogCase.sourceGroups.flatMap((g) => g.sources.map((s) => s.id));
    const groupChatIds = backlogCase.sourceGroups
      .flatMap((g) => g.sources)
      .filter((s) => /group|DC/i.test(s.label))
      .map((s) => s.id);

    const messages = await prisma.backlogMessage.findMany({
      where: {
        sourceId: { in: sourceIds },
        parsedOk: true,
      },
      orderBy: { parsedTimestamp: "asc" },
    });

    for (const msg of messages) {
      const isDelivery = DELIVERY_PATTERNS.some((p) => p.test(msg.rawText));
      if (!isDelivery) continue;

      const isGroupChat = groupChatIds.includes(msg.sourceId);
      if (!isGroupChat) continue; // Only use confirmed Dellow delivery messages

      result.totalSources++;

      // Try to extract specific qty + product
      const deliveryExtraction = extractDeliveryContent(msg.rawText);

      for (const item of deliveryExtraction) {
        const cp = await prisma.canonicalProduct.findUnique({
          where: { code: item.productCode },
        });
        if (!cp) continue;

        // Check for duplicate supply event
        const existing = await prisma.supplyEvent.findFirst({
          where: {
            siteId,
            canonicalProductId: cp.id,
            timestamp: msg.parsedTimestamp,
          },
        });
        if (existing) continue;

        // UOM normalisation
        const uomResult = await normaliseUom(cp.id, item.qty, item.rawUom, cp.canonicalUom);

        await prisma.supplyEvent.create({
          data: {
            siteId,
            canonicalProductId: cp.id,
            fulfilmentType: "DELIVERED",
            qty: item.qty,
            rawUom: item.rawUom,
            normalisedQty: uomResult.normalisedQty,
            canonicalUom: uomResult.canonicalUom,
            uomResolved: uomResult.uomResolved,
            sourceRef: `BacklogMessage:${msg.id}`,
            evidenceRef: msg.rawText.slice(0, 200),
            timestamp: msg.parsedTimestamp,
          },
        });

        result.eventsCreated++;
        result.fromMessages++;
        productsSeen.add(item.productCode);
      }
    }
  }

  // ─── Source 2: Commercial bills (bill lines as supply proxy) ────────

  const bills = await prisma.commercialBill.findMany({
    include: {
      lines: { include: { canonicalProduct: true } },
    },
  });

  for (const bill of bills) {
    for (const line of bill.lines) {
      if (!line.canonicalProductId || !line.canonicalProduct) continue;

      result.totalSources++;

      // Check for duplicate
      const existing = await prisma.supplyEvent.findFirst({
        where: {
          siteId,
          canonicalProductId: line.canonicalProductId,
          sourceRef: `CommercialBillLine:${line.id}`,
        },
      });
      if (existing) continue;

      const uomResult = await normaliseUom(
        line.canonicalProductId,
        Number(line.qty),
        line.rawUom,
        line.canonicalProduct.canonicalUom
      );

      await prisma.supplyEvent.create({
        data: {
          siteId,
          canonicalProductId: line.canonicalProductId,
          fulfilmentType: "DELIVERED",
          qty: Number(line.qty),
          rawUom: line.rawUom,
          normalisedQty: uomResult.normalisedQty,
          canonicalUom: uomResult.canonicalUom,
          uomResolved: uomResult.uomResolved,
          sourceRef: `CommercialBillLine:${line.id}`,
          evidenceRef: `Bill ${bill.billNumber}: ${line.description}`,
          timestamp: bill.billDate,
        },
      });

      result.eventsCreated++;
      result.fromBills++;
      productsSeen.add(line.canonicalProduct.code);
    }
  }

  // ─── Source 3: Delivery media evidence ─────────────────────────────

  const deliveryMedia = await prisma.mediaEvidence.findMany({
    where: {
      siteId,
      evidenceRole: "DELIVERY_EVIDENCE",
      processingStatus: { in: ["EXTRACTED", "CLASSIFIED"] },
      candidateProducts: { isEmpty: false },
    },
  });

  for (const media of deliveryMedia) {
    if (!media.candidateProducts || media.candidateProducts.length === 0) continue;
    const qtys = (media.candidateQtys as Record<string, number>) || {};

    result.totalSources++;

    for (const code of media.candidateProducts) {
      const cp = await prisma.canonicalProduct.findUnique({ where: { code } });
      if (!cp) continue;

      const qty = qtys[code] || 0;
      if (qty === 0) continue;

      const existing = await prisma.supplyEvent.findFirst({
        where: {
          siteId,
          canonicalProductId: cp.id,
          sourceRef: `MediaEvidence:${media.id}`,
        },
      });
      if (existing) continue;

      await prisma.supplyEvent.create({
        data: {
          siteId,
          canonicalProductId: cp.id,
          fulfilmentType: "DELIVERED",
          qty,
          rawUom: "EA",
          normalisedQty: qty,
          canonicalUom: cp.canonicalUom,
          uomResolved: true,
          sourceRef: `MediaEvidence:${media.id}`,
          evidenceRef: media.classificationNotes || media.fileName || "Delivery media",
          timestamp: media.timestamp,
        },
      });

      result.eventsCreated++;
      result.fromMedia++;
      productsSeen.add(code);
    }
  }

  result.productsSeen = [...productsSeen];
  return result;
}

// ─── Delivery content extraction ────────────────────────────────────────────

function extractDeliveryContent(text: string): Array<{ productCode: string; qty: number; rawUom: string }> {
  const results: Array<{ productCode: string; qty: number; rawUom: string }> = [];
  const lines = text.split("\n");

  for (const line of lines) {
    // Try specific delivery qty patterns
    for (const pattern of DELIVERY_QTY_PATTERNS) {
      const match = line.match(pattern);
      if (match) {
        const qty = parseInt(match[1]);
        const productText = match[2];
        const normalized = normalizeProduct(productText);
        if (normalized.normalized !== "UNKNOWN") {
          results.push({ productCode: normalized.normalized, qty, rawUom: "EA" });
        }
        break;
      }
    }

    // Try generic qty extraction
    if (results.length === 0) {
      const qu = extractQtyUnit(line);
      if (qu) {
        const normalized = normalizeProduct(line);
        if (normalized.normalized !== "UNKNOWN") {
          results.push({ productCode: normalized.normalized, qty: qu.qty, rawUom: qu.unit });
        }
      }
    }
  }

  return results;
}
