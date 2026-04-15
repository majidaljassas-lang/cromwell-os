/**
 * Invoice trigger — uninvoiced-delivery detection and client-invoice task
 * creation.
 *
 * Public API:
 *   checkInvoiceRequired(logisticsEventId)  — called from delivery-tracker
 *                                              when a delivery lands.
 *                                              Creates INVOICE_REQUIRED
 *                                              task if any TicketLine on
 *                                              the ticket lacks a
 *                                              SalesInvoiceLine.
 *   findUninvoicedDeliveries({ days?, limit? })
 *                                            — returns all delivered
 *                                              LogisticsEvents from the
 *                                              past `days` (default 7)
 *                                              that still have uninvoiced
 *                                              TicketLines. No side effects.
 *   sweepUninvoicedDeliveries({ days?, limit? })
 *                                            — calls findUninvoicedDeliveries
 *                                              then checkInvoiceRequired on
 *                                              every hit. Idempotent.
 *   resolveBillingCustomers(customerId)      — returns candidate billing
 *                                              entities (primary customer,
 *                                              parent, siblings, own
 *                                              subsidiaries, aliases).
 *                                              Never auto-selects.
 *
 * Pricing policy — we do NOT invent sale prices. suggestedTotal only sums
 * TicketLines that already have `actualSaleUnit` or `suggestedSaleUnit`.
 * benchmarkUnit is the supplier's price — ignored. Lines with no sale
 * price are flagged in the task body with "needs pricing".
 */

import { prisma } from "@/lib/prisma";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BillingCandidate {
  customerId: string;
  name: string;
  source: "ticket" | "parent-entity" | "sibling" | "subsidiary" | "alias";
  isBillingEntity: boolean;
}

export interface InvoiceCheckResult {
  ticketId: string;
  eventId?: string;
  created: boolean;
  taskId?: string;
  uninvoicedLineCount: number;
  suggestedTotal: number;
  linesNeedingPricing: number;
  billingCandidates: BillingCandidate[];
  message: string;
}

export interface UninvoicedDelivery {
  eventId: string;
  ticketId: string;
  ticketNo: number;
  ticketTitle: string;
  customerId: string;
  customerName: string;
  siteName: string | null;
  deliveredAt: Date;
  uninvoicedLineCount: number;
  suggestedTotal: number;
  linesNeedingPricing: number;
}

export interface FindUninvoicedDeliveriesResult {
  ok: boolean;
  scanned: number;
  uninvoicedCount: number;
  deliveries: UninvoicedDelivery[];
  errors: Array<{ eventId: string; error: string }>;
}

export interface SweepResult {
  ok: boolean;
  scanned: number;
  uninvoicedCount: number;
  tasksCreated: number;
  tasksAlreadyOpen: number;
  deliveries: Array<{
    eventId: string;
    ticketId: string;
    taskId?: string;
    created: boolean;
    suggestedTotal: number;
  }>;
  errors: Array<{ eventId: string; error: string }>;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export async function checkInvoiceRequired(
  logisticsEventId: string
): Promise<InvoiceCheckResult> {
  const event = await prisma.logisticsEvent.findUnique({
    where: { id: logisticsEventId },
    select: {
      id: true,
      ticketId: true,
      timestamp: true,
      deliveredAt: true,
      ticket: {
        select: {
          id: true,
          ticketNo: true,
          title: true,
          payingCustomerId: true,
          site: { select: { siteName: true } },
          payingCustomer: { select: { id: true, name: true } },
          lines: {
            select: {
              id: true,
              description: true,
              qty: true,
              suggestedSaleUnit: true,
              actualSaleUnit: true,
              invoiceLines: { select: { id: true } },
            },
          },
        },
      },
    },
  });

  if (!event || !event.ticket) {
    return {
      ticketId: "",
      created: false,
      uninvoicedLineCount: 0,
      suggestedTotal: 0,
      linesNeedingPricing: 0,
      billingCandidates: [],
      message: `LogisticsEvent ${logisticsEventId} not found or has no ticket`,
    };
  }

  const ticket = event.ticket;
  const uninvoicedLines = ticket.lines.filter(
    (l) => l.invoiceLines.length === 0
  );

  if (uninvoicedLines.length === 0) {
    return {
      ticketId: ticket.id,
      eventId: event.id,
      created: false,
      uninvoicedLineCount: 0,
      suggestedTotal: 0,
      linesNeedingPricing: 0,
      billingCandidates: [],
      message: "All TicketLines already have SalesInvoiceLine — no action",
    };
  }

  const priced = computePricedTotal(uninvoicedLines);
  const billingCandidates = await resolveBillingCustomers(
    ticket.payingCustomerId
  );

  // Idempotency: skip if open INVOICE_REQUIRED already exists for this ticket
  const existing = await prisma.task.findFirst({
    where: {
      ticketId: ticket.id,
      taskType: "INVOICE_REQUIRED",
      status: { notIn: ["DONE", "RESOLVED", "CLOSED", "REJECTED"] },
    },
    select: { id: true },
  });

  if (existing) {
    return {
      ticketId: ticket.id,
      eventId: event.id,
      created: false,
      taskId: existing.id,
      uninvoicedLineCount: uninvoicedLines.length,
      suggestedTotal: priced.total,
      linesNeedingPricing: priced.needsPricing,
      billingCandidates,
      message: "INVOICE_REQUIRED task already open",
    };
  }

  const draftBody = buildInvoiceRequiredBody({
    ticket: {
      ticketNo: ticket.ticketNo,
      title: ticket.title,
      customerName: ticket.payingCustomer.name,
      siteName: ticket.site?.siteName ?? null,
    },
    deliveredAt: event.deliveredAt ?? event.timestamp,
    uninvoicedLines,
    suggestedTotal: priced.total,
    linesNeedingPricing: priced.needsPricing,
    billingCandidates,
  });

  const pricingNote =
    priced.needsPricing > 0
      ? `, ${priced.needsPricing} line(s) need pricing`
      : "";
  const reason =
    `Delivered ${uninvoicedLines.length} uninvoiced line(s), suggested £${priced.total.toFixed(2)}` +
    pricingNote +
    ".";

  const task = await prisma.task.create({
    data: {
      ticketId: ticket.id,
      taskType: "INVOICE_REQUIRED",
      priority: "HIGH",
      status: "OPEN",
      dueAt: endOfToday(),
      generatedReason: reason,
      draftBody,
    },
    select: { id: true },
  });

  return {
    ticketId: ticket.id,
    eventId: event.id,
    created: true,
    taskId: task.id,
    uninvoicedLineCount: uninvoicedLines.length,
    suggestedTotal: priced.total,
    linesNeedingPricing: priced.needsPricing,
    billingCandidates,
    message: "INVOICE_REQUIRED task created",
  };
}

export async function findUninvoicedDeliveries(
  opts: { days?: number; limit?: number } = {}
): Promise<FindUninvoicedDeliveriesResult> {
  const days = opts.days ?? 7;
  const limit = Math.min(opts.limit ?? 200, 1000);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const events = await prisma.logisticsEvent.findMany({
    where: {
      OR: [{ stopStatus: "DELIVERED" }, { deliveredAt: { not: null } }],
      timestamp: { gte: since },
    },
    select: {
      id: true,
      ticketId: true,
      timestamp: true,
      deliveredAt: true,
      ticket: {
        select: {
          ticketNo: true,
          title: true,
          payingCustomerId: true,
          site: { select: { siteName: true } },
          payingCustomer: { select: { name: true } },
          lines: {
            select: {
              qty: true,
              actualSaleUnit: true,
              suggestedSaleUnit: true,
              invoiceLines: { select: { id: true } },
            },
          },
        },
      },
    },
    orderBy: { timestamp: "desc" },
    take: limit,
  });

  const result: FindUninvoicedDeliveriesResult = {
    ok: true,
    scanned: 0,
    uninvoicedCount: 0,
    deliveries: [],
    errors: [],
  };

  for (const event of events) {
    try {
      result.scanned += 1;
      if (!event.ticket) continue;
      const uninvoicedLines = event.ticket.lines.filter(
        (l) => l.invoiceLines.length === 0
      );
      if (uninvoicedLines.length === 0) continue;

      const priced = computePricedTotal(uninvoicedLines);

      result.uninvoicedCount += 1;
      result.deliveries.push({
        eventId: event.id,
        ticketId: event.ticketId,
        ticketNo: event.ticket.ticketNo,
        ticketTitle: event.ticket.title,
        customerId: event.ticket.payingCustomerId,
        customerName: event.ticket.payingCustomer.name,
        siteName: event.ticket.site?.siteName ?? null,
        deliveredAt: event.deliveredAt ?? event.timestamp,
        uninvoicedLineCount: uninvoicedLines.length,
        suggestedTotal: priced.total,
        linesNeedingPricing: priced.needsPricing,
      });
    } catch (err) {
      result.ok = false;
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push({ eventId: event.id, error: msg });
      console.error(`[find-uninvoiced] event ${event.id} failed:`, err);
    }
  }

  return result;
}

export async function sweepUninvoicedDeliveries(
  opts: { days?: number; limit?: number } = {}
): Promise<SweepResult> {
  const found = await findUninvoicedDeliveries(opts);

  const result: SweepResult = {
    ok: found.ok,
    scanned: found.scanned,
    uninvoicedCount: found.uninvoicedCount,
    tasksCreated: 0,
    tasksAlreadyOpen: 0,
    deliveries: [],
    errors: [...found.errors],
  };

  for (const d of found.deliveries) {
    try {
      const outcome = await checkInvoiceRequired(d.eventId);
      if (outcome.created) result.tasksCreated += 1;
      else if (outcome.taskId) result.tasksAlreadyOpen += 1;
      result.deliveries.push({
        eventId: d.eventId,
        ticketId: d.ticketId,
        taskId: outcome.taskId,
        created: outcome.created,
        suggestedTotal: outcome.suggestedTotal,
      });
    } catch (err) {
      result.ok = false;
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push({ eventId: d.eventId, error: msg });
      console.error(`[sweep-uninvoiced] event ${d.eventId} failed:`, err);
    }
  }

  return result;
}

export async function resolveBillingCustomers(
  customerId: string
): Promise<BillingCandidate[]> {
  const candidates: BillingCandidate[] = [];

  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: {
      id: true,
      name: true,
      isBillingEntity: true,
      parentCustomerEntityId: true,
      parentEntity: {
        select: { id: true, name: true, isBillingEntity: true },
      },
      subsidiaries: {
        select: { id: true, name: true, isBillingEntity: true },
      },
      customerAliases: {
        where: { isActive: true },
        select: { aliasText: true },
      },
    },
  });

  if (!customer) return candidates;

  // 1. The ticket's paying customer is always a candidate.
  candidates.push({
    customerId: customer.id,
    name: customer.name,
    source: "ticket",
    isBillingEntity: customer.isBillingEntity,
  });

  // 2. Parent billing entity.
  if (customer.parentEntity && customer.parentEntity.id !== customer.id) {
    candidates.push({
      customerId: customer.parentEntity.id,
      name: customer.parentEntity.name,
      source: "parent-entity",
      isBillingEntity: customer.parentEntity.isBillingEntity,
    });
  }

  // 3. Siblings sharing the same parent.
  if (customer.parentCustomerEntityId) {
    const siblings = await prisma.customer.findMany({
      where: {
        parentCustomerEntityId: customer.parentCustomerEntityId,
        id: { not: customer.id },
        isBillingEntity: true,
      },
      select: { id: true, name: true, isBillingEntity: true },
    });
    for (const s of siblings) {
      candidates.push({
        customerId: s.id,
        name: s.name,
        source: "sibling",
        isBillingEntity: s.isBillingEntity,
      });
    }
  }

  // 4. Own subsidiaries that are billing entities.
  for (const s of customer.subsidiaries) {
    if (s.isBillingEntity) {
      candidates.push({
        customerId: s.id,
        name: s.name,
        source: "subsidiary",
        isBillingEntity: s.isBillingEntity,
      });
    }
  }

  // 5. Name aliases — surfaced as hints, not separate billing entities.
  for (const a of customer.customerAliases) {
    candidates.push({
      customerId: customer.id,
      name: `${customer.name} — also known as "${a.aliasText}"`,
      source: "alias",
      isBillingEntity: customer.isBillingEntity,
    });
  }

  return candidates;
}

// ─── Back-compat export for Phase 3 call site ────────────────────────────────
// Phase 3's delivery-tracker imports triggerInvoiceCheck(ticketId). The
// Phase 4 public API takes logisticsEventId, so Phase 3 callers switch to
// checkInvoiceRequired(). This thin wrapper keeps older direct imports
// working until Phase 11 sweeps them.
export interface TriggerInvoiceCheckResult {
  ticketId: string;
  created: boolean;
  message: string;
}

export async function triggerInvoiceCheck(
  ticketId: string
): Promise<TriggerInvoiceCheckResult> {
  const latestEvent = await prisma.logisticsEvent.findFirst({
    where: {
      ticketId,
      OR: [{ stopStatus: "DELIVERED" }, { deliveredAt: { not: null } }],
    },
    orderBy: { timestamp: "desc" },
    select: { id: true },
  });
  if (!latestEvent) {
    return {
      ticketId,
      created: false,
      message: "No DELIVERED LogisticsEvent for ticket — skipping invoice check",
    };
  }
  const outcome = await checkInvoiceRequired(latestEvent.id);
  return {
    ticketId,
    created: outcome.created,
    message: outcome.message,
  };
}

// ─── helpers ─────────────────────────────────────────────────────────────────

interface PriceablePart {
  qty: unknown;
  actualSaleUnit: unknown;
  suggestedSaleUnit: unknown;
}

function computePricedTotal(
  lines: PriceablePart[]
): { total: number; needsPricing: number } {
  let total = 0;
  let needsPricing = 0;
  for (const l of lines) {
    const unit =
      l.actualSaleUnit != null
        ? Number(l.actualSaleUnit)
        : l.suggestedSaleUnit != null
          ? Number(l.suggestedSaleUnit)
          : null;
    if (unit === null || Number.isNaN(unit)) {
      needsPricing += 1;
      continue;
    }
    total += Number(l.qty) * unit;
  }
  return { total: Math.round(total * 100) / 100, needsPricing };
}

function endOfToday(): Date {
  const d = new Date();
  d.setHours(17, 0, 0, 0);
  return d;
}

function buildInvoiceRequiredBody(args: {
  ticket: {
    ticketNo: number;
    title: string;
    customerName: string;
    siteName: string | null;
  };
  deliveredAt: Date;
  uninvoicedLines: Array<{
    description: string;
    qty: unknown;
    suggestedSaleUnit: unknown;
    actualSaleUnit: unknown;
  }>;
  suggestedTotal: number;
  linesNeedingPricing: number;
  billingCandidates: BillingCandidate[];
}): string {
  const lines: string[] = [
    `Invoice required — ticket ${args.ticket.ticketNo} ${args.ticket.title}`,
    ``,
    `Client       : ${args.ticket.customerName}`,
    `Site         : ${args.ticket.siteName ?? "—"}`,
    `Delivered at : ${args.deliveredAt.toISOString().slice(0, 10)}`,
    ``,
    `Uninvoiced lines:`,
  ];

  for (const l of args.uninvoicedLines) {
    const hasActual = l.actualSaleUnit != null;
    const hasSuggested = l.suggestedSaleUnit != null;
    const unit = hasActual
      ? Number(l.actualSaleUnit)
      : hasSuggested
        ? Number(l.suggestedSaleUnit)
        : null;
    const desc =
      l.description.length > 60
        ? `${l.description.slice(0, 60)}…`
        : l.description;
    if (unit === null) {
      lines.push(`  • ${desc} — qty ${l.qty} — needs pricing`);
    } else {
      const total = Number(l.qty) * unit;
      const tag = hasActual ? "" : " (suggested)";
      lines.push(
        `  • ${desc} — qty ${l.qty} @ £${unit.toFixed(2)}${tag} = £${total.toFixed(2)}`
      );
    }
  }

  lines.push(``);
  lines.push(
    `Suggested invoice total: £${args.suggestedTotal.toFixed(2)}` +
      (args.linesNeedingPricing > 0
        ? ` (excludes ${args.linesNeedingPricing} line(s) without pricing)`
        : "")
  );
  lines.push(``);

  if (args.billingCandidates.length > 1) {
    lines.push(`Billing entity options (confirm one before invoice is raised):`);
    for (const c of args.billingCandidates) {
      const flag = c.isBillingEntity ? "✓" : "✗";
      lines.push(`  [${flag}] ${c.name} (source: ${c.source})`);
    }
  } else if (args.billingCandidates.length === 1) {
    lines.push(`Billing entity: ${args.billingCandidates[0].name}`);
  }

  return lines.join("\n");
}
