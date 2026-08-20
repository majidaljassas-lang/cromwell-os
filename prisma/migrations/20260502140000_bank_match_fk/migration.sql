-- Add FK constraint from BankTransactionMatch.bankTransactionId -> BankTransaction.id
-- so the Prisma relation has a real DB-level FK.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'BankTransactionMatch_bankTransactionId_fkey'
  ) THEN
    ALTER TABLE "BankTransactionMatch"
      ADD CONSTRAINT "BankTransactionMatch_bankTransactionId_fkey"
      FOREIGN KEY ("bankTransactionId") REFERENCES "BankTransaction"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
