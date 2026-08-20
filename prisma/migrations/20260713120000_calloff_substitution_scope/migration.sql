-- Scope a substitution batch to a single call-off drawdown (swap-within-call-off).
-- Null callOffId keeps the existing PO-wide behaviour.
ALTER TABLE "CallOffSubstitution" ADD COLUMN "callOffId" TEXT;
ALTER TABLE "CallOffSubstitution" ADD CONSTRAINT "CallOffSubstitution_callOffId_fkey" FOREIGN KEY ("callOffId") REFERENCES "CallOff"("id");
CREATE INDEX "CallOffSubstitution_callOffId_idx" ON "CallOffSubstitution"("callOffId");
