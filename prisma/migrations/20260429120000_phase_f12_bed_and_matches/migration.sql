-- F12: BED (Billable Expense Details) staging + bill-line ↔ invoice-line junction.
-- BED is Zoho's authoritative bill→invoice linkage. Junction holds confirmed pairs
-- regardless of source (BED / matcher tier / manual).

CREATE TABLE IF NOT EXISTS "ZohoImportedBillableExpense" (
  "id"                       TEXT PRIMARY KEY,
  "zohoTransactionId"        TEXT NOT NULL,
  "zohoTransactionNumber"    TEXT,
  "zohoItemId"               TEXT NOT NULL,
  "zohoInvoiceId"            TEXT,
  "zohoInvoiceNumber"        TEXT,
  "zohoCustomerId"           TEXT,
  "customerName"             TEXT,
  "vendorName"               TEXT,
  "status"                   TEXT,
  "transactionDate"          TIMESTAMP(3),
  "invoiceDate"              TIMESTAMP(3),
  "itemName"                 TEXT,
  "description"              TEXT,
  "productName"              TEXT,
  "quantityOrdered"          DECIMAL(14,4),
  "bcyItemPrice"             DECIMAL(14,6),
  "bcyTotal"                 DECIMAL(14,2),
  "invoicedAmount"           DECIMAL(14,2),
  "markupPercent"            DECIMAL(8,2),
  "markedUpAmount"           DECIMAL(14,2),
  "grossProfitPercentage"    DECIMAL(8,2),
  "type"                     TEXT,
  "projectName"              TEXT,
  "branchName"               TEXT,
  "billCfSite"               TEXT,
  "billCfBillStatus"         TEXT,
  "referenceNumber"          TEXT,
  "payload"                  JSONB NOT NULL,
  "importedAt"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "billLineId"               TEXT,
  "invoiceLineId"            TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "ZohoImportedBillableExpense_txn_item_key"
  ON "ZohoImportedBillableExpense"("zohoTransactionId", "zohoItemId");
CREATE INDEX IF NOT EXISTS "ZohoImportedBillableExpense_invoice_idx"   ON "ZohoImportedBillableExpense"("zohoInvoiceId");
CREATE INDEX IF NOT EXISTS "ZohoImportedBillableExpense_txn_idx"       ON "ZohoImportedBillableExpense"("zohoTransactionId");
CREATE INDEX IF NOT EXISTS "ZohoImportedBillableExpense_billLine_idx"  ON "ZohoImportedBillableExpense"("billLineId");
CREATE INDEX IF NOT EXISTS "ZohoImportedBillableExpense_invLine_idx"   ON "ZohoImportedBillableExpense"("invoiceLineId");
CREATE INDEX IF NOT EXISTS "ZohoImportedBillableExpense_customer_idx"  ON "ZohoImportedBillableExpense"("customerName");
CREATE INDEX IF NOT EXISTS "ZohoImportedBillableExpense_site_idx"      ON "ZohoImportedBillableExpense"("billCfSite");

CREATE TABLE IF NOT EXISTS "ZohoBillLineMatch" (
  "id"                  TEXT PRIMARY KEY,
  "billLineId"          TEXT NOT NULL,
  "invoiceLineId"       TEXT NOT NULL,
  "qtyAllocated"        DECIMAL(14,4) NOT NULL,
  "costAllocated"       DECIMAL(14,2) NOT NULL,
  "source"              TEXT NOT NULL,
  "confidence"          DECIMAL(5,2),
  "excessMode"          TEXT,
  "manualConfirmedAt"   TIMESTAMP(3),
  "manualConfirmedBy"   TEXT,
  "manualNote"          TEXT,
  "splitParentId"       TEXT,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "ZohoBillLineMatch_pair_key"
  ON "ZohoBillLineMatch"("billLineId", "invoiceLineId");
CREATE INDEX IF NOT EXISTS "ZohoBillLineMatch_billLine_idx"     ON "ZohoBillLineMatch"("billLineId");
CREATE INDEX IF NOT EXISTS "ZohoBillLineMatch_invoiceLine_idx"  ON "ZohoBillLineMatch"("invoiceLineId");
CREATE INDEX IF NOT EXISTS "ZohoBillLineMatch_source_idx"       ON "ZohoBillLineMatch"("source");
