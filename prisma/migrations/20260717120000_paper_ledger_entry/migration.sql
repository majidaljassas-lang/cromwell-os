-- Paper P&L ledger: materials bought and handed to a customer without charging.
-- Cost is real (hits the accounts via the SupplierBill). Sale is paper — the agreed
-- rate it WOULD have been billed at. Nothing here posts to the GL or becomes an invoice.

CREATE TABLE IF NOT EXISTS "PaperLedgerEntry" (
  "id"                 TEXT NOT NULL,
  "entryDate"          TIMESTAMP(3) NOT NULL,
  "description"        TEXT NOT NULL,

  "customerId"         TEXT NOT NULL,
  "siteId"             TEXT,
  "ticketId"           TEXT,
  "supplierId"         TEXT,
  "canonicalProductId" TEXT,

  "qty"                DECIMAL(14,4) NOT NULL,
  "unit"               "UnitOfMeasure" NOT NULL DEFAULT 'EA',

  "actualCostUnit"     DECIMAL(14,4) NOT NULL,
  "actualCostTotal"    DECIMAL(14,2) NOT NULL,

  "agreedRateUnit"     DECIMAL(14,4) NOT NULL,
  "paperSaleTotal"     DECIMAL(14,2) NOT NULL,
  "paperMarginTotal"   DECIMAL(14,2) NOT NULL,

  "originBillId"       TEXT,
  "originBillNo"       TEXT,

  "notes"              TEXT,
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"          TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PaperLedgerEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PaperLedgerEntry_entryDate_idx"          ON "PaperLedgerEntry"("entryDate");
CREATE INDEX IF NOT EXISTS "PaperLedgerEntry_customerId_idx"         ON "PaperLedgerEntry"("customerId");
CREATE INDEX IF NOT EXISTS "PaperLedgerEntry_siteId_idx"             ON "PaperLedgerEntry"("siteId");
CREATE INDEX IF NOT EXISTS "PaperLedgerEntry_ticketId_idx"           ON "PaperLedgerEntry"("ticketId");
CREATE INDEX IF NOT EXISTS "PaperLedgerEntry_supplierId_idx"         ON "PaperLedgerEntry"("supplierId");
CREATE INDEX IF NOT EXISTS "PaperLedgerEntry_canonicalProductId_idx" ON "PaperLedgerEntry"("canonicalProductId");

ALTER TABLE "PaperLedgerEntry"
  ADD CONSTRAINT "PaperLedgerEntry_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PaperLedgerEntry"
  ADD CONSTRAINT "PaperLedgerEntry_siteId_fkey"
  FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PaperLedgerEntry"
  ADD CONSTRAINT "PaperLedgerEntry_ticketId_fkey"
  FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PaperLedgerEntry"
  ADD CONSTRAINT "PaperLedgerEntry_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "PaperLedgerEntry"
  ADD CONSTRAINT "PaperLedgerEntry_canonicalProductId_fkey"
  FOREIGN KEY ("canonicalProductId") REFERENCES "CanonicalProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;
