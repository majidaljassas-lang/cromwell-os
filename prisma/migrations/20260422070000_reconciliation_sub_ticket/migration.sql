-- Reconciliation sub-ticket models (Valsir→Geberit swap + customer revised-list flow)
-- Parent ticket is protected until workflow state = APPLIED.

-- New TicketLineStatus value for Section C customer-removal on apply.
ALTER TYPE "TicketLineStatus" ADD VALUE IF NOT EXISTS 'REMOVED_BY_CUSTOMER';

-- Enums
CREATE TYPE "ReconciliationType" AS ENUM (
  'VALSIR_GEBERIT_SWAP',
  'CUSTOMER_LIST_REVISION'
);

CREATE TYPE "ReconciliationWorkflowState" AS ENUM (
  'DRAFT',
  'PENDING_CUSTOMER_CONFIRMATION',
  'CUSTOMER_APPROVED',
  'APPLIED',
  'CLOSED'
);

CREATE TYPE "ReconciliationSection" AS ENUM ('A', 'B', 'C', 'D');

CREATE TYPE "ReconciliationLineAction" AS ENUM (
  'SWAP_CODE_AND_RECOST',
  'NO_CHANGE',
  'CONFIRM_WITH_CUSTOMER',
  'CUSTOMER_ONLY'
);

CREATE TYPE "ReconciliationFlag" AS ENUM (
  'OK',
  'VERIFY',
  'PRICE_FIX',
  'CONFIRM'
);

-- Reconciliation
CREATE SEQUENCE "Reconciliation_reconciliationNo_seq";

CREATE TABLE "Reconciliation" (
  "id" TEXT PRIMARY KEY,
  "reconciliationNo" INTEGER NOT NULL DEFAULT nextval('"Reconciliation_reconciliationNo_seq"'),
  "parentTicketId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "type" "ReconciliationType" NOT NULL,
  "workflowState" "ReconciliationWorkflowState" NOT NULL DEFAULT 'DRAFT',
  "notes" TEXT,
  "customerListSize" INTEGER NOT NULL DEFAULT 0,
  "customerListSnapshot" JSONB,
  "discrepancy" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "confirmedAt" TIMESTAMP(3),
  "appliedAt" TIMESTAMP(3),
  "closedAt" TIMESTAMP(3)
);

ALTER SEQUENCE "Reconciliation_reconciliationNo_seq" OWNED BY "Reconciliation"."reconciliationNo";

CREATE UNIQUE INDEX "Reconciliation_reconciliationNo_key" ON "Reconciliation"("reconciliationNo");
CREATE INDEX "Reconciliation_parentTicketId_idx" ON "Reconciliation"("parentTicketId");
CREATE INDEX "Reconciliation_workflowState_idx" ON "Reconciliation"("workflowState");

ALTER TABLE "Reconciliation"
  ADD CONSTRAINT "Reconciliation_parentTicketId_fkey"
  FOREIGN KEY ("parentTicketId") REFERENCES "Ticket"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- ReconciliationLine
CREATE TABLE "ReconciliationLine" (
  "id" TEXT PRIMARY KEY,
  "reconciliationId" TEXT NOT NULL,
  "parentTicketLineId" TEXT,
  "section" "ReconciliationSection" NOT NULL,
  "action" "ReconciliationLineAction" NOT NULL,
  "flag" "ReconciliationFlag",
  "description" TEXT NOT NULL,
  "qty" DECIMAL(14, 4) NOT NULL,
  "unit" TEXT NOT NULL,
  "oldCode" TEXT,
  "newCode" TEXT,
  "note" TEXT,
  "keepFlag" BOOLEAN,
  "appliedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE INDEX "ReconciliationLine_reconciliationId_idx" ON "ReconciliationLine"("reconciliationId");
CREATE INDEX "ReconciliationLine_section_idx" ON "ReconciliationLine"("section");

ALTER TABLE "ReconciliationLine"
  ADD CONSTRAINT "ReconciliationLine_reconciliationId_fkey"
  FOREIGN KEY ("reconciliationId") REFERENCES "Reconciliation"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReconciliationLine"
  ADD CONSTRAINT "ReconciliationLine_parentTicketLineId_fkey"
  FOREIGN KEY ("parentTicketLineId") REFERENCES "TicketLine"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
