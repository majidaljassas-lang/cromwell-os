-- CP Bank Spine ingestion models
-- Barclays current account + Barclaycard
-- Source of truth for reconciliation: bank line → purchase invoice → order group → sales invoice

-- Enums
CREATE TYPE "BankLineAccount" AS ENUM('CURRENT', 'CARD');
CREATE TYPE "BankLineMatchStatus" AS ENUM('UNMATCHED', 'SUGGESTED', 'PARTIAL', 'MATCHED', 'AUTO_BILL_CREATED', 'EXCLUDED', 'EXCEPTION');
CREATE TYPE "BankLineMatchLegType" AS ENUM('PAYMENT', 'CREDIT_REFUND');

-- BankLine: one row per bank transaction
CREATE TABLE "BankLine" (
  "id"             TEXT NOT NULL PRIMARY KEY,
  "account"        "BankLineAccount" NOT NULL,
  "spineNumber"    TEXT,
  "txnDate"        TIMESTAMP(3) NOT NULL,
  "amount"         DECIMAL(14,2) NOT NULL, -- + in / - out (card pre-flipped)
  "subcategory"    TEXT,
  "memo"           TEXT NOT NULL,
  "sourceRow"      INTEGER NOT NULL, -- 1-based row in CSV
  "rowHash"        TEXT NOT NULL UNIQUE, -- sha256(...) for idempotent re-import
  "matchStatus"    "BankLineMatchStatus" NOT NULL DEFAULT 'UNMATCHED',
  "excludedReason" TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL
);

CREATE INDEX "BankLine_txnDate_idx" ON "BankLine"("txnDate");
CREATE INDEX "BankLine_account_idx" ON "BankLine"("account");
CREATE INDEX "BankLine_matchStatus_idx" ON "BankLine"("matchStatus");
CREATE INDEX "BankLine_memo_idx" ON "BankLine"("memo");

-- BankLineMatch: many-to-many between bank line and purchase doc
CREATE TABLE "BankLineMatch" (
  "id"                TEXT NOT NULL,
  "bankLineId"        TEXT NOT NULL,
  "legType"           "BankLineMatchLegType" NOT NULL,
  "supplierBillId"    TEXT,
  "creditNoteId"      TEXT,
  "amountAllocated"   DECIMAL(14,2) NOT NULL,
  "confidence"        DECIMAL(5,2),
  "matchMethod"       TEXT NOT NULL, -- AMOUNT_DATE_NAME|AMOUNT_DATE|SUBSET_SUM|AUTO_CREATED_BILL|MANUAL
  "reason"            TEXT,
  "manualConfirmedAt" TIMESTAMP(3),
  "manualConfirmedBy" TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BankLineMatch_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BankLineMatch_bankLineId_fkey" FOREIGN KEY ("bankLineId") REFERENCES "BankLine"("id") ON DELETE CASCADE,
  CONSTRAINT "BankLineMatch_supplierBillId_fkey" FOREIGN KEY ("supplierBillId") REFERENCES "SupplierBill"("id") ON DELETE SET NULL,
  CONSTRAINT "BankLineMatch_creditNoteId_fkey" FOREIGN KEY ("creditNoteId") REFERENCES "CreditNote"("id") ON DELETE SET NULL,
  CONSTRAINT "BankLineMatch_unique_match" UNIQUE("bankLineId", "legType", "supplierBillId", "creditNoteId")
);

CREATE INDEX "BankLineMatch_bankLineId_idx" ON "BankLineMatch"("bankLineId");
CREATE INDEX "BankLineMatch_supplierBillId_idx" ON "BankLineMatch"("supplierBillId");
CREATE INDEX "BankLineMatch_creditNoteId_idx" ON "BankLineMatch"("creditNoteId");
