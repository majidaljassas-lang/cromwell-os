-- F13: Make ZohoBillLineMatch flexible enough for arbitrary line splits —
-- one bill line can have N allocations going to different targets:
--   - INVOICE  : invoiceLineId points to a sales invoice line
--   - STOCK    : qty held for future use (targetCustomerName / targetSiteName optional)
--   - WRITE_OFF: qty written off (returns, damage, lost)
--   - TICKET   : allocated to an OS ticket but not yet invoiced
--   - PENDING  : allocated to a customer/site verbally but no invoice/ticket yet

-- Drop the unique constraint that required (billLineId, invoiceLineId);
-- one bill line CAN have multiple allocations to the same invoice line and to
-- non-invoice targets.
ALTER TABLE "ZohoBillLineMatch"
  DROP CONSTRAINT IF EXISTS "ZohoBillLineMatch_pair_key";

-- Make invoiceLineId nullable
ALTER TABLE "ZohoBillLineMatch"
  ALTER COLUMN "invoiceLineId" DROP NOT NULL;

-- Add target descriptive fields
ALTER TABLE "ZohoBillLineMatch"
  ADD COLUMN IF NOT EXISTS "targetType"         TEXT NOT NULL DEFAULT 'INVOICE',
  ADD COLUMN IF NOT EXISTS "targetCustomerName" TEXT,
  ADD COLUMN IF NOT EXISTS "targetSiteName"     TEXT,
  ADD COLUMN IF NOT EXISTS "targetTicketRef"    TEXT;

CREATE INDEX IF NOT EXISTS "ZohoBillLineMatch_targetType_idx"
  ON "ZohoBillLineMatch"("targetType");
