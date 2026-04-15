/**
 * OCR Runner — OCR_REQUIRED → PARSED (via rawText population).
 *
 * Maintains a pool of 2 Tesseract workers (one job at a time per worker).
 * Picks all IntakeDocument rows with status OCR_REQUIRED (oldest first),
 * renders each PDF page to an image via pdfjs-dist, OCRs every page, and
 * concatenates the result into rawText before transitioning to PARSED.
 *
 * Error thresholds mirror the queue's bumpRetry logic:
 *   retryCount < 3  → ERROR (will be retried after back-off)
 *   retryCount 3-4  → ERROR with escalated back-off
 *   retryCount >= 5 → DEAD_LETTER (bumpRetry handles this)
 */

import { prisma } from "@/lib/prisma";
import { markStatus, bumpRetry, pickNext } from "../queue";
import { fetchAttachment, refreshAccessToken } from "@/lib/microsoft/graph-client";
import fs from "fs/promises";
import path from "path";

// ─── Tesseract worker pool ───────────────────────────────────────────────────

const POOL_SIZE = 2;

interface PoolSlot {
  worker: import("tesseract.js").Worker;
  busy: boolean;
}

let pool: PoolSlot[] | null = null;

async function initPool(): Promise<PoolSlot[]> {
  if (pool) return pool;
  const { createWorker } = await import("tesseract.js");
  const slots: PoolSlot[] = [];
  for (let i = 0; i < POOL_SIZE; i++) {
    const worker = await createWorker("eng");
    slots.push({ worker, busy: false });
  }
  pool = slots;
  return pool;
}

async function terminatePool(): Promise<void> {
  if (!pool) return;
  await Promise.allSettled(pool.map((s) => s.worker.terminate()));
  pool = null;
}

/** Acquire a free slot, waiting (polling) until one is available. */
async function acquireSlot(slots: PoolSlot[]): Promise<PoolSlot> {
  while (true) {
    const free = slots.find((s) => !s.busy);
    if (free) {
      free.busy = true;
      return free;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}

function releaseSlot(slot: PoolSlot) {
  slot.busy = false;
}

// ─── PDF → per-page image rendering ─────────────────────────────────────────

async function renderPdfToImages(pdfBytes: Buffer): Promise<Buffer[]> {
  // pdfjs-dist is OPTIONAL — if it's not installed, OCR can't run and docs
  // stay in OCR_REQUIRED for manual review. Wrap in try/catch + use Function
  // constructor so the bundler can't follow the import statically.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let pdfjsLib: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, no-new-func
    const dyn = new Function("p", "return import(p)") as (p: string) => Promise<any>;
    pdfjsLib = await dyn("pdfjs-dist/legacy/build/pdf.mjs");
  } catch (e) {
    console.warn("[ocr] pdfjs-dist not installed — OCR skipped:", e instanceof Error ? e.message : e);
    return [];
  }

  // Suppress worker-thread warnings in Node
  pdfjsLib.GlobalWorkerOptions = pdfjsLib.GlobalWorkerOptions ?? {};
  pdfjsLib.GlobalWorkerOptions.workerSrc = "";

  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(pdfBytes) });
  const pdfDoc = await loadingTask.promise;
  const numPages: number = pdfDoc.numPages;

  // We need a Canvas implementation — use the 'canvas' package if available,
  // otherwise fall back to null (pages will yield empty OCR text and the doc
  // stays OCR_REQUIRED for manual review).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let createCanvas: ((w: number, h: number) => any) | null = null;
  try {
    // @ts-expect-error — 'canvas' has no bundled type declarations
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const canvasMod: any = await import("canvas");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createCanvas = (w: number, h: number) => (canvasMod.createCanvas as any)(w, h);
  } catch {
    createCanvas = null;
  }

  const images: Buffer[] = [];

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 2.0 }); // 2× scale for better OCR quality

    if (!createCanvas) {
      // Can't render without canvas — push empty buffer; OCR will yield ""
      images.push(Buffer.alloc(0));
      continue;
    }

    const canvas = createCanvas(Math.round(viewport.width), Math.round(viewport.height));
    const context = canvas.getContext("2d");

    await page.render({
      canvasContext: context,
      viewport,
    }).promise;

    // Export as PNG buffer
    const pngBuffer: Buffer = canvas.toBuffer("image/png");
    images.push(pngBuffer);
  }

  return images;
}

// ─── Outlook attachment resolution (mirrors pdf-parser logic) ────────────────

function isOutlookAttachmentId(fileRef: string): boolean {
  return !fileRef.startsWith("/") && !fileRef.startsWith(".");
}

async function resolveOutlookContext(
  ingestionEventId: string
): Promise<{ accessToken: string; outlookMessageId: string } | null> {
  const event = await prisma.ingestionEvent.findUnique({
    where: { id: ingestionEventId },
    select: { sourceId: true, rawPayload: true },
  });
  if (!event) return null;

  const payload = event.rawPayload as Record<string, unknown> | null;
  const outlookMessageId = payload?.id as string | undefined;
  if (!outlookMessageId) return null;

  const source = await prisma.ingestionSource.findUnique({
    where: { id: event.sourceId },
    select: { accessToken: true, refreshToken: true, tokenExpiresAt: true },
  });
  if (!source) return null;

  let accessToken = source.accessToken ?? "";
  const isExpired = !accessToken || (source.tokenExpiresAt && source.tokenExpiresAt <= new Date());
  if (isExpired && source.refreshToken) {
    try {
      const tokens = await refreshAccessToken(source.refreshToken);
      await prisma.ingestionSource.update({
        where: { id: event.sourceId },
        data: {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        },
      });
      accessToken = tokens.access_token;
    } catch {
      return null;
    }
  }

  if (!accessToken) return null;
  return { accessToken, outlookMessageId };
}

// ─── Single-document OCR ─────────────────────────────────────────────────────

async function ocrDocument(
  docId: string,
  slot: PoolSlot
): Promise<"PARSED" | "OCR_REQUIRED" | "ERROR"> {
  const doc = await prisma.intakeDocument.findUnique({ where: { id: docId } });
  if (!doc) return "ERROR";

  try {
    // Obtain raw bytes ────────────────────────────────────────────────────────
    let buf: Buffer | null = null;

    if (doc.fileRef) {
      if (doc.sourceType === "EMAIL" && isOutlookAttachmentId(doc.fileRef)) {
        if (!doc.ingestionEventId) {
          await markStatus(docId, "OCR_REQUIRED", {
            errorMessage: "EMAIL sourceType but no ingestionEventId — cannot fetch attachment for OCR",
          });
          return "OCR_REQUIRED";
        }
        const ctx = await resolveOutlookContext(doc.ingestionEventId);
        if (!ctx) {
          await markStatus(docId, "OCR_REQUIRED", {
            errorMessage: "Could not resolve Outlook token for OCR attachment fetch",
          });
          return "OCR_REQUIRED";
        }
        buf = await fetchAttachment(ctx.accessToken, ctx.outlookMessageId, doc.fileRef);
      } else {
        const resolved = path.isAbsolute(doc.fileRef)
          ? doc.fileRef
          : path.resolve(process.cwd(), doc.fileRef);
        buf = await fs.readFile(resolved);
      }
    }

    if (!buf || buf.length === 0) {
      await markStatus(docId, "OCR_REQUIRED", {
        errorMessage: "No bytes available for OCR — no fileRef or empty file",
      });
      return "OCR_REQUIRED";
    }

    // Render PDF pages to images then OCR each ────────────────────────────────
    const pageImages = await renderPdfToImages(buf);

    const pageTexts: string[] = [];
    for (const imgBuf of pageImages) {
      if (!imgBuf || imgBuf.length === 0) continue;
      const result = await slot.worker.recognize(imgBuf);
      pageTexts.push(result.data.text ?? "");
    }

    const fullText = pageTexts.join("\n").trim();

    if (fullText.length < 40) {
      // Not enough text — leave in OCR_REQUIRED for a manual pass rather than
      // burning retries; the extractor cannot do anything useful with < 40 chars.
      await markStatus(docId, "OCR_REQUIRED", {
        errorMessage: `OCR yielded only ${fullText.length} chars — may need manual review`,
      });
      return "OCR_REQUIRED";
    }

    // Persist and advance ─────────────────────────────────────────────────────
    await prisma.intakeDocument.update({
      where: { id: docId },
      data: { rawText: fullText },
    });
    await markStatus(docId, "PARSED", { errorMessage: null });

    // Async content-matcher rescore — same hook as the PDF text path
    try {
      const doc = await prisma.intakeDocument.findUnique({ where: { id: docId }, select: { ingestionEventId: true } });
      if (doc?.ingestionEventId) {
        const { reconsiderThreadMatchForEvent } = await import("@/lib/inbox/content-matcher");
        await reconsiderThreadMatchForEvent(doc.ingestionEventId);
      }
    } catch (rescoreErr) {
      console.warn(`[ocr-runner] rescore failed for doc ${docId}:`, rescoreErr instanceof Error ? rescoreErr.message : rescoreErr);
    }

    return "PARSED";
  } catch (e) {
    await bumpRetry(docId, e instanceof Error ? e.message : "OCR failed");
    return "ERROR";
  }
}

// ─── Public entry point ───────────────────────────────────────────────────────

/**
 * Process all IntakeDocument rows with status OCR_REQUIRED, oldest first.
 * Uses a pool of 2 Tesseract workers to parallelise page-level OCR.
 * Workers are always terminated in a finally block.
 */
export async function processOcrRequired(batchSize = 10): Promise<{ processed: number; errors: number }> {
  const docs = await pickNext("OCR_REQUIRED", batchSize);
  if (docs.length === 0) return { processed: 0, errors: 0 };

  const slots = await initPool();

  let processed = 0;
  let errors = 0;

  try {
    // Process docs concurrently, bounded by pool size
    await Promise.all(
      docs.map(async (doc) => {
        const slot = await acquireSlot(slots);
        try {
          const outcome = await ocrDocument(doc.id, slot);
          if (outcome === "PARSED") {
            processed++;
          } else if (outcome === "ERROR") {
            errors++;
          }
          // OCR_REQUIRED outcomes are not errors — they park for manual review
        } finally {
          releaseSlot(slot);
        }
      })
    );
  } finally {
    await terminatePool();
  }

  return { processed, errors };
}

/**
 * Single-document entry point kept for backward-compat with runWorker("ocr", id).
 * Allocates a fresh worker for this one job and terminates it immediately after.
 */
export async function runOcr(docId: string): Promise<"PARSED" | "OCR_REQUIRED" | "ERROR"> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng");
  const slot: PoolSlot = { worker, busy: true };
  try {
    return await ocrDocument(docId, slot);
  } finally {
    await worker.terminate();
  }
}
