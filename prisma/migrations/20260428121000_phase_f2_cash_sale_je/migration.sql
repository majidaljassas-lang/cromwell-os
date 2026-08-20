-- F2: link CashSale to JournalEntry for idempotent GL posting
ALTER TABLE "CashSale" ADD COLUMN IF NOT EXISTS "journalEntryId" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "CashSale_journalEntryId_key" ON "CashSale"("journalEntryId");
