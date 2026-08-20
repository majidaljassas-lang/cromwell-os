-- Allow multiple match candidates per BankTransaction (Best + Possible matches).
-- Replace the unique on bankTransactionId with a composite unique on
-- (bankTransactionId, matchType, matchedRecordId) so the same candidate can't
-- be inserted twice but multiple distinct candidates per txn are allowed.

ALTER TABLE "BankTransactionMatch"
  DROP CONSTRAINT IF EXISTS "BankTransactionMatch_bankTransactionId_key";

DROP INDEX IF EXISTS "BankTransactionMatch_bankTransactionId_key";

CREATE UNIQUE INDEX IF NOT EXISTS "BankTransactionMatch_btxn_type_record_key"
  ON "BankTransactionMatch" ("bankTransactionId", "matchType", "matchedRecordId");
