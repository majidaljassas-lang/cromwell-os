-- CreateEnum
CREATE TYPE "BillMatchStatus" AS ENUM ('MATCHED', 'DISPUTE', 'VARIANCE', 'AWAITING_DELIVERY', 'AWAITING_BILL', 'ORPHAN_BILL', 'PARTIAL');

-- AlterTable
ALTER TABLE "SupplierBill" ADD COLUMN     "matchNotes" TEXT,
ADD COLUMN     "matchStatus" "BillMatchStatus",
ADD COLUMN     "matchVarianceAmt" DECIMAL(14,2),
ADD COLUMN     "matchedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "draftBody" TEXT,
ADD COLUMN     "supplierBillId" TEXT;

-- CreateIndex
CREATE INDEX "SupplierBill_matchStatus_idx" ON "SupplierBill"("matchStatus");

-- CreateIndex
CREATE INDEX "Task_taskType_status_idx" ON "Task"("taskType", "status");

-- CreateIndex
CREATE INDEX "Task_supplierBillId_idx" ON "Task"("supplierBillId");

-- CreateIndex
CREATE INDEX "Task_dueAt_idx" ON "Task"("dueAt");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_supplierBillId_fkey" FOREIGN KEY ("supplierBillId") REFERENCES "SupplierBill"("id") ON DELETE SET NULL ON UPDATE CASCADE;
