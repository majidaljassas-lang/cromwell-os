import { prisma } from "@/lib/prisma";
import { reconcileBankTransactions } from "@/lib/finance/bank-reconciler";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { bankAccountId } = body;

    if (!bankAccountId) {
      return Response.json({ error: "bankAccountId is required" }, { status: 400 });
    }

    // Verify bank account exists
    const bankAccount = await prisma.bankAccount.findUnique({
      where: { id: bankAccountId },
    });
    if (!bankAccount) {
      return Response.json({ error: "Bank account not found" }, { status: 404 });
    }

    const result = await reconcileBankTransactions(bankAccountId);

    return Response.json(result);
  } catch (error) {
    console.error("Reconciliation failed:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Reconciliation failed" },
      { status: 500 }
    );
  }
}
