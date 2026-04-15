-- Enforce site/customer linkage at the database level.
-- Rule: site activity (orders, deliveries, invoices, bills) must be attached
-- to both a customer and a site. Quotes remain exempt (customer-only allowed).
-- Tickets remain exempt in the schema; the QUOTED→transactional transition is
-- guarded at the API layer so quote-phase tickets can still exist without a site.

ALTER TABLE "CustomerPO"   ALTER COLUMN "siteId"     SET NOT NULL;
ALTER TABLE "SalesInvoice" ALTER COLUMN "siteId"     SET NOT NULL;
ALTER TABLE "OrderGroup"   ALTER COLUMN "customerId" SET NOT NULL;
ALTER TABLE "OrderEvent"   ALTER COLUMN "customerId" SET NOT NULL;

ALTER TABLE "CustomerPO"   DROP CONSTRAINT "CustomerPO_siteId_fkey";
ALTER TABLE "CustomerPO"   ADD  CONSTRAINT "CustomerPO_siteId_fkey"
  FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SalesInvoice" DROP CONSTRAINT "SalesInvoice_siteId_fkey";
ALTER TABLE "SalesInvoice" ADD  CONSTRAINT "SalesInvoice_siteId_fkey"
  FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OrderGroup" ADD CONSTRAINT "OrderGroup_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OrderEvent" ADD CONSTRAINT "OrderEvent_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "OrderGroup_customerId_idx" ON "OrderGroup" ("customerId");
CREATE INDEX IF NOT EXISTS "OrderEvent_customerId_idx" ON "OrderEvent" ("customerId");
