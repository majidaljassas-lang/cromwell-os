-- Phase 12: Autonomous intake
-- InboxThread: AI classification + override fields
ALTER TABLE "InboxThread" ADD COLUMN "aiClassification" TEXT;
ALTER TABLE "InboxThread" ADD COLUMN "aiConfidence" INTEGER;
ALTER TABLE "InboxThread" ADD COLUMN "aiSummary" TEXT;
ALTER TABLE "InboxThread" ADD COLUMN "aiEntities" JSONB;
ALTER TABLE "InboxThread" ADD COLUMN "aiAnalysedAt" TIMESTAMP(3);
ALTER TABLE "InboxThread" ADD COLUMN "autoCreatedTicket" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "InboxThread" ADD COLUMN "manualMode" BOOLEAN NOT NULL DEFAULT false;

-- Ticket: AI intake + override fields
ALTER TABLE "Ticket" ADD COLUMN "autoCreatedByAi" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Ticket" ADD COLUMN "manualMode" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Ticket" ADD COLUMN "aiSummary" TEXT;

-- InboxThreadStatus enum: add AUTO_TICKETED
ALTER TYPE "InboxThreadStatus" ADD VALUE IF NOT EXISTS 'AUTO_TICKETED';
