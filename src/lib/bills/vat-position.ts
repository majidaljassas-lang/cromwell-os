/**
 * Running VAT position — input VAT from SupplierBillLine vs output VAT
 * from SalesInvoiceLine, for a date window.
 *
 * Scope:
 *   inputVat  = sum(SupplierBillLine.vatAmount)
 *               where SupplierBill.billDate in [from, to]
 *                 AND SupplierBill.status != 'VOID'
 *
 *   outputVat = sum(SalesInvoiceLine.vatAmount)
 *               where SalesInvoice.issuedAt in [from, to]
 *                 AND SalesInvoice.status  in ('SENT', 'PAID')
 *
 * position  = outputVat − inputVat  (positive = owe HMRC, negative = reclaim)
 */

import { prisma } from "@/lib/prisma";

export interface VatPosition {
  from: string;
  to: string;
  inputVat: number;
  outputVat: number;
  position: number;
  inputBillCount: number;
  outputInvoiceCount: number;
}

export async function getVatPosition(from: Date, to: Date): Promise<VatPosition> {
  const [bills, invoices] = await Promise.all([
    prisma.supplierBill.findMany({
      where: {
        billDate: { gte: from, lte: to },
        status:   { not: "VOID" },
      },
      select: {
        id: true,
        vatAmount: true,
        lines: { select: { vatAmount: true } },
      },
    }),
    prisma.salesInvoice.findMany({
      where: {
        issuedAt: { gte: from, lte: to },
        status:   { in: ["SENT", "PAID"] },
      },
      select: {
        id: true,
        lines: { select: { vatAmount: true, lineTotal: true, vatRate: true } },
      },
    }),
  ]);

  let inputVat = 0;
  for (const b of bills) {
    if (b.vatAmount) {
      inputVat += Number(b.vatAmount);
      continue;
    }
    for (const l of b.lines) {
      if (l.vatAmount) inputVat += Number(l.vatAmount);
    }
  }

  let outputVat = 0;
  for (const inv of invoices) {
    for (const l of inv.lines) {
      if (l.vatAmount) {
        outputVat += Number(l.vatAmount);
      } else if (l.vatRate) {
        outputVat += Number(l.lineTotal) * (Number(l.vatRate) / 100);
      }
    }
  }

  inputVat  = round2(inputVat);
  outputVat = round2(outputVat);

  return {
    from: from.toISOString().slice(0, 10),
    to:   to.toISOString().slice(0, 10),
    inputVat,
    outputVat,
    position: round2(outputVat - inputVat),
    inputBillCount: bills.length,
    outputInvoiceCount: invoices.length,
  };
}

function round2(n: number): number { return Math.round(n * 100) / 100; }
