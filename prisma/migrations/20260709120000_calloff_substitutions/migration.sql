-- Call-off PO line substitutions: a customer-approved batch of line swaps against
-- a call-off (drawdown) CustomerPO. Applying splits the ticket line so already
-- called-off/delivered qty is frozen on the old line and only the remaining
-- balance moves to the new item (which becomes a new TicketLine).

-- TicketLine: link a substituted-in line back to the line it replaced, and a new
-- status for a fully-swapped-out old line.
ALTER TABLE "TicketLine" ADD COLUMN "substitutedFromLineId" TEXT;
ALTER TABLE "TicketLine" ADD CONSTRAINT "TicketLine_substitutedFromLineId_fkey" FOREIGN KEY ("substitutedFromLineId") REFERENCES "TicketLine"("id");
CREATE INDEX "TicketLine_substitutedFromLineId_idx" ON "TicketLine"("substitutedFromLineId");

ALTER TYPE "TicketLineStatus" ADD VALUE 'SUPERSEDED';

CREATE TABLE "CallOffSubstitution" (
  "id"            TEXT PRIMARY KEY,
  "customerPOId"  TEXT NOT NULL,
  "title"         TEXT NOT NULL,
  "notes"         TEXT,
  "workflowState" TEXT NOT NULL DEFAULT 'DRAFT',
  "pdfFileName"   TEXT,
  "pdfPath"       TEXT,
  "approvedAt"    TIMESTAMP(3),
  "appliedAt"     TIMESTAMP(3),
  "closedAt"      TIMESTAMP(3),
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CallOffSubstitution_customerPOId_fkey" FOREIGN KEY ("customerPOId") REFERENCES "CustomerPO"("id")
);

CREATE INDEX "CallOffSubstitution_customerPOId_idx"  ON "CallOffSubstitution"("customerPOId");
CREATE INDEX "CallOffSubstitution_workflowState_idx" ON "CallOffSubstitution"("workflowState");

CREATE TABLE "CallOffSubstitutionLine" (
  "id"                    TEXT PRIMARY KEY,
  "substitutionId"        TEXT NOT NULL,
  "oldTicketLineId"       TEXT NOT NULL,
  "oldCode"               TEXT,
  "oldDescription"        TEXT NOT NULL,
  "newCode"               TEXT,
  "newDescription"        TEXT NOT NULL,
  "newCanonicalProductId" TEXT,
  "qtyToSwap"             DECIMAL(14,4) NOT NULL,
  "frozenQtySnapshot"     DECIMAL(14,4) NOT NULL DEFAULT 0,
  "newTicketLineId"       TEXT,
  "note"                  TEXT,
  "appliedAt"             TIMESTAMP(3),
  "displayOrder"          INTEGER NOT NULL DEFAULT 0,
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CallOffSubstitutionLine_substitutionId_fkey" FOREIGN KEY ("substitutionId") REFERENCES "CallOffSubstitution"("id") ON DELETE CASCADE
);

CREATE INDEX "CallOffSubstitutionLine_substitutionId_displayOrder_idx" ON "CallOffSubstitutionLine"("substitutionId", "displayOrder");
CREATE INDEX "CallOffSubstitutionLine_oldTicketLineId_idx"             ON "CallOffSubstitutionLine"("oldTicketLineId");
