/**
 * POST /api/finance/bank-inbox/categorize
 *
 * Direct-categorize a bank transaction. Used when a txn doesn't tie to an
 * existing invoice / bill — bank charges, owner drawings, transfers,
 * miscellaneous expenses. Posts a balanced JE between the bank account
 * and a chosen counterparty account, then marks the txn RECONCILED.
 *
 * Body:
 *   {
 *     bankTransactionId: string;
 *     counterpartyAccountId: string;     // ChartOfAccount.id
 *     description: string;               // free-text JE narrative
 *     customerId?: string | null;
 *     siteId?: string | null;
 *     supplierId?: string | null;
 *     ticketId?: string | null;
 *   }
 */
import { postBankSettlement } from "@/lib/finance/gl-posting";

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      bankTransactionId?: string;
      counterpartyAccountId?: string;
      description?: string;
      customerId?: string | null;
      siteId?: string | null;
      supplierId?: string | null;
      ticketId?: string | null;
    };
    if (!body.bankTransactionId || !body.counterpartyAccountId || !body.description) {
      return Response.json(
        { error: "bankTransactionId, counterpartyAccountId, description required" },
        { status: 400 }
      );
    }
    const result = await postBankSettlement({
      bankTransactionId: body.bankTransactionId,
      counterpartyAccountId: body.counterpartyAccountId,
      description: body.description,
      customerId: body.customerId ?? null,
      siteId: body.siteId ?? null,
      supplierId: body.supplierId ?? null,
      ticketId: body.ticketId ?? null,
    });
    return Response.json({ ok: true, journalEntryId: result.id, created: result.created });
  } catch (e) {
    console.error("/api/finance/bank-inbox/categorize POST failed:", e);
    return Response.json(
      { error: e instanceof Error ? e.message : "failed" },
      { status: 500 }
    );
  }
}
