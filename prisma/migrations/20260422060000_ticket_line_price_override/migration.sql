-- Manual cost/supplier override flag — when true, recalcWinner skips the TicketLine cost/supplier fields.
ALTER TABLE "TicketLine" ADD COLUMN IF NOT EXISTS "priceOverride" BOOLEAN NOT NULL DEFAULT false;
