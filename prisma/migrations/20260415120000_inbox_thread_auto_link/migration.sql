-- Inbox thread auto-link: confidence-scored contact→customer→open-ticket matching.
-- Adds linkConfidence + linkSource columns and their enums.

DO $$ BEGIN
  CREATE TYPE "InboxLinkConfidence" AS ENUM ('HIGH', 'MEDIUM', 'LOW');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "InboxLinkSource" AS ENUM ('AUTO', 'MANUAL');
EXCEPTION WHEN duplicate_object THEN null; END $$;

ALTER TABLE "InboxThread"
  ADD COLUMN IF NOT EXISTS "linkConfidence" "InboxLinkConfidence",
  ADD COLUMN IF NOT EXISTS "linkSource"     "InboxLinkSource";

-- Existing rows that already have a linkedTicketId were linked by hand (no
-- auto-linker has ever run); mark them MANUAL so the new auto-link step never
-- overwrites them.
UPDATE "InboxThread"
SET "linkSource" = 'MANUAL'
WHERE "linkedTicketId" IS NOT NULL
  AND "linkSource" IS NULL;
