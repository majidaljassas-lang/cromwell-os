/**
 * ORDER BUILDER — Anchor-based order reconstruction
 *
 * Replicates how a human manually reconstructs an order:
 *
 * 1. FIND ANCHOR — message/media with 3+ products + quantities
 * 2. CREATE ONE GROUP per anchor — no fragmentation
 * 3. ATTACH RELATED — additions, substitutions, confirmations (forward scan, same context)
 * 4. IGNORE NOISE — no "mixed items", no empty groups, no casual messages
 * 5. NORMALISE — clean product list with total qty per product
 * 6. SUBSTITUTIONS — reduce original, increase replacement
 * 7. REQUIRE COMPLETENESS — no qty=0, no partial lines
 *
 * ANTI-CONTAMINATION:
 * - DC group chat → CONFIRMED site
 * - Direct chats → only if explicitly references DC/Dellow/Shuttleworth → PROBABLE
 * - Everything else → excluded from auto-build
 */

import { prisma } from "@/lib/prisma";
import { extractProductLines } from "./order-classifier";
import type { ExtractedProductLine } from "./order-classifier";
import { normaliseUom } from "./uom";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface OrderBuilderConfig {
  siteId: string;
  caseId: string;
  groupChatSourceIds: string[];
  sitePatterns: RegExp[];
  excludePatterns: RegExp[];
}

export interface BuildResult {
  totalTimelineEvents: number;
  anchorsFound: number;
  ordersBuilt: number;
  eventsCreated: number;
  reviewItems: number;
  orders: BuiltOrder[];
}

export interface BuiltOrder {
  id: string;
  label: string;
  anchorDate: string;
  primarySource: string;
  sender: string;
  approvalStatus: string;
  siteConfidence: string;
  contaminationRisk: string;
  eventCount: number;
  products: ProductSummary[];
  totalQty: number;
  additions: number;
  substitutions: number;
}

interface ProductSummary {
  code: string;
  name: string;
  qty: number;
  uom: string;
  uomResolved: boolean;
}

// ─── Anchor detection ───────────────────────────────────────────────────────

const MIN_PRODUCT_LINES_FOR_ANCHOR = 3;

const SITE_PATTERNS = [
  /dellow/i, /shuttleworth/i, /stratford/i,
  /wentworth\s*st/i, /\bDC\b/i, /dellow\s*centre/i,
  /for\s+dc\b/i, /at\s+dc\b/i,
];

const EXCLUDE_PATTERNS = [
  /friern\s*park/i, /antrim\s*mansion/i, /finchley/i, /133\s*friern/i,
];

// ─── Attachment patterns (forward scan) ─────────────────────────────────────

const ADDITION_PATTERNS = [
  /\balso\b/i, /\bextra\b/i, /\badd\b/i, /\bplus\b/i,
  /\bplease\s+add/i, /\bon\s+top/i, /\bas\s+well/i,
  /\bcan\s+(?:you|we)\s+(?:also|add)/i, /\bmore\b/i, /\btop\s+up/i,
];

const SUBSTITUTION_PATTERNS = [
  /\binstead\b/i, /\breplace/i, /\bswap/i, /\buse\s+.*instead/i,
  /\brather\s+than/i, /\bin\s+place\s+of/i, /\bsubstitut/i,
];

const CONFIRMATION_PATTERNS = [
  /\bconfirm/i, /\bapprov/i, /\bgo\s+ahead/i, /\byes\s+please/i,
  /\bproceed/i, /\ball\s+good/i, /\bthat'?s?\s+correct/i,
];

const ATTACHMENT_WINDOW_HOURS = 72;

// ─── Default config ─────────────────────────────────────────────────────────

export function getDellowConfig(siteId: string, caseId: string): OrderBuilderConfig {
  return {
    siteId,
    caseId,
    groupChatSourceIds: [],
    sitePatterns: SITE_PATTERNS,
    excludePatterns: EXCLUDE_PATTERNS,
  };
}

// ─── Core Builder ───────────────────────────────────────────────────────────

export async function buildOrders(config: OrderBuilderConfig): Promise<BuildResult> {
  const { siteId, caseId, sitePatterns, excludePatterns } = config;

  // Site activity (OrderGroup, OrderEvent) requires a customer. Resolve via the
  // site's default billing customer; fall back to single billable link.
  const siteForCustomer = await prisma.site.findUnique({
    where: { id: siteId },
    include: {
      siteCommercialLinks: {
        where: { isActive: true, billingAllowed: true },
        orderBy: [{ defaultBillingCustomer: "desc" }],
      },
    },
  });
  const resolvedCustomerId = siteForCustomer?.siteCommercialLinks[0]?.customerId;
  if (!resolvedCustomerId) {
    throw new Error(
      `Order builder cannot proceed: site ${siteId} has no active SiteCommercialLink ` +
      `with billingAllowed=true. A site must be linked to a billing customer before ` +
      `transactional orders can be created.`,
    );
  }

  const backlogCase = await prisma.backlogCase.findFirst({
    where: { id: caseId },
    include: { sourceGroups: { include: { sources: true } } },
  });
  if (!backlogCase) throw new Error("Backlog case not found");

  const groupChatSourceIds = config.groupChatSourceIds.length > 0
    ? config.groupChatSourceIds
    : backlogCase.sourceGroups
        .flatMap((g) => g.sources)
        .filter((s) => /group|DC/i.test(s.label))
        .map((s) => s.id);

  const whatsappSourceIds = backlogCase.sourceGroups
    .flatMap((g) => g.sources)
    .filter((s) => s.sourceType === "WHATSAPP")
    .map((s) => s.id);

  const sourceLabels: Record<string, string> = {};
  for (const g of backlogCase.sourceGroups) {
    for (const s of g.sources) sourceLabels[s.id] = s.label;
  }

  // ─── Step 1: Build timeline ─────────────────────────────────────────

  const messages = await prisma.backlogMessage.findMany({
    where: { sourceId: { in: whatsappSourceIds }, parsedOk: true },
    orderBy: { parsedTimestamp: "asc" },
  });

  const mediaItems = await prisma.mediaEvidence.findMany({
    where: {
      siteId,
      processingStatus: { in: ["EXTRACTED", "CLASSIFIED", "LINKED"] },
      candidateProducts: { isEmpty: false },
    },
    orderBy: { timestamp: "asc" },
  });

  interface TimelineItem {
    id: string;
    type: "message" | "media";
    sourceId: string;
    sender: string;
    timestamp: Date;
    rawText: string;
    productLines: ExtractedProductLine[];
    isGroupChat: boolean;
    siteConfidence: "CONFIRMED" | "PROBABLE" | "UNKNOWN_SITE" | "NOT_THIS_SITE";
    // Media-specific
    candidateProducts?: string[];
    candidateQtys?: Record<string, number> | null;
  }

  const timeline: TimelineItem[] = [];

  for (const msg of messages) {
    const isGroupChat = groupChatSourceIds.includes(msg.sourceId);
    const siteConf = getSiteConfidence(msg.rawText, isGroupChat, sitePatterns, excludePatterns);
    const productLines = extractProductLines(msg.rawText);

    timeline.push({
      id: msg.id,
      type: "message",
      sourceId: msg.sourceId,
      sender: msg.sender,
      timestamp: msg.parsedTimestamp,
      rawText: msg.rawText,
      productLines,
      isGroupChat,
      siteConfidence: siteConf,
    });
  }

  for (const media of mediaItems) {
    const isGroupChat = media.sourceChat ? groupChatSourceIds.includes(media.sourceChat) : false;
    const text = media.extractedText || media.rawText || "";
    const siteConf = getSiteConfidence(text, isGroupChat, sitePatterns, excludePatterns);

    // Build product lines from pre-extracted candidates
    const productLines: ExtractedProductLine[] = [];
    const qtys = (media.candidateQtys as Record<string, number>) || {};
    for (const code of media.candidateProducts || []) {
      const qty = qtys[code] || 0;
      if (qty <= 0) continue;
      productLines.push({
        rawText: `${code}: ${qty} (OCR)`,
        productCode: code,
        productName: code,
        category: null,
        qty,
        rawUom: "EA",
        confidence: 70,
        lineIndex: 0,
      });
    }

    if (productLines.length === 0) continue;

    timeline.push({
      id: media.id,
      type: "media",
      sourceId: media.sourceChat || "",
      sender: media.sender || "UNKNOWN",
      timestamp: media.timestamp,
      rawText: text,
      productLines,
      isGroupChat,
      siteConfidence: siteConf,
      candidateProducts: media.candidateProducts || [],
      candidateQtys: qtys,
    });
  }

  timeline.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  // (debug removed)

  // ─── Step 2: Find anchors ──────────────────────────────────────────

  interface Anchor {
    item: TimelineItem;
    resolvedProducts: ExtractedProductLine[];
  }

  const anchors: Anchor[] = [];
  const usedIds = new Set<string>();

  // FIRST: Check paired messages (header + product list sent within 60s by same sender)
  // This catches "order for DC" + product list as a single anchor with inherited site confidence
  // Checks all pairs within 60s, not just adjacent in timeline (other chats may interleave)
  for (let i = 0; i < timeline.length; i++) {
    const a = timeline[i];
    if (usedIds.has(a.id)) continue;
    if (a.productLines.length >= MIN_PRODUCT_LINES_FOR_ANCHOR) continue; // a is already an anchor on its own

    // Look for a message from same sender within 60s that has products
    let b: TimelineItem | null = null;
    for (let j = i + 1; j < timeline.length; j++) {
      const candidate = timeline[j];
      if (candidate.timestamp.getTime() - a.timestamp.getTime() > 60000) break;
      if (candidate.sender === a.sender && !usedIds.has(candidate.id)) {
        const resolved = candidate.productLines.filter((pl) => pl.productCode !== null);
        if (resolved.length >= MIN_PRODUCT_LINES_FOR_ANCHOR) {
          b = candidate;
          break;
        }
      }
    }
    if (!b) continue;

    // If A has 0 products but B has 3+, combine as one anchor
    // Inherit the BEST site confidence from either message
    const combinedProducts = [...a.productLines, ...b.productLines];
    const resolved = combinedProducts.filter((pl) => pl.productCode !== null);
    if (resolved.length >= MIN_PRODUCT_LINES_FOR_ANCHOR && !usedIds.has(a.id)) {
      const combinedText = a.rawText + "\n" + b.rawText;
      const bestSiteConf = upgradeSiteConfidence(a.siteConfidence, b.siteConfidence);
      const bestIsGroupChat = a.isGroupChat || b.isGroupChat;
      // Re-evaluate site confidence on combined text
      const combinedSiteConf = getSiteConfidence(combinedText, bestIsGroupChat, sitePatterns, excludePatterns);
      const finalSiteConf = upgradeSiteConfidence(bestSiteConf, combinedSiteConf);

      anchors.push({
        item: {
          ...b,
          rawText: combinedText,
          productLines: combinedProducts,
          siteConfidence: finalSiteConf,
          isGroupChat: bestIsGroupChat,
        },
        resolvedProducts: resolved,
      });
      usedIds.add(a.id);
      usedIds.add(b.id);
    }
  }

  // THEN: Single message anchors (3+ resolved products, not already paired)
  for (let idx = 0; idx < timeline.length; idx++) {
    const item = timeline[idx];
    if (usedIds.has(item.id)) continue;
    if (item.siteConfidence === "NOT_THIS_SITE") continue;

    const resolved = item.productLines.filter((pl) => pl.productCode !== null);
    if (resolved.length < MIN_PRODUCT_LINES_FOR_ANCHOR) continue;

    // If UNKNOWN_SITE, check the raw text of the anchor + ALL nearby messages
    // for site patterns. Also check the original message text before line extraction
    // (the classifier strips context when extracting product lines).
    let finalItem = item;
    if (item.siteConfidence === "UNKNOWN_SITE") {
      // Re-check the full raw text for site patterns (might have been missed if
      // the product list was a separate message from the "order for DC" header)
      const fullCheck = getSiteConfidence(item.rawText, item.isGroupChat, sitePatterns, excludePatterns);
      if (fullCheck === "CONFIRMED" || fullCheck === "PROBABLE") {
        finalItem = { ...item, siteConfidence: fullCheck };
      } else {
        // Search same-sender messages within 5 min window for site context
        const ts = item.timestamp.getTime();
        let combinedText = item.rawText;
        let anyGroupChat = item.isGroupChat;
        const contextIds: string[] = [];

        for (let j = 0; j < timeline.length; j++) {
          const t = timeline[j];
          if (t.id === item.id) continue;
          if (t.sender !== item.sender) continue;
          const diff = Math.abs(t.timestamp.getTime() - ts);
          if (diff > 300000) continue; // 5 min window
          combinedText = t.rawText + "\n" + combinedText;
          if (t.isGroupChat) anyGroupChat = true;
          contextIds.push(t.id);
        }

        const combinedSiteConf = getSiteConfidence(combinedText, anyGroupChat, sitePatterns, excludePatterns);
        if (combinedSiteConf === "CONFIRMED" || combinedSiteConf === "PROBABLE") {
          finalItem = { ...item, rawText: combinedText, siteConfidence: combinedSiteConf };
          for (const cid of contextIds) usedIds.add(cid);
        }
      }

      // Still UNKNOWN after all checks — skip (anti-contamination)
      if (finalItem.siteConfidence === "UNKNOWN_SITE") continue;
    }

    anchors.push({ item: finalItem, resolvedProducts: resolved });
    usedIds.add(item.id);
  }

  // ─── Step 3: Clear existing and persist ─────────────────────────────

  const existingGroups = await prisma.orderGroup.findMany({
    where: { siteId },
    select: { id: true },
  });
  for (const eg of existingGroups) {
    await prisma.orderEvent.deleteMany({ where: { orderGroupId: eg.id } });
    await prisma.invoiceLineAllocation.deleteMany({ where: { orderGroupId: eg.id } });
  }
  if (existingGroups.length > 0) {
    await prisma.orderGroup.deleteMany({ where: { siteId } });
  }

  const result: BuildResult = {
    totalTimelineEvents: timeline.length,
    anchorsFound: anchors.length,
    ordersBuilt: 0,
    eventsCreated: 0,
    reviewItems: 0,
    orders: [],
  };

  for (const anchor of anchors) {
    const anchorItem = anchor.item;
    const isConfirmed = anchorItem.siteConfidence === "CONFIRMED" || anchorItem.siteConfidence === "PROBABLE";
    const contRisk = anchorItem.isGroupChat ? "LOW_RISK" : "HIGH_RISK";

    // Build product list from anchor
    const productMap = new Map<string, { code: string; qty: number; rawUom: string; lines: ExtractedProductLine[] }>();

    for (const pl of anchor.resolvedProducts) {
      if (!pl.productCode) continue;
      const existing = productMap.get(pl.productCode);
      if (existing) {
        existing.qty += pl.qty;
        existing.lines.push(pl);
      } else {
        productMap.set(pl.productCode, {
          code: pl.productCode,
          qty: pl.qty,
          rawUom: pl.rawUom,
          lines: [pl],
        });
      }
    }

    if (productMap.size === 0) continue;

    // ─── Step 3b: Forward scan for attachments ────────────────────────

    let additions = 0;
    let substitutions = 0;
    const attachedEvents: Array<{ item: TimelineItem; type: string; productLines: ExtractedProductLine[] }> = [];

    const anchorTs = anchorItem.timestamp.getTime();
    const windowMs = ATTACHMENT_WINDOW_HOURS * 60 * 60 * 1000;

    for (const item of timeline) {
      if (usedIds.has(item.id)) continue;
      if (item.timestamp.getTime() <= anchorTs) continue;
      if (item.timestamp.getTime() > anchorTs + windowMs) break;
      if (item.sender !== anchorItem.sender && !item.isGroupChat) continue;
      if (item.siteConfidence === "NOT_THIS_SITE") continue;
      if (item.productLines.length === 0) continue;

      // Check if products overlap with anchor
      const anchorCodes = new Set(productMap.keys());
      const hasOverlap = item.productLines.some((pl) => pl.productCode && anchorCodes.has(pl.productCode));

      const isAddition = ADDITION_PATTERNS.some((p) => p.test(item.rawText));
      const isSubstitution = SUBSTITUTION_PATTERNS.some((p) => p.test(item.rawText));
      const isConfirmation = CONFIRMATION_PATTERNS.some((p) => p.test(item.rawText));

      if (hasOverlap || isAddition || isSubstitution || isConfirmation) {
        let eventType = "ADDITION";
        if (isSubstitution) { eventType = "SUBSTITUTION_IN"; substitutions++; }
        else if (isConfirmation) eventType = "CONFIRMATION";
        else additions++;

        // Add products to map
        for (const pl of item.productLines) {
          if (!pl.productCode) continue;
          const existing = productMap.get(pl.productCode);
          if (existing) {
            if (eventType === "ADDITION" || eventType === "CONFIRMATION") {
              existing.qty += pl.qty;
            }
            existing.lines.push(pl);
          } else {
            productMap.set(pl.productCode, {
              code: pl.productCode,
              qty: pl.qty,
              rawUom: pl.rawUom,
              lines: [pl],
            });
          }
        }

        attachedEvents.push({ item, type: eventType, productLines: item.productLines });
        usedIds.add(item.id);
      }
    }

    // ─── Step 4: Create OrderGroup ────────────────────────────────────

    const dateStr = anchorItem.timestamp.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
    const firstName = anchorItem.sender.split(" ")[0];
    const productCodes = [...productMap.keys()];
    const productStr = productCodes.slice(0, 3).join(", ") + (productCodes.length > 3 ? ` +${productCodes.length - 3}` : "");

    const orderGroup = await prisma.orderGroup.create({
      data: {
        siteId,
        customerId: resolvedCustomerId,
        label: `${firstName} — ${dateStr} — ${productStr}`,
        description: `Anchor order: ${productCodes.length} products, ${1 + attachedEvents.length} events. Source: ${sourceLabels[anchorItem.sourceId] || anchorItem.sourceId}`,
        approvalStatus: isConfirmed ? "AUTO_APPROVED" as any : "PENDING_REVIEW" as any,
        siteConfidence: anchorItem.siteConfidence as any,
        contaminationRisk: contRisk as any,
        sourceChat: sourceLabels[anchorItem.sourceId] || anchorItem.sourceId,
        primarySender: anchorItem.sender,
      },
    });

    // Create OrderEvents for anchor
    let totalQty = 0;
    const productSummaries: ProductSummary[] = [];

    for (const [code, product] of productMap) {
      const cp = await prisma.canonicalProduct.findUnique({ where: { code } });
      if (!cp) {
        await prisma.reviewQueueItem.create({
          data: {
            queueType: "UNRESOLVED_PRODUCT",
            description: `Order Builder: product "${code}" not found in canonical products`,
            siteId,
            productCode: code,
            entityId: orderGroup.id,
            entityType: "OrderGroup",
          },
        });
        result.reviewItems++;
        continue;
      }

      const uomResult = await normaliseUom(cp.id, product.qty, product.rawUom, cp.canonicalUom);

      await prisma.orderEvent.create({
        data: {
          orderGroupId: orderGroup.id,
          canonicalProductId: cp.id,
          siteId,
          customerId: resolvedCustomerId,
          eventType: "INITIAL_ORDER",
          qty: product.qty,
          rawUom: product.rawUom,
          normalisedQty: uomResult.normalisedQty,
          canonicalUom: uomResult.canonicalUom,
          uomResolved: uomResult.uomResolved,
          sourceMessageId: anchorItem.id,
          sourceText: product.lines.map((l) => l.rawText).join(" | "),
          sourceType: anchorItem.type === "media" ? "MEDIA_OCR" as any : "TEXT_MESSAGE" as any,
          sourceConfidence: anchorItem.isGroupChat ? "HIGH" as any : "LOW" as any,
          siteConfidence: anchorItem.siteConfidence as any,
          contaminationRisk: contRisk as any,
          timestamp: anchorItem.timestamp,
        },
      });

      result.eventsCreated++;
      const qty = uomResult.uomResolved ? (uomResult.normalisedQty || product.qty) : product.qty;
      totalQty += qty;

      productSummaries.push({
        code,
        name: cp.name,
        qty: product.qty,
        uom: product.rawUom,
        uomResolved: uomResult.uomResolved,
      });

      if (!uomResult.uomResolved) {
        await prisma.reviewQueueItem.create({
          data: {
            queueType: "UOM_MISMATCH",
            description: `Order Builder: ${code} — ${product.rawUom} → ${cp.canonicalUom}`,
            siteId,
            productCode: code,
            entityId: orderGroup.id,
            entityType: "OrderGroup",
            rawValue: `${product.qty} ${product.rawUom}`,
          },
        });
        result.reviewItems++;
      }
    }

    // Create events for attachments
    for (const attached of attachedEvents) {
      for (const pl of attached.productLines) {
        if (!pl.productCode) continue;
        const cp = await prisma.canonicalProduct.findUnique({ where: { code: pl.productCode } });
        if (!cp) continue;

        const uomResult = await normaliseUom(cp.id, pl.qty, pl.rawUom, cp.canonicalUom);

        await prisma.orderEvent.create({
          data: {
            orderGroupId: orderGroup.id,
            canonicalProductId: cp.id,
            siteId,
            customerId: resolvedCustomerId,
            eventType: attached.type as any,
            qty: pl.qty,
            rawUom: pl.rawUom,
            normalisedQty: uomResult.normalisedQty,
            canonicalUom: uomResult.canonicalUom,
            uomResolved: uomResult.uomResolved,
            sourceMessageId: attached.item.id,
            sourceText: pl.rawText,
            sourceType: attached.item.type === "media" ? "MEDIA_OCR" as any : "TEXT_MESSAGE" as any,
            sourceConfidence: attached.item.isGroupChat ? "HIGH" as any : "LOW" as any,
            siteConfidence: attached.item.siteConfidence as any,
            contaminationRisk: (attached.item.isGroupChat ? "LOW_RISK" : "HIGH_RISK") as any,
            timestamp: attached.item.timestamp,
          },
        });
        result.eventsCreated++;
      }
    }

    // Update group total
    await prisma.orderGroup.update({
      where: { id: orderGroup.id },
      data: { orderedQty: totalQty },
    });

    result.ordersBuilt++;
    result.orders.push({
      id: orderGroup.id,
      label: orderGroup.label,
      anchorDate: anchorItem.timestamp.toISOString(),
      primarySource: sourceLabels[anchorItem.sourceId] || anchorItem.sourceId,
      sender: anchorItem.sender,
      approvalStatus: isConfirmed ? "AUTO_APPROVED" : "PENDING_REVIEW",
      siteConfidence: anchorItem.siteConfidence,
      contaminationRisk: contRisk,
      eventCount: 1 + attachedEvents.length,
      products: productSummaries,
      totalQty,
      additions,
      substitutions,
    });
  }

  return result;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function upgradeSiteConfidence(
  a: "CONFIRMED" | "PROBABLE" | "UNKNOWN_SITE" | "NOT_THIS_SITE",
  b: "CONFIRMED" | "PROBABLE" | "UNKNOWN_SITE" | "NOT_THIS_SITE"
): "CONFIRMED" | "PROBABLE" | "UNKNOWN_SITE" | "NOT_THIS_SITE" {
  const rank = { CONFIRMED: 3, PROBABLE: 2, UNKNOWN_SITE: 1, NOT_THIS_SITE: 0 };
  return rank[a] >= rank[b] ? a : b;
}

function getSiteConfidence(
  text: string,
  isGroupChat: boolean,
  sitePatterns: RegExp[],
  excludePatterns: RegExp[]
): "CONFIRMED" | "PROBABLE" | "UNKNOWN_SITE" | "NOT_THIS_SITE" {
  if (isGroupChat) return "CONFIRMED";
  for (const p of excludePatterns) { if (p.test(text)) return "NOT_THIS_SITE"; }
  for (const p of sitePatterns) { if (p.test(text)) return "PROBABLE"; }
  return "UNKNOWN_SITE";
}
