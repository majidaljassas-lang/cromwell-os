-- F8: Zoho → OS pointer-only link tables. Mappings live here so historical
-- Zoho data can show alongside OS-native data in unified Customer/Site
-- views WITHOUT being copied into native tables. Many-to-one supported:
-- many Zoho customers can point to one OS Customer (group consolidation).

CREATE TABLE IF NOT EXISTS "ZohoCustomerLink" (
  "zohoCustomerId"   TEXT PRIMARY KEY,
  "zohoCustomerName" TEXT,
  "customerId"       TEXT NOT NULL,
  "manualConfirmed"  BOOLEAN NOT NULL DEFAULT true,
  "confidence"       DECIMAL(5,2),
  "notes"            TEXT,
  "linkedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "linkedBy"         TEXT,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ZohoCustomerLink_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "ZohoCustomerLink_customerId_idx" ON "ZohoCustomerLink"("customerId");

CREATE TABLE IF NOT EXISTS "ZohoSiteLink" (
  "cfSite"           TEXT PRIMARY KEY,
  "siteId"           TEXT NOT NULL,
  "manualConfirmed"  BOOLEAN NOT NULL DEFAULT true,
  "confidence"       DECIMAL(5,2),
  "notes"            TEXT,
  "linkedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "linkedBy"         TEXT,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ZohoSiteLink_siteId_fkey"
    FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS "ZohoSiteLink_siteId_idx" ON "ZohoSiteLink"("siteId");

-- Cleanup decision annotations (Phase 7 — also added now to keep one migration)
-- Pure annotation: the Zoho payload is never modified. These columns let
-- the user record triage decisions for stale drafts, anomalies, etc.
ALTER TABLE "ZohoImportedInvoice"
  ADD COLUMN IF NOT EXISTS "cleanupDecision"     TEXT,
  ADD COLUMN IF NOT EXISTS "cleanupDecisionAt"   TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "cleanupDecisionBy"   TEXT,
  ADD COLUMN IF NOT EXISTS "cleanupDecisionNote" TEXT;
CREATE INDEX IF NOT EXISTS "ZohoImportedInvoice_cleanupDecision_idx"
  ON "ZohoImportedInvoice"("cleanupDecision");
