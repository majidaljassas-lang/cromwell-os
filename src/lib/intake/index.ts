/**
 * Intake engine — top-level orchestrator.
 *
 * runAllPending() walks each DocumentQueueStatus that has a downstream worker
 * and invokes it. Can be called from a cron, a scheduler, or /api/intake/queue.
 *
 * runWorker(name) invokes one named worker explicitly (for tests + manual triggers).
 */

import { pickNext, queueCounts } from "./queue";
import { runPdfParser }         from "./workers/pdf-parser";
import { runOcr, processOcrRequired } from "./workers/ocr-runner";
import { runBillExtractor }     from "./workers/bill-extractor";
import { runMatcher }           from "./workers/match-runner";
import { runAllocator }         from "./workers/allocation-runner";
import { runPoster }            from "./workers/post-runner";
import { runEmailPoller }       from "./workers/email-poller";

type WorkerName =
  | "email-poller"
  | "pdf-parser"
  | "ocr"
  | "bill-extractor"
  | "matcher"
  | "allocator"
  | "poster";

export async function runWorker(name: WorkerName, docId?: string) {
  switch (name) {
    case "email-poller":   return runEmailPoller();
    case "pdf-parser":     return runPdfParser(must(docId));
    case "ocr":            return runOcr(must(docId));
    case "bill-extractor": return runBillExtractor(must(docId));
    case "matcher":        return runMatcher(must(docId));
    case "allocator":      return runAllocator(must(docId));
    case "poster":         return runPoster(must(docId));
  }
}

function must(docId?: string): string {
  if (!docId) throw new Error("runWorker requires a docId for this worker");
  return docId;
}

export interface TickResult {
  counts: Record<string, number>;
  ticks: Array<{ stage: string; docId: string; outcome: string }>;
}

export async function runAllPending(batchSize = 10): Promise<TickResult> {
  const ticks: TickResult["ticks"] = [];

  // Priority: advance documents furthest along the pipeline first, to free capacity.
  const stages: Array<{ status: Parameters<typeof pickNext>[0]; run: (id: string) => Promise<string>; stage: string }> = [
    { status: "APPROVED",     run: async (id) => String(await runPoster(id)),        stage: "post" },
    { status: "AUTO_MATCHED", run: async (id) => String(await runAllocator(id)),     stage: "allocate" },
    { status: "PARSED",       run: async (id) => String(await runMatcher(id)),       stage: "match" },
    { status: "DOWNLOADED",   run: async (id) => String(await runBillExtractor(id)), stage: "extract" },
    { status: "NEW",          run: async (id) => String(await runPdfParser(id)),     stage: "pdf-parse" },
  ];

  for (const s of stages) {
    const rows = await pickNext(s.status, batchSize);
    for (const r of rows) {
      try {
        const outcome = await s.run(r.id);
        ticks.push({ stage: s.stage, docId: r.id, outcome });
      } catch (e) {
        ticks.push({ stage: s.stage, docId: r.id, outcome: `ERROR: ${e instanceof Error ? e.message : "unknown"}` });
      }
    }
  }

  // OCR_REQUIRED documents are processed as a pooled batch AFTER the pdf-parser pass
  // so any NEW→OCR_REQUIRED transitions from this tick are included.
  try {
    const ocrResult = await processOcrRequired(batchSize);
    if (ocrResult.processed > 0 || ocrResult.errors > 0) {
      ticks.push({
        stage: "ocr-batch",
        docId: "batch",
        outcome: `processed=${ocrResult.processed} errors=${ocrResult.errors}`,
      });
    }
  } catch (e) {
    ticks.push({ stage: "ocr-batch", docId: "batch", outcome: `ERROR: ${e instanceof Error ? e.message : "unknown"}` });
  }

  return { counts: await queueCounts(), ticks };
}
