/**
 * GET  /api/finance/journals       — list manual journals
 * POST /api/finance/journals       — create a manual JE (balanced, period-aware)
 *   Body: {
 *     entryDate: "YYYY-MM-DD",
 *     reference?: string,
 *     description: string,
 *     lines: Array<{
 *       accountId: string,
 *       debit?: number,
 *       credit?: number,
 *       description?: string,
 *       customerId?: string, siteId?: string, ticketId?: string, supplierId?: string
 *     }>
 *   }
 */
import { prisma } from "@/lib/prisma";

const r2 = (n: number) => Math.round(n * 100) / 100;

export async function GET() {
  const journals = await prisma.journalEntry.findMany({
    where: { sourceType: "MANUAL_JOURNAL" },
    orderBy: { entryDate: "desc" },
    take: 100,
    include: {
      lines: { include: { account: true } },
      period: true,
    },
  });
  return Response.json({ journals });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      entryDate?: string;
      reference?: string;
      description?: string;
      lines?: Array<{
        accountId?: string;
        debit?: number;
        credit?: number;
        description?: string;
        customerId?: string;
        siteId?: string;
        ticketId?: string;
        supplierId?: string;
      }>;
    };

    if (!body.entryDate || !body.description || !Array.isArray(body.lines) || body.lines.length < 2) {
      return Response.json(
        { error: "entryDate, description, and at least 2 lines required" },
        { status: 400 }
      );
    }
    const lines = body.lines.filter((l) => l.accountId);
    if (lines.length < 2) {
      return Response.json({ error: "At least 2 lines with accountId required" }, { status: 400 });
    }

    const totalDebit = r2(lines.reduce((s, l) => s + (Number(l.debit) || 0), 0));
    const totalCredit = r2(lines.reduce((s, l) => s + (Number(l.credit) || 0), 0));
    if (totalDebit !== totalCredit) {
      return Response.json(
        { error: `Unbalanced: DR £${totalDebit} ≠ CR £${totalCredit}` },
        { status: 400 }
      );
    }
    if (totalDebit === 0) {
      return Response.json({ error: "Zero-value journal" }, { status: 400 });
    }

    const entryDate = new Date(body.entryDate);

    const result = await prisma.$transaction(async (tx) => {
      // Period lookup / auto-create + lock check (mirrors gl-posting.ts)
      const y = entryDate.getUTCFullYear();
      const m = entryDate.getUTCMonth();
      const label = `${y}-${String(m + 1).padStart(2, "0")}`;
      const startDate = new Date(Date.UTC(y, m, 1));
      const endDate = new Date(Date.UTC(y, m + 1, 0, 23, 59, 59, 999));
      let period = await tx.fiscalPeriod.findUnique({ where: { label } });
      if (period) {
        if (period.status === "LOCKED")
          throw new Error(`Period ${label} is LOCKED — cannot post manual journal`);
      } else {
        period = await tx.fiscalPeriod.create({
          data: { label, startDate, endDate, status: "OPEN" },
        });
      }

      const je = await tx.journalEntry.create({
        data: {
          entryDate,
          periodId: period.id,
          reference: body.reference ?? null,
          description: body.description!,
          sourceType: "MANUAL_JOURNAL",
          sourceId: null,
          status: "POSTED",
          lines: {
            create: lines.map((l) => ({
              accountId: l.accountId!,
              description: l.description ?? null,
              debit: r2(Number(l.debit) || 0),
              credit: r2(Number(l.credit) || 0),
              customerId: l.customerId ?? null,
              siteId: l.siteId ?? null,
              ticketId: l.ticketId ?? null,
              supplierId: l.supplierId ?? null,
            })),
          },
        },
      });

      // Bump balances
      const balanceUpdates = new Map<string, number>();
      for (const l of lines) {
        const delta = (Number(l.debit) || 0) - (Number(l.credit) || 0);
        balanceUpdates.set(
          l.accountId!,
          (balanceUpdates.get(l.accountId!) ?? 0) + delta
        );
      }
      for (const [accountId, delta] of balanceUpdates) {
        await tx.chartOfAccount.update({
          where: { id: accountId },
          data: { currentBalance: { increment: r2(delta) } },
        });
      }
      return je;
    });

    return Response.json({ ok: true, journalEntryId: result.id });
  } catch (e) {
    console.error("/api/finance/journals POST failed:", e);
    return Response.json(
      { error: e instanceof Error ? e.message : "failed" },
      { status: 500 }
    );
  }
}
