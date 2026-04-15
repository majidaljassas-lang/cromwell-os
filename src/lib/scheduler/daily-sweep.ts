/**
 * Daily ops sweep — runs 07:00 every day via external cron hitting
 * /api/scheduler/daily-sweep (which wraps this in runJob() and persists
 * the DailySweepResult to SchedulerLog.summary).
 *
 * Eight independent checks — any one failing does NOT stop the others.
 *
 *   1. OVERDUE_DELIVERY         PO raised 3+ days ago, no DELIVERED
 *                               LogisticsEvent → task per ticket.
 *   2. UNINVOICED_DELIVERIES    Delegates to sweepUninvoicedDeliveries
 *                               (Phase 4). Does NOT duplicate logic.
 *   3. CHASE_PAYMENT            SalesInvoice.dueDate within next 5 days,
 *                               no Payment, status ∉ DRAFT/VOID/PAID.
 *   4. PAYMENT_OVERDUE          SalesInvoice.dueDate past, no Payment.
 *                               Priority URGENT; 7+ days overdue → CRITICAL.
 *   5. CHASE_CREDIT_NOTE        ReturnLine.expectedCredit > 0, no linked
 *                               CreditNoteAllocation, returnDate 14+ days.
 *   6. SUPPLIER_DISPUTES_AGING  SupplierBill.matchStatus = DISPUTE
 *                               (not BillLineMatch — that's line-level
 *                               candidate scoring). Escalates existing
 *                               SUPPLIER_DISPUTE task: 3+ days → URGENT,
 *                               7+ days → CRITICAL.
 *   7. SURPLUS_STOCK_AGING      StockExcessRecord unresolved 7+ days
 *                               → SURPLUS_ACTION_REQUIRED. 14+ days
 *                               → RETURN_TO_SUPPLIER (separate task type).
 *   8. BANK_DETAIL_ALERTS       Task type BANK_DETAIL_CHANGE_ALERT open
 *                               for 1+ day with priority < CRITICAL
 *                               → escalate to CRITICAL.
 *
 * Task dedup: ensureOpenTask (local) keys on (ticketId, taskType,
 * status ∉ DONE/RESOLVED/CLOSED/REJECTED) plus optional supplierBillId /
 * ticketLineId / extra-selector so re-runs don't create duplicates.
 *
 * Pricing policy (reused from Phase 4): no fabrication. Chaser bodies
 * use invoice.totalSell and (totalSell − sum(payments)) for balance.
 */

import { prisma } from "@/lib/prisma";
import { sweepUninvoicedDeliveries } from "@/lib/finance/invoice-trigger";
import { runSurplusMatcher } from "@/lib/stock/surplus-matcher";
import { runMiscommDetection } from "@/lib/intelligence/miscomm-detector";
import { runBankDetailSweep } from "@/lib/suppliers/bank-detail-monitor";

// ─── Public types ────────────────────────────────────────────────────────────

export interface CategoryResult {
  ok: boolean;
  scanned: number;
  created: number;
  escalated: number;
  error?: string;
  detail?: Record<string, unknown>;
}

export interface DailySweepResult {
  ok: boolean;
  checked: number;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  categories: Record<string, CategoryResult>;
  errors: Array<{ category: string; error: string }>;
}

// ─── Public entry point ──────────────────────────────────────────────────────

export async function runDailySweep(): Promise<DailySweepResult> {
  const startedAt = new Date();
  const categories: Record<string, CategoryResult> = {};
  const errors: Array<{ category: string; error: string }> = [];

  const checks: Array<[string, () => Promise<CategoryResult>]> = [
    ["overdueDelivery", runOverdueDeliveries],
    ["uninvoicedDeliveries", runUninvoicedDeliveriesCheck],
    ["chasePayment", runChasePayment],
    ["paymentOverdue", runPaymentOverdue],
    ["chaseCreditNote", runChaseCreditNote],
    ["supplierDisputesAging", runSupplierDisputesAging],
    ["miscommDetection", runMiscommDetectionCheck],
    ["surplusMatching", runSurplusMatchingCheck],
    ["surplusStockAging", runSurplusStockAging],
    ["bankDetailSweep", runBankDetailSweepCheck],
    ["bankDetailAlerts", runBankDetailAlerts],
  ];

  for (const [name, fn] of checks) {
    try {
      categories[name] = await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      categories[name] = {
        ok: false,
        scanned: 0,
        created: 0,
        escalated: 0,
        error: msg,
      };
      errors.push({ category: name, error: msg });
      console.error(`[daily-sweep] ${name} failed:`, err);
    }
  }

  const finishedAt = new Date();
  const checked = Object.values(categories).reduce(
    (sum, c) => sum + c.created + c.escalated,
    0
  );

  return {
    ok: errors.length === 0,
    checked,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    categories,
    errors,
  };
}

// ─── Check 1: OVERDUE_DELIVERY ───────────────────────────────────────────────

async function runOverdueDeliveries(): Promise<CategoryResult> {
  const cutoff = daysAgo(3);
  const pos = await prisma.procurementOrder.findMany({
    where: {
      issuedAt: { lte: cutoff },
      status: { notIn: ["DELIVERED", "CANCELLED", "CLOSED"] },
    },
    select: {
      id: true,
      poNo: true,
      ticketId: true,
      issuedAt: true,
      deliveryDateExpected: true,
      supplier: { select: { name: true } },
      ticket: {
        select: {
          id: true,
          ticketNo: true,
          title: true,
          logisticsEvents: {
            select: {
              stopStatus: true,
              deliveredAt: true,
              eventType: true,
              timestamp: true,
            },
          },
        },
      },
    },
  });

  let created = 0;
  const seenTicketIds = new Set<string>();

  for (const po of pos) {
    if (!po.ticket) continue;
    if (isDelivered(po.ticket.logisticsEvents)) continue;
    if (seenTicketIds.has(po.ticket.id)) continue;
    seenTicketIds.add(po.ticket.id);

    const outcome = await ensureOpenTask({
      ticketId: po.ticket.id,
      taskType: "OVERDUE_DELIVERY",
      priority: "HIGH",
      dueAt: endOfToday(),
      generatedReason:
        `PO ${po.poNo} (${po.supplier.name}) raised ${daysSince(po.issuedAt!)}` +
        ` days ago, no confirmed delivery.`,
      draftBody: buildOverdueDeliveryBody(po),
    });
    if (outcome.created) created += 1;
  }

  return {
    ok: true,
    scanned: pos.length,
    created,
    escalated: 0,
    detail: { distinctTickets: seenTicketIds.size },
  };
}

// ─── Check 2: UNINVOICED_DELIVERIES — delegate to Phase 4 ────────────────────

async function runUninvoicedDeliveriesCheck(): Promise<CategoryResult> {
  const sweep = await sweepUninvoicedDeliveries({ days: 7 });
  return {
    ok: sweep.ok,
    scanned: sweep.scanned,
    created: sweep.tasksCreated,
    escalated: 0,
    detail: {
      uninvoicedCount: sweep.uninvoicedCount,
      tasksAlreadyOpen: sweep.tasksAlreadyOpen,
    },
  };
}

// ─── Check 3: CHASE_PAYMENT ──────────────────────────────────────────────────

async function runChasePayment(): Promise<CategoryResult> {
  const now = new Date();
  const in5 = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);

  const invoices = await prisma.salesInvoice.findMany({
    where: {
      dueDate: { gte: now, lte: in5 },
      paidAt: null,
      payments: { none: {} },
      status: { notIn: ["DRAFT", "CANCELLED", "VOID", "PAID"] },
    },
    select: {
      id: true,
      ticketId: true,
      invoiceNo: true,
      status: true,
      dueDate: true,
      issuedAt: true,
      totalSell: true,
      customer: { select: { name: true } },
      site: { select: { siteName: true } },
    },
  });

  let created = 0;
  for (const inv of invoices) {
    const daysLeft = daysSince(inv.dueDate!) * -1; // dueDate is in the future → negative → flip
    const outcome = await ensureOpenTask({
      ticketId: inv.ticketId,
      taskType: "CHASE_PAYMENT",
      priority: "NORMAL",
      dueAt: inv.dueDate!,
      generatedReason: `Invoice ${inv.invoiceNo ?? inv.id.slice(0, 8)} for £${Number(inv.totalSell).toFixed(2)} due in ${daysLeft} day(s).`,
      draftBody: buildChasePaymentBody({
        invoiceNo: inv.invoiceNo ?? inv.id.slice(0, 8),
        customerName: inv.customer.name,
        siteName: inv.site?.siteName ?? null,
        total: Number(inv.totalSell),
        dueDate: inv.dueDate!,
        daysLeft,
      }),
      matchSelector: { invoiceNo: inv.invoiceNo ?? inv.id.slice(0, 8) },
    });
    if (outcome.created) created += 1;
  }

  return { ok: true, scanned: invoices.length, created, escalated: 0 };
}

// ─── Check 4: PAYMENT_OVERDUE ────────────────────────────────────────────────

async function runPaymentOverdue(): Promise<CategoryResult> {
  const now = new Date();

  const invoices = await prisma.salesInvoice.findMany({
    where: {
      dueDate: { lt: now },
      paidAt: null,
      payments: { none: {} },
      status: { notIn: ["DRAFT", "CANCELLED", "VOID", "PAID"] },
    },
    select: {
      id: true,
      ticketId: true,
      invoiceNo: true,
      dueDate: true,
      totalSell: true,
      customer: { select: { name: true } },
      site: { select: { siteName: true } },
    },
  });

  let created = 0;
  let escalated = 0;

  for (const inv of invoices) {
    const overdueDays = daysSince(inv.dueDate!);
    const targetPriority = overdueDays >= 7 ? "CRITICAL" : "URGENT";

    const existing = await prisma.task.findFirst({
      where: {
        ticketId: inv.ticketId,
        taskType: "PAYMENT_OVERDUE",
        status: { notIn: ["DONE", "RESOLVED", "CLOSED", "REJECTED"] },
        generatedReason: { contains: `inv=${inv.invoiceNo ?? inv.id.slice(0, 8)}` },
      },
      select: { id: true, priority: true },
    });

    const reason = `PAYMENT_OVERDUE inv=${inv.invoiceNo ?? inv.id.slice(0, 8)} overdueDays=${overdueDays} amount=£${Number(inv.totalSell).toFixed(2)}`;
    const draft = buildPaymentOverdueBody({
      invoiceNo: inv.invoiceNo ?? inv.id.slice(0, 8),
      customerName: inv.customer.name,
      siteName: inv.site?.siteName ?? null,
      total: Number(inv.totalSell),
      dueDate: inv.dueDate!,
      overdueDays,
      targetPriority,
    });

    if (!existing) {
      await prisma.task.create({
        data: {
          ticketId: inv.ticketId,
          taskType: "PAYMENT_OVERDUE",
          priority: targetPriority,
          status: "OPEN",
          dueAt: endOfToday(),
          generatedReason: reason,
          draftBody: draft,
        },
      });
      created += 1;
    } else if (priorityRank(existing.priority) < priorityRank(targetPriority)) {
      await prisma.task.update({
        where: { id: existing.id },
        data: { priority: targetPriority, generatedReason: reason, draftBody: draft },
      });
      escalated += 1;
    }
  }

  return { ok: true, scanned: invoices.length, created, escalated };
}

// ─── Check 5: CHASE_CREDIT_NOTE ──────────────────────────────────────────────

async function runChaseCreditNote(): Promise<CategoryResult> {
  const cutoff = daysAgo(14);

  const returns = await prisma.return.findMany({
    where: {
      returnDate: { lte: cutoff },
      status: { notIn: ["CANCELLED", "VOID"] },
    },
    select: {
      id: true,
      ticketId: true,
      returnDate: true,
      status: true,
      supplier: { select: { name: true } },
      lines: {
        select: {
          id: true,
          expectedCredit: true,
          actualCredit: true,
          creditAllocations: { select: { id: true } },
        },
      },
    },
  });

  let created = 0;
  let scanned = 0;

  for (const r of returns) {
    scanned += 1;
    const unsettled = r.lines.filter(
      (l) =>
        l.expectedCredit != null &&
        Number(l.expectedCredit) > 0 &&
        l.creditAllocations.length === 0
    );
    if (unsettled.length === 0) continue;
    const expectedTotal = unsettled.reduce(
      (s, l) => s + Number(l.expectedCredit ?? 0),
      0
    );

    const outcome = await ensureOpenTask({
      ticketId: r.ticketId,
      taskType: "CHASE_CREDIT_NOTE",
      priority: "HIGH",
      dueAt: endOfToday(),
      generatedReason: `Return ${r.id.slice(0, 8)} (${r.supplier.name}) — expected £${expectedTotal.toFixed(2)}, no CreditNote after ${daysSince(r.returnDate)} days.`,
      draftBody: buildChaseCreditNoteBody({
        supplierName: r.supplier.name,
        returnRef: r.id.slice(0, 8),
        returnDate: r.returnDate,
        expectedTotal,
        unsettledLineCount: unsettled.length,
      }),
      matchSelector: { returnId: r.id },
    });
    if (outcome.created) created += 1;
  }

  return { ok: true, scanned, created, escalated: 0 };
}

// ─── Check 6: SUPPLIER_DISPUTES_AGING ────────────────────────────────────────

async function runSupplierDisputesAging(): Promise<CategoryResult> {
  const cutoff3d = daysAgo(3);
  const cutoff7d = daysAgo(7);

  const bills = await prisma.supplierBill.findMany({
    where: {
      matchStatus: "DISPUTE",
      matchedAt: { lte: cutoff3d },
    },
    select: {
      id: true,
      billNo: true,
      matchedAt: true,
      supplier: { select: { name: true } },
    },
  });

  let escalated = 0;
  let scanned = 0;

  for (const bill of bills) {
    scanned += 1;
    const age = daysSince(bill.matchedAt!);
    const targetPriority = age >= 7 ? "CRITICAL" : "URGENT";

    const tasks = await prisma.task.findMany({
      where: {
        supplierBillId: bill.id,
        taskType: "SUPPLIER_DISPUTE",
        status: { notIn: ["DONE", "RESOLVED", "CLOSED", "REJECTED"] },
      },
      select: { id: true, priority: true, generatedReason: true },
    });

    for (const task of tasks) {
      if (priorityRank(task.priority) < priorityRank(targetPriority)) {
        await prisma.task.update({
          where: { id: task.id },
          data: {
            priority: targetPriority,
            generatedReason:
              (task.generatedReason ?? "") +
              ` | escalated day ${age} → ${targetPriority}`,
          },
        });
        escalated += 1;
      }
    }
  }

  return { ok: true, scanned, created: 0, escalated };
}

// ─── Check 6b: MISCOMM_DETECTION — delegate to Phase 8 ───────────────────────

async function runMiscommDetectionCheck(): Promise<CategoryResult> {
  const r = await runMiscommDetection({ limit: 100, sinceHours: 96 });
  return {
    ok: r.ok,
    scanned: r.messagesScanned,
    created: r.tasksCreated,
    escalated: r.tasksAppended,
    error: r.errors.length
      ? r.errors.map((e) => `${e.ticketId}: ${e.error}`).join("; ")
      : undefined,
    detail: {
      ticketsScanned: r.ticketsScanned,
      conflictsFound: r.conflictsFound,
      rolesInferred: r.rolesInferred,
    },
  };
}

// ─── Check 7a: BANK_DETAIL sweep — delegate to Phase 9 ───────────────────────

async function runBankDetailSweepCheck(): Promise<CategoryResult> {
  const r = await runBankDetailSweep({ limit: 200 });
  return {
    ok: r.ok,
    scanned: r.scanned,
    created: r.tasksCreated,
    escalated: 0,
    error: r.errors.length
      ? r.errors.map((e) => `${e.supplierBillId}: ${e.error}`).join("; ")
      : undefined,
    detail: {
      mismatches: r.mismatches,
      newStoreRequests: r.newStoreRequests,
    },
  };
}

// ─── Check 7: SURPLUS_MATCHING — delegate to Phase 6 ─────────────────────────

async function runSurplusMatchingCheck(): Promise<CategoryResult> {
  const r = await runSurplusMatcher({ limit: 200 });
  return {
    ok: r.ok,
    scanned: r.scanned,
    created: r.tasksCreated,
    escalated: 0,
    error: r.errors.length
      ? r.errors.map((e) => `${e.stockExcessRecordId}: ${e.error}`).join("; ")
      : undefined,
    detail: {
      canonicalResolved: r.resolved,
      matchedPairs: r.matchedPairs,
      tasksAlreadyOpen: r.tasksAlreadyOpen,
      unresolved: r.unresolved,
    },
  };
}

// ─── Check 8: SURPLUS_STOCK_AGING ────────────────────────────────────────────

async function runSurplusStockAging(): Promise<CategoryResult> {
  const cutoff7d = daysAgo(7);
  const cutoff14d = daysAgo(14);

  const records = await prisma.stockExcessRecord.findMany({
    where: {
      createdAt: { lte: cutoff7d },
      status: { notIn: ["RESOLVED", "CLOSED", "TRANSFERRED"] },
    },
    select: {
      id: true,
      ticketLineId: true,
      excessQty: true,
      excessCost: true,
      description: true,
      createdAt: true,
      treatment: true,
      ticketLine: {
        select: {
          id: true,
          ticketId: true,
          description: true,
        },
      },
    },
  });

  let created = 0;
  let scanned = 0;

  for (const rec of records) {
    scanned += 1;
    if (!rec.ticketLine) continue;

    const age = daysSince(rec.createdAt);
    const taskType =
      age >= 14 ? "RETURN_TO_SUPPLIER" : "SURPLUS_ACTION_REQUIRED";

    const outcome = await ensureOpenTask({
      ticketId: rec.ticketLine.ticketId,
      ticketLineId: rec.ticketLine.id,
      taskType,
      priority: age >= 14 ? "URGENT" : "HIGH",
      dueAt: endOfToday(),
      generatedReason: `Surplus £${Number(rec.excessCost).toFixed(2)} (${rec.excessQty ?? "?"} units) on "${rec.ticketLine.description}" — ${age} day(s) unresolved.`,
      draftBody: buildSurplusBody({
        productDescription: rec.ticketLine.description,
        excessQty: rec.excessQty,
        excessCost: Number(rec.excessCost),
        ageDays: age,
        treatment: rec.treatment,
        taskType,
      }),
      matchSelector: { stockExcessRecordId: rec.id },
    });
    if (outcome.created) created += 1;
  }

  return { ok: true, scanned, created, escalated: 0 };
}

// ─── Check 8: BANK_DETAIL_ALERTS ─────────────────────────────────────────────

async function runBankDetailAlerts(): Promise<CategoryResult> {
  const cutoff = daysAgo(1);

  const tasks = await prisma.task.findMany({
    where: {
      taskType: "BANK_DETAIL_CHANGE_ALERT",
      status: { notIn: ["DONE", "RESOLVED", "CLOSED", "REJECTED"] },
      createdAt: { lte: cutoff },
      priority: { not: "CRITICAL" },
    },
    select: { id: true, priority: true, generatedReason: true, createdAt: true },
  });

  let escalated = 0;
  for (const task of tasks) {
    await prisma.task.update({
      where: { id: task.id },
      data: {
        priority: "CRITICAL",
        generatedReason:
          (task.generatedReason ?? "") +
          ` | escalated to CRITICAL (day ${daysSince(task.createdAt)})`,
      },
    });
    escalated += 1;
  }

  return { ok: true, scanned: tasks.length, created: 0, escalated };
}

// ─── Shared helpers ──────────────────────────────────────────────────────────

function isDelivered(
  events: Array<{ stopStatus: unknown; deliveredAt: Date | null; eventType: string | null }>
): boolean {
  for (const e of events) {
    if (e.stopStatus === "DELIVERED") return true;
    if (e.deliveredAt !== null) return true;
    const t = (e.eventType || "").toUpperCase();
    if (t.includes("DELIVER") && !t.includes("NOT") && !t.includes("FAIL")) {
      return true;
    }
  }
  return false;
}

function priorityRank(p: string): number {
  switch (p) {
    case "CRITICAL": return 4;
    case "URGENT": return 3;
    case "HIGH": return 2;
    case "NORMAL": return 1;
    default: return 0;
  }
}

interface EnsureOpenTaskInput {
  ticketId: string;
  taskType: string;
  priority: string;
  dueAt: Date;
  generatedReason: string;
  draftBody: string;
  ticketLineId?: string;
  supplierBillId?: string;
  /**
   * Extra dedup fragments embedded into generatedReason so two distinct
   * records on the same ticket (two invoices, two returns, two surplus
   * items) don't collapse into one open task. Key=value pairs are
   * substring-matched.
   */
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

  // Build WHERE that combines fixed keys + selector fragments
  const where: Record<string, unknown> = {
    ticketId: input.ticketId,
    taskType: input.taskType,
    status: { notIn: ["DONE", "RESOLVED", "CLOSED", "REJECTED"] },
  };
  if (input.ticketLineId) where.ticketLineId = input.ticketLineId;
  if (input.supplierBillId) where.supplierBillId = input.supplierBillId;
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
      supplierBillId: input.supplierBillId,
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

// ─── Date helpers ────────────────────────────────────────────────────────────

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

function daysSince(d: Date): number {
  return Math.floor((Date.now() - d.getTime()) / (24 * 60 * 60 * 1000));
}

function endOfToday(): Date {
  const d = new Date();
  d.setHours(17, 0, 0, 0);
  return d;
}

// ─── Task body builders ──────────────────────────────────────────────────────

function buildOverdueDeliveryBody(po: {
  poNo: string;
  issuedAt: Date | null;
  deliveryDateExpected: Date | null;
  supplier: { name: string };
  ticket: { ticketNo: number; title: string } | null;
}): string {
  return [
    `Overdue delivery — ${po.ticket ? `ticket ${po.ticket.ticketNo} ${po.ticket.title}` : "unknown ticket"}`,
    ``,
    `Supplier       : ${po.supplier.name}`,
    `PO             : ${po.poNo}`,
    `Raised         : ${po.issuedAt?.toISOString().slice(0, 10) ?? "—"}`,
    `Expected       : ${po.deliveryDateExpected?.toISOString().slice(0, 10) ?? "—"}`,
    `Days since raised : ${po.issuedAt ? daysSince(po.issuedAt) : "?"}`,
    ``,
    `Action: chase the supplier for delivery date. If already delivered but signal not logged, record the LogisticsEvent to close this task automatically.`,
  ].join("\n");
}

function buildChasePaymentBody(args: {
  invoiceNo: string;
  customerName: string;
  siteName: string | null;
  total: number;
  dueDate: Date;
  daysLeft: number;
}): string {
  return [
    `Payment chaser — invoice ${args.invoiceNo}`,
    ``,
    `Client   : ${args.customerName}`,
    `Site     : ${args.siteName ?? "—"}`,
    `Amount   : £${args.total.toFixed(2)}`,
    `Due date : ${args.dueDate.toISOString().slice(0, 10)} (${args.daysLeft} day(s) remaining)`,
    ``,
    `--- Suggested email ---`,
    ``,
    `Hi ${args.customerName} accounts team,`,
    ``,
    `This is a friendly reminder that invoice ${args.invoiceNo} for £${args.total.toFixed(2)} falls due on ${args.dueDate.toISOString().slice(0, 10)}. Please let us know if you need a copy or if there are any queries before the due date.`,
    ``,
    `Thanks,`,
    `Cromwell Freight Accounts`,
  ].join("\n");
}

function buildPaymentOverdueBody(args: {
  invoiceNo: string;
  customerName: string;
  siteName: string | null;
  total: number;
  dueDate: Date;
  overdueDays: number;
  targetPriority: string;
}): string {
  return [
    `Payment OVERDUE — invoice ${args.invoiceNo} (${args.targetPriority})`,
    ``,
    `Client       : ${args.customerName}`,
    `Site         : ${args.siteName ?? "—"}`,
    `Amount       : £${args.total.toFixed(2)}`,
    `Due date     : ${args.dueDate.toISOString().slice(0, 10)}`,
    `Overdue by   : ${args.overdueDays} day(s)`,
    ``,
    `--- Suggested email ---`,
    ``,
    `Hi ${args.customerName} accounts team,`,
    ``,
    `Invoice ${args.invoiceNo} for £${args.total.toFixed(2)} was due on ${args.dueDate.toISOString().slice(0, 10)} and remains unpaid (${args.overdueDays} days overdue). Please confirm a payment date or raise any queries so we can resolve.`,
    ``,
    `Regards,`,
    `Cromwell Freight Accounts`,
  ].join("\n");
}

function buildChaseCreditNoteBody(args: {
  supplierName: string;
  returnRef: string;
  returnDate: Date;
  expectedTotal: number;
  unsettledLineCount: number;
}): string {
  return [
    `Credit note chaser — ${args.supplierName}`,
    ``,
    `Return ref     : ${args.returnRef}`,
    `Return date    : ${args.returnDate.toISOString().slice(0, 10)}`,
    `Days since     : ${daysSince(args.returnDate)}`,
    `Expected credit: £${args.expectedTotal.toFixed(2)} across ${args.unsettledLineCount} line(s)`,
    ``,
    `--- Suggested email ---`,
    ``,
    `Hi ${args.supplierName} accounts team,`,
    ``,
    `We raised return ${args.returnRef} on ${args.returnDate.toISOString().slice(0, 10)} with an expected credit of £${args.expectedTotal.toFixed(2)}, and have not yet received a credit note. Please confirm when the credit will be issued or advise if anything else is needed from our side.`,
    ``,
    `Thanks,`,
    `Cromwell Freight Accounts`,
  ].join("\n");
}

function buildSurplusBody(args: {
  productDescription: string;
  excessQty: unknown;
  excessCost: number;
  ageDays: number;
  treatment: string;
  taskType: string;
}): string {
  return [
    `${args.taskType === "RETURN_TO_SUPPLIER" ? "Return to supplier" : "Surplus — action required"}`,
    ``,
    `Product    : ${args.productDescription}`,
    `Qty excess : ${args.excessQty ?? "?"}`,
    `Cost tied  : £${args.excessCost.toFixed(2)}`,
    `Treatment  : ${args.treatment}`,
    `Age        : ${args.ageDays} day(s) unresolved`,
    ``,
    args.taskType === "RETURN_TO_SUPPLIER"
      ? `Action: raise a Return to the supplier for this surplus. If a downstream ticket can consume it, transfer via Reallocation instead.`
      : `Action: allocate surplus to another active ticket (Reallocation) or escalate to supplier return if no buyer found.`,
  ].join("\n");
}
