-- Wire SupplierBillLine to a real GL account from ChartOfAccount.
-- Bills post to exactly 4 buckets (5000 Materials, 5100 Labour, 5200
-- Carriage In, 5400 Plant Hire). Existing `costClassification` enum
-- becomes an internal classification, no longer the user-facing dropdown.
ALTER TABLE "SupplierBillLine" ADD COLUMN IF NOT EXISTS "glAccountId" TEXT;

ALTER TABLE "SupplierBillLine"
  ADD CONSTRAINT "SupplierBillLine_glAccountId_fkey"
  FOREIGN KEY ("glAccountId") REFERENCES "ChartOfAccount"(id)
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "SupplierBillLine_glAccountId_idx"
  ON "SupplierBillLine"("glAccountId");
