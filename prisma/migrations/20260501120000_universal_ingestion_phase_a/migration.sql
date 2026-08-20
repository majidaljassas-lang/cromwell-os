-- Universal Ingestion Phase A (2026-05-01)
-- Extend IntakeDocument from bills-coupled to universal doc intake.
-- Extend Task with closesOnSignal so reactions auto-resolve open loops.
-- All additive, all nullable. No data loss possible.

ALTER TABLE "IntakeDocument"
  ADD COLUMN IF NOT EXISTS "docType"          TEXT,
  ADD COLUMN IF NOT EXISTS "intent"           TEXT,
  ADD COLUMN IF NOT EXISTS "intentConfidence" DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS "extracted"        JSONB,
  ADD COLUMN IF NOT EXISTS "linkedTicketId"   TEXT,
  ADD COLUMN IF NOT EXISTS "linkedTaskId"     TEXT,
  ADD COLUMN IF NOT EXISTS "triggerStatus"    TEXT;

CREATE INDEX IF NOT EXISTS "IntakeDocument_docType_idx"        ON "IntakeDocument"("docType");
CREATE INDEX IF NOT EXISTS "IntakeDocument_intent_idx"         ON "IntakeDocument"("intent");
CREATE INDEX IF NOT EXISTS "IntakeDocument_triggerStatus_idx"  ON "IntakeDocument"("triggerStatus");
CREATE INDEX IF NOT EXISTS "IntakeDocument_linkedTicketId_idx" ON "IntakeDocument"("linkedTicketId");

ALTER TABLE "Task"
  ADD COLUMN IF NOT EXISTS "closesOnSignal" JSONB,
  ADD COLUMN IF NOT EXISTS "closedBySignal" TEXT;
