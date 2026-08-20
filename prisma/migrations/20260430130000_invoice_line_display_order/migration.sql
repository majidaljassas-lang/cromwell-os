-- Make SalesInvoiceLine ordering deterministic.
-- createdAt alone is not stable for createMany inserts (identical timestamps)
-- and Postgres can reshuffle equal-key results after UPDATEs (HOT updates).
-- displayOrder is the single source of truth; id is tiebreaker.

ALTER TABLE "SalesInvoiceLine"
  ADD COLUMN IF NOT EXISTS "displayOrder" INT NOT NULL DEFAULT 0;

-- Backfill: use existing createdAt then id to preserve current visible order
-- (where stable) and lock it permanently.
WITH ordered AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY "salesInvoiceId"
           ORDER BY "createdAt" ASC, id ASC
         ) AS rn
  FROM "SalesInvoiceLine"
)
UPDATE "SalesInvoiceLine" sil
SET "displayOrder" = ordered.rn
FROM ordered
WHERE sil.id = ordered.id;

CREATE INDEX IF NOT EXISTS "SalesInvoiceLine_salesInvoiceId_displayOrder_idx"
  ON "SalesInvoiceLine" ("salesInvoiceId", "displayOrder");
