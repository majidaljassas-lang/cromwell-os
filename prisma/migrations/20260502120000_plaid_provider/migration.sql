-- Add PLAID to BankProvider enum + cursor column on BankConnection for /transactions/sync.

-- 1. Add PLAID enum value if missing.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'BankProvider' AND e.enumlabel = 'PLAID'
  ) THEN
    ALTER TYPE "BankProvider" ADD VALUE 'PLAID';
  END IF;
END $$;

-- 2. Add cursor column for Plaid /transactions/sync (null for TrueLayer rows).
ALTER TABLE "BankConnection"
  ADD COLUMN IF NOT EXISTS "cursor" TEXT;
