-- Companies House lookup support on Customer
ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "companyNumber" TEXT;

-- Pro-forma rendering off Quote (does not post to AR — quote stays the source of truth)
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "proformaNumber" TEXT;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "proformaIssuedAt" TIMESTAMP(3);
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "proformaPdfFileName" TEXT;
ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "proformaPdfPath" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Quote_proformaNumber_key" ON "Quote"("proformaNumber");
