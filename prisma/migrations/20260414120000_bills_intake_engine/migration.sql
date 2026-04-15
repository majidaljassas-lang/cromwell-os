-- Bills Intake Engine — new models, enums, and column extensions
-- Safe to run on an existing database: uses IF NOT EXISTS / DO blocks where possible.

-- ────────────────────────────────────────────────────────────────
-- Enums
-- ────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE "BillAllocationType" AS ENUM ('TICKET_LINE', 'STOCK', 'RETURNS_CANDIDATE', 'OVERHEAD', 'UNRESOLVED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "BillCorrectionType" AS ENUM ('SUPPLIER_REASSIGNED', 'TICKET_REASSIGNED', 'SITE_REASSIGNED', 'SKU_MAPPED', 'SPLIT_ALLOCATION', 'SURPLUS_ROUTED', 'DUPLICATE_FLAGGED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "BillMatchAction" AS ENUM ('AUTO_LINKED', 'SUGGESTED', 'REJECTED', 'EXCEPTION');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "BillMatchCandidateType" AS ENUM ('TICKET_LINE', 'PO_LINE', 'INVOICE_LINE', 'STOCK', 'RETURNS');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "DocumentQueueStatus" AS ENUM ('NEW', 'DOWNLOADED', 'OCR_REQUIRED', 'PARSED', 'MATCH_PENDING', 'AUTO_MATCHED', 'REVIEW_REQUIRED', 'APPROVED', 'POSTED', 'ERROR', 'DEAD_LETTER');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "SupplierAliasSource" AS ENUM ('USER', 'EMAIL_DOMAIN', 'VAT', 'SYSTEM');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ────────────────────────────────────────────────────────────────
-- Extend SupplierBill
-- ────────────────────────────────────────────────────────────────

ALTER TABLE "SupplierBill"
  ADD COLUMN IF NOT EXISTS "intakeDocumentId"  TEXT,
  ADD COLUMN IF NOT EXISTS "duplicateOfBillId" TEXT,
  ADD COLUMN IF NOT EXISTS "duplicateStatus"   TEXT,
  ADD COLUMN IF NOT EXISTS "checksum"          TEXT;

CREATE INDEX IF NOT EXISTS "SupplierBill_checksum_idx"         ON "SupplierBill" ("checksum");
CREATE INDEX IF NOT EXISTS "SupplierBill_intakeDocumentId_idx" ON "SupplierBill" ("intakeDocumentId");

-- ────────────────────────────────────────────────────────────────
-- Extend SupplierBillLine
-- ────────────────────────────────────────────────────────────────

ALTER TABLE "SupplierBillLine"
  ADD COLUMN IF NOT EXISTS "parseConfidence"  DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS "originalUom"      TEXT,
  ADD COLUMN IF NOT EXISTS "packSize"         INTEGER,
  ADD COLUMN IF NOT EXISTS "extractedSku"     TEXT,
  ADD COLUMN IF NOT EXISTS "intakeDocumentId" TEXT;

CREATE INDEX IF NOT EXISTS "SupplierBillLine_intakeDocumentId_idx" ON "SupplierBillLine" ("intakeDocumentId");

-- ────────────────────────────────────────────────────────────────
-- Extend SiteAlias (observationCount, lastSeenAt)
-- ────────────────────────────────────────────────────────────────

ALTER TABLE "SiteAlias"
  ADD COLUMN IF NOT EXISTS "observationCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "lastSeenAt"       TIMESTAMP(3);

-- ────────────────────────────────────────────────────────────────
-- IntakeDocument
-- ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "IntakeDocument" (
  "id"                TEXT PRIMARY KEY,
  "sourceType"        TEXT NOT NULL,
  "sourceRef"         TEXT,
  "fileRef"           TEXT,
  "rawText"           TEXT,
  "status"            "DocumentQueueStatus" NOT NULL DEFAULT 'NEW',
  "parseConfidence"   DECIMAL(5,2),
  "errorMessage"      TEXT,
  "retryCount"        INTEGER NOT NULL DEFAULT 0,
  "checksum"          TEXT,
  "ingestionEventId"  TEXT,
  "supplierBillId"    TEXT,
  "nextAttemptAt"     TIMESTAMP(3),
  "lastAttemptAt"     TIMESTAMP(3),
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "IntakeDocument_status_idx"        ON "IntakeDocument" ("status");
CREATE INDEX IF NOT EXISTS "IntakeDocument_sourceType_idx"    ON "IntakeDocument" ("sourceType");
CREATE INDEX IF NOT EXISTS "IntakeDocument_checksum_idx"      ON "IntakeDocument" ("checksum");
CREATE INDEX IF NOT EXISTS "IntakeDocument_nextAttemptAt_idx" ON "IntakeDocument" ("nextAttemptAt");

-- SupplierBill → IntakeDocument and duplicate self-FK
DO $$ BEGIN
  ALTER TABLE "SupplierBill"
    ADD CONSTRAINT "SupplierBill_intakeDocumentId_fkey"
    FOREIGN KEY ("intakeDocumentId") REFERENCES "IntakeDocument"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "SupplierBill"
    ADD CONSTRAINT "SupplierBill_duplicateOfBillId_fkey"
    FOREIGN KEY ("duplicateOfBillId") REFERENCES "SupplierBill"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "SupplierBillLine"
    ADD CONSTRAINT "SupplierBillLine_intakeDocumentId_fkey"
    FOREIGN KEY ("intakeDocumentId") REFERENCES "IntakeDocument"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ────────────────────────────────────────────────────────────────
-- BillLineAllocation
-- ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "BillLineAllocation" (
  "id"                   TEXT PRIMARY KEY,
  "supplierBillLineId"   TEXT NOT NULL,
  "allocationType"       "BillAllocationType" NOT NULL,
  "ticketLineId"         TEXT,
  "ticketId"             TEXT,
  "siteId"               TEXT,
  "customerId"           TEXT,
  "supplierBillId"       TEXT,
  "qtyAllocated"         DECIMAL(14,4) NOT NULL,
  "costAllocated"        DECIMAL(14,2) NOT NULL,
  "confidence"           DECIMAL(5,2),
  "reason"               TEXT,
  "stockExcessRecordId"  TEXT,
  "returnId"             TEXT,
  "absorbedAllocationId" TEXT,
  "costAllocationId"     TEXT,
  "createdBy"            TEXT,
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "BillLineAllocation_supplierBillLineId_idx" ON "BillLineAllocation" ("supplierBillLineId");
CREATE INDEX IF NOT EXISTS "BillLineAllocation_ticketLineId_idx"       ON "BillLineAllocation" ("ticketLineId");
CREATE INDEX IF NOT EXISTS "BillLineAllocation_allocationType_idx"     ON "BillLineAllocation" ("allocationType");
CREATE INDEX IF NOT EXISTS "BillLineAllocation_supplierBillId_idx"     ON "BillLineAllocation" ("supplierBillId");

DO $$ BEGIN
  ALTER TABLE "BillLineAllocation"
    ADD CONSTRAINT "BillLineAllocation_supplierBillLineId_fkey"
    FOREIGN KEY ("supplierBillLineId") REFERENCES "SupplierBillLine"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ────────────────────────────────────────────────────────────────
-- BillLineMatch
-- ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "BillLineMatch" (
  "id"                  TEXT PRIMARY KEY,
  "supplierBillLineId"  TEXT NOT NULL,
  "candidateType"       "BillMatchCandidateType" NOT NULL,
  "candidateId"         TEXT NOT NULL,
  "supplierConfidence"  DECIMAL(5,2),
  "productConfidence"   DECIMAL(5,2),
  "ticketConfidence"    DECIMAL(5,2),
  "siteConfidence"      DECIMAL(5,2),
  "entityConfidence"    DECIMAL(5,2),
  "overallConfidence"   DECIMAL(5,2),
  "reasons"             JSONB,
  "action"              "BillMatchAction" NOT NULL,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "BillLineMatch_supplierBillLineId_idx"           ON "BillLineMatch" ("supplierBillLineId");
CREATE INDEX IF NOT EXISTS "BillLineMatch_candidateType_candidateId_idx"   ON "BillLineMatch" ("candidateType", "candidateId");
CREATE INDEX IF NOT EXISTS "BillLineMatch_action_idx"                       ON "BillLineMatch" ("action");

DO $$ BEGIN
  ALTER TABLE "BillLineMatch"
    ADD CONSTRAINT "BillLineMatch_supplierBillLineId_fkey"
    FOREIGN KEY ("supplierBillLineId") REFERENCES "SupplierBillLine"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ────────────────────────────────────────────────────────────────
-- BillIntakeCorrection
-- ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "BillIntakeCorrection" (
  "id"                 TEXT PRIMARY KEY,
  "supplierBillLineId" TEXT NOT NULL,
  "correctionType"     "BillCorrectionType" NOT NULL,
  "beforeJson"         JSONB,
  "afterJson"          JSONB,
  "userId"             TEXT,
  "reason"             TEXT,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "BillIntakeCorrection_supplierBillLineId_idx" ON "BillIntakeCorrection" ("supplierBillLineId");
CREATE INDEX IF NOT EXISTS "BillIntakeCorrection_correctionType_idx"     ON "BillIntakeCorrection" ("correctionType");
CREATE INDEX IF NOT EXISTS "BillIntakeCorrection_createdAt_idx"          ON "BillIntakeCorrection" ("createdAt");

DO $$ BEGIN
  ALTER TABLE "BillIntakeCorrection"
    ADD CONSTRAINT "BillIntakeCorrection_supplierBillLineId_fkey"
    FOREIGN KEY ("supplierBillLineId") REFERENCES "SupplierBillLine"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ────────────────────────────────────────────────────────────────
-- SupplierAlias
-- ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "SupplierAlias" (
  "id"               TEXT PRIMARY KEY,
  "supplierId"       TEXT NOT NULL,
  "alias"            TEXT NOT NULL,
  "source"           "SupplierAliasSource" NOT NULL,
  "confidence"       DECIMAL(5,2),
  "observationCount" INTEGER NOT NULL DEFAULT 0,
  "lastSeenAt"       TIMESTAMP(3),
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "SupplierAlias_supplierId_alias_key" ON "SupplierAlias" ("supplierId", "alias");
CREATE INDEX        IF NOT EXISTS "SupplierAlias_alias_idx"            ON "SupplierAlias" ("alias");

DO $$ BEGIN
  ALTER TABLE "SupplierAlias"
    ADD CONSTRAINT "SupplierAlias_supplierId_fkey"
    FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ────────────────────────────────────────────────────────────────
-- SupplierProductMapping
-- ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "SupplierProductMapping" (
  "id"                   TEXT PRIMARY KEY,
  "supplierId"           TEXT NOT NULL,
  "supplierSku"          TEXT,
  "supplierDescription"  TEXT,
  "canonicalName"        TEXT,
  "normalizedItemName"   TEXT,
  "defaultUom"           TEXT,
  "defaultPackSize"      INTEGER,
  "observationCount"     INTEGER NOT NULL DEFAULT 0,
  "lastSeenAt"           TIMESTAMP(3),
  "lastUnitCost"         DECIMAL(14,4),
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "SupplierProductMapping_supplierId_supplierSku_key" ON "SupplierProductMapping" ("supplierId", "supplierSku");
CREATE INDEX        IF NOT EXISTS "SupplierProductMapping_supplierId_idx"              ON "SupplierProductMapping" ("supplierId");
CREATE INDEX        IF NOT EXISTS "SupplierProductMapping_normalizedItemName_idx"      ON "SupplierProductMapping" ("normalizedItemName");

DO $$ BEGIN
  ALTER TABLE "SupplierProductMapping"
    ADD CONSTRAINT "SupplierProductMapping_supplierId_fkey"
    FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
