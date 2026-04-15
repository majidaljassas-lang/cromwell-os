-- CreateEnum
CREATE TYPE "LogisticsStopStatus" AS ENUM ('NOT_ARRIVED', 'BYPASSED', 'DEPARTED', 'DELIVERED', 'UNKNOWN');

-- AlterTable
ALTER TABLE "LogisticsEvent" ADD COLUMN     "cpRef" TEXT,
ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "deliveryAddress" TEXT,
ADD COLUMN     "driver" TEXT,
ADD COLUMN     "plannedDate" TIMESTAMP(3),
ADD COLUMN     "processedAt" TIMESTAMP(3),
ADD COLUMN     "stopStatus" "LogisticsStopStatus";

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "deliveryFailed" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "LogisticsEvent_ticketId_timestamp_idx" ON "LogisticsEvent"("ticketId", "timestamp");

-- CreateIndex
CREATE INDEX "LogisticsEvent_stopStatus_idx" ON "LogisticsEvent"("stopStatus");

-- CreateIndex
CREATE INDEX "LogisticsEvent_processedAt_idx" ON "LogisticsEvent"("processedAt");

-- CreateIndex
CREATE INDEX "LogisticsEvent_cpRef_idx" ON "LogisticsEvent"("cpRef");
