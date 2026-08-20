-- CreateTable CustomerPOTicketLink
CREATE TABLE "CustomerPOTicketLink" (
    "id" TEXT NOT NULL,
    "customerPOId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerPOTicketLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerPOTicketLink_customerPOId_ticketId_key" ON "CustomerPOTicketLink"("customerPOId", "ticketId");

-- CreateIndex
CREATE INDEX "CustomerPOTicketLink_customerPOId_idx" ON "CustomerPOTicketLink"("customerPOId");

-- CreateIndex
CREATE INDEX "CustomerPOTicketLink_ticketId_idx" ON "CustomerPOTicketLink"("ticketId");

-- AddForeignKey
ALTER TABLE "CustomerPOTicketLink" ADD CONSTRAINT "CustomerPOTicketLink_customerPOId_fkey" FOREIGN KEY ("customerPOId") REFERENCES "CustomerPO"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPOTicketLink" ADD CONSTRAINT "CustomerPOTicketLink_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
