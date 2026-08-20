-- TrueLayer swap: drop Yapily + Enable Banking remnants, add BankConnection model.
-- Existing BankAccount row (Cromwell Plumbing Barclays) is preserved; it will
-- be linked to a BankConnection when OAuth completes.

-- 1. Rename SourceType.ENABLE_BANKING -> OPEN_BANKING (provider-agnostic, atomic, preserves any rows).
ALTER TYPE "SourceType" RENAME VALUE 'ENABLE_BANKING' TO 'OPEN_BANKING';

-- 2. Drop unique index that covers enableAccountId before the column drop.
DROP INDEX IF EXISTS "BankAccount_enableAccountId_key";

-- 3. Drop legacy provider columns.
ALTER TABLE "BankAccount"
  DROP COLUMN IF EXISTS "yapilyConsentToken",
  DROP COLUMN IF EXISTS "yapilyAccountId",
  DROP COLUMN IF EXISTS "yapilyInstitutionId",
  DROP COLUMN IF EXISTS "enableSessionId",
  DROP COLUMN IF EXISTS "enableAccountId";

-- 4. Create BankProvider enum.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BankProvider') THEN
    CREATE TYPE "BankProvider" AS ENUM ('TRUELAYER', 'CSV');
  END IF;
END $$;

-- 5. Create BankConnection table.
CREATE TABLE IF NOT EXISTS "BankConnection" (
  "id" TEXT NOT NULL,
  "provider" "BankProvider" NOT NULL DEFAULT 'TRUELAYER',
  "providerName" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "providerConnectionId" TEXT,
  "accessToken" TEXT,
  "refreshToken" TEXT,
  "tokenExpiresAt" TIMESTAMP(3),
  "consentExpiresAt" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "lastSyncedAt" TIMESTAMP(3),
  "lastSyncError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BankConnection_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "BankConnection_status_idx" ON "BankConnection"("status");
CREATE INDEX IF NOT EXISTS "BankConnection_consentExpiresAt_idx" ON "BankConnection"("consentExpiresAt");

-- 6. Add new columns to BankAccount linking it to a BankConnection.
ALTER TABLE "BankAccount"
  ADD COLUMN IF NOT EXISTS "connectionId" TEXT,
  ADD COLUMN IF NOT EXISTS "providerAccountId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "BankAccount_providerAccountId_key" ON "BankAccount"("providerAccountId");
CREATE INDEX IF NOT EXISTS "BankAccount_connectionId_idx" ON "BankAccount"("connectionId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'BankAccount_connectionId_fkey'
  ) THEN
    ALTER TABLE "BankAccount"
      ADD CONSTRAINT "BankAccount_connectionId_fkey"
      FOREIGN KEY ("connectionId") REFERENCES "BankConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
