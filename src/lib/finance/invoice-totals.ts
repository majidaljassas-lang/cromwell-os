import { Prisma } from "@/generated/prisma";

type Tx = Prisma.TransactionClient | typeof import("@/lib/prisma").prisma;

export const STANDARD_VAT_RATE = 20; // UK standard rate %

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Compute VAT amount for a single line at a given rate (%). */
export function lineVat(net: number, ratePct: number = STANDARD_VAT_RATE): number {
  return r2(net * (ratePct / 100));
}

/** Build a SalesInvoiceLine create-payload's VAT fields. */
export function vatFields(net: number, ratePct: number = STANDARD_VAT_RATE) {
  return { vatRate: ratePct, vatAmount: lineVat(net, ratePct) };
}

/**
 * Recompute net/vat/gross from current line data and persist on the header.
 * `totalSell` is kept aligned with `totalGross` so legacy readers see gross.
 */
export async function recomputeInvoiceTotals(tx: Tx, invoiceId: string): Promise<{
  totalNet: number;
  totalVat: number;
  totalGross: number;
}> {
  const lines = await tx.salesInvoiceLine.findMany({
    where: { salesInvoiceId: invoiceId },
    select: { lineTotal: true, vatAmount: true },
  });
  const totalNet = r2(lines.reduce((s, l) => s + Number(l.lineTotal), 0));
  const totalVat = r2(lines.reduce((s, l) => s + Number(l.vatAmount ?? 0), 0));
  const totalGross = r2(totalNet + totalVat);
  await tx.salesInvoice.update({
    where: { id: invoiceId },
    data: {
      totalNet,
      totalVat,
      totalGross,
      totalSell: totalGross,
    },
  });
  return { totalNet, totalVat, totalGross };
}
