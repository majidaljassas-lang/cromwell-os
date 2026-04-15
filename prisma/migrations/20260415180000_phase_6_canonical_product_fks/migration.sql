-- AlterTable
ALTER TABLE "StockExcessRecord" ADD COLUMN     "canonicalProductId" TEXT;

-- AlterTable
ALTER TABLE "TicketLine" ADD COLUMN     "canonicalProductId" TEXT;

-- CreateIndex
CREATE INDEX "StockExcessRecord_canonicalProductId_idx" ON "StockExcessRecord"("canonicalProductId");

-- CreateIndex
CREATE INDEX "TicketLine_canonicalProductId_idx" ON "TicketLine"("canonicalProductId");

-- AddForeignKey
ALTER TABLE "TicketLine" ADD CONSTRAINT "TicketLine_canonicalProductId_fkey" FOREIGN KEY ("canonicalProductId") REFERENCES "CanonicalProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockExcessRecord" ADD CONSTRAINT "StockExcessRecord_canonicalProductId_fkey" FOREIGN KEY ("canonicalProductId") REFERENCES "CanonicalProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;
