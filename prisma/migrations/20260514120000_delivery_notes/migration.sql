-- DeliveryNote + DeliveryNoteLine: persist each printed delivery note so the
-- next sheet can compute remaining outstanding qty per TicketLine.

CREATE TABLE IF NOT EXISTS "DeliveryNote" (
  "id"           TEXT PRIMARY KEY,
  "ticketId"     TEXT NOT NULL REFERENCES "Ticket"(id),
  "deliveryNo"   INTEGER NOT NULL,
  "deliveryDate" TIMESTAMP(3) NOT NULL,
  "signedBy"     TEXT,
  "notes"        TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "DeliveryNote_ticketId_deliveryNo_key" ON "DeliveryNote"("ticketId","deliveryNo");
CREATE INDEX IF NOT EXISTS "DeliveryNote_ticketId_idx"     ON "DeliveryNote"("ticketId");
CREATE INDEX IF NOT EXISTS "DeliveryNote_deliveryDate_idx" ON "DeliveryNote"("deliveryDate");

CREATE TABLE IF NOT EXISTS "DeliveryNoteLine" (
  "id"             TEXT PRIMARY KEY,
  "deliveryNoteId" TEXT NOT NULL REFERENCES "DeliveryNote"(id) ON DELETE CASCADE,
  "ticketLineId"   TEXT NOT NULL REFERENCES "TicketLine"(id),
  "qtyDelivered"   DECIMAL(14,4) NOT NULL,
  "qtyBackOrder"   DECIMAL(14,4) NOT NULL DEFAULT 0,
  "status"         TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS "DeliveryNoteLine_deliveryNoteId_idx" ON "DeliveryNoteLine"("deliveryNoteId");
CREATE INDEX IF NOT EXISTS "DeliveryNoteLine_ticketLineId_idx"   ON "DeliveryNoteLine"("ticketLineId");
