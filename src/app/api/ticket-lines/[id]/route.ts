import { prisma } from "@/lib/prisma";
import { autoProgressTicket } from "@/lib/procurement/auto-progress-ticket";
import { resolveSupplier, recordAlias } from "@/lib/suppliers/smart-match";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const line = await prisma.ticketLine.findUnique({
      where: { id },
      include: {
        ticket: true,
        payingCustomer: true,
        site: true,
        siteCommercialLink: true,
      },
    });
    if (!line) {
      return Response.json({ error: "Ticket line not found" }, { status: 404 });
    }
    return Response.json(line);
  } catch (error) {
    console.error("Failed to get ticket line:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Failed to get ticket line" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await request.json();

    // Handle move up/down
    if (body._move === "up" || body._move === "down") {
      const current = await prisma.ticketLine.findUnique({ where: { id }, select: { ticketId: true, createdAt: true, sectionLabel: true } });
      if (!current) return Response.json({ error: "Not found" }, { status: 404 });

      const sibling = await prisma.ticketLine.findFirst({
        where: {
          ticketId: current.ticketId,
          sectionLabel: current.sectionLabel,
          parentLineId: null,
          createdAt: body._move === "up" ? { lt: current.createdAt } : { gt: current.createdAt },
        },
        orderBy: { createdAt: body._move === "up" ? "desc" : "asc" },
        select: { id: true, createdAt: true },
      });

      if (sibling) {
        // Swap createdAt timestamps
        const tempDate = new Date(current.createdAt.getTime() - 1);
        await prisma.ticketLine.update({ where: { id }, data: { createdAt: sibling.createdAt } });
        await prisma.ticketLine.update({ where: { id: sibling.id }, data: { createdAt: current.createdAt } });
      }

      return Response.json({ ok: true, moved: body._move });
    }

    // Whitelist allowed fields
    const allowed: Record<string, unknown> = {};
    const fields = [
      "description", "normalizedItemName", "productCode", "specification",
      "internalNotes", "qty", "unit", "lineType",
      "expectedCostUnit", "expectedCostTotal", "actualCostTotal",
      "benchmarkUnit", "benchmarkTotal",
      "suggestedSaleUnit", "actualSaleUnit", "actualSaleTotal",
      "expectedMarginTotal", "actualMarginTotal", "varianceTotal",
      "evidenceStatus", "costStatus", "salesStatus",
      "supplierStrategyType", "siteId", "siteCommercialLinkId",
      "supplierId", "supplierName", "supplierReference",
      "fromStock", "toOrder", "status", "canonicalProductId",
      "priceOverride", "sectionLabel", "isLocked",
    ];
    for (const f of fields) {
      if (body[f] !== undefined) allowed[f] = body[f];
    }

    // Lock cost/supplier from auto-recalc when the user edits them directly.
    // Why: recalcWinner (manual prices panel + Phase 13 supplier-quote-linker + doc ingestion)
    // would otherwise overwrite the user's value with the cheapest auto-discovered price.
    const userTouchedCostOrSupplier =
      body.expectedCostUnit !== undefined ||
      body.supplierName !== undefined ||
      body.supplierId !== undefined;
    if (userTouchedCostOrSupplier && body.priceOverride === undefined) {
      allowed.priceOverride = true;
    }

    // Auto-calculate totals if unit prices change
    const current = await prisma.ticketLine.findUnique({ where: { id }, select: { qty: true, expectedCostUnit: true, suggestedSaleUnit: true, actualSaleUnit: true } });
    if (!current) return Response.json({ error: "Not found" }, { status: 404 });

    const qty = Number(allowed.qty ?? current.qty);
    const expectedCostUnit = Number(allowed.expectedCostUnit ?? current.expectedCostUnit ?? 0);
    const suggestedSaleUnit = Number(allowed.suggestedSaleUnit ?? current.suggestedSaleUnit ?? 0);
    const actualSaleUnit = Number(allowed.actualSaleUnit ?? current.actualSaleUnit ?? 0);

    // Auto-calculate derived fields
    if (allowed.expectedCostUnit !== undefined || allowed.qty !== undefined) {
      allowed.expectedCostTotal = expectedCostUnit * qty;
    }
    if (allowed.actualSaleUnit !== undefined || allowed.qty !== undefined) {
      allowed.actualSaleTotal = actualSaleUnit * qty;
    }
    if (allowed.suggestedSaleUnit !== undefined || allowed.expectedCostUnit !== undefined) {
      allowed.expectedMarginTotal = (suggestedSaleUnit - expectedCostUnit) * qty;
    }
    if (allowed.actualSaleUnit !== undefined || allowed.expectedCostUnit !== undefined) {
      allowed.actualMarginTotal = (actualSaleUnit - expectedCostUnit) * qty;
      allowed.varianceTotal = (actualSaleUnit - suggestedSaleUnit) * qty;
    }

    // Fix 5: Auto-status progression
    const hasExpectedCost = expectedCostUnit > 0 || Number(allowed.expectedCostTotal || 0) > 0;
    const hasSalePrice = actualSaleUnit > 0 || suggestedSaleUnit > 0;

    if (hasExpectedCost && hasSalePrice) {
      // Both cost and sale present — check if ready for quote
      const hasQty = qty > 0;
      const hasDescription = true; // already required on create
      if (hasQty && hasDescription) {
        allowed.status = "READY_FOR_QUOTE";
      } else {
        allowed.status = "PRICED";
      }
    } else if (hasExpectedCost || hasSalePrice) {
      allowed.status = "PRICED";
    }
    // If neither, stay at current status (don't regress)

    // Don't override manually set status if it's further along
    if (body.status !== undefined) {
      allowed.status = body.status;
    }

    // Smart supplier resolution. Skip when caller already has a supplierId
    // (frontend already picked from the grey-zone confirm dialog) or when
    // body opts out via _supplierConfirmAsNew.
    let supplierMatchInfo: ReturnType<typeof Object> | null = null;
    if (allowed.supplierName && !allowed.supplierId && !body._supplierConfirmAsNew) {
      const typed = String(allowed.supplierName).trim();
      allowed.supplierName = typed;
      const match = await resolveSupplier(typed);

      if (match.status === "EXACT" || match.status === "ALIAS") {
        allowed.supplierId = match.supplier!.id;
        allowed.supplierName = match.supplier!.name;
      } else if (match.status === "AUTO_MERGE") {
        allowed.supplierId = match.supplier!.id;
        allowed.supplierName = match.supplier!.name;
        await recordAlias(match.supplier!.id, typed, "USER");
      } else if (match.status === "CONFIRM") {
        // Don't save the supplier change yet — return candidates for the UI to confirm.
        delete allowed.supplierName;
        delete allowed.supplierId;
        supplierMatchInfo = { status: "CONFIRM", typed, candidates: match.candidates };
      } else {
        // NEW — never auto-create. Surface a confirmation so the user has to
        // explicitly opt in to a new Supplier record. Stops the duplicate
        // bleed when typed strings differ subtly from existing names.
        // (Aligns with "No Auto Party Intake".)
        delete allowed.supplierName;
        delete allowed.supplierId;
        supplierMatchInfo = { status: "CONFIRM", typed, candidates: [] };
      }
    } else if (allowed.supplierName && !allowed.supplierId && body._supplierConfirmAsNew) {
      const typed = String(allowed.supplierName).trim();
      allowed.supplierName = typed;
      const newSupplier = await prisma.supplier.create({ data: { name: typed } });
      allowed.supplierId = newSupplier.id;
    } else if (allowed.supplierName && allowed.supplierId) {
      // User picked an existing supplier from the grey-zone dialog — record their typed string as alias.
      if (body._supplierTypedAlias && typeof body._supplierTypedAlias === "string") {
        await recordAlias(String(allowed.supplierId), body._supplierTypedAlias, "USER");
      }
    }

    const line = await prisma.ticketLine.update({
      where: { id },
      data: allowed,
      select: { id: true, ticketId: true, status: true, description: true, qty: true, unit: true, expectedCostUnit: true, expectedCostTotal: true, actualCostTotal: true, actualSaleUnit: true, actualSaleTotal: true, suggestedSaleUnit: true, expectedMarginTotal: true, actualMarginTotal: true, varianceTotal: true, normalizedItemName: true, productCode: true, specification: true, internalNotes: true, lineType: true, benchmarkUnit: true, benchmarkTotal: true, evidenceStatus: true, costStatus: true, salesStatus: true, supplierStrategyType: true, siteId: true, siteCommercialLinkId: true, supplierId: true, supplierName: true, supplierReference: true, sectionLabel: true, payingCustomerId: true, canonicalProductId: true, isBomParent: true, priceOverride: true },
    });

    const pricingChanged = allowed.expectedCostUnit !== undefined || allowed.actualSaleUnit !== undefined || allowed.suggestedSaleUnit !== undefined;

    // Auto-reopen CLOSED ticket on any line edit — a closed ticket that's
    // being edited is, by definition, not closed anymore.
    const parentTicket = await prisma.ticket.findUnique({
      where: { id: line.ticketId },
      select: { status: true, isLocked: true },
    });
    if (parentTicket?.status === "CLOSED") {
      await prisma.$transaction([
        prisma.ticket.update({
          where: { id: line.ticketId },
          data: { status: "PRICING", isLocked: false, lastActivityAt: new Date() },
        }),
        prisma.event.create({
          data: {
            ticketId: line.ticketId,
            ticketLineId: line.id,
            eventType: "QUOTE_REVISED",
            timestamp: new Date(),
            notes: "Auto-reopened: line edited on a CLOSED ticket",
          },
        }),
      ]);
    } else if (pricingChanged && parentTicket?.status === "CAPTURED") {
      await prisma.ticket.update({
        where: { id: line.ticketId },
        data: { status: "PRICING", lastActivityAt: new Date() },
      });
    }

    if (allowed.status === "ORDERED" || allowed.status === "FROM_STOCK" || allowed.status === "FULLY_COSTED" || allowed.status === "INVOICED") {
      await autoProgressTicket(line.ticketId);
    }

    // ── CASCADE: push changes to all linked lines (same canonicalProductId) ──
    // Fields that cascade: description, cost, sale, supplier, productCode, BOM
    const cascadeFields = ["description", "expectedCostUnit", "actualSaleUnit", "suggestedSaleUnit", "supplierName", "supplierId", "productCode", "benchmarkUnit"];
    const hasCascadeChange = cascadeFields.some(f => allowed[f] !== undefined);

    if (hasCascadeChange && line.canonicalProductId) {
      // Find all sibling lines with the same canonicalProductId on this ticket
      const siblings = await prisma.ticketLine.findMany({
        where: {
          ticketId: line.ticketId,
          canonicalProductId: line.canonicalProductId,
          id: { not: line.id },
          parentLineId: null,
        },
        select: { id: true, qty: true, isBomParent: true, priceOverride: true },
      });

      let applied = 0;
      for (const sib of siblings) {
        const sibQty = Number(sib.qty);
        const updates: Record<string, unknown> = {};
        // Locked siblings keep their cost/supplier; only non-pricing fields cascade.
        const allowPricing = !sib.priceOverride;

        if (allowPricing && allowed.expectedCostUnit !== undefined) {
          updates.expectedCostUnit = allowed.expectedCostUnit;
          updates.expectedCostTotal = Math.round(Number(allowed.expectedCostUnit) * sibQty * 100) / 100;
        }
        if (allowed.actualSaleUnit !== undefined) {
          updates.actualSaleUnit = allowed.actualSaleUnit;
          updates.actualSaleTotal = Math.round(Number(allowed.actualSaleUnit) * sibQty * 100) / 100;
        }
        if (allowed.suggestedSaleUnit !== undefined) {
          updates.suggestedSaleUnit = allowed.suggestedSaleUnit;
        }
        if (allowed.description !== undefined) updates.description = allowed.description;
        if (allowPricing && allowed.supplierName !== undefined) updates.supplierName = allowed.supplierName;
        if (allowPricing && allowed.supplierId !== undefined) updates.supplierId = allowed.supplierId;
        if (allowed.productCode !== undefined) updates.productCode = allowed.productCode;
        if (allowed.benchmarkUnit !== undefined) updates.benchmarkUnit = allowed.benchmarkUnit;

        // Recalculate margins for sibling
        const costUnit = Number(updates.expectedCostUnit ?? line.expectedCostUnit ?? 0);
        const saleUnit = Number(updates.actualSaleUnit ?? line.actualSaleUnit ?? 0);
        const sugSaleUnit = Number(updates.suggestedSaleUnit ?? line.suggestedSaleUnit ?? 0);
        if (updates.expectedCostUnit !== undefined || updates.actualSaleUnit !== undefined) {
          updates.expectedMarginTotal = (saleUnit - costUnit) * sibQty;
          updates.actualMarginTotal = (saleUnit - costUnit) * sibQty;
          updates.varianceTotal = (saleUnit - sugSaleUnit) * sibQty;
        }

        if (Object.keys(updates).length > 0) {
          await prisma.ticketLine.update({ where: { id: sib.id }, data: updates });
          applied++;
        }
      }

      // If source line is a BOM parent, copy BOM to siblings that aren't BOM parents yet
      if (line.isBomParent && applied > 0) {
        const components = await prisma.ticketLine.findMany({
          where: { parentLineId: id },
          select: { description: true, qty: true, unit: true, expectedCostUnit: true, supplierName: true },
        });
        if (components.length > 0) {
          for (const sib of siblings) {
            if (sib.isBomParent) continue;
            try {
              // Use internal fetch to create BOM on sibling
              const bomRes = await fetch(`http://localhost:3000/api/ticket-lines/${sib.id}/bom`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  components: components.map(c => ({
                    description: c.description,
                    qty: Number(c.qty),
                    unit: c.unit || "EA",
                    expectedCostUnit: Number(c.expectedCostUnit || 0),
                    supplierName: c.supplierName || undefined,
                  })),
                }),
              });
            } catch {}
          }
        }
      }

      return Response.json({ ...line, _applied: applied, ...(supplierMatchInfo ? { _supplierMatch: supplierMatchInfo } : {}) });
    }

    return Response.json({ ...line, ...(supplierMatchInfo ? { _supplierMatch: supplierMatchInfo } : {}) });
  } catch (error) {
    console.error("Failed to update ticket line:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Failed to update ticket line" }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    // Check for hard dependencies that block deletion
    const invoiceLines = await prisma.salesInvoiceLine.count({ where: { ticketLineId: id } });

    if (invoiceLines > 0) {
      return Response.json({
        error: "Cannot delete — line has invoice lines. Remove those first.",
        invoiceLines,
      }, { status: 409 });
    }

    // Clean up soft dependencies before deleting — sequential to respect FK order
    await prisma.$transaction(async (tx) => {
      // Clean up dependencies on component lines (if BOM parent)
      await tx.costAllocation.deleteMany({ where: { ticketLine: { parentLineId: id } } });
      await tx.stockUsage.deleteMany({ where: { ticketLine: { parentLineId: id } } });
      await tx.quoteLine.deleteMany({ where: { ticketLine: { parentLineId: id } } });
      await tx.procurementOrderLine.updateMany({ where: { ticketLine: { parentLineId: id } }, data: { ticketLineId: null } });
      await tx.ticketLine.deleteMany({ where: { parentLineId: id } });
      // Clean up dependencies on the parent line itself
      await tx.costAllocation.deleteMany({ where: { ticketLineId: id } });
      await tx.stockUsage.deleteMany({ where: { ticketLineId: id } });
      await tx.quoteLine.deleteMany({ where: { ticketLineId: id } });
      await tx.customerPOLine.deleteMany({ where: { ticketLineId: id } });
      await tx.procurementOrderLine.updateMany({ where: { ticketLineId: id }, data: { ticketLineId: null } });
      await tx.ticketLine.delete({ where: { id } });
    });

    return Response.json({ deleted: true, id });
  } catch (error) {
    console.error("Failed to delete ticket line:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Failed to delete ticket line" }, { status: 500 });
  }
}
