import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { ensureAttachmentsExtracted } from "@/lib/ingestion/ensure-attachments";
import { handleStatement } from "@/lib/ingestion/handlers/statement-handler";

/**
 * Re-run the statement reconciler on an existing IntakeDocument.
 *
 * Used to repair the 19 statements created with the old (broken) sender
 * extraction + before attachment text was reaching the engine. Wipes the old
 * STATEMENT_RECONCILED + STATEMENT_UNMATCHED_BILL tasks for this statement,
 * re-runs handleStatement, and replaces the IntakeDocument's payload.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const doc = await prisma.intakeDocument.findUnique({
    where: { id },
    select: { id: true, ingestionEventId: true, docType: true, linkedTaskId: true, extracted: true },
  });
  if (!doc || doc.docType !== "STATEMENT") {
    return NextResponse.json({ error: "not a statement IntakeDocument" }, { status: 404 });
  }
  if (!doc.ingestionEventId) {
    return NextResponse.json({ error: "no ingestionEventId on document" }, { status: 400 });
  }

  // 1) Force attachment extraction now (the original handler may have skipped it).
  const ensureResult = await ensureAttachmentsExtracted(doc.ingestionEventId);

  // 2) Reload the event + parsed message after extraction may have appended PDF text.
  const event = await prisma.ingestionEvent.findUnique({
    where: { id: doc.ingestionEventId },
    include: { parsedMessages: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  if (!event) return NextResponse.json({ error: "event not found" }, { status: 404 });

  const parsed = event.parsedMessages[0];
  const raw = (event.rawPayload ?? {}) as Record<string, unknown>;

  const { fromEmail, fromName } = extractSenderFromPayload(raw);
  const subject = typeof raw.subject === "string" ? raw.subject : "";
  const text = parsed?.extractedText ?? "";

  // 3) Wipe the old tasks tied to this statement so we don't double-up.
  // The summary task is doc.linkedTaskId; the unmatched chase tasks share
  // their ticketId. We delete by ticketId + taskType, scoped to this run.
  const oldSummaryTask = doc.linkedTaskId
    ? await prisma.task.findUnique({
        where: { id: doc.linkedTaskId },
        select: { id: true, ticketId: true },
      })
    : null;
  let deletedTasks = 0;
  if (oldSummaryTask) {
    // Only delete chase tasks whose closesOnSignal references one of the OLD
    // refs from this document — narrow blast radius.
    const oldMatches = ((doc.extracted ?? {}) as { matches?: Array<{ ref?: string }> }).matches ?? [];
    const oldRefs = oldMatches.map((m) => m.ref).filter(Boolean) as string[];

    if (oldRefs.length > 0) {
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

    // Delete the summary task too so handleStatement creates a fresh one.
    await prisma.task.delete({ where: { id: oldSummaryTask.id } });
    deletedTasks += 1;
  }

  // 4) Delete the old IntakeDocument so handleStatement can create a fresh one
  //    keyed off the same eventId without unique-constraint issues.
  //    handleStatement uses sourceRef = ctx.eventId; we created the doc with the
  //    same. Delete by id.
  await prisma.intakeDocument.delete({ where: { id: doc.id } });

  // 5) Re-run.
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

  return NextResponse.json({
    ok: outcome.success,
    deletedTasks,
    ensureResult,
    sender: { fromEmail, fromName },
    textChars: text.length,
    outcome: {
      action: outcome.action,
      details: outcome.details,
      newIntakeDocumentId: outcome.intakeDocumentId,
    },
  });
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
