// Apply a CUSTOMER_APPROVED CallOffSubstitution. This is the only path that
// mutates ticket/PO lines for a substitution — everything runs in one
// transaction so a partial write can never leave the ticket half-swapped.
//
// Freeze-then-split (per line):
//  - frozenQty = already called-off on the old ticket line (delivered ⊆ this).
//  - frozenQty == 0  → nothing committed yet: mutate the old ticket line in place
//                      (new code/description, wipe pricing for manual re-cost).
//  - frozenQty  > 0  → cap the old ticket line + its CustomerPOLine at frozenQty
//                      and mark the line SUPERSEDED; create a NEW ticket line +
//                      CustomerPOLine for the new item carrying only the remaining
//                      balance, linked back via substitutedFromLineId. Past
//                      call-offs / delivery notes stay pinned to the old line.
//
// After the transaction: resequenceLines + syncPoConsumptionFromCallOffs (both
// use the global prisma client and their own transactions).

import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma";
import type { CallOffSubstitution } from "@/generated/prisma";
import { assertTransition } from "@/lib/reconciliations/state-machine";
import { resequenceLines } from "@/lib/tickets/resequence-lines";
import { syncPoConsumptionFromCallOffs } from "@/lib/finance/po-drawdown";
import { resyncTicketDownstream } from "@/lib/tickets/sync-downstream";

export async function applySubstitutionBatch(
  substitutionId: string,
): Promise<CallOffSubstitution> {
  const { batch, ticketId, poId } = await prisma.$transaction(async (tx) => {
    const sub = await tx.callOffSubstitution.findUnique({
      where: { id: substitutionId },
      include: { lines: { orderBy: { displayOrder: "asc" } }, customerPO: true },
    });
    if (!sub) throw new Error(`Substitution ${substitutionId} not found`);
    assertTransition(sub.workflowState, "APPLIED");

    const po = sub.customerPO;
    if (!po.ticketId) throw new Error("PO has no linked ticket — cannot apply");
    const ticketId = po.ticketId;
    const now = new Date();

    let inPlace = 0;
    let split = 0;
    let scoped = 0;

    for (const line of sub.lines) {
      const oldLine = await tx.ticketLine.findUnique({ where: { id: line.oldTicketLineId } });
      if (!oldLine) continue;

      const oldPoLine = await tx.customerPOLine.findFirst({
        where: { customerPOId: po.id, ticketLineId: oldLine.id },
      });

      // ── Scoped path: swap within one call-off ──
      // Move only this call-off's undelivered qty to the new item. The old
      // PO line qty is left intact (the item may still be drawn on other
      // call-offs); instead we re-point this call-off's draw to the new line.
      if (sub.callOffId) {
        const callOffId = sub.callOffId;
        const [reqAgg, delAgg] = await Promise.all([
          tx.callOffLine.aggregate({
            where: { callOffId, ticketLineId: oldLine.id },
            _sum: { requestedQty: true },
          }),
          tx.deliveryNoteLine.aggregate({
            where: { ticketLineId: oldLine.id, deliveryNote: { callOffId } },
            _sum: { qtyDelivered: true },
          }),
        ]);
        const requestedInC = Number(reqAgg._sum.requestedQty ?? 0);
        const deliveredInC = Number(delAgg._sum.qtyDelivered ?? 0);
        const swappable = Math.max(0, requestedInC - deliveredInC);
        const moveQty = Math.min(Number(line.qtyToSwap), swappable);

        if (moveQty <= 1e-6) {
          await tx.callOffSubstitutionLine.update({
            where: { id: line.id },
            data: { appliedAt: now, frozenQtySnapshot: new Prisma.Decimal(deliveredInC) },
          });
          continue;
        }

        const auditOld = `[${now.toISOString()}] Substitution (call-off): ${line.oldCode ?? line.oldDescription} → ${line.newCode ?? line.newDescription}`;
        const agreedUnitPrice = oldPoLine?.agreedUnitPrice ?? null;

        const newLine = await tx.ticketLine.create({
          data: {
            ticketId,
            lineType: oldLine.lineType,
            description: line.newDescription,
            productCode: line.newCode,
            canonicalProductId: line.newCanonicalProductId,
            qty: new Prisma.Decimal(moveQty),
            unit: oldLine.unit,
            payingCustomerId: oldLine.payingCustomerId,
            siteId: oldLine.siteId,
            siteCommercialLinkId: oldLine.siteCommercialLinkId,
            sectionLabel: oldLine.sectionLabel,
            displayOrder: oldLine.displayOrder,
            status: "CAPTURED",
            substitutedFromLineId: oldLine.id,
            internalNotes: `${auditOld} — new line carrying ${moveQty} within call-off`,
          },
        });

        const newPoLine = await tx.customerPOLine.create({
          data: {
            customerPOId: po.id,
            ticketLineId: newLine.id,
            description: line.newDescription,
            qty: new Prisma.Decimal(moveQty),
            agreedUnitPrice,
            agreedTotal: agreedUnitPrice
              ? new Prisma.Decimal(Number(agreedUnitPrice) * moveQty)
              : null,
          },
        });

        // Reduce the old item's draw on this call-off by moveQty (never below
        // what's already invoiced), then add the new item's draw.
        let toMove = moveQty;
        const oldCallOffLines = await tx.callOffLine.findMany({
          where: { callOffId, ticketLineId: oldLine.id },
          orderBy: { displayOrder: "asc" },
        });
        let maxOrder = 0;
        for (const col of oldCallOffLines) {
          if (col.displayOrder > maxOrder) maxOrder = col.displayOrder;
          if (toMove <= 1e-6) continue;
          const req = Number(col.requestedQty);
          const reducible = Math.max(0, req - Number(col.invoicedQty));
          const take = Math.min(reducible, toMove);
          if (take > 1e-6) {
            await tx.callOffLine.update({
              where: { id: col.id },
              data: { requestedQty: new Prisma.Decimal(req - take) },
            });
            toMove -= take;
          }
        }
        await tx.callOffLine.create({
          data: {
            callOffId,
            customerPOLineId: newPoLine.id,
            ticketLineId: newLine.id,
            description: line.newDescription,
            requestedQty: new Prisma.Decimal(moveQty),
            agreedUnitPrice,
            displayOrder: maxOrder + 1,
          },
        });

        await tx.callOffSubstitutionLine.update({
          where: { id: line.id },
          data: {
            newTicketLineId: newLine.id,
            appliedAt: now,
            frozenQtySnapshot: new Prisma.Decimal(deliveredInC),
          },
        });
        scoped++;
        continue;
      }

      // Live-recompute frozen (called-off) for this line.
      const calledOffAgg = await tx.callOffLine.aggregate({
        where: { ticketLineId: oldLine.id, callOff: { customerPOId: po.id } },
        _sum: { requestedQty: true },
      });
      const frozen = Number(calledOffAgg._sum.requestedQty ?? 0);
      const ordered = Number(oldPoLine?.qty ?? oldLine.qty);
      const remaining = Math.max(0, ordered - frozen);
      const moveQty = Math.min(Number(line.qtyToSwap), remaining);

      const auditOld = `[${now.toISOString()}] Substitution: ${line.oldCode ?? line.oldDescription} → ${line.newCode ?? line.newDescription}`;

      if (frozen <= 1e-6) {
        // In-place swap — nothing committed against the old item.
        await tx.ticketLine.update({
          where: { id: oldLine.id },
          data: {
            productCode: line.newCode,
            description: line.newDescription,
            canonicalProductId: line.newCanonicalProductId,
            expectedCostUnit: null,
            expectedCostTotal: null,
            suggestedSaleUnit: null,
            actualSaleUnit: null,
            actualSaleTotal: null,
            expectedMarginTotal: null,
            actualMarginTotal: null,
            varianceTotal: null,
            status: "CAPTURED",
            priceOverride: false,
            internalNotes: [oldLine.internalNotes, `${auditOld} (in place)`]
              .filter(Boolean)
              .join("\n"),
          },
        });
        if (oldPoLine) {
          await tx.customerPOLine.update({
            where: { id: oldPoLine.id },
            data: { description: line.newDescription },
          });
        }
        await tx.callOffSubstitutionLine.update({
          where: { id: line.id },
          data: { newTicketLineId: oldLine.id, appliedAt: now, frozenQtySnapshot: new Prisma.Decimal(0) },
        });
        inPlace++;
        continue;
      }

      // Split — freeze the committed qty on the old line, move the remainder.
      await tx.ticketLine.update({
        where: { id: oldLine.id },
        data: {
          qty: new Prisma.Decimal(frozen),
          status: "SUPERSEDED",
          internalNotes: [oldLine.internalNotes, `${auditOld} — ${frozen} frozen on old item, ${moveQty} moved`]
            .filter(Boolean)
            .join("\n"),
        },
      });
      if (oldPoLine) {
        await tx.customerPOLine.update({
          where: { id: oldPoLine.id },
          data: { qty: new Prisma.Decimal(frozen) },
        });
      }

      const newLine = await tx.ticketLine.create({
        data: {
          ticketId,
          lineType: oldLine.lineType,
          description: line.newDescription,
          productCode: line.newCode,
          canonicalProductId: line.newCanonicalProductId,
          qty: new Prisma.Decimal(moveQty),
          unit: oldLine.unit,
          payingCustomerId: oldLine.payingCustomerId,
          siteId: oldLine.siteId,
          siteCommercialLinkId: oldLine.siteCommercialLinkId,
          sectionLabel: oldLine.sectionLabel,
          displayOrder: oldLine.displayOrder,
          status: "CAPTURED",
          substitutedFromLineId: oldLine.id,
          internalNotes: `${auditOld} — new line carrying ${moveQty} from substitution`,
        },
      });

      const agreedUnitPrice = oldPoLine?.agreedUnitPrice ?? null;
      await tx.customerPOLine.create({
        data: {
          customerPOId: po.id,
          ticketLineId: newLine.id,
          description: line.newDescription,
          qty: new Prisma.Decimal(moveQty),
          agreedUnitPrice: agreedUnitPrice,
          agreedTotal: agreedUnitPrice
            ? new Prisma.Decimal(Number(agreedUnitPrice) * moveQty)
            : null,
        },
      });

      await tx.callOffSubstitutionLine.update({
        where: { id: line.id },
        data: { newTicketLineId: newLine.id, appliedAt: now, frozenQtySnapshot: new Prisma.Decimal(frozen) },
      });
      split++;
    }

    await tx.event.create({
      data: {
        ticketId,
        eventType: "QUOTE_REVISED",
        timestamp: now,
        sourceRef: `CallOffSubstitution#${substitutionId}`,
        notes: sub.callOffId
          ? `Applied substitution "${sub.title}" within call-off — ${scoped} line(s) re-pointed`
          : `Applied substitution "${sub.title}" — ${inPlace} in place, ${split} split`,
      },
    });

    // Reopen/unlock the ticket so the swapped lines can be re-costed, mirroring
    // the reconciliation apply convention.
    const ticket = await tx.ticket.findUnique({
      where: { id: ticketId },
      select: { status: true },
    });
    await tx.ticket.update({
      where: { id: ticketId },
      data: {
        status: ticket?.status === "CLOSED" ? "PRICING" : ticket?.status,
        isLocked: false,
        lastActivityAt: now,
      },
    });

    await resyncTicketDownstream(ticketId, tx);

    const updated = await tx.callOffSubstitution.update({
      where: { id: substitutionId },
      data: { workflowState: "APPLIED", appliedAt: now },
    });

    return { batch: updated, ticketId, poId: po.id };
  });

  // Post-commit: these helpers manage their own transactions.
  await resequenceLines(ticketId);
  await syncPoConsumptionFromCallOffs(poId);

  return batch;
}
