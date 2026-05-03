-- Phase 1 of POD feature: Customer.podRequired flag, PODDocument model.
-- POD = Proof of Delivery. Required at invoice send when customer.podRequired = true.

ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "podRequired" BOOLEAN NOT NULL DEFAULT false;

DO $$ BEGIN
  CREATE TYPE "PODType" AS ENUM ('DELIVERY_NOTE','IMAGE','TRACKING_NOTE','SIGNED_RECEIPT','OTHER');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "PODDocument" (
  "id"             TEXT PRIMARY KEY,
  "ticketId"       TEXT NOT NULL REFERENCES "Ticket"(id),
  "ticketLineId"   TEXT REFERENCES "TicketLine"(id),
  "podType"        "PODType" NOT NULL,
  "fileRef"        TEXT,
  "fileName"       TEXT,
  "mimeType"       TEXT,
  "fileSize"       INTEGER,
  "trackingNumber" TEXT,
  "carrier"        TEXT,
  "supplierName"   TEXT,
  "signedBy"       TEXT,
  "signedAt"       TIMESTAMP(3),
  "notes"          TEXT,
  "uploadedBy"     TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "PODDocument_ticketId_idx"     ON "PODDocument"("ticketId");
CREATE INDEX IF NOT EXISTS "PODDocument_ticketLineId_idx" ON "PODDocument"("ticketLineId");
CREATE INDEX IF NOT EXISTS "PODDocument_podType_idx"      ON "PODDocument"("podType");
