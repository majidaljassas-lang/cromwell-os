-- F10: Zoho bill line-item staging. One row per line on an imported
-- bill. Cascades from ZohoImportedBill. Quarantine layer only —
-- never read by GL / AP / reports.

CREATE TABLE IF NOT EXISTS "ZohoImportedBillLine" (
  "id"             TEXT PRIMARY KEY,
  "billId"         TEXT NOT NULL,
  "lineNumber"     INTEGER NOT NULL,
  "itemName"       TEXT,
  "itemDesc"       TEXT,
  "productId"      TEXT,
  "sku"            TEXT,
  "quantity"       DECIMAL(14,4),
  "usageUnit"      TEXT,
  "rate"           DECIMAL(14,6),
  "itemTotal"      DECIMAL(14,2),
  "account"        TEXT,
  "accountCode"    TEXT,
  "itemTaxPercent" DECIMAL(6,3),
  "itemTaxAmount"  DECIMAL(14,2),
  "cfSite"         TEXT,
  "customerName"   TEXT,
  "payload"        JSONB NOT NULL,
  "importedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ZohoImportedBillLine_billId_fkey"
    FOREIGN KEY ("billId") REFERENCES "ZohoImportedBill"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "ZohoImportedBillLine_billId_idx"     ON "ZohoImportedBillLine"("billId");
CREATE INDEX IF NOT EXISTS "ZohoImportedBillLine_productId_idx"  ON "ZohoImportedBillLine"("productId");
CREATE INDEX IF NOT EXISTS "ZohoImportedBillLine_sku_idx"        ON "ZohoImportedBillLine"("sku");
CREATE INDEX IF NOT EXISTS "ZohoImportedBillLine_cfSite_idx"     ON "ZohoImportedBillLine"("cfSite");
