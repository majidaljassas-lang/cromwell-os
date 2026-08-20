-- F1: JournalLine analytic dimensions
-- Adds nullable customerId, siteId, ticketId, ticketLineId, supplierId to JournalLine
-- so every JE line carries its full operational context for global + line-item drill.

ALTER TABLE "JournalLine"
  ADD COLUMN IF NOT EXISTS "customerId"   TEXT,
  ADD COLUMN IF NOT EXISTS "siteId"       TEXT,
  ADD COLUMN IF NOT EXISTS "ticketId"     TEXT,
  ADD COLUMN IF NOT EXISTS "ticketLineId" TEXT,
  ADD COLUMN IF NOT EXISTS "supplierId"   TEXT;

-- Foreign keys
ALTER TABLE "JournalLine"
  ADD CONSTRAINT "JournalLine_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "JournalLine"
  ADD CONSTRAINT "JournalLine_siteId_fkey"
  FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "JournalLine"
  ADD CONSTRAINT "JournalLine_ticketId_fkey"
  FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "JournalLine"
  ADD CONSTRAINT "JournalLine_ticketLineId_fkey"
  FOREIGN KEY ("ticketLineId") REFERENCES "TicketLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "JournalLine"
  ADD CONSTRAINT "JournalLine_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Indexes for fast analytic filtering
CREATE INDEX IF NOT EXISTS "JournalLine_customerId_idx"   ON "JournalLine"("customerId");
CREATE INDEX IF NOT EXISTS "JournalLine_siteId_idx"       ON "JournalLine"("siteId");
CREATE INDEX IF NOT EXISTS "JournalLine_ticketId_idx"     ON "JournalLine"("ticketId");
CREATE INDEX IF NOT EXISTS "JournalLine_ticketLineId_idx" ON "JournalLine"("ticketLineId");
CREATE INDEX IF NOT EXISTS "JournalLine_supplierId_idx"   ON "JournalLine"("supplierId");
