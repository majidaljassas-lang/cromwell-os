-- Add billingEmail, creditLimit, currency to Customer.
-- All nullable. A null value on a subsidiary means "inherit from parent" —
-- see src/lib/customers/effective-billing.ts (walks up parentCustomerEntityId).

ALTER TABLE "Customer"
  ADD COLUMN IF NOT EXISTS "billingEmail" TEXT,
  ADD COLUMN IF NOT EXISTS "creditLimit"  NUMERIC(14, 2),
  ADD COLUMN IF NOT EXISTS "currency"     TEXT;
