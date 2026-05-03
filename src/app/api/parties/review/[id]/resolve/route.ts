import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type ResolveBody = {
  action: "match" | "create" | "dismiss";
  targetId?: string;
  name?: string;
};

/**
 * Re-trigger upstream artefacts that were parked because of an unresolved
 * party. Returns counts so the API response can show the user what woke up.
 */
async function retriggerForResolvedItems(items: { entityType: string | null; entityId: string | null }[]) {
  const counts = { intakeDocs: 0, ingestionEvents: 0 };
  for (const it of items) {
    if (!it.entityType || !it.entityId) continue;
    if (it.entityType === "IntakeDocument") {
      const updated = await prisma.intakeDocument.updateMany({
        where: { id: it.entityId, status: "REVIEW_REQUIRED" },
        data: { status: "DOWNLOADED", errorMessage: null, nextAttemptAt: new Date() },
      });
      counts.intakeDocs += updated.count;
    } else if (it.entityType === "IngestionEvent") {
      const updated = await prisma.ingestionEvent.updateMany({
        where: { id: it.entityId, status: "NEEDS_TRIAGE" },
        data: { status: "CLASSIFIED" },
      });
      counts.ingestionEvents += updated.count;
    }
  }
  return counts;
}

/**
 * Find sibling open queue items with the same rawValue + queueType so a
 * single match/create resolves the whole batch (e.g. 5 parked bills from the
 * same unknown supplier all clear at once).
 */
async function resolveSiblings(
  queueType: string,
  rawValue: string | null,
  excludeId: string,
  resolvedValue: string,
) {
  if (!rawValue) return [];
  const siblings = await prisma.reviewQueueItem.findMany({
    where: {
      queueType: queueType as never,
      rawValue,
      id: { not: excludeId },
      status: { in: ["OPEN_REVIEW", "IN_PROGRESS_REVIEW"] },
    },
    select: { id: true, entityType: true, entityId: true },
  });
  if (siblings.length > 0) {
    await prisma.reviewQueueItem.updateMany({
      where: { id: { in: siblings.map((s) => s.id) } },
      data: { status: "RESOLVED", resolvedAt: new Date(), resolvedValue },
    });
  }
  return siblings;
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await req.json()) as ResolveBody;

  const item = await prisma.reviewQueueItem.findUnique({ where: { id } });
  if (!item) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (item.status !== "OPEN_REVIEW" && item.status !== "IN_PROGRESS_REVIEW") {
    return NextResponse.json({ error: `item already ${item.status}` }, { status: 409 });
  }

  if (body.action === "dismiss") {
    await prisma.reviewQueueItem.update({
      where: { id },
      data: { status: "DISMISSED", resolvedAt: new Date() },
    });
    return NextResponse.json({ ok: true });
  }

  const isSupplier = item.queueType === "UNRESOLVED_SUPPLIER";

  if (body.action === "match") {
    if (!body.targetId) return NextResponse.json({ error: "targetId required" }, { status: 400 });

    const target = isSupplier
      ? await prisma.supplier.findUnique({ where: { id: body.targetId }, select: { id: true, name: true } })
      : await prisma.customer.findUnique({ where: { id: body.targetId }, select: { id: true, name: true } });
    if (!target) return NextResponse.json({ error: "target not found" }, { status: 404 });

    if (isSupplier && item.rawValue) {
      const existsAlias = await prisma.supplierAlias.findFirst({
        where: { alias: { equals: item.rawValue, mode: "insensitive" }, supplierId: target.id },
      });
      if (!existsAlias) {
        await prisma.supplierAlias.create({
          data: { supplierId: target.id, alias: item.rawValue, source: "USER" },
        });
      }
    }
    if (!isSupplier && item.rawValue) {
      const existsAlias = await prisma.customerAlias.findFirst({
        where: { aliasText: { equals: item.rawValue, mode: "insensitive" }, customerId: target.id },
      });
      if (!existsAlias) {
        await prisma.customerAlias.create({
          data: { customerId: target.id, aliasText: item.rawValue, manualConfirmed: true, aliasSource: "MANUAL_REVIEW" },
        });
      }
    }

    await prisma.reviewQueueItem.update({
      where: { id },
      data: { status: "RESOLVED", resolvedAt: new Date(), resolvedValue: target.id },
    });
    const siblings = await resolveSiblings(item.queueType, item.rawValue, item.id, target.id);
    const retrig = await retriggerForResolvedItems([item, ...siblings]);
    return NextResponse.json({
      ok: true,
      matchedTo: { id: target.id, name: target.name },
      siblingsResolved: siblings.length,
      retriggered: retrig,
    });
  }

  if (body.action === "create") {
    const name = (body.name ?? item.rawValue ?? "").trim();
    if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });

    const created = isSupplier
      ? await prisma.supplier.create({ data: { name }, select: { id: true, name: true } })
      : await prisma.customer.create({ data: { name }, select: { id: true, name: true } });

    if (isSupplier && item.rawValue && item.rawValue.toLowerCase() !== name.toLowerCase()) {
      await prisma.supplierAlias.create({
        data: { supplierId: created.id, alias: item.rawValue, source: "USER" },
      });
    }
    if (!isSupplier && item.rawValue && item.rawValue.toLowerCase() !== name.toLowerCase()) {
      await prisma.customerAlias.create({
        data: { customerId: created.id, aliasText: item.rawValue, manualConfirmed: true, aliasSource: "MANUAL_REVIEW" },
      });
    }

    await prisma.reviewQueueItem.update({
      where: { id },
      data: { status: "RESOLVED", resolvedAt: new Date(), resolvedValue: created.id },
    });
    const siblings = await resolveSiblings(item.queueType, item.rawValue, item.id, created.id);
    const retrig = await retriggerForResolvedItems([item, ...siblings]);
    return NextResponse.json({
      ok: true,
      created,
      siblingsResolved: siblings.length,
      retriggered: retrig,
    });
  }

  return NextResponse.json({ error: `unknown action ${String(body.action)}` }, { status: 400 });
}
