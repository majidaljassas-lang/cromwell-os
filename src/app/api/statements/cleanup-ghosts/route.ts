import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * One-shot cleanup of ghost STATEMENT_UNMATCHED_BILL tasks.
 *
 * The first version of the statement reconciler had an over-greedy regex that
 * captured word fragments ("ING", "OICE"), date stamps ("2026-05", "30/04"),
 * net-terms pairs ("60-09"), and other non-invoice strings. Each of those
 * spawned a HIGH-priority chase task that will never auto-close because no
 * real bill matches.
 *
 * This endpoint scans every OPEN STATEMENT_UNMATCHED_BILL task, parses the
 * billNo out of its closesOnSignal matcher, and hard-deletes the ones that
 * fail the same `isLikelyBillRef` filter the new reconciler uses.
 *
 * Conservative: ambiguous refs stay (they may turn out to be real bills).
 */

const WORD_FRAGMENT_GARBAGE = new Set([
  "OICE", "OICES", "OICING", "ICES", "ICING", "ING", "OICE.",
  "STATEMENT", "STATEMENTS", "ACCOUNT", "TOTAL", "BALANCE", "DATE", "REF",
]);

function isLikelyBillRef(raw: string): boolean {
  const ref = raw.toUpperCase();
  if (WORD_FRAGMENT_GARBAGE.has(ref)) return false;
  if (/^\d{4}-\d{1,2}$/.test(ref)) return false;
  if (/^\d{1,2}[-/]\d{1,2}$/.test(ref)) return false;
  if (/^\d{1,2}[-/]\d{4}$/.test(ref)) return false;
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(ref)) return false;
  if (/^\d{1,2}-\d{1,2}$/.test(ref) && ref.length <= 5) return false;
  if (/^[A-Z]{2,5}$/.test(ref)) return false;
  if (/^\d{1,4}$/.test(ref)) return false;
  return true;
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun") === "1";

  const tasks = await prisma.task.findMany({
    where: { taskType: "STATEMENT_UNMATCHED_BILL", status: "OPEN" },
    select: { id: true, closesOnSignal: true, generatedReason: true },
  });

  const ghosts: Array<{ id: string; ref: string }> = [];
  const kept: Array<{ id: string; ref: string }> = [];

  for (const t of tasks) {
    const spec = t.closesOnSignal as { matcher?: { billNo?: string } } | null;
    const ref = spec?.matcher?.billNo ?? null;
    if (!ref) {
      ghosts.push({ id: t.id, ref: "(no ref in matcher)" });
      continue;
    }
    if (!isLikelyBillRef(ref)) {
      ghosts.push({ id: t.id, ref });
    } else {
      kept.push({ id: t.id, ref });
    }
  }

  let deleted = 0;
  if (!dryRun && ghosts.length > 0) {
    const res = await prisma.task.deleteMany({
      where: { id: { in: ghosts.map((g) => g.id) } },
    });
    deleted = res.count;
  }

  return NextResponse.json({
    inspected: tasks.length,
    ghostCount: ghosts.length,
    keptCount: kept.length,
    deleted,
    dryRun,
    sampleGhosts: ghosts.slice(0, 30).map((g) => g.ref),
  });
}
