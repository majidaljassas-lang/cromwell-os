/**
 * Driver-cost allocator.
 *
 * Cascade: SupplierBill (CF) → DeliveryRun → DeliveryRunStop → Ticket → TicketLine.
 *
 * Per ticket the cascade depends on Ticket.deliveryBillingMode:
 *   ABSORBED   — share spreads across the ticket's product lines, weighted by
 *                each line's sales value. Eats into goods-line margin.
 *   CHARGEABLE — share lands on the ticket's TicketLineType.DELIVERY line.
 *                If the ticket is CHARGEABLE but has no DELIVERY line, a
 *                DELIVERY_LINE_REQUIRED task is opened (no auto-create — that
 *                would invent a price; see "Close Loops Only" memory).
 *
 * Idempotent: re-running clears auto-set shares (those with costShareOverridden
 * = false) and recomputes. User-overridden stops are honoured; remaining bill
 * total redistributes across the rest by the run's splitMethod.
 */

import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma";

export interface AllocateResult {
  runId: string;
  billId: string;
  billTotal: number;
  splitMethod: string;
  stopsAllocated: number;
  ticketsTouched: number;
  linesTouched: number;
  tasksCreated: { id: string; taskType: string }[];
  notes: string[];
}

export async function allocateRunCost(
  deliveryRunId: string,
  supplierBillId: string,
): Promise<AllocateResult> {
  const run = await prisma.deliveryRun.findUnique({
    where: { id: deliveryRunId },
    include: {
      stops: {
        orderBy: { sequence: "asc" },
        include: {
          ticket: {
            include: {
              lines: true,
            },
          },
        },
      },
    },
  });
  if (!run) throw new Error(`DeliveryRun not found: ${deliveryRunId}`);

  const bill = await prisma.supplierBill.findUnique({
    where: { id: supplierBillId },
    select: { id: true, totalCost: true, supplierId: true },
  });
  if (!bill) throw new Error(`SupplierBill not found: ${supplierBillId}`);

  const billTotal = Number(bill.totalCost);
  const notes: string[] = [];
  const tasksCreated: { id: string; taskType: string }[] = [];

  // Step 1 — compute each stop's costShare using splitMethod, honouring overrides.
  const overridden = run.stops.filter((s) => s.costShareOverridden);
  const auto = run.stops.filter((s) => !s.costShareOverridden);
  const overriddenTotal = overridden.reduce(
    (acc, s) => acc + Number(s.costShare ?? 0),
    0,
  );
  const remainingPot = round2(billTotal - overriddenTotal);

  if (auto.length === 0) {
    notes.push("All stops user-overridden — no auto split applied.");
  } else if (run.splitMethod === "MANUAL") {
    notes.push(
      "splitMethod=MANUAL — auto stops left blank; user must set each manually.",
    );
  } else if (run.splitMethod === "EQUAL") {
    const per = round2(remainingPot / auto.length);
    let running = 0;
    for (let i = 0; i < auto.length; i++) {
      const isLast = i === auto.length - 1;
      // last stop absorbs the rounding remainder so the total reconciles
      const share = isLast ? round2(remainingPot - running) : per;
      running = round2(running + share);
      await prisma.deliveryRunStop.update({
        where: { id: auto[i].id },
        data: { costShare: new Prisma.Decimal(share) },
      });
    }
  } else if (run.splitMethod === "TICKET_VALUE") {
    const values = auto.map((s) => ticketSalesValue(s.ticket));
    const totalValue = values.reduce((a, b) => a + b, 0);
    if (totalValue === 0) {
      // fallback to equal so the cost still lands somewhere
      notes.push(
        "TICKET_VALUE method requested but no ticket sales values found — fell back to EQUAL.",
      );
      const per = round2(remainingPot / auto.length);
      let running = 0;
      for (let i = 0; i < auto.length; i++) {
        const isLast = i === auto.length - 1;
        const share = isLast ? round2(remainingPot - running) : per;
        running = round2(running + share);
        await prisma.deliveryRunStop.update({
          where: { id: auto[i].id },
          data: { costShare: new Prisma.Decimal(share) },
        });
      }
    } else {
      let running = 0;
      for (let i = 0; i < auto.length; i++) {
        const isLast = i === auto.length - 1;
        const ratio = values[i] / totalValue;
        const share = isLast
          ? round2(remainingPot - running)
          : round2(remainingPot * ratio);
        running = round2(running + share);
        await prisma.deliveryRunStop.update({
          where: { id: auto[i].id },
          data: { costShare: new Prisma.Decimal(share) },
        });
      }
    }
  }

  // Step 2 — refetch the run with updated costShares, then cascade per ticket.
  const refreshed = await prisma.deliveryRun.findUnique({
    where: { id: deliveryRunId },
    include: {
      stops: {
        orderBy: { sequence: "asc" },
        include: {
          ticket: { include: { lines: true } },
        },
      },
    },
  });
  if (!refreshed) throw new Error("DeliveryRun vanished mid-allocate");

  const ticketsTouched = new Set<string>();
  let linesTouched = 0;

  // Group stops by ticket so an absorbed/chargeable cascade runs once per ticket
  // even when one ticket has multiple stops on the run.
  const byTicket = new Map<string, typeof refreshed.stops>();
  for (const stop of refreshed.stops) {
    const arr = byTicket.get(stop.ticketId) ?? [];
    arr.push(stop);
    byTicket.set(stop.ticketId, arr);
  }

  for (const [ticketId, stops] of byTicket) {
    const ticketShare = stops.reduce(
      (acc, s) => acc + Number(s.costShare ?? 0),
      0,
    );
    if (ticketShare === 0) continue;

    const ticket = stops[0].ticket;
    ticketsTouched.add(ticketId);

    if (ticket.deliveryBillingMode === "CHARGEABLE") {
      const deliveryLines = ticket.lines.filter(
        (l) => l.lineType === "DELIVERY",
      );
      if (deliveryLines.length === 0) {
        // Open a task — never auto-create a delivery line (would invent a price).
        const existing = await prisma.task.findFirst({
          where: {
            ticketId,
            taskType: "DELIVERY_LINE_REQUIRED",
            status: "OPEN",
          },
        });
        if (!existing) {
          const task = await prisma.task.create({
            data: {
              ticketId,
              taskType: "DELIVERY_LINE_REQUIRED",
              priority: "HIGH",
              status: "OPEN",
              generatedReason: `CF driver cost £${ticketShare.toFixed(2)} arrived via DeliveryRun #${run.runNo} but ticket is CHARGEABLE with no DELIVERY line. Add one with the agreed sales price; cost will land on it on the next allocator run.`,
            },
          });
          tasksCreated.push({ id: task.id, taskType: task.taskType });
        }
        continue;
      }

      // Single delivery line — entire ticketShare lands there.
      // Multiple delivery lines — split by line sales value (rare, but defined).
      if (deliveryLines.length === 1) {
        await prisma.ticketLine.update({
          where: { id: deliveryLines[0].id },
          data: { deliveryCostShare: new Prisma.Decimal(round2(ticketShare)) },
        });
        linesTouched++;
      } else {
        const totalSale = deliveryLines.reduce(
          (a, l) => a + lineSalesValue(l),
          0,
        );
        if (totalSale === 0) {
          const per = round2(ticketShare / deliveryLines.length);
          let running = 0;
          for (let i = 0; i < deliveryLines.length; i++) {
            const isLast = i === deliveryLines.length - 1;
            const share = isLast ? round2(ticketShare - running) : per;
            running = round2(running + share);
            await prisma.ticketLine.update({
              where: { id: deliveryLines[i].id },
              data: { deliveryCostShare: new Prisma.Decimal(share) },
            });
            linesTouched++;
          }
        } else {
          let running = 0;
          for (let i = 0; i < deliveryLines.length; i++) {
            const isLast = i === deliveryLines.length - 1;
            const ratio = lineSalesValue(deliveryLines[i]) / totalSale;
            const share = isLast
              ? round2(ticketShare - running)
              : round2(ticketShare * ratio);
            running = round2(running + share);
            await prisma.ticketLine.update({
              where: { id: deliveryLines[i].id },
              data: { deliveryCostShare: new Prisma.Decimal(share) },
            });
            linesTouched++;
          }
        }
      }

      // Clear shares on product lines for this ticket — chargeable mode means
      // delivery cost belongs on the delivery line, not smeared across goods.
      await prisma.ticketLine.updateMany({
        where: {
          ticketId,
          NOT: { lineType: "DELIVERY" },
        },
        data: { deliveryCostShare: null },
      });
    } else {
      // ABSORBED — spread across product lines (exclude DELIVERY,
      // RETURN_ADJUSTMENT, CASH_SALE) weighted by line sales value.
      const productLines = ticket.lines.filter(
        (l) =>
          l.lineType !== "DELIVERY" &&
          l.lineType !== "RETURN_ADJUSTMENT" &&
          l.lineType !== "CASH_SALE",
      );
      if (productLines.length === 0) {
        notes.push(
          `Ticket ${ticketId} ABSORBED but has no product lines — £${ticketShare.toFixed(2)} unallocated.`,
        );
        continue;
      }
      const totalSale = productLines.reduce(
        (a, l) => a + lineSalesValue(l),
        0,
      );
      if (totalSale === 0) {
        const per = round2(ticketShare / productLines.length);
        let running = 0;
        for (let i = 0; i < productLines.length; i++) {
          const isLast = i === productLines.length - 1;
          const share = isLast ? round2(ticketShare - running) : per;
          running = round2(running + share);
          await prisma.ticketLine.update({
            where: { id: productLines[i].id },
            data: { deliveryCostShare: new Prisma.Decimal(share) },
          });
          linesTouched++;
        }
      } else {
        let running = 0;
        for (let i = 0; i < productLines.length; i++) {
          const isLast = i === productLines.length - 1;
          const ratio = lineSalesValue(productLines[i]) / totalSale;
          const share = isLast
            ? round2(ticketShare - running)
            : round2(ticketShare * ratio);
          running = round2(running + share);
          await prisma.ticketLine.update({
            where: { id: productLines[i].id },
            data: { deliveryCostShare: new Prisma.Decimal(share) },
          });
          linesTouched++;
        }
      }
    }
  }

  // Step 3 — link the bill to the run for traceability.
  await prisma.supplierBill.update({
    where: { id: bill.id },
    data: { deliveryRunId: run.id },
  });

  return {
    runId: run.id,
    billId: bill.id,
    billTotal,
    splitMethod: run.splitMethod,
    stopsAllocated: refreshed.stops.length,
    ticketsTouched: ticketsTouched.size,
    linesTouched,
    tasksCreated,
    notes,
  };
}

function ticketSalesValue(ticket: { lines: { lineType: string; actualSaleTotal: Prisma.Decimal | null; suggestedSaleUnit: Prisma.Decimal | null; qty: Prisma.Decimal }[] }): number {
  return ticket.lines
    .filter(
      (l) =>
        l.lineType !== "DELIVERY" &&
        l.lineType !== "RETURN_ADJUSTMENT" &&
        l.lineType !== "CASH_SALE",
    )
    .reduce((acc, l) => acc + lineSalesValue(l), 0);
}

function lineSalesValue(l: { actualSaleTotal: Prisma.Decimal | null; suggestedSaleUnit: Prisma.Decimal | null; qty: Prisma.Decimal }): number {
  if (l.actualSaleTotal != null) return Number(l.actualSaleTotal);
  if (l.suggestedSaleUnit != null) return Number(l.suggestedSaleUnit) * Number(l.qty);
  return 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
