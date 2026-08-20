-- F3: FiscalPeriod + period scoping for the GL.
-- Periods are monthly (label = "YYYY-MM"). Status drives posting rules:
--   OPEN   — postings allowed
--   CLOSED — postings allowed but flagged (soft close, future use)
--   LOCKED — postings rejected by gl-posting.ts

CREATE TABLE IF NOT EXISTS "FiscalPeriod" (
  "id"        TEXT PRIMARY KEY,
  "label"     TEXT NOT NULL UNIQUE,
  "startDate" TIMESTAMP(3) NOT NULL,
  "endDate"   TIMESTAMP(3) NOT NULL,
  "status"    TEXT NOT NULL DEFAULT 'OPEN',
  "closedAt"  TIMESTAMP(3),
  "closedBy"  TEXT,
  "notes"     TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "FiscalPeriod_startDate_endDate_idx" ON "FiscalPeriod"("startDate", "endDate");
CREATE INDEX IF NOT EXISTS "FiscalPeriod_status_idx"             ON "FiscalPeriod"("status");

-- Add periodId to JournalEntry (nullable; backfilled below)
ALTER TABLE "JournalEntry" ADD COLUMN IF NOT EXISTS "periodId" TEXT;
ALTER TABLE "JournalEntry"
  ADD CONSTRAINT "JournalEntry_periodId_fkey"
  FOREIGN KEY ("periodId") REFERENCES "FiscalPeriod"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "JournalEntry_periodId_idx" ON "JournalEntry"("periodId");

-- Backfill: create one FiscalPeriod for every distinct YYYY-MM in existing JEs.
INSERT INTO "FiscalPeriod" ("id", "label", "startDate", "endDate", "status", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  TO_CHAR(month_start, 'YYYY-MM') AS label,
  month_start,
  (month_start + INTERVAL '1 month' - INTERVAL '1 day')::timestamp AS month_end,
  'OPEN',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM (
  SELECT DISTINCT date_trunc('month', "entryDate")::timestamp AS month_start
  FROM "JournalEntry"
) m
ON CONFLICT ("label") DO NOTHING;

-- Link existing JEs to their period
UPDATE "JournalEntry" je
SET "periodId" = fp."id"
FROM "FiscalPeriod" fp
WHERE je."periodId" IS NULL
  AND TO_CHAR(je."entryDate", 'YYYY-MM') = fp."label";
