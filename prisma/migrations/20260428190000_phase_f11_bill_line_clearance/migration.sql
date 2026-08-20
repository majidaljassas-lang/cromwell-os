-- F11: Per-bill-line clearance status. Match derived from cross-referencing
-- ZohoImportedInvoiceLine. Used by the recovery / "money on the table"
-- reconciliation flow.

ALTER TABLE "ZohoImportedBillLine"
  ADD COLUMN IF NOT EXISTS "clearStatus"          TEXT,
  ADD COLUMN IF NOT EXISTS "matchedInvoiceLineId" TEXT,
  ADD COLUMN IF NOT EXISTS "matchConfidence"      DECIMAL(5,2),
  ADD COLUMN IF NOT EXISTS "matchReason"          TEXT,
  ADD COLUMN IF NOT EXISTS "matchedAt"            TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "ZohoImportedBillLine_clearStatus_idx"
  ON "ZohoImportedBillLine"("clearStatus");
CREATE INDEX IF NOT EXISTS "ZohoImportedBillLine_matchedInvoiceLineId_idx"
  ON "ZohoImportedBillLine"("matchedInvoiceLineId");
