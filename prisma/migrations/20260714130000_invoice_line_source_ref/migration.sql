-- Add sourceRef to SalesInvoiceLine: a reference (e.g. approved quote number)
-- rendered under the line description on the invoice. Null for existing lines.
ALTER TABLE "SalesInvoiceLine"
  ADD COLUMN IF NOT EXISTS "sourceRef" TEXT;
