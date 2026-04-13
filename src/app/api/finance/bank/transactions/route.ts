import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const bankAccountId = searchParams.get("bankAccountId");
    const status = searchParams.get("status"); // UNRECONCILED, MATCHED, RECONCILED, EXCLUDED
    const limit = parseInt(searchParams.get("limit") || "50", 10);
    const offset = parseInt(searchParams.get("offset") || "0", 10);

    const where: Record<string, unknown> = {};
    if (bankAccountId) where.bankAccountId = bankAccountId;
    if (status) where.reconciliationStatus = status;

    const [transactions, total] = await Promise.all([
      prisma.bankTransaction.findMany({
        where,
        orderBy: { transactionDate: "desc" },
        take: Math.min(limit, 200),
        skip: offset,
        include: {
          bankAccount: {
            select: { bankName: true, accountName: true },
          },
        },
      }),
      prisma.bankTransaction.count({ where }),
    ]);

    return Response.json({ transactions, total });
  } catch (error) {
    console.error("Failed to list bank transactions:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to list bank transactions" },
      { status: 500 }
    );
  }
}
