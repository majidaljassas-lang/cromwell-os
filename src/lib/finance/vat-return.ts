/**
 * VAT return assembly and submission (F8).
 *
 * UK MTD-style 9-box layout assembled from JournalLine activity in the
 * period. Boxes 2/8/9 are zero by default (post-Brexit assumption — no EU
 * acquisitions). Box 5 = Box 3 − Box 4.
 *
 * Submission posts a settlement JE that:
 *   - clears the accumulated VAT Output balance (DR 2100)
 *   - clears the accumulated VAT Input balance (CR 1300)
 *   - lands the net liability in HMRC VAT Liability (CR 2200) — or DR if a
 *     refund is due.
 */

import { prisma } from "@/lib/prisma";
import type { Prisma, PrismaClient } from "@/generated/prisma";

type Tx = Prisma.TransactionClient | PrismaClient;

const VAT_OUTPUT_CODE = "2100";
const VAT_INPUT_CODE = "1300";
const HMRC_VAT_LIABILITY_CODE = "2200";

const r2 = (n: number) => Math.round(n * 100) / 100;

interface BoxTotals {
  box1: number;
  box2: number;
  box3: number;
  box4: number;
  box5: number;
  box6: number;
  box7: number;
  box8: number;
  box9: number;
}

export async function calculateBoxes(
  periodStart: Date,
  periodEnd: Date
): Promise<BoxTotals> {
  // Box 1 — VAT on sales (credit balance on VAT Output minus debits)
  // Box 4 — VAT reclaimed on purchases (debit balance on VAT Input minus credits)
  const [vatOut, vatIn, revenueAggs, expenseAggs] = await Promise.all([
    prisma.journalLine.aggregate({
      _sum: { debit: true, credit: true },
      where: {
        account: { accountCode: VAT_OUTPUT_CODE },
        journalEntry: {
          entryDate: { gte: periodStart, lte: periodEnd },
          status: "POSTED",
        },
      },
    }),
    prisma.journalLine.aggregate({
      _sum: { debit: true, credit: true },
      where: {
        account: { accountCode: VAT_INPUT_CODE },
        journalEntry: {
          entryDate: { gte: periodStart, lte: periodEnd },
          status: "POSTED",
        },
      },
    }),
    prisma.journalLine.aggregate({
      _sum: { debit: true, credit: true },
      where: {
        account: { accountType: "INCOME" },
        journalEntry: {
          entryDate: { gte: periodStart, lte: periodEnd },
          status: "POSTED",
        },
      },
    }),
    // Box 7: only purchases (COGS), not full opex. UK convention varies but
    // most small wholesalers report all purchases here including overheads.
    prisma.journalLine.aggregate({
      _sum: { debit: true, credit: true },
      where: {
        account: { accountType: "EXPENSE" },
        journalEntry: {
          entryDate: { gte: periodStart, lte: periodEnd },
          status: "POSTED",
        },
      },
    }),
  ]);

  const box1 = r2(Number(vatOut._sum.credit ?? 0) - Number(vatOut._sum.debit ?? 0));
  const box4 = r2(Number(vatIn._sum.debit ?? 0) - Number(vatIn._sum.credit ?? 0));
  const box6 = r2(Number(revenueAggs._sum.credit ?? 0) - Number(revenueAggs._sum.debit ?? 0));
  const box7 = r2(Number(expenseAggs._sum.debit ?? 0) - Number(expenseAggs._sum.credit ?? 0));

  return {
    box1,
    box2: 0,
    box3: r2(box1 + 0),
    box4,
    box5: r2(box1 - box4),
    box6,
    box7,
    box8: 0,
    box9: 0,
  };
}

export async function generateOrUpdateReturn(periodStart: Date, periodEnd: Date) {
  const boxes = await calculateBoxes(periodStart, periodEnd);
  const existing = await prisma.vATReturn.findUnique({
    where: { periodStart_periodEnd: { periodStart, periodEnd } },
  });
  if (existing) {
    if (existing.status === "SUBMITTED" || existing.status === "ACCEPTED") {
      return existing;
    }
    return prisma.vATReturn.update({
      where: { id: existing.id },
      data: { ...boxes, status: "CALCULATED" },
    });
  }
  return prisma.vATReturn.create({
    data: {
      periodStart,
      periodEnd,
      status: "CALCULATED",
      ...boxes,
    },
  });
}

/**
 * Mark a return as SUBMITTED and post the settlement JE that clears
 * VAT Output / VAT Input into the HMRC VAT Liability account.
 */
export async function submitReturn(returnId: string, hmrcRef?: string) {
  return prisma.$transaction(async (tx: Tx) => {
    const r = await tx.vATReturn.findUnique({ where: { id: returnId } });
    if (!r) throw new Error("VAT return not found");
    if (r.status === "SUBMITTED" || r.status === "ACCEPTED")
      throw new Error("Already submitted");

    const accounts = await tx.chartOfAccount.findMany({
      where: {
        accountCode: { in: [VAT_OUTPUT_CODE, VAT_INPUT_CODE, HMRC_VAT_LIABILITY_CODE] },
      },
    });
    const acctMap = new Map(accounts.map((a) => [a.accountCode, a]));
    const vatOut = acctMap.get(VAT_OUTPUT_CODE);
    const vatIn = acctMap.get(VAT_INPUT_CODE);
    const liab = acctMap.get(HMRC_VAT_LIABILITY_CODE);
    if (!vatOut || !vatIn || !liab)
      throw new Error("VAT accounts not seeded — run /api/finance/seed first");

    const box1 = Number(r.box1);
    const box4 = Number(r.box4);
    const box5 = Number(r.box5);

    // Settlement JE
    const lines: Array<{
      accountId: string;
      description: string;
      debit?: number;
      credit?: number;
    }> = [];
    if (box1 > 0)
      lines.push({
        accountId: vatOut.id,
        description: `VAT Output cleared — return ${r.id}`,
        debit: box1,
      });
    if (box4 > 0)
      lines.push({
        accountId: vatIn.id,
        description: `VAT Input cleared — return ${r.id}`,
        credit: box4,
      });
    if (box5 > 0)
      lines.push({
        accountId: liab.id,
        description: `HMRC VAT liability — return ${r.id}`,
        credit: box5,
      });
    else if (box5 < 0)
      lines.push({
        accountId: liab.id,
        description: `HMRC VAT refund due — return ${r.id}`,
        debit: -box5,
      });

    const totalDebit = r2(lines.reduce((s, l) => s + (l.debit ?? 0), 0));
    const totalCredit = r2(lines.reduce((s, l) => s + (l.credit ?? 0), 0));
    if (totalDebit !== totalCredit)
      throw new Error(
        `VAT settlement unbalanced: DR ${totalDebit} ≠ CR ${totalCredit}`
      );

    if (totalDebit > 0) {
      const period = await tx.fiscalPeriod.findFirst({
        where: { startDate: { lte: r.periodEnd }, endDate: { gte: r.periodEnd } },
      });
      const je = await tx.journalEntry.create({
        data: {
          entryDate: r.periodEnd,
          periodId: period?.id ?? null,
          reference: `VAT-${r.periodStart.toISOString().slice(0, 7)}`,
          description: `VAT return settlement ${r.periodStart.toISOString().slice(0, 7)}`,
          sourceType: "VAT_PAYMENT",
          sourceId: r.id,
          status: "POSTED",
          lines: {
            create: lines.map((l) => ({
              accountId: l.accountId,
              description: l.description,
              debit: r2(l.debit ?? 0),
              credit: r2(l.credit ?? 0),
            })),
          },
        },
      });
      // Bump balances
      for (const l of lines) {
        const delta = (l.debit ?? 0) - (l.credit ?? 0);
        await tx.chartOfAccount.update({
          where: { id: l.accountId },
          data: { currentBalance: { increment: r2(delta) } },
        });
      }
      console.log(`VAT return ${r.id}: posted settlement JE ${je.id}`);
    }

    return tx.vATReturn.update({
      where: { id: r.id },
      data: {
        status: "SUBMITTED",
        submittedAt: new Date(),
        hmrcRef: hmrcRef ?? null,
      },
    });
  });
}
