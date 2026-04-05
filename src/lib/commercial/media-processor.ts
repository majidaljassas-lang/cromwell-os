/**
 * Media Evidence Processor
 *
 * Scans BacklogMessages for media references (images, PDFs, documents, voice notes).
 * Creates MediaEvidence records for each media item found.
 * Classifies media by evidence role and extracts candidate order content.
 *
 * Media types supported:
 * - IMAGE: screenshots, photos of material lists, product images
 * - PDF: invoices, delivery notes, specification sheets
 * - DOCUMENT: forwarded files, spreadsheets
 * - VOICE_NOTE: voice messages (text extraction deferred)
 * - VIDEO: site videos (usually irrelevant to orders)
 *
 * Classification:
 * - ORDER_EVIDENCE: contains quantities, product names, material lists
 * - DELIVERY_EVIDENCE: delivery confirmation, POD, on-site photos
 * - INVOICE_EVIDENCE: invoice document, price reference
 * - PRODUCT_REFERENCE: product specs, catalogue reference
 * - IRRELEVANT: personal, unrelated media
 * - UNKNOWN_MEDIA: needs manual review
 */

import { prisma } from "@/lib/prisma";
import { normalizeProduct, extractQtyUnit } from "@/lib/reconciliation/normalizer";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MediaScanResult {
  totalMessages: number;
  mediaFound: number;
  created: number;
  skipped: number;
  byType: Record<string, number>;
  byRole: Record<string, number>;
}

export interface ExtractedMediaContent {
  productLines: {
    rawText: string;
    productCode: string | null;
    qty: number;
    rawUom: string;
    confidence: number;
  }[];
  evidenceRole: string;
  roleConfidence: string;
  classificationNotes: string;
}

// ─── Media detection patterns ───────────────────────────────────────────────

const MEDIA_PATTERNS = {
  image: [
    /‎?image omitted/i,
    /‎?\.(jpg|jpeg|png|gif|webp|heic|heif)\b/i,
    /‎?photo/i,
    /‎?screenshot/i,
  ],
  pdf: [
    /\.pdf\b/i,
    /‎?document omitted/i,
    /\d+\s*pages?\s+‎?document/i,
  ],
  document: [
    /\.(xlsx?|docx?|csv|txt)\b/i,
  ],
  voiceNote: [
    /‎?audio omitted/i,
    /‎?voice note/i,
    /‎?ptt-\d/i,
  ],
  video: [
    /‎?video omitted/i,
    /\.(mp4|mov|avi)\b/i,
  ],
};

// ─── Context classification patterns ────────────────────────────────────────

const ORDER_CONTEXT_PATTERNS = [
  /order/i, /material/i, /please\s+(get|send|order)/i,
  /need\s+(the\s+)?following/i, /quantity/i, /qty/i,
  /list/i, /schedule/i, /spec/i,
];

const DELIVERY_CONTEXT_PATTERNS = [
  /deliver/i, /arrived/i, /on\s+site/i, /received/i,
  /pod/i, /proof\s+of\s+delivery/i, /unload/i, /driver/i,
];

const INVOICE_CONTEXT_PATTERNS = [
  /invoice/i, /inv[\s-]?\d/i, /bill/i, /price/i,
  /quote/i, /amount/i, /total/i, /£\d/i,
];

const PRODUCT_REF_PATTERNS = [
  /catalogue/i, /spec\s*sheet/i, /data\s*sheet/i,
  /brochure/i, /technical/i, /product\s*ref/i,
];

// ─── Core Scanner ───────────────────────────────────────────────────────────

/**
 * Scan BacklogMessages for a case and create MediaEvidence records
 * for every media item detected.
 */
export async function scanForMedia(caseId: string, siteId: string): Promise<MediaScanResult> {
  // Get all sources for this case
  const sources = await prisma.backlogSource.findMany({
    where: { group: { caseId } },
    select: { id: true },
  });
  const sourceIds = sources.map((s) => s.id);

  if (sourceIds.length === 0) {
    return { totalMessages: 0, mediaFound: 0, created: 0, skipped: 0, byType: {}, byRole: {} };
  }

  // Fetch all messages
  const messages = await prisma.backlogMessage.findMany({
    where: { sourceId: { in: sourceIds } },
    orderBy: { parsedTimestamp: "asc" },
  });

  const result: MediaScanResult = {
    totalMessages: messages.length,
    mediaFound: 0,
    created: 0,
    skipped: 0,
    byType: {},
    byRole: {},
  };

  for (const msg of messages) {
    const mediaItems = detectMedia(msg);

    for (const media of mediaItems) {
      result.mediaFound++;

      // Check for existing record (idempotent)
      const existing = await prisma.mediaEvidence.findFirst({
        where: {
          backlogMessageId: msg.id,
          mediaType: media.mediaType as any,
        },
      });

      if (existing) {
        result.skipped++;
        continue;
      }

      // Classify based on surrounding context
      const classification = classifyMedia(msg, media);

      // Extract candidate products if it looks like order evidence
      let candidateProducts: string[] = [];
      let candidateQtys: Record<string, number> | null = null;

      if (classification.evidenceRole === "ORDER_EVIDENCE" && msg.rawText) {
        const extracted = extractFromContext(msg.rawText);
        candidateProducts = extracted.products;
        candidateQtys = extracted.qtys;
      }

      await prisma.mediaEvidence.create({
        data: {
          sourceChat: msg.sourceId,
          linkedMessageId: msg.id,
          backlogMessageId: msg.id,
          sender: msg.sender,
          timestamp: msg.parsedTimestamp,
          mediaType: media.mediaType as any,
          fileName: media.fileName,
          rawText: msg.rawText,
          processingStatus: "PENDING",
          evidenceRole: classification.evidenceRole as any,
          roleConfidence: classification.roleConfidence as any,
          classificationNotes: classification.notes,
          siteId,
          candidateProducts,
          candidateQtys: candidateQtys ? candidateQtys : undefined,
        },
      });

      result.created++;
      result.byType[media.mediaType] = (result.byType[media.mediaType] || 0) + 1;
      result.byRole[classification.evidenceRole] = (result.byRole[classification.evidenceRole] || 0) + 1;

      // Create review queue item for pending media
      await prisma.reviewQueueItem.create({
        data: {
          queueType: "MEDIA_PENDING",
          description: `${media.mediaType} from ${msg.sender} at ${msg.parsedTimestamp.toISOString().slice(0, 16)} — ${classification.evidenceRole}`,
          siteId,
          entityType: "MediaEvidence",
          rawValue: media.fileName || msg.rawText.slice(0, 100),
        },
      });
    }
  }

  // Update backlog completeness
  const mediaTotal = await prisma.mediaEvidence.count({
    where: { siteId },
  });
  const mediaProcessed = await prisma.mediaEvidence.count({
    where: { siteId, processingStatus: { in: ["EXTRACTED", "CLASSIFIED", "LINKED"] } },
  });
  const mediaExcluded = await prisma.mediaEvidence.count({
    where: { siteId, processingStatus: "EXCLUDED" },
  });

  await prisma.backlogCompleteness.upsert({
    where: { caseId },
    create: {
      caseId,
      totalMessages: messages.length,
      messagesProcessed: messages.length,
      totalMedia: mediaTotal,
      mediaProcessed,
      mediaExcluded,
      isComplete: false,
    },
    update: {
      totalMessages: messages.length,
      messagesProcessed: messages.length,
      totalMedia: mediaTotal,
      mediaProcessed,
      mediaExcluded,
      isComplete: mediaTotal === mediaProcessed + mediaExcluded,
    },
  });

  return result;
}

// ─── Media Detection ────────────────────────────────────────────────────────

interface DetectedMedia {
  mediaType: string;
  fileName: string | null;
}

function detectMedia(msg: { rawText: string; hasMedia: boolean; mediaType: string | null; mediaFilename: string | null; hasAttachment: boolean }): DetectedMedia[] {
  const results: DetectedMedia[] = [];
  const text = msg.rawText;

  // Check explicit media flags from backlog parser
  if (msg.hasMedia && msg.mediaType) {
    const type = mapMediaType(msg.mediaType);
    if (type) {
      results.push({ mediaType: type, fileName: msg.mediaFilename });
      return results; // Already detected
    }
  }

  // Check text for media references
  for (const [type, patterns] of Object.entries(MEDIA_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        const mappedType = type === "voiceNote" ? "VOICE_NOTE" : type.toUpperCase();
        // Avoid duplicates
        if (!results.some((r) => r.mediaType === mappedType)) {
          // Try to extract filename
          const filenameMatch = text.match(/([^\s/\\]+\.\w{2,5})\b/);
          results.push({
            mediaType: mappedType,
            fileName: filenameMatch ? filenameMatch[1] : null,
          });
        }
        break;
      }
    }
  }

  return results;
}

function mapMediaType(raw: string): string | null {
  const lower = raw.toLowerCase();
  if (lower.includes("image") || lower.includes("photo")) return "IMAGE";
  if (lower.includes("pdf")) return "PDF";
  if (lower.includes("audio") || lower.includes("voice") || lower.includes("ptt")) return "VOICE_NOTE";
  if (lower.includes("video")) return "VIDEO";
  if (lower.includes("document") || lower.includes("doc")) return "DOCUMENT";
  return null;
}

// ─── Classification ─────────────────────────────────────────────────────────

function classifyMedia(
  msg: { rawText: string; sender: string; messageType: string },
  media: DetectedMedia
): { evidenceRole: string; roleConfidence: string; notes: string } {
  const text = msg.rawText;
  const prevLines = text.split("\n").slice(0, 5).join(" "); // Context around media

  // Score each role
  const orderScore = matchCount(prevLines, ORDER_CONTEXT_PATTERNS);
  const deliveryScore = matchCount(prevLines, DELIVERY_CONTEXT_PATTERNS);
  const invoiceScore = matchCount(prevLines, INVOICE_CONTEXT_PATTERNS);
  const productScore = matchCount(prevLines, PRODUCT_REF_PATTERNS);

  // PDFs are likely invoices or specs
  if (media.mediaType === "PDF") {
    if (invoiceScore > 0) return { evidenceRole: "INVOICE_EVIDENCE", roleConfidence: "MEDIUM", notes: "PDF with invoice context" };
    if (productScore > 0) return { evidenceRole: "PRODUCT_REFERENCE", roleConfidence: "MEDIUM", notes: "PDF with product reference context" };
    return { evidenceRole: "UNKNOWN_MEDIA", roleConfidence: "LOW", notes: "PDF — needs review" };
  }

  // Voice notes — cannot extract text automatically, flag for review
  if (media.mediaType === "VOICE_NOTE") {
    if (orderScore > 0) return { evidenceRole: "ORDER_EVIDENCE", roleConfidence: "LOW", notes: "Voice note in order context — needs transcription" };
    return { evidenceRole: "UNKNOWN_MEDIA", roleConfidence: "LOW", notes: "Voice note — needs transcription review" };
  }

  // Images
  if (media.mediaType === "IMAGE") {
    if (orderScore > 0) return { evidenceRole: "ORDER_EVIDENCE", roleConfidence: "MEDIUM", notes: "Image in order context — may contain material list" };
    if (deliveryScore > 0) return { evidenceRole: "DELIVERY_EVIDENCE", roleConfidence: "MEDIUM", notes: "Image in delivery context — may be POD" };
    if (invoiceScore > 0) return { evidenceRole: "INVOICE_EVIDENCE", roleConfidence: "MEDIUM", notes: "Image in invoice context" };
    if (productScore > 0) return { evidenceRole: "PRODUCT_REFERENCE", roleConfidence: "MEDIUM", notes: "Image in product reference context" };
  }

  // Default
  const bestScore = Math.max(orderScore, deliveryScore, invoiceScore, productScore);
  if (bestScore === 0) {
    return { evidenceRole: "UNKNOWN_MEDIA", roleConfidence: "LOW", notes: "No context clues — needs manual review" };
  }

  if (orderScore === bestScore) return { evidenceRole: "ORDER_EVIDENCE", roleConfidence: "LOW", notes: "Weak order context" };
  if (deliveryScore === bestScore) return { evidenceRole: "DELIVERY_EVIDENCE", roleConfidence: "LOW", notes: "Weak delivery context" };
  if (invoiceScore === bestScore) return { evidenceRole: "INVOICE_EVIDENCE", roleConfidence: "LOW", notes: "Weak invoice context" };
  return { evidenceRole: "PRODUCT_REFERENCE", roleConfidence: "LOW", notes: "Weak product reference context" };
}

// ─── Content Extraction from Context ────────────────────────────────────────

function extractFromContext(text: string): { products: string[]; qtys: Record<string, number> } {
  const products: string[] = [];
  const qtys: Record<string, number> = {};

  const lines = text.split("\n");
  for (const line of lines) {
    const qtyUnit = extractQtyUnit(line);
    if (!qtyUnit) continue;

    const normalized = normalizeProduct(line);
    if (normalized.normalized !== "UNKNOWN") {
      if (!products.includes(normalized.normalized)) {
        products.push(normalized.normalized);
      }
      qtys[normalized.normalized] = (qtys[normalized.normalized] || 0) + qtyUnit.qty;
    }
  }

  return { products, qtys };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function matchCount(text: string, patterns: RegExp[]): number {
  let count = 0;
  for (const p of patterns) {
    if (p.test(text)) count++;
  }
  return count;
}

/**
 * Process a single MediaEvidence record — update its extracted text,
 * classification, and create candidate order events if applicable.
 */
export async function processMediaEvidence(
  mediaId: string,
  extractedText: string | null,
  evidenceRole: string,
  confidence: string
): Promise<void> {
  const media = await prisma.mediaEvidence.findUnique({ where: { id: mediaId } });
  if (!media) throw new Error("MediaEvidence not found");

  const updateData: Record<string, unknown> = {
    extractedText,
    evidenceRole,
    roleConfidence: confidence,
    processingStatus: extractedText ? "EXTRACTED" : "CLASSIFIED",
  };

  // If extracted text contains order content, extract candidates
  if (extractedText && evidenceRole === "ORDER_EVIDENCE") {
    const extracted = extractFromContext(extractedText);
    updateData.candidateProducts = extracted.products;
    updateData.candidateQtys = Object.keys(extracted.qtys).length > 0 ? extracted.qtys : undefined;
  }

  await prisma.mediaEvidence.update({
    where: { id: mediaId },
    data: updateData,
  });
}
