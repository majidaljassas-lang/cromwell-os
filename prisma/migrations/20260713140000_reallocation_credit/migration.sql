-- Internal-only reallocation credit tracker, scoped to a CustomerPO.
-- A cancelled PO line frees value; the user draws it down on over-orders and
-- small extras. Draws never exceed the credit.

CREATE TABLE "ReallocationCredit" (
  "id"                TEXT PRIMARY KEY,
  "customerPOId"      TEXT NOT NULL,
  "sourceDescription" TEXT NOT NULL,
  "sourceQty"         DECIMAL(14,4) NOT NULL,
  "sourceUnitValue"   DECIMAL(14,4) NOT NULL,
  "creditValue"       DECIMAL(14,2) NOT NULL,
  "notes"             TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ReallocationCredit_customerPOId_fkey" FOREIGN KEY ("customerPOId") REFERENCES "CustomerPO"("id")
);

CREATE INDEX "ReallocationCredit_customerPOId_idx" ON "ReallocationCredit"("customerPOId");

CREATE TABLE "ReallocationDraw" (
  "id"           TEXT PRIMARY KEY,
  "creditId"     TEXT NOT NULL,
  "description"  TEXT NOT NULL,
  "value"        DECIMAL(14,2) NOT NULL,
  "displayOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReallocationDraw_creditId_fkey" FOREIGN KEY ("creditId") REFERENCES "ReallocationCredit"("id") ON DELETE CASCADE
);

CREATE INDEX "ReallocationDraw_creditId_displayOrder_idx" ON "ReallocationDraw"("creditId", "displayOrder");
