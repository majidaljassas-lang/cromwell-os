-- Group-PO drawdown: a CallOff can target a bill-to entity + site directly,
-- drawing from pooled CustomerPOLines without being bound to a single ticket.
-- All additive / nullability-widening — safe and reversible.

ALTER TABLE "CallOff" ADD COLUMN IF NOT EXISTS "billToCustomerId" TEXT;
ALTER TABLE "CallOff" ADD COLUMN IF NOT EXISTS "siteId" TEXT;
ALTER TABLE "CallOff" ALTER COLUMN "ticketId" DROP NOT NULL;

ALTER TABLE "CallOffLine" ALTER COLUMN "ticketLineId" DROP NOT NULL;

DO $$ BEGIN
  ALTER TABLE "CallOff" ADD CONSTRAINT "CallOff_billToCustomerId_fkey"
    FOREIGN KEY ("billToCustomerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "CallOff" ADD CONSTRAINT "CallOff_siteId_fkey"
    FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "CallOff_billToCustomerId_idx" ON "CallOff"("billToCustomerId");
CREATE INDEX IF NOT EXISTS "CallOff_siteId_idx" ON "CallOff"("siteId");
