-- Make SalesInvoice header VAT-aware.
--
-- Before: only `totalSell` existed, with inconsistent semantics —
--   convert-to-invoice wrote gross (net + vat),
--   most other writers wrote net (sum of line.lineTotal),
--   backlog-promote wrote whatever Zoho sent.
--
-- After: explicit totalNet / totalVat / totalGross. `totalSell` retained
-- as a semantic alias for totalGross so existing readers keep working;
-- the backfill below aligns it.

ALTER TABLE "SalesInvoice"
  ADD COLUMN IF NOT EXISTS "totalNet"   DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "totalVat"   DECIMAL(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "totalGross" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- Backfill totalNet / totalVat from line-level data.
UPDATE "SalesInvoice" si
SET "totalNet" = COALESCE(agg.net, 0),
    "totalVat" = COALESCE(agg.vat, 0)
FROM (
  SELECT "salesInvoiceId",
         SUM("lineTotal")            AS net,
         SUM(COALESCE("vatAmount",0)) AS vat
  FROM "SalesInvoiceLine"
  GROUP BY "salesInvoiceId"
) agg
WHERE agg."salesInvoiceId" = si.id;

-- Compute gross. Three reconciliation cases against existing totalSell:
--  1. lines exist with VAT  → totalGross = net + vat,  totalSell := gross
--  2. lines exist, no VAT   → totalGross = totalSell (don't second-guess gross/net),
--                             totalNet  = totalSell, totalVat = 0
--  3. no lines (header-only/Zoho legacy) → totalGross = totalSell,
--                                          totalNet := totalSell, totalVat := 0
UPDATE "SalesInvoice" si
SET "totalGross" =
      CASE
        WHEN si."totalVat" > 0 THEN si."totalNet" + si."totalVat"
        ELSE si."totalSell"
      END,
    "totalNet" =
      CASE
        WHEN si."totalVat" = 0 AND si."totalNet" = 0 THEN si."totalSell"
        ELSE si."totalNet"
      END,
    "totalSell" =
      CASE
        WHEN si."totalVat" > 0 THEN si."totalNet" + si."totalVat"
        ELSE si."totalSell"
      END;
