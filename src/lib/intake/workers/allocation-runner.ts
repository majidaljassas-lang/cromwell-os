/**
 * Allocation runner — AUTO_MATCHED → APPROVED (ready to post).
 *
 * Runs the allocation engine on every line of the parsed bill, producing
 * BillLineAllocation rows. Does not yet write CostAllocation / StockExcessRecord /
 * Return — that's post-runner's job.
 */

import { prisma } from "@/lib/prisma";
import { markStatus, bumpRetry } from "../queue";
import { allocateBillLine } from "../allocation-engine";

export async function runAllocator(docId: string): Promise<"APPROVED" | "REVIEW_REQUIRED" | "ERROR"> {
  const doc = await prisma.intakeDocument.findUnique({ where: { id: docId } });
  if (!doc || !doc.supplierBillId) return "ERROR";

  try {
    const lines = await prisma.supplierBillLine.findMany({
      where: { supplierBillId: doc.supplierBillId },
      select: { id: true },
    });

    let anyUnresolved = false;
    for (const l of lines) {
      const r = await allocateBillLine(l.id);
      if (r.hasUnresolved) anyUnresolved = true;
    }

    const next: "APPROVED" | "REVIEW_REQUIRED" = anyUnresolved ? "REVIEW_REQUIRED" : "APPROVED";
    await markStatus(docId, next, {
      errorMessage: anyUnresolved ? "One or more lines have UNRESOLVED surplus" : null,
    });
    return next;
  } catch (e) {
    await bumpRetry(docId, e instanceof Error ? e.message : "allocator failed");
    return "ERROR";
  }
}
