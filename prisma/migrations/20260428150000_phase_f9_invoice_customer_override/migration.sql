-- F9: Per-invoice customer override.
-- Lets the user re-attribute individual Zoho invoices to a specific OS
-- Customer (e.g. switch ONE invoice from "GS8 Construction" to "Luc
-- Construction"), independent of the Zoho-customer-level link. When set,
-- the override wins over ZohoCustomerLink for that invoice in unified views.
-- Underlying Zoho payload is unchanged.

ALTER TABLE "ZohoImportedInvoice"
  ADD COLUMN IF NOT EXISTS "overrideCustomerId" TEXT,
  ADD COLUMN IF NOT EXISTS "overrideAt"          TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "overrideBy"          TEXT,
  ADD COLUMN IF NOT EXISTS "overrideReason"      TEXT;

DO $$ BEGIN
  ALTER TABLE "ZohoImportedInvoice"
    ADD CONSTRAINT "ZohoImportedInvoice_overrideCustomerId_fkey"
    FOREIGN KEY ("overrideCustomerId") REFERENCES "Customer"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE INDEX IF NOT EXISTS "ZohoImportedInvoice_overrideCustomerId_idx"
  ON "ZohoImportedInvoice"("overrideCustomerId");
