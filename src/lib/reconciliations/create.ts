// Create a Reconciliation + snapshot all classified lines into ReconciliationLine
// rows. Parent ticket is NOT mutated here — that happens only on apply().

import { prisma } from "@/lib/prisma";
import type {
  Prisma,
  Reconciliation,
  ReconciliationType,
} from "@/generated/prisma";
import { classify, type CustomerListRow } from "./classify";

export type CreateReconciliationInput = {
  parentTicketId: string;
  title: string;
  type: ReconciliationType;
  notes?: string;
  customerList: CustomerListRow[];
  initialState?: "DRAFT" | "PENDING_CUSTOMER_CONFIRMATION";
};

export async function createReconciliation(
  input: CreateReconciliationInput,
): Promise<Reconciliation & { classification: ReturnType<typeof classify> }> {
  const parentLines = await prisma.ticketLine.findMany({
    where: { ticketId: input.parentTicketId },
    select: { id: true, description: true, productCode: true, qty: true, unit: true },
    orderBy: { createdAt: "asc" },
  });

  const classification = classify(
    parentLines.map((l) => ({
      id: l.id,
      description: l.description,
      productCode: l.productCode,
      qty: Number(l.qty),
      unit: l.unit,
    })),
    input.customerList,
  );

  return prisma.$transaction(async (tx) => {
    const recon = await tx.reconciliation.create({
      data: {
        parentTicketId: input.parentTicketId,
        title: input.title,
        type: input.type,
        notes: input.notes,
        customerListSize: input.customerList.length,
        customerListSnapshot: input.customerList as unknown as Prisma.InputJsonValue,
        discrepancy:
          classification.discrepancies.length > 0
            ? ({ messages: classification.discrepancies } as unknown as Prisma.InputJsonValue)
            : undefined,
        workflowState: input.initialState ?? "DRAFT",
      },
    });

    for (const row of classification.rows) {
      if (row.section === "A") {
        await tx.reconciliationLine.create({
          data: {
            reconciliationId: recon.id,
            parentTicketLineId: row.parentLineId,
            section: "A",
            action: "SWAP_CODE_AND_RECOST",
            flag: row.flag,
            description: row.description,
            qty: row.qty,
            unit: row.unit,
            oldCode: row.oldCode,
            newCode: row.newCode,
            note: row.note,
          },
        });
      } else if (row.section === "B") {
        const noteParts: string[] = [`customer row #${row.matchedCustomerIdx}`];
        if (row.qtyMismatch) noteParts.push(`qty mismatch → customer qty ${row.qtyMismatch.customerQty}`);
        if (row.unitMismatch) noteParts.push(`unit mismatch → customer unit ${row.unitMismatch.customerUnit}`);
        await tx.reconciliationLine.create({
          data: {
            reconciliationId: recon.id,
            parentTicketLineId: row.parentLineId,
            section: "B",
            action: "NO_CHANGE",
            flag: row.qtyMismatch || row.unitMismatch ? "VERIFY" : "OK",
            description: row.description,
            qty: row.qty,
            unit: row.unit,
            note: noteParts.join(" · "),
          },
        });
      } else if (row.section === "C") {
        await tx.reconciliationLine.create({
          data: {
            reconciliationId: recon.id,
            parentTicketLineId: row.parentLineId,
            section: "C",
            action: "CONFIRM_WITH_CUSTOMER",
            flag: "CONFIRM",
            description: row.description,
            qty: row.qty,
            unit: row.unit,
            note: "Not on customer's revised list — decide keep or remove",
            keepFlag: null, // user must toggle
          },
        });
      } else {
        await tx.reconciliationLine.create({
          data: {
            reconciliationId: recon.id,
            parentTicketLineId: null,
            section: "D",
            action: "CUSTOMER_ONLY",
            flag: "VERIFY",
            description: row.description,
            qty: row.qty,
            unit: row.unit,
            oldCode: null,
            newCode: row.customerCode,
            note: `Customer row #${row.customerIdx} has no matching parent line`,
          },
        });
      }
    }

    return { ...recon, classification };
  });
}
