/**
 * Surplus matcher — finds open TicketLines that could consume unresolved
 * StockExcessRecord rows.
 *
 * Public API:
 *   runSurplusMatcher({ limit? })
 *     Scan unresolved StockExcessRecords with excess > 0. Resolve each to
 *     a CanonicalProduct (back-filling StockExcessRecord.canonicalProductId
 *     and TicketLine.canonicalProductId when discovered). For every source,
 *     find open TicketLines on *other* tickets that need the same canonical
 *     product (or a substitution-family member) and have no
 *     ProcurementOrder raised yet. Create a SURPLUS_MATCH_AVAILABLE task
 *     on the source ticket AND the destination ticket. Idempotent — keyed
 *     on (stockExcessRecordId, destTicketLineId).
 *
 *   resolveCanonicalProduct(input)
 *     Resolve a CanonicalProduct from whatever identifiers are on hand
 *     (productCode, normalizedItemName, description). Order:
 *       1. productCode          → CanonicalProduct.code       (CODE)
 *       2. normalizedItemName   → CanonicalProduct.code       (CODE)
 *       3. normalizedItemName   → ProductNormalization.rawPattern
 *                               → CanonicalProduct.code       (CODE)
 *       4. normalizedItemName   → CanonicalProduct.aliases[]  (ALIAS)
 *       5. description          → CanonicalProduct.name       (NAME)
 *     Returns { canonicalProductId, code, confidence, method } — null id
 *     if nothing matched.
 *
 * This is the place that wires TicketLine/StockExcessRecord to the
 * canonical product hierarchy going forward. It does NOT invent
 * products, margins, or prices — if no canonical match is found the
 * record is skipped and picked up on a future sweep.
 *
 * Runs:
 *   • As a step in /api/automation/run-all (every 5 minutes).
 *   • As check 7 in the daily sweep, *before* the ageing check so
 *     fresh matches pre-empt "return to supplier" tasks.
 */

import { prisma } from "@/lib/prisma";

// ─── Public types ────────────────────────────────────────────────────────────

export interface ResolveCanonicalInput {
  productCode?: string | null;
  normalizedItemName?: string | null;
  description?: string | null;
}

export type CanonicalResolveConfidence =
  | "CODE"
  | "ALIAS"
  | "NAME"
  | "NONE";

export interface ResolveCanonicalResult {
  canonicalProductId: string | null;
  code: string | null;
  name: string | null;
  confidence: CanonicalResolveConfidence;
  method: string;
}

export interface SurplusMatch {
  stockExcessRecordId: string;
  sourceTicketId: string | null;
  sourceTicketLineId: string | null;
  destTicketLineId: string;
  destTicketId: string;
  canonicalProductId: string;
  canonicalCode: string;
  matchKind: "EXACT" | "SUBSTITUTION_FAMILY";
  sourceTaskId?: string;
  destTaskId: string;
  sourceTaskCreated: boolean;
  destTaskCreated: boolean;
}

export interface MatcherResult {
  ok: boolean;
  scanned: number;
  resolved: number;
  matchedPairs: number;
  tasksCreated: number;
  tasksAlreadyOpen: number;
  unresolved: number;
  errors: Array<{ stockExcessRecordId: string; error: string }>;
  matches: SurplusMatch[];
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function runSurplusMatcher(
  opts: { limit?: number } = {}
): Promise<MatcherResult> {
  const limit = Math.min(opts.limit ?? 100, 500);

  const records = await prisma.stockExcessRecord.findMany({
    where: {
      status: { notIn: ["RESOLVED", "CLOSED", "TRANSFERRED"] },
      treatment: { notIn: ["RESOLVED", "TRANSFERRED", "WRITE_OFF"] },
      excessCost: { gt: 0 },
    },
    select: {
      id: true,
      ticketLineId: true,
      canonicalProductId: true,
      description: true,
      excessCost: true,
      excessQty: true,
      supplierBillLine: {
        select: {
          productCode: true,
          normalizedItemName: true,
          description: true,
          extractedSku: true,
        },
      },
      ticketLine: {
        select: {
          id: true,
          ticketId: true,
          canonicalProductId: true,
          productCode: true,
          normalizedItemName: true,
          description: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  const result: MatcherResult = {
    ok: true,
    scanned: 0,
    resolved: 0,
    matchedPairs: 0,
    tasksCreated: 0,
    tasksAlreadyOpen: 0,
    unresolved: 0,
    errors: [],
    matches: [],
  };

  for (const rec of records) {
    try {
      result.scanned += 1;

      // Step 1: resolve canonical for this surplus record.
      let canonicalId = rec.canonicalProductId;
      if (!canonicalId) {
        const resolve = await resolveCanonicalProduct({
          productCode:
            rec.supplierBillLine?.productCode ??
            rec.ticketLine?.productCode ??
            rec.supplierBillLine?.extractedSku ??
            null,
          normalizedItemName:
            rec.supplierBillLine?.normalizedItemName ??
            rec.ticketLine?.normalizedItemName ??
            null,
          description:
            rec.description ??
            rec.ticketLine?.description ??
            rec.supplierBillLine?.description ??
            null,
        });
        if (resolve.canonicalProductId) {
          canonicalId = resolve.canonicalProductId;
          await prisma.stockExcessRecord.update({
            where: { id: rec.id },
            data: { canonicalProductId: canonicalId },
          });
          result.resolved += 1;
          // Back-fill source TicketLine if it has no canonical either.
          if (rec.ticketLine && !rec.ticketLine.canonicalProductId) {
            await prisma.ticketLine.update({
              where: { id: rec.ticketLine.id },
              data: { canonicalProductId: canonicalId },
            });
          }
        }
      }
      if (!canonicalId) {
        result.unresolved += 1;
        continue;
      }

      // Step 2: widen to substitution family (if allowed).
      const familyCanonicalIds = await expandToSubstitutionFamily(canonicalId);

      // Step 3: find candidate TicketLines. Different ticket, open, no PO raised.
      const sourceTicketId = rec.ticketLine?.ticketId ?? null;
      const candidateWhere: Record<string, unknown> = {
        canonicalProductId: { in: Array.from(familyCanonicalIds) },
        status: { notIn: ["FULLY_COSTED", "INVOICED", "MERGED"] },
        procurementLines: { none: {} },
      };
      if (sourceTicketId) {
        candidateWhere.ticketId = { not: sourceTicketId };
      }

      const candidates = await prisma.ticketLine.findMany({
        where: candidateWhere,
        select: {
          id: true,
          ticketId: true,
          canonicalProductId: true,
          description: true,
          qty: true,
          ticket: { select: { ticketNo: true, title: true } },
        },
        orderBy: { createdAt: "asc" },
        take: 10,
      });

      if (candidates.length === 0) continue;

      // Look up canonical and source ticket metadata once per record.
      const [canonical, sourceTicket] = await Promise.all([
        prisma.canonicalProduct.findUnique({
          where: { id: canonicalId },
          select: { code: true, name: true },
        }),
        sourceTicketId
          ? prisma.ticket.findUnique({
              where: { id: sourceTicketId },
              select: { ticketNo: true, title: true },
            })
          : Promise.resolve(null),
      ]);

      for (const cand of candidates) {
        const matchKind: SurplusMatch["matchKind"] =
          cand.canonicalProductId === canonicalId
            ? "EXACT"
            : "SUBSTITUTION_FAMILY";

        const matchSelector = {
          stockExcessRecordId: rec.id,
          destTicketLineId: cand.id,
        };

        const bodyCommon = {
          canonical: {
            code: canonical?.code ?? "?",
            name: canonical?.name ?? "?",
          },
          matchKind,
          sourceTicket: sourceTicket
            ? { ticketNo: sourceTicket.ticketNo, title: sourceTicket.title }
            : null,
          destTicket: cand.ticket
            ? { ticketNo: cand.ticket.ticketNo, title: cand.ticket.title }
            : null,
          excessQty: rec.excessQty,
          excessCost: Number(rec.excessCost),
          destQty: Number(cand.qty),
        };

        // Source-side task (skip if we had no sourceTicketId).
        let sourceTaskId: string | undefined;
        let sourceTaskCreated = false;
        if (sourceTicketId && rec.ticketLine) {
          const srcTask = await ensureOpenTask({
            ticketId: sourceTicketId,
            ticketLineId: rec.ticketLine.id,
            taskType: "SURPLUS_MATCH_AVAILABLE",
            priority: "HIGH",
            dueAt: endOfToday(),
            generatedReason:
              `Surplus £${Number(rec.excessCost).toFixed(2)}` +
              ` (${rec.excessQty ?? "?"} units) of "${canonical?.name ?? canonical?.code ?? "?"}"` +
              ` could be transferred to ticket #${cand.ticket?.ticketNo ?? "?"}.`,
            draftBody: buildSurplusMatchBody({ ...bodyCommon, side: "source" }),
            matchSelector,
          });
          sourceTaskId = srcTask.id;
          sourceTaskCreated = srcTask.created;
        }

        // Destination-side task.
        const destTask = await ensureOpenTask({
          ticketId: cand.ticketId,
          ticketLineId: cand.id,
          taskType: "SURPLUS_MATCH_AVAILABLE",
          priority: "HIGH",
          dueAt: endOfToday(),
          generatedReason:
            `Ticket #${cand.ticket?.ticketNo ?? "?"} needs ${cand.qty}` +
            ` ${canonical?.name ?? canonical?.code ?? "?"} — surplus available` +
            ` from ticket #${sourceTicket?.ticketNo ?? "?"}.`,
          draftBody: buildSurplusMatchBody({
            ...bodyCommon,
            side: "destination",
          }),
          matchSelector,
        });

        const anyCreated = sourceTaskCreated || destTask.created;
        if (anyCreated) result.tasksCreated += 1;
        else result.tasksAlreadyOpen += 1;
        result.matchedPairs += 1;

        result.matches.push({
          stockExcessRecordId: rec.id,
          sourceTicketId,
          sourceTicketLineId: rec.ticketLine?.id ?? null,
          destTicketLineId: cand.id,
          destTicketId: cand.ticketId,
          canonicalProductId: canonicalId,
          canonicalCode: canonical?.code ?? "",
          matchKind,
          sourceTaskId,
          destTaskId: destTask.id,
          sourceTaskCreated,
          destTaskCreated: destTask.created,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push({ stockExcessRecordId: rec.id, error: msg });
      result.ok = false;
      console.error(`[surplus-matcher] record ${rec.id} failed:`, err);
    }
  }

  return result;
}

export async function resolveCanonicalProduct(
  input: ResolveCanonicalInput
): Promise<ResolveCanonicalResult> {
  // 1. productCode → CanonicalProduct.code
  if (input.productCode) {
    const cp = await prisma.canonicalProduct.findFirst({
      where: { code: input.productCode, isActive: true },
      select: { id: true, code: true, name: true },
    });
    if (cp) {
      return {
        canonicalProductId: cp.id,
        code: cp.code,
        name: cp.name,
        confidence: "CODE",
        method: "productCode=CanonicalProduct.code",
      };
    }
  }

  // 2. normalizedItemName → CanonicalProduct.code
  if (input.normalizedItemName) {
    const cp = await prisma.canonicalProduct.findFirst({
      where: { code: input.normalizedItemName, isActive: true },
      select: { id: true, code: true, name: true },
    });
    if (cp) {
      return {
        canonicalProductId: cp.id,
        code: cp.code,
        name: cp.name,
        confidence: "CODE",
        method: "normalizedItemName=CanonicalProduct.code",
      };
    }

    // 3. normalizedItemName via ProductNormalization rule → CanonicalProduct.code
    const rule = await prisma.productNormalization.findFirst({
      where: { rawPattern: input.normalizedItemName },
      select: { normalizedName: true },
    });
    if (rule) {
      const cp2 = await prisma.canonicalProduct.findFirst({
        where: { code: rule.normalizedName, isActive: true },
        select: { id: true, code: true, name: true },
      });
      if (cp2) {
        return {
          canonicalProductId: cp2.id,
          code: cp2.code,
          name: cp2.name,
          confidence: "CODE",
          method: "ProductNormalization.rawPattern→normalizedName→CanonicalProduct.code",
        };
      }
    }

    // 4. normalizedItemName in CanonicalProduct.aliases[]
    const cp3 = await prisma.canonicalProduct.findFirst({
      where: { aliases: { has: input.normalizedItemName }, isActive: true },
      select: { id: true, code: true, name: true },
    });
    if (cp3) {
      return {
        canonicalProductId: cp3.id,
        code: cp3.code,
        name: cp3.name,
        confidence: "ALIAS",
        method: "aliases.has(normalizedItemName)",
      };
    }
  }

  // 5. description → CanonicalProduct.name (exact, case-insensitive)
  if (input.description) {
    const cp = await prisma.canonicalProduct.findFirst({
      where: {
        name: { equals: input.description, mode: "insensitive" },
        isActive: true,
      },
      select: { id: true, code: true, name: true },
    });
    if (cp) {
      return {
        canonicalProductId: cp.id,
        code: cp.code,
        name: cp.name,
        confidence: "NAME",
        method: "description=CanonicalProduct.name (ci)",
      };
    }
  }

  return {
    canonicalProductId: null,
    code: null,
    name: null,
    confidence: "NONE",
    method: "unresolved",
  };
}

// ─── helpers ─────────────────────────────────────────────────────────────────

async function expandToSubstitutionFamily(
  canonicalId: string
): Promise<Set<string>> {
  const set = new Set<string>([canonicalId]);
  const memberships = await prisma.substitutionFamilyMember.findMany({
    where: {
      canonicalProductId: canonicalId,
      family: { substitutionAllowed: true },
    },
    select: {
      family: { select: { members: { select: { canonicalProductId: true } } } },
    },
  });
  for (const m of memberships) {
    for (const peer of m.family.members) set.add(peer.canonicalProductId);
  }
  return set;
}

interface EnsureOpenTaskInput {
  ticketId: string;
  ticketLineId?: string;
  taskType: string;
  priority: string;
  dueAt: Date;
  generatedReason: string;
  draftBody: string;
  matchSelector?: Record<string, string>;
}

async function ensureOpenTask(
  input: EnsureOpenTaskInput
): Promise<{ id: string; created: boolean }> {
  const selectorFragments = input.matchSelector
    ? Object.entries(input.matchSelector).map(([k, v]) => `${k}=${v}`)
    : [];
  const reason = selectorFragments.length
    ? `${input.generatedReason} [${selectorFragments.join(" ")}]`
    : input.generatedReason;

  const where: Record<string, unknown> = {
    ticketId: input.ticketId,
    taskType: input.taskType,
    status: { notIn: ["DONE", "RESOLVED", "CLOSED", "REJECTED"] },
  };
  if (input.ticketLineId) where.ticketLineId = input.ticketLineId;
  if (selectorFragments.length) {
    where.AND = selectorFragments.map((frag) => ({
      generatedReason: { contains: frag },
    }));
  }

  const existing = await prisma.task.findFirst({
    where,
    select: { id: true },
  });
  if (existing) return { id: existing.id, created: false };

  const created = await prisma.task.create({
    data: {
      ticketId: input.ticketId,
      ticketLineId: input.ticketLineId,
      taskType: input.taskType,
      priority: input.priority,
      status: "OPEN",
      dueAt: input.dueAt,
      generatedReason: reason,
      draftBody: input.draftBody,
    },
    select: { id: true },
  });
  return { id: created.id, created: true };
}

function endOfToday(): Date {
  const d = new Date();
  d.setHours(17, 0, 0, 0);
  return d;
}

function buildSurplusMatchBody(args: {
  side: "source" | "destination";
  canonical: { code: string; name: string };
  matchKind: "EXACT" | "SUBSTITUTION_FAMILY";
  sourceTicket: { ticketNo: number; title: string } | null;
  destTicket: { ticketNo: number; title: string } | null;
  excessQty: unknown;
  excessCost: number;
  destQty: number;
}): string {
  const kindLabel =
    args.matchKind === "EXACT" ? "exact" : "substitution family";
  return [
    `Surplus transfer opportunity — ${args.canonical.name} (${args.canonical.code})`,
    `Match type : ${kindLabel}`,
    ``,
    `Source ticket : ${args.sourceTicket ? `#${args.sourceTicket.ticketNo} ${args.sourceTicket.title}` : "—"}`,
    `Dest ticket   : ${args.destTicket ? `#${args.destTicket.ticketNo} ${args.destTicket.title}` : "—"}`,
    `Surplus       : ${args.excessQty ?? "?"} units (£${args.excessCost.toFixed(2)} tied up)`,
    `Dest needs    : ${args.destQty}`,
    ``,
    args.side === "source"
      ? `Action (TRANSFER): create ReallocationRecord, reduce StockExcessRecord.excess, link cost to destination TicketLine. Supplier stays paid; we stop carrying cost.`
      : `Action (TRANSFER): accept surplus from source; we skip raising a ProcurementOrder for this line. Cost moves onto this ticket via ReallocationRecord.`,
    `Action (IGNORE) : skip this match; next sweep will re-offer if still available.`,
  ].join("\n");
}
