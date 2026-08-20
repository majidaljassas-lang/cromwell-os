import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureAttachmentsExtracted } from "@/lib/ingestion/ensure-attachments";
import { handleStatement } from "@/lib/ingestion/handlers/statement-handler";

/**
 * Re-run the statement reconciler against every existing STATEMENT
 * IntakeDocument. Used to repair statements created before the sender
 * extraction + Zoho fallback + tightened regex landed.
 *
 * For each statement: wipes its old summary + chase tasks, deletes the doc,
 * then re-runs handleStatement. The new doc takes its place with corrected
 * sender/supplierId/refs.
 *
 * Pass ?dryRun=1 to see counts without mutating.
 */
export async function POST(request: Request) {
  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun") === "1";

  const docs = await prisma.intakeDocument.findMany({
    where: { docType: "STATEMENT" },
    orderBy: { createdAt: "asc" },
    select: { id: true, ingestionEventId: true, linkedTaskId: true, extracted: true },
  });

  const results: Array<{
    oldId: string;
    newId: string | null;
    ok: boolean;
    deletedTasks: number;
    matched: number;
    unmatched: number;
    sender: string | null;
    note?: string;
  }> = [];

  for (const doc of docs) {
    if (!doc.ingestionEventId) {
      results.push({ oldId: doc.id, newId: null, ok: false, deletedTasks: 0, matched: 0, unmatched: 0, sender: null, note: "no ingestionEventId" });
      continue;
    }

    if (dryRun) {
      const ext = (doc.extracted ?? {}) as { matches?: Array<{ matched?: boolean }> };
      const m = ext.matches ?? [];
      results.push({
        oldId: doc.id,
        newId: null,
        ok: true,
        deletedTasks: 0,
        matched: m.filter((x) => x.matched).length,
        unmatched: m.filter((x) => !x.matched).length,
        sender: null,
        note: "dryRun",
      });
      continue;
    }

    try {
      await ensureAttachmentsExtracted(doc.ingestionEventId);

      const event = await prisma.ingestionEvent.findUnique({
        where: { id: doc.ingestionEventId },
        include: { parsedMessages: { orderBy: { createdAt: "desc" }, take: 1 } },
      });
      if (!event) {
        results.push({ oldId: doc.id, newId: null, ok: false, deletedTasks: 0, matched: 0, unmatched: 0, sender: null, note: "event not found" });
        continue;
      }

      const parsed = event.parsedMessages[0];
      const raw = (event.rawPayload ?? {}) as Record<string, unknown>;

      const { fromEmail, fromName } = extractSenderFromPayload(raw);
      const subject = typeof raw.subject === "string" ? raw.subject : "";
      const text = parsed?.extractedText ?? "";

      // Clean up the old tasks scoped to this statement's refs only.
      const oldMatches = ((doc.extracted ?? {}) as { matches?: Array<{ ref?: string }> }).matches ?? [];
      const oldRefs = oldMatches.map((m) => m.ref).filter(Boolean) as string[];

      let deletedTasks = 0;
      const oldSummaryTask = doc.linkedTaskId
        ? await prisma.task.findUnique({
            where: { id: doc.linkedTaskId },
            select: { id: true, ticketId: true },
          })
        : null;

      if (oldSummaryTask && oldRefs.length > 0) {
        const oldChase = await prisma.task.findMany({
          where: {
            ticketId: oldSummaryTask.ticketId,
            taskType: "STATEMENT_UNMATCHED_BILL",
            status: "OPEN",
          },
          select: { id: true, closesOnSignal: true },
        });
        const toDelete = oldChase
          .filter((t) => {
            const m = (t.closesOnSignal as { matcher?: { billNo?: string } } | null)?.matcher?.billNo;
            return m && oldRefs.includes(m);
          })
          .map((t) => t.id);
        if (toDelete.length > 0) {
          const r = await prisma.task.deleteMany({ where: { id: { in: toDelete } } });
          deletedTasks += r.count;
        }
      }
      if (oldSummaryTask) {
        await prisma.task.delete({ where: { id: oldSummaryTask.id } });
        deletedTasks += 1;
      }

      await prisma.intakeDocument.delete({ where: { id: doc.id } });

      const outcome = await handleStatement({
        eventId: event.id,
        classification: "STATEMENT",
        intent: "REACTION",
        subject,
        text,
        fromEmail,
        fromName,
        data: (parsed?.structuredData as Record<string, unknown>) ?? {},
      });

      // Re-read the new IntakeDocument to count matched/unmatched.
      let newMatched = 0;
      let newUnmatched = 0;
      if (outcome.intakeDocumentId) {
        const newDoc = await prisma.intakeDocument.findUnique({
          where: { id: outcome.intakeDocumentId },
          select: { extracted: true },
        });
        const m = ((newDoc?.extracted ?? {}) as { matches?: Array<{ matched?: boolean }> }).matches ?? [];
        newMatched = m.filter((x) => x.matched).length;
        newUnmatched = m.filter((x) => !x.matched).length;
      }

      results.push({
        oldId: doc.id,
        newId: outcome.intakeDocumentId ?? null,
        ok: outcome.success,
        deletedTasks,
        matched: newMatched,
        unmatched: newUnmatched,
        sender: fromEmail || fromName || null,
      });
    } catch (e) {
      results.push({
        oldId: doc.id,
        newId: null,
        ok: false,
        deletedTasks: 0,
        matched: 0,
        unmatched: 0,
        sender: null,
        note: e instanceof Error ? e.message : "unknown error",
      });
    }
  }

  const summary = results.reduce(
    (acc, r) => ({
      total: acc.total + 1,
      ok: acc.ok + (r.ok ? 1 : 0),
      failed: acc.failed + (r.ok ? 0 : 1),
      tasksDeleted: acc.tasksDeleted + r.deletedTasks,
      matched: acc.matched + r.matched,
      unmatched: acc.unmatched + r.unmatched,
    }),
    { total: 0, ok: 0, failed: 0, tasksDeleted: 0, matched: 0, unmatched: 0 },
  );

  return NextResponse.json({ summary, dryRun, results });
}

function extractSenderFromPayload(raw: Record<string, unknown>): { fromEmail: string; fromName: string } {
  const fromEmailField = typeof raw.fromEmail === "string" ? raw.fromEmail : null;
  const fromNameField = typeof raw.fromName === "string" ? raw.fromName : null;
  if (fromEmailField || fromNameField) {
    return { fromEmail: fromEmailField ?? "", fromName: fromNameField ?? "" };
  }
  const fromObj = raw.from as { emailAddress?: { address?: string; name?: string } } | string | undefined;
  if (fromObj && typeof fromObj === "object" && fromObj.emailAddress) {
    return {
      fromEmail: fromObj.emailAddress.address ?? "",
      fromName: fromObj.emailAddress.name ?? "",
    };
  }
  if (typeof fromObj === "string") {
    return { fromEmail: fromObj, fromName: "" };
  }
  return { fromEmail: "", fromName: "" };
}
