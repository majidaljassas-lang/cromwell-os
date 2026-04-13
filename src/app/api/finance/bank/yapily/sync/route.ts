import { prisma } from "@/lib/prisma";
import { getTransactions, isYapilyConfigured } from "@/lib/finance/yapily";
import { reconcileBankTransactions } from "@/lib/finance/bank-reconciler";

export async function POST(request: Request) {
  try {
    if (!isYapilyConfigured()) {
      return Response.json(
        { error: "Yapily is not configured. Set YAPILY_APP_UUID and YAPILY_APP_SECRET." },
        { status: 503 }
      );
    }

    const body = await request.json();
    const { bankAccountId } = body;

    if (!bankAccountId) {
      return Response.json({ error: "bankAccountId is required" }, { status: 400 });
    }

    const bankAccount = await prisma.bankAccount.findUnique({
      where: { id: bankAccountId },
    });

    if (!bankAccount) {
      return Response.json({ error: "Bank account not found" }, { status: 404 });
    }

    if (!bankAccount.yapilyConsentToken || !bankAccount.yapilyAccountId) {
      return Response.json(
        { error: "Bank account not connected to Yapily. Use /api/finance/bank/yapily/connect first." },
        { status: 400 }
      );
    }

    // Determine the "from" date: last sync or 90 days ago
    const fromDate = bankAccount.lastSyncedAt
      ? bankAccount.lastSyncedAt.toISOString().slice(0, 10)
      : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    // Fetch transactions from Yapily
    const yapilyTransactions = await getTransactions(
      bankAccount.yapilyConsentToken,
      bankAccount.yapilyAccountId,
      fromDate
    );

    if (yapilyTransactions.length === 0) {
      await prisma.bankAccount.update({
        where: { id: bankAccountId },
        data: { lastSyncedAt: new Date() },
      });

      return Response.json({
        synced: 0,
        skipped: 0,
        reconciliation: null,
        message: "No new transactions from bank",
      });
    }

    // Import transactions with dedup via fitId
    const now = new Date();
    let synced = 0;
    let skipped = 0;

    for (const txn of yapilyTransactions) {
      const fitId = txn.id;
      const amount = txn.transactionAmount?.amount ?? txn.amount;
      const txnDate = new Date(txn.bookingDateTime || txn.date);
      const description =
        txn.description ||
        (txn.transactionInformation || []).join(" ") ||
        "No description";
      const balance = txn.balance?.balanceAmount?.amount ?? null;

      // Skip if we already have this fitId
      const exists = await prisma.bankTransaction.findFirst({
        where: {
          bankAccountId,
          fitId,
        },
      });

      if (exists) {
        skipped++;
        continue;
      }

      await prisma.bankTransaction.create({
        data: {
          bankAccountId,
          transactionDate: txnDate,
          amount,
          transactionType: amount >= 0 ? "DEPOSIT" : "WITHDRAWAL",
          description,
          reference: txn.reference || null,
          fitId,
          runningBalance: balance,
          reconciliationStatus: "UNRECONCILED",
          importedAt: now,
        },
      });
      synced++;
    }

    // Update last synced timestamp
    await prisma.bankAccount.update({
      where: { id: bankAccountId },
      data: { lastSyncedAt: now },
    });

    // Run auto-reconciliation on new transactions
    const reconciliation = await reconcileBankTransactions(bankAccountId);

    return Response.json({
      synced,
      skipped,
      total: yapilyTransactions.length,
      reconciliation: {
        processed: reconciliation.processed,
        reconciled: reconciliation.reconciled,
        matched: reconciliation.matched,
        unreconciled: reconciliation.unreconciled,
      },
      message: `Synced ${synced} transactions, skipped ${skipped} duplicates. Reconciled ${reconciliation.reconciled}, suggested ${reconciliation.matched} matches.`,
    });
  } catch (error) {
    console.error("Yapily sync failed:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Yapily sync failed" },
      { status: 500 }
    );
  }
}
