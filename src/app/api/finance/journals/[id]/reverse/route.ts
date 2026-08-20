/**
 * POST /api/finance/journals/[id]/reverse
 * Creates a reversing JE on the same date (with debit/credit swapped)
 * and links the two via reversedById.
 */
import { prisma } from "@/lib/prisma";

const r2 = (n: number) => Math.round(n * 100) / 100;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const original = await tx.journalEntry.findUnique({
        where: { id },
        include: { lines: true, period: true },
      });
      if (!original) throw new Error("Journal entry not found");
      if (original.isReversed) throw new Error("Already reversed");

      if (original.period?.status === "LOCKED")
        throw new Error(`Period ${original.period.label} is LOCKED`);

      const reversal = await tx.journalEntry.create({
        data: {
          entryDate: original.entryDate,
          periodId: original.periodId,
          reference: original.reference ? `REV-${original.reference}` : null,
          description: `Reversal of ${original.description}`,
          sourceType: original.sourceType,
          sourceId: original.sourceId,
          isAdjustment: true,
          status: "POSTED",
          reversedById: null,
          lines: {
            create: original.lines.map((l) => ({
              accountId: l.accountId,
              description: l.description ? `Reverse — ${l.description}` : null,
              debit: r2(Number(l.credit)),
              credit: r2(Number(l.debit)),
              customerId: l.customerId,
              siteId: l.siteId,
              ticketId: l.ticketId,
              ticketLineId: l.ticketLineId,
              supplierId: l.supplierId,
            })),
          },
        },
      });

      await tx.journalEntry.update({
        where: { id: original.id },
        data: { isReversed: true, reversedById: reversal.id, status: "REVERSED" },
      });

      // Bump balances by reverse delta
      const balanceUpdates = new Map<string, number>();
      for (const l of original.lines) {
        const delta = Number(l.credit) - Number(l.debit);
        balanceUpdates.set(l.accountId, (balanceUpdates.get(l.accountId) ?? 0) + delta);
      }
      for (const [accountId, delta] of balanceUpdates) {
        await tx.chartOfAccount.update({
          where: { id: accountId },
          data: { currentBalance: { increment: r2(delta) } },
        });
      }
      return reversal;
    });

    return Response.json({ ok: true, reversalId: result.id });
  } catch (e) {
    console.error("/api/finance/journals/[id]/reverse failed:", e);
    return Response.json(
      { error: e instanceof Error ? e.message : "failed" },
      { status: 500 }
    );
  }
}
