-- Manual classification: replaces AI auto-tag on inbox.
-- User picks one or more tags per email + optional ticket(s). Each tag has a
-- routing handler that downstream engines react to.

-- 1. Enum for tag category.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ClassificationCategory') THEN
    CREATE TYPE "ClassificationCategory" AS ENUM ('FINANCIAL', 'OPERATIONAL', 'BOTH');
  END IF;
END $$;

-- 2. ClassificationTag table.
CREATE TABLE IF NOT EXISTS "ClassificationTag" (
  "id"             TEXT NOT NULL,
  "name"           TEXT NOT NULL,
  "label"          TEXT NOT NULL,
  "category"       "ClassificationCategory" NOT NULL,
  "routingHandler" TEXT,
  "active"         BOOLEAN NOT NULL DEFAULT true,
  "sortOrder"      INTEGER NOT NULL DEFAULT 0,
  "description"    TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ClassificationTag_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ClassificationTag_name_key" ON "ClassificationTag"("name");

-- 3. ManualInboxAction table.
CREATE TABLE IF NOT EXISTS "ManualInboxAction" (
  "id"               TEXT NOT NULL,
  "ingestionEventId" TEXT NOT NULL,
  "tagId"            TEXT NOT NULL,
  "ticketId"         TEXT,
  "userId"           TEXT,
  "batchId"          TEXT,
  "notes"            TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ManualInboxAction_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ManualInboxAction_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "ClassificationTag"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "ManualInboxAction_ingestionEventId_idx" ON "ManualInboxAction"("ingestionEventId");
CREATE INDEX IF NOT EXISTS "ManualInboxAction_tagId_idx" ON "ManualInboxAction"("tagId");
CREATE INDEX IF NOT EXISTS "ManualInboxAction_ticketId_idx" ON "ManualInboxAction"("ticketId");
CREATE INDEX IF NOT EXISTS "ManualInboxAction_batchId_idx" ON "ManualInboxAction"("batchId");
