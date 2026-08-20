-- F6: Zoho historical import staging tables. Quarantined by default —
-- never read by GL / AR / AP / reports until promoted via the Backlog UI.

DO $$ BEGIN
  CREATE TYPE "ZohoImportStatus" AS ENUM ('QUARANTINED', 'PROMOTED', 'MERGED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

CREATE TABLE IF NOT EXISTS "ZohoImportedBill" (
  "id"             TEXT PRIMARY KEY,
  "zohoId"         TEXT NOT NULL UNIQUE,
  "zohoNumber"     TEXT,
  "zohoVendorId"   TEXT,
  "vendorName"     TEXT,
  "billDate"       TIMESTAMP(3),
  "dueDate"        TIMESTAMP(3),
  "total"          DECIMAL(14,2),
  "balance"        DECIMAL(14,2),
  "currencyCode"   TEXT,
  "status"         TEXT,
  "payload"        JSONB NOT NULL,
  "importStatus"   "ZohoImportStatus" NOT NULL DEFAULT 'QUARANTINED',
  "promotedToId"   TEXT,
  "promotedAt"     TIMESTAMP(3),
  "rejectedReason" TEXT,
  "notes"          TEXT,
  "importedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "ZohoImportedBill_importStatus_idx" ON "ZohoImportedBill"("importStatus");
CREATE INDEX IF NOT EXISTS "ZohoImportedBill_billDate_idx"     ON "ZohoImportedBill"("billDate");
CREATE INDEX IF NOT EXISTS "ZohoImportedBill_zohoVendorId_idx" ON "ZohoImportedBill"("zohoVendorId");

CREATE TABLE IF NOT EXISTS "ZohoImportedInvoice" (
  "id"              TEXT PRIMARY KEY,
  "zohoId"          TEXT NOT NULL UNIQUE,
  "zohoNumber"      TEXT,
  "zohoCustomerId"  TEXT,
  "customerName"    TEXT,
  "invoiceDate"     TIMESTAMP(3),
  "dueDate"         TIMESTAMP(3),
  "total"           DECIMAL(14,2),
  "balance"         DECIMAL(14,2),
  "currencyCode"    TEXT,
  "status"          TEXT,
  "payload"         JSONB NOT NULL,
  "importStatus"    "ZohoImportStatus" NOT NULL DEFAULT 'QUARANTINED',
  "promotedToId"    TEXT,
  "promotedAt"      TIMESTAMP(3),
  "rejectedReason"  TEXT,
  "notes"           TEXT,
  "importedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "ZohoImportedInvoice_importStatus_idx"   ON "ZohoImportedInvoice"("importStatus");
CREATE INDEX IF NOT EXISTS "ZohoImportedInvoice_invoiceDate_idx"    ON "ZohoImportedInvoice"("invoiceDate");
CREATE INDEX IF NOT EXISTS "ZohoImportedInvoice_zohoCustomerId_idx" ON "ZohoImportedInvoice"("zohoCustomerId");

CREATE TABLE IF NOT EXISTS "ZohoImportedPayment" (
  "id"              TEXT PRIMARY KEY,
  "zohoId"          TEXT NOT NULL UNIQUE,
  "paymentSide"     TEXT NOT NULL,
  "zohoContactId"   TEXT,
  "contactName"     TEXT,
  "paymentDate"     TIMESTAMP(3),
  "amount"          DECIMAL(14,2),
  "paymentMode"     TEXT,
  "reference"       TEXT,
  "payload"         JSONB NOT NULL,
  "importStatus"    "ZohoImportStatus" NOT NULL DEFAULT 'QUARANTINED',
  "promotedToId"    TEXT,
  "promotedAt"      TIMESTAMP(3),
  "rejectedReason"  TEXT,
  "notes"           TEXT,
  "importedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "ZohoImportedPayment_importStatus_idx" ON "ZohoImportedPayment"("importStatus");
CREATE INDEX IF NOT EXISTS "ZohoImportedPayment_paymentSide_idx"  ON "ZohoImportedPayment"("paymentSide");
CREATE INDEX IF NOT EXISTS "ZohoImportedPayment_paymentDate_idx"  ON "ZohoImportedPayment"("paymentDate");

CREATE TABLE IF NOT EXISTS "ZohoImportedContact" (
  "id"              TEXT PRIMARY KEY,
  "zohoId"          TEXT NOT NULL UNIQUE,
  "contactName"     TEXT,
  "companyName"     TEXT,
  "contactType"     TEXT,
  "email"           TEXT,
  "phone"           TEXT,
  "vatNumber"       TEXT,
  "payload"         JSONB NOT NULL,
  "importStatus"    "ZohoImportStatus" NOT NULL DEFAULT 'QUARANTINED',
  "promotedToId"    TEXT,
  "promotedKind"    TEXT,
  "promotedAt"      TIMESTAMP(3),
  "rejectedReason"  TEXT,
  "notes"           TEXT,
  "importedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "ZohoImportedContact_importStatus_idx" ON "ZohoImportedContact"("importStatus");
CREATE INDEX IF NOT EXISTS "ZohoImportedContact_contactType_idx"  ON "ZohoImportedContact"("contactType");
