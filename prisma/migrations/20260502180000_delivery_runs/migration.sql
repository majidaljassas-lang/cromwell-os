-- Driver schedule + POD feed.
-- DeliveryRun = a driver's day (ordered stops, COLLECT from suppliers / DELIVER to sites).
-- DeliveryRunStop completion emits a LogisticsEvent (closes the stopStatus writer gap
-- flagged in AGENTS.md) and links a PODDocument for the POD data centre.

DO $$ BEGIN CREATE TYPE "DriverSource" AS ENUM ('IN_HOUSE','CROMWELL_FREIGHT'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "RunStatus"    AS ENUM ('DRAFT','DISPATCHED','COMPLETED','CANCELLED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "RunStopType"  AS ENUM ('COLLECT','DELIVER'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "RunStopStatus" AS ENUM ('PENDING','ARRIVED','COMPLETED','FAILED','SKIPPED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "SplitMethod"  AS ENUM ('EQUAL','TICKET_VALUE','MANUAL'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "DeliveryBillingMode" AS ENUM ('ABSORBED','CHARGEABLE'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE SEQUENCE IF NOT EXISTS "DeliveryRun_runNo_seq";

CREATE TABLE IF NOT EXISTS "DeliveryRun" (
  "id"            TEXT PRIMARY KEY,
  "runNo"         INTEGER NOT NULL DEFAULT nextval('"DeliveryRun_runNo_seq"'),
  "runDate"       TIMESTAMP(3) NOT NULL,
  "driverSource"  "DriverSource" NOT NULL,
  "driverName"    TEXT,
  "cfSupplierId"  TEXT REFERENCES "Supplier"(id),
  "cfJobRef"      TEXT,
  "vehicleReg"    TEXT,
  "status"        "RunStatus" NOT NULL DEFAULT 'DRAFT',
  "splitMethod"   "SplitMethod" NOT NULL DEFAULT 'EQUAL',
  "notes"         TEXT,
  "dispatchedAt"  TIMESTAMP(3),
  "completedAt"   TIMESTAMP(3),
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER SEQUENCE "DeliveryRun_runNo_seq" OWNED BY "DeliveryRun"."runNo";

CREATE UNIQUE INDEX IF NOT EXISTS "DeliveryRun_runNo_key"        ON "DeliveryRun"("runNo");
CREATE INDEX        IF NOT EXISTS "DeliveryRun_runDate_idx"      ON "DeliveryRun"("runDate");
CREATE INDEX        IF NOT EXISTS "DeliveryRun_status_idx"       ON "DeliveryRun"("status");
CREATE INDEX        IF NOT EXISTS "DeliveryRun_driverSource_idx" ON "DeliveryRun"("driverSource");
CREATE INDEX        IF NOT EXISTS "DeliveryRun_cfSupplierId_idx" ON "DeliveryRun"("cfSupplierId");

CREATE TABLE IF NOT EXISTS "DeliveryRunStop" (
  "id"                  TEXT PRIMARY KEY,
  "runId"               TEXT NOT NULL REFERENCES "DeliveryRun"(id),
  "sequence"            INTEGER NOT NULL,
  "type"                "RunStopType" NOT NULL,
  "ticketId"            TEXT NOT NULL REFERENCES "Ticket"(id),
  "siteId"              TEXT REFERENCES "Site"(id),
  "supplierId"          TEXT REFERENCES "Supplier"(id),
  "addressSnapshot"     TEXT,
  "timeWindowStart"     TIMESTAMP(3),
  "timeWindowEnd"       TIMESTAMP(3),
  "status"              "RunStopStatus" NOT NULL DEFAULT 'PENDING',
  "arrivedAt"           TIMESTAMP(3),
  "completedAt"         TIMESTAMP(3),
  "signedByName"        TEXT,
  "notes"               TEXT,
  "costShare"           DECIMAL(14,2),
  "costShareOverridden" BOOLEAN NOT NULL DEFAULT false,
  "podDocumentId"       TEXT REFERENCES "PODDocument"(id),
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "DeliveryRunStop_runId_sequence_key" ON "DeliveryRunStop"("runId","sequence");
CREATE INDEX        IF NOT EXISTS "DeliveryRunStop_runId_sequence_idx" ON "DeliveryRunStop"("runId","sequence");
CREATE INDEX        IF NOT EXISTS "DeliveryRunStop_ticketId_idx"       ON "DeliveryRunStop"("ticketId");
CREATE INDEX        IF NOT EXISTS "DeliveryRunStop_siteId_idx"         ON "DeliveryRunStop"("siteId");
CREATE INDEX        IF NOT EXISTS "DeliveryRunStop_supplierId_idx"     ON "DeliveryRunStop"("supplierId");
CREATE INDEX        IF NOT EXISTS "DeliveryRunStop_status_idx"         ON "DeliveryRunStop"("status");

ALTER TABLE "Ticket"
  ADD COLUMN IF NOT EXISTS "deliveryBillingMode" "DeliveryBillingMode" NOT NULL DEFAULT 'ABSORBED';

ALTER TABLE "TicketLine"
  ADD COLUMN IF NOT EXISTS "deliveryCostShare" DECIMAL(14,2);

ALTER TABLE "SupplierBill"
  ADD COLUMN IF NOT EXISTS "deliveryRunId" TEXT REFERENCES "DeliveryRun"(id);

CREATE INDEX IF NOT EXISTS "SupplierBill_deliveryRunId_idx" ON "SupplierBill"("deliveryRunId");

ALTER TABLE "LogisticsEvent"
  ADD COLUMN IF NOT EXISTS "runStopId" TEXT REFERENCES "DeliveryRunStop"(id);

CREATE INDEX IF NOT EXISTS "LogisticsEvent_runStopId_idx" ON "LogisticsEvent"("runStopId");
