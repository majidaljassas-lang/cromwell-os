-- CallOff: first-class wrapper around customer call-offs against a CustomerPO.
-- Allows requested-vs-invoiced tracking so back-orders stay tied to the
-- originating call-off instead of floating back to the PO pool.

CREATE TABLE "CallOff" (
  "id"           TEXT PRIMARY KEY,
  "callOffNo"    SERIAL UNIQUE,
  "customerPOId" TEXT NOT NULL,
  "ticketId"     TEXT NOT NULL,
  "callOffDate"  TIMESTAMP(3) NOT NULL,
  "source"       TEXT,
  "notes"        TEXT,
  "status"       TEXT NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CallOff_customerPOId_fkey" FOREIGN KEY ("customerPOId") REFERENCES "CustomerPO"("id"),
  CONSTRAINT "CallOff_ticketId_fkey"     FOREIGN KEY ("ticketId")     REFERENCES "Ticket"("id")
);

CREATE INDEX "CallOff_customerPOId_idx" ON "CallOff"("customerPOId");
CREATE INDEX "CallOff_ticketId_idx"     ON "CallOff"("ticketId");
CREATE INDEX "CallOff_status_idx"       ON "CallOff"("status");

CREATE TABLE "CallOffLine" (
  "id"               TEXT PRIMARY KEY,
  "callOffId"        TEXT NOT NULL,
  "customerPOLineId" TEXT NOT NULL,
  "ticketLineId"     TEXT NOT NULL,
  "description"      TEXT NOT NULL,
  "requestedQty"     DECIMAL(14,4) NOT NULL,
  "invoicedQty"      DECIMAL(14,4) NOT NULL DEFAULT 0,
  "agreedUnitPrice"  DECIMAL(14,4),
  "displayOrder"     INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "CallOffLine_callOffId_fkey"        FOREIGN KEY ("callOffId")        REFERENCES "CallOff"("id"),
  CONSTRAINT "CallOffLine_customerPOLineId_fkey" FOREIGN KEY ("customerPOLineId") REFERENCES "CustomerPOLine"("id"),
  CONSTRAINT "CallOffLine_ticketLineId_fkey"     FOREIGN KEY ("ticketLineId")     REFERENCES "TicketLine"("id")
);

CREATE INDEX "CallOffLine_callOffId_displayOrder_idx" ON "CallOffLine"("callOffId", "displayOrder");

-- Link SalesInvoice → CallOff so invoices know which call-off they ship for.
ALTER TABLE "SalesInvoice" ADD COLUMN "callOffId" TEXT;
ALTER TABLE "SalesInvoice" ADD CONSTRAINT "SalesInvoice_callOffId_fkey" FOREIGN KEY ("callOffId") REFERENCES "CallOff"("id");
CREATE INDEX "SalesInvoice_callOffId_idx" ON "SalesInvoice"("callOffId");
