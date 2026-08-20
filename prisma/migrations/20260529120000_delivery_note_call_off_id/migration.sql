-- DeliveryNote.callOffId: physical delivery scoped to a specific CallOff.
-- Nullable: pre-existing DNs and ad-hoc deliveries without a call-off stay valid.

ALTER TABLE "DeliveryNote" ADD COLUMN "callOffId" TEXT;
ALTER TABLE "DeliveryNote" ADD CONSTRAINT "DeliveryNote_callOffId_fkey" FOREIGN KEY ("callOffId") REFERENCES "CallOff"("id");
CREATE INDEX "DeliveryNote_callOffId_idx" ON "DeliveryNote"("callOffId");
