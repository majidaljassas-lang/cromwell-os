-- F7: Zoho invoice line-item staging. One row per line on an imported
-- invoice. Cascades from ZohoImportedInvoice. Quarantine layer only —
-- never read by GL / AR / reports.

CREATE TABLE IF NOT EXISTS "ZohoImportedInvoiceLine" (
  "id"             TEXT PRIMARY KEY,
  "invoiceId"      TEXT NOT NULL,
  "lineNumber"     INTEGER NOT NULL,
  "itemName"       TEXT,
  "itemDesc"       TEXT,
  "productId"      TEXT,
  "sku"            TEXT,
  "quantity"       DECIMAL(14,4),
  "usageUnit"      TEXT,
  "itemPrice"      DECIMAL(14,6),
  "itemTotal"      DECIMAL(14,2),
  "account"        TEXT,
  "accountCode"    TEXT,
  "itemTaxPercent" DECIMAL(6,3),
  "itemTaxAmount"  DECIMAL(14,2),
  "cfSite"         TEXT,
  "payload"        JSONB NOT NULL,
  "importedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ZohoImportedInvoiceLine_invoiceId_fkey"
    FOREIGN KEY ("invoiceId") REFERENCES "ZohoImportedInvoice"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "ZohoImportedInvoiceLine_invoiceId_idx"  ON "ZohoImportedInvoiceLine"("invoiceId");
CREATE INDEX IF NOT EXISTS "ZohoImportedInvoiceLine_productId_idx" ON "ZohoImportedInvoiceLine"("productId");
CREATE INDEX IF NOT EXISTS "ZohoImportedInvoiceLine_sku_idx"        ON "ZohoImportedInvoiceLine"("sku");
CREATE INDEX IF NOT EXISTS "ZohoImportedInvoiceLine_cfSite_idx"     ON "ZohoImportedInvoiceLine"("cfSite");
