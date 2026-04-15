/**
 * Match runner — PARSED → MATCH_PENDING → AUTO_MATCHED | REVIEW_REQUIRED.
 *
 * Wraps the multi-signal match-engine (Phase 4) and the legacy autoLinkBillLine.
 * Both are invoked — the new engine writes BillLineMatch rows, the legacy one
 * keeps CostAllocation behaviour unchanged. We take the strongest overall score
 * from the new engine to decide AUTO vs REVIEW.
 */

import { prisma } from "@/lib/prisma";
import { markStatus, bumpRetry } from "../queue";
import { matchBillLine } from "../match-engine";
import { detectDuplicate } from "./duplicate-detector";
import { autoLinkBillLine } from "@/lib/ingestion/auto-link-bill-line";

const AUTO_THRESHOLD    = 95;
const SUGGEST_THRESHOLD = 80;

export async function runMatcher(docId: string): Promise<"AUTO_MATCHED" | "REVIEW_REQUIRED" | "ERROR"> {
  const doc = await prisma.intakeDocument.findUnique({ where: { id: docId } });
  if (!doc || !doc.supplierBillId) return "ERROR";

  try {
    await markStatus(docId, "MATCH_PENDING", { errorMessage: null });

    // Duplicate check first — a definite duplicate should never auto-post
    const dup = await detectDuplicate(doc.supplierBillId);

    const lines = await prisma.supplierBillLine.findMany({
      where: { supplierBillId: doc.supplierBillId },
      select: { id: true },
    });

    let minConfidence = 100;
    for (const l of lines) {
      const match = await matchBillLine(l.id);
      if (match.best && Number(match.best.scores.overallConfidence) < minConfidence) {
        minConfidence = Number(match.best.scores.overallConfidence);
      } else if (!match.best) {
        minConfidence = 0;
      }
      // Keep the legacy auto-link running too so existing downstream code keeps working
      try { await autoLinkBillLine(l.id, "SYSTEM"); } catch { /* ignore — logged inside */ }
    }

    const nextStatus: "AUTO_MATCHED" | "REVIEW_REQUIRED" =
      dup.status === "DEFINITE" ? "REVIEW_REQUIRED"
      : minConfidence >= AUTO_THRESHOLD ? "AUTO_MATCHED"
      : "REVIEW_REQUIRED";

    await markStatus(docId, nextStatus, {
      errorMessage: nextStatus === "REVIEW_REQUIRED"
        ? (dup.status ? `Duplicate ${dup.status}` : `Min line confidence ${minConfidence.toFixed(0)} < ${AUTO_THRESHOLD}`)
        : null,
    });
    void SUGGEST_THRESHOLD; // reserved for future UI routing
    return nextStatus;
  } catch (e) {
    await bumpRetry(docId, e instanceof Error ? e.message : "matcher failed");
    return "ERROR";
  }
}
