/**
 * Media OCR + Classification + Order Event Extraction
 *
 * Processes uploaded media files:
 * - Images: OCR via tesseract.js
 * - PDFs: text extraction via pdf-parse
 * - Voice notes: flagged for manual transcription (no local whisper)
 * - Documents: text extraction where possible
 *
 * Classification is based on extracted text content, not guesswork.
 * Order events are extracted from text with full provenance.
 */

import Tesseract from "tesseract.js";
import path from "path";
import fs from "fs";
import { prisma } from "@/lib/prisma";
import { normalizeProduct, extractQtyUnit } from "@/lib/reconciliation/normalizer";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ProcessedMedia {
  id: string;
  mediaType: string;
  fileName: string | null;
  extractedText: string | null;
  evidenceRole: string;
  roleConfidence: string;
  classificationNotes: string;
  candidateEvents: CandidateOrderEvent[];
  processingStatus: string;
  error: string | null;
}

export interface CandidateOrderEvent {
  rawText: string;
  productCode: string | null;
  productName: string | null;
  qty: number;
  rawUom: string;
  eventType: string;
  confidence: string;
  sourceType: string;
}

export interface BatchResult {
  totalProcessed: number;
  ocrSuccess: number;
  ocrFailed: number;
  voiceNotesFlagged: number;
  classified: Record<string, number>;
  candidateEventsFound: number;
  items: ProcessedMedia[];
}

// ─── Classification patterns ────────────────────────────────────────────────

const ORDER_PATTERNS = [
  /quantity\s*required/i, /order\s*(received|confirmed|number)/i,
  /material\s*(list|schedule|order)/i, /call\s*off/i,
  /delivery\s*qty/i, /please\s*(order|send|supply)/i,
  /\d+\s*(no|pcs|ea|m|m2)\b/i, /item\s+.*qty/i,
];

const DELIVERY_PATTERNS = [
  /deliver(y|ed)/i, /on\s*site/i, /install(ed|ation)/i,
  /proof\s*of\s*delivery/i, /pod\b/i, /received\b/i,
  /signed\b/i, /driver\b/i,
];

const INVOICE_PATTERNS = [
  /invoice\s*(no|number|#)/i, /inv[-\s]?\d/i,
  /amount\s*due/i, /payment\s*terms/i, /vat\b/i,
  /sub\s*total/i, /total\s*£/i, /net\s*amount/i,
];

const PRODUCT_REF_PATTERNS = [
  /product\s*schedule/i, /specification/i, /data\s*sheet/i,
  /technical/i, /proposal\s*no/i, /sku\b/i,
  /manufacturer/i, /catalogue/i, /brochure/i,
];

const IRRELEVANT_PATTERNS = [
  /whatsapp/i, /profile\s*photo/i, /sticker/i,
  /screenshot.*(?:call|chat|notification)/i,
];

// ─── Core processor ─────────────────────────────────────────────────────────

export async function processMediaBatch(
  siteId: string,
  limit?: number
): Promise<BatchResult> {
  // Get all PENDING media with actual files
  const media = await prisma.mediaEvidence.findMany({
    where: {
      siteId,
      processingStatus: "PENDING",
      filePath: { not: null },
    },
    orderBy: { timestamp: "asc" },
    take: limit || 500,
  });

  const result: BatchResult = {
    totalProcessed: 0,
    ocrSuccess: 0,
    ocrFailed: 0,
    voiceNotesFlagged: 0,
    classified: {},
    candidateEventsFound: 0,
    items: [],
  };

  for (const item of media) {
    const processed = await processOneMedia(item);
    result.totalProcessed++;
    result.items.push(processed);

    if (processed.extractedText) result.ocrSuccess++;
    else if (processed.mediaType !== "VOICE_NOTE" && processed.mediaType !== "VIDEO") result.ocrFailed++;
    if (processed.mediaType === "VOICE_NOTE") result.voiceNotesFlagged++;

    result.classified[processed.evidenceRole] = (result.classified[processed.evidenceRole] || 0) + 1;
    result.candidateEventsFound += processed.candidateEvents.length;

    // Persist results
    await prisma.mediaEvidence.update({
      where: { id: item.id },
      data: {
        extractedText: processed.extractedText,
        extractionMethod: processed.mediaType === "IMAGE" ? "TESSERACT_JS" :
                          processed.mediaType === "PDF" ? "PDF_PARSE" :
                          processed.mediaType === "VOICE_NOTE" ? "MANUAL_PENDING" : "NONE",
        evidenceRole: processed.evidenceRole as any,
        roleConfidence: processed.roleConfidence as any,
        classificationNotes: processed.classificationNotes,
        candidateProducts: processed.candidateEvents
          .map((e) => e.productCode)
          .filter((c): c is string => c !== null),
        candidateQtys: processed.candidateEvents.length > 0
          ? Object.fromEntries(
              processed.candidateEvents
                .filter((e) => e.productCode)
                .map((e) => [e.productCode!, e.qty])
            )
          : undefined,
        processingStatus: processed.processingStatus as any,
        processingError: processed.error,
      },
    });
  }

  return result;
}

async function processOneMedia(item: {
  id: string;
  mediaType: string;
  fileName: string | null;
  filePath: string | null;
  rawText: string | null;
}): Promise<ProcessedMedia> {
  const base: ProcessedMedia = {
    id: item.id,
    mediaType: item.mediaType,
    fileName: item.fileName,
    extractedText: null,
    evidenceRole: "UNKNOWN_MEDIA",
    roleConfidence: "LOW",
    classificationNotes: "",
    candidateEvents: [],
    processingStatus: "EXTRACTED",
    error: null,
  };

  try {
    switch (item.mediaType) {
      case "IMAGE":
        return await processImage(item, base);
      case "PDF":
        return await processPdf(item, base);
      case "VOICE_NOTE":
        return processVoiceNote(item, base);
      case "VIDEO":
        return processVideo(item, base);
      case "DOCUMENT":
        return processDocument(item, base);
      default:
        base.classificationNotes = `Unknown media type: ${item.mediaType}`;
        return base;
    }
  } catch (err) {
    base.error = err instanceof Error ? err.message : String(err);
    base.processingStatus = "FAILED";
    base.classificationNotes = `Processing failed: ${base.error}`;
    return base;
  }
}

// ─── Image processing (OCR) ────────────────────────────────────────────────

async function processImage(
  item: { id: string; filePath: string | null; rawText: string | null; fileName: string | null },
  base: ProcessedMedia
): Promise<ProcessedMedia> {
  if (!item.filePath) {
    base.error = "No file path";
    base.processingStatus = "FAILED";
    return base;
  }

  const absPath = path.join(process.cwd(), "public", item.filePath);
  if (!fs.existsSync(absPath)) {
    base.error = `File not found: ${absPath}`;
    base.processingStatus = "FAILED";
    return base;
  }

  // Check file size — skip very small images (likely icons/stickers)
  const stat = fs.statSync(absPath);
  if (stat.size < 5000) {
    base.evidenceRole = "IRRELEVANT";
    base.roleConfidence = "MEDIUM";
    base.classificationNotes = `Image too small (${stat.size} bytes) — likely icon or sticker`;
    base.processingStatus = "CLASSIFIED";
    return base;
  }

  // Run OCR
  try {
    const result = await Tesseract.recognize(absPath, "eng", {
      logger: () => {}, // suppress progress logs
    });

    const text = result.data.text.trim();
    const confidence = result.data.confidence;

    if (text.length < 5) {
      // No meaningful text — likely a photo, not a document
      base.extractedText = text || null;
      base.classificationNotes = `OCR returned minimal text (${text.length} chars, confidence ${confidence}%) — likely a site photo`;

      // Check if filename gives clues
      if (item.rawText && hasDeliveryContext(item.rawText)) {
        base.evidenceRole = "DELIVERY_EVIDENCE";
        base.roleConfidence = "LOW";
        base.classificationNotes += " — delivery context from message";
      } else {
        base.evidenceRole = "UNKNOWN_MEDIA";
        base.roleConfidence = "LOW";
      }
      base.processingStatus = "CLASSIFIED";
      return base;
    }

    base.extractedText = text;

    // Classify based on extracted text
    const classification = classifyByText(text);
    base.evidenceRole = classification.role;
    base.roleConfidence = classification.confidence;
    base.classificationNotes = `OCR: ${text.length} chars, engine confidence ${confidence}%. ${classification.notes}`;

    // Extract order events if order evidence
    if (classification.role === "ORDER_EVIDENCE") {
      base.candidateEvents = extractOrderEvents(text, "MEDIA_OCR", item.id);
    }

    base.processingStatus = "EXTRACTED";
    return base;
  } catch (ocrErr) {
    base.error = `OCR failed: ${ocrErr instanceof Error ? ocrErr.message : String(ocrErr)}`;
    base.processingStatus = "FAILED";
    return base;
  }
}

// ─── PDF processing ────────────────────────────────────────────────────────

async function processPdf(
  item: { id: string; filePath: string | null; rawText: string | null },
  base: ProcessedMedia
): Promise<ProcessedMedia> {
  if (!item.filePath) {
    base.error = "No file path";
    base.processingStatus = "FAILED";
    return base;
  }

  const absPath = path.join(process.cwd(), "public", item.filePath);
  if (!fs.existsSync(absPath)) {
    base.error = `File not found: ${absPath}`;
    base.processingStatus = "FAILED";
    return base;
  }

  try {
    // @ts-ignore — pdf-parse has no type declarations
    const pdfParse = (await import("pdf-parse")).default;
    const buffer = fs.readFileSync(absPath);
    const data = await pdfParse(buffer);
    const text = data.text.trim();

    base.extractedText = text;

    if (text.length < 10) {
      base.evidenceRole = "UNKNOWN_MEDIA";
      base.roleConfidence = "LOW";
      base.classificationNotes = "PDF with minimal extractable text";
      base.processingStatus = "CLASSIFIED";
      return base;
    }

    const classification = classifyByText(text);
    base.evidenceRole = classification.role;
    base.roleConfidence = classification.confidence;
    base.classificationNotes = `PDF: ${data.numpages} pages, ${text.length} chars. ${classification.notes}`;

    if (classification.role === "ORDER_EVIDENCE") {
      base.candidateEvents = extractOrderEvents(text, "MEDIA_OCR", item.id);
    }

    base.processingStatus = "EXTRACTED";
    return base;
  } catch (err) {
    base.error = `PDF parse failed: ${err instanceof Error ? err.message : String(err)}`;
    base.processingStatus = "FAILED";
    return base;
  }
}

// ─── Voice note processing ─────────────────────────────────────────────────

function processVoiceNote(
  item: { id: string; filePath: string | null; rawText: string | null },
  base: ProcessedMedia
): ProcessedMedia {
  // No local whisper — flag for manual transcription
  base.evidenceRole = "UNKNOWN_MEDIA";
  base.roleConfidence = "LOW";
  base.processingStatus = "PENDING";
  base.classificationNotes = "Voice note — requires manual transcription. No automated speech-to-text available.";

  // Use surrounding message context for initial classification
  if (item.rawText) {
    if (hasOrderContext(item.rawText)) {
      base.evidenceRole = "ORDER_EVIDENCE";
      base.roleConfidence = "LOW";
      base.classificationNotes += " Message context suggests order content.";
    } else if (hasDeliveryContext(item.rawText)) {
      base.evidenceRole = "DELIVERY_EVIDENCE";
      base.roleConfidence = "LOW";
      base.classificationNotes += " Message context suggests delivery content.";
    }
  }

  return base;
}

// ─── Video processing ──────────────────────────────────────────────────────

function processVideo(
  item: { id: string; filePath: string | null; rawText: string | null },
  base: ProcessedMedia
): ProcessedMedia {
  base.evidenceRole = "UNKNOWN_MEDIA";
  base.roleConfidence = "LOW";
  base.processingStatus = "PENDING";
  base.classificationNotes = "Video — requires manual review.";

  if (item.rawText && hasDeliveryContext(item.rawText)) {
    base.evidenceRole = "DELIVERY_EVIDENCE";
    base.roleConfidence = "LOW";
    base.classificationNotes += " Message context suggests site/delivery video.";
  }

  return base;
}

// ─── Document processing ───────────────────────────────────────────────────

function processDocument(
  item: { id: string; filePath: string | null; rawText: string | null },
  base: ProcessedMedia
): ProcessedMedia {
  // Without specific document parsers, flag for review
  base.evidenceRole = "UNKNOWN_MEDIA";
  base.roleConfidence = "LOW";
  base.processingStatus = "PENDING";
  base.classificationNotes = "Document — requires manual review or specific parser.";
  return base;
}

// ─── Text classification ───────────────────────────────────────────────────

function classifyByText(text: string): { role: string; confidence: string; notes: string } {
  const scores = {
    ORDER_EVIDENCE: matchCount(text, ORDER_PATTERNS),
    DELIVERY_EVIDENCE: matchCount(text, DELIVERY_PATTERNS),
    INVOICE_EVIDENCE: matchCount(text, INVOICE_PATTERNS),
    PRODUCT_REFERENCE: matchCount(text, PRODUCT_REF_PATTERNS),
    IRRELEVANT: matchCount(text, IRRELEVANT_PATTERNS),
  };

  const best = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [topRole, topScore] = best[0];
  const [secondRole, secondScore] = best[1];

  if (topScore === 0) {
    return { role: "UNKNOWN_MEDIA", confidence: "LOW", notes: "No classification patterns matched" };
  }

  // Check for quantity patterns — strong signal for ORDER_EVIDENCE
  const hasQtyLines = extractQtyLines(text).length > 0;
  if (hasQtyLines && topRole !== "ORDER_EVIDENCE") {
    // Override if we found quantities
    if (scores.ORDER_EVIDENCE > 0 || hasQtyLines) {
      return {
        role: "ORDER_EVIDENCE",
        confidence: "MEDIUM",
        notes: `Quantities detected in text. Also matched: ${topRole} (${topScore})`,
      };
    }
  }

  const confidence = topScore >= 3 ? "HIGH" :
                     topScore >= 2 ? "MEDIUM" :
                     topScore - secondScore >= 1 ? "MEDIUM" : "LOW";

  return {
    role: topRole,
    confidence,
    notes: `Matched ${topRole} with score ${topScore}. Runner-up: ${secondRole} (${secondScore})`,
  };
}

// ─── Order event extraction ────────────────────────────────────────────────

function extractOrderEvents(
  text: string,
  sourceType: string,
  mediaId: string
): CandidateOrderEvent[] {
  const events: CandidateOrderEvent[] = [];
  const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);

  for (const line of lines) {
    const qtyUnit = extractQtyUnit(line);
    if (!qtyUnit) continue;

    const normalized = normalizeProduct(line);
    const productCode = normalized.normalized !== "UNKNOWN" ? normalized.normalized : null;

    // Determine event type from context
    let eventType = "INITIAL_ORDER";
    if (/cancel|remove|don'?t/i.test(line)) eventType = "CANCELLATION";
    else if (/add|extra|also|plus/i.test(line)) eventType = "ADDITION";
    else if (/instead|replace|swap|substitut/i.test(line)) eventType = "SUBSTITUTION_IN";
    else if (/confirm|approved|order\s*received/i.test(line)) eventType = "CONFIRMATION";

    // Confidence based on product recognition
    const confidence = productCode ? (qtyUnit.qty > 0 ? "HIGH" : "MEDIUM") : "LOW";

    events.push({
      rawText: line,
      productCode,
      productName: productCode || line.slice(0, 60),
      qty: qtyUnit.qty,
      rawUom: qtyUnit.unit,
      eventType,
      confidence,
      sourceType,
    });
  }

  return events;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function matchCount(text: string, patterns: RegExp[]): number {
  let count = 0;
  for (const p of patterns) {
    if (p.test(text)) count++;
  }
  return count;
}

function hasOrderContext(text: string): boolean {
  return ORDER_PATTERNS.some((p) => p.test(text));
}

function hasDeliveryContext(text: string): boolean {
  return DELIVERY_PATTERNS.some((p) => p.test(text));
}

function extractQtyLines(text: string): string[] {
  return text.split(/\n/)
    .map((l) => l.trim())
    .filter((l) => extractQtyUnit(l) !== null);
}
