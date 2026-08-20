import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/statements/recent?since=ISO&limit=N
 * Lists statement IntakeDocuments + the tasks they generated.
 * Used as the data source for the /statements page.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const since = url.searchParams.get("since");
  const limit = Math.min(Number(url.searchParams.get("limit") ?? "50"), 200);
  const supplierId = url.searchParams.get("supplierId");

  const where: Record<string, unknown> = { docType: "STATEMENT" };
  if (since) where.createdAt = { gte: new Date(since) };
  if (supplierId) {
    // The reconciler stores supplierId on extracted.supplierId. Prisma JSON
    // path filter narrows to statements that resolved to this supplier.
    where.extracted = { path: ["supplierId"], equals: supplierId };
  }

  const docs = await prisma.intakeDocument.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      createdAt: true,
      ingestionEventId: true,
      extracted: true,
      linkedTaskId: true,
    },
  });

  const eventIds = docs.map((d) => d.ingestionEventId).filter(Boolean) as string[];
  const events = eventIds.length
    ? await prisma.ingestionEvent.findMany({
        where: { id: { in: eventIds } },
        select: { id: true, rawPayload: true, receivedAt: true },
      })
    : [];
  const eventById = new Map(events.map((e) => [e.id, e]));

  const summaryTaskIds = docs.map((d) => d.linkedTaskId).filter(Boolean) as string[];
  const summaryTasks = summaryTaskIds.length
    ? await prisma.task.findMany({
        where: { id: { in: summaryTaskIds } },
        select: { id: true, status: true, priority: true, taskType: true, generatedReason: true, ticketId: true },
      })
    : [];
  const summaryTaskById = new Map(summaryTasks.map((t) => [t.id, t]));

  // Pull all open STATEMENT_UNMATCHED_BILL tasks for any of these statements'
  // related tickets so the summary can show "X open chases".
  const ticketIds = Array.from(new Set(summaryTasks.map((t) => t.ticketId).filter(Boolean) as string[]));
  const unmatchedTasks = ticketIds.length
    ? await prisma.task.findMany({
        where: { ticketId: { in: ticketIds }, taskType: "STATEMENT_UNMATCHED_BILL", status: "OPEN" },
        select: { id: true, generatedReason: true, ticketId: true },
      })
    : [];

  const rows = docs.map((d) => {
    const ext = (d.extracted ?? {}) as Record<string, unknown>;
    const sender = (ext.sender ?? {}) as { email?: string; name?: string };
    const subject = (ext.subject as string) ?? "";
    const summary = (ext.summary ?? {}) as { totalRefs?: number; matched?: number; unmatched?: number };
    const matches = Array.isArray(ext.matches) ? (ext.matches as Array<Record<string, unknown>>) : [];
    const sumTask = d.linkedTaskId ? summaryTaskById.get(d.linkedTaskId) : null;
    const evt = eventById.get(d.ingestionEventId ?? "");
    return {
      id: d.id,
      createdAt: d.createdAt,
      receivedAt: evt?.receivedAt ?? d.createdAt,
      sender: { email: sender.email ?? null, name: sender.name ?? null },
      subject,
      totalRefs: summary.totalRefs ?? matches.length,
      matched: summary.matched ?? matches.filter((m) => m.matched).length,
      unmatched: summary.unmatched ?? matches.filter((m) => !m.matched).length,
      summaryTask: sumTask
        ? {
            id: sumTask.id,
            status: sumTask.status,
            priority: sumTask.priority,
            ticketId: sumTask.ticketId,
            reason: sumTask.generatedReason,
          }
        : null,
      matches: matches.map((m) => ({
        ref: m.ref as string,
        matched: !!m.matched,
        source: ((m.source as string) ?? null) as "NATIVE" | "ZOHO_IMPORTED" | null,
        billId: (m.billId as string) ?? null,
        paymentStatus: (m.paymentStatus as string) ?? null,
      })),
    };
  });

  const totalsAcross = rows.reduce(
    (acc, r) => ({
      totalRefs: acc.totalRefs + r.totalRefs,
      matched: acc.matched + r.matched,
      unmatched: acc.unmatched + r.unmatched,
    }),
    { totalRefs: 0, matched: 0, unmatched: 0 },
  );

  return NextResponse.json({
    statements: rows,
    totals: {
      ...totalsAcross,
      statementCount: rows.length,
      openUnmatchedTasks: unmatchedTasks.length,
    },
  });
}
