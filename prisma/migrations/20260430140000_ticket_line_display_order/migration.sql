-- Make TicketLine ordering deterministic and immutable.
-- createdAt alone is not stable, and lines must never reshuffle.
-- displayOrder is the single source of truth; id is tiebreaker.

ALTER TABLE "TicketLine"
  ADD COLUMN IF NOT EXISTS "displayOrder" INT NOT NULL DEFAULT 0;

WITH ordered AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY "ticketId"
           ORDER BY "createdAt" ASC, id ASC
         ) AS rn
  FROM "TicketLine"
)
UPDATE "TicketLine" tl
SET "displayOrder" = ordered.rn
FROM ordered
WHERE tl.id = ordered.id;

CREATE INDEX IF NOT EXISTS "TicketLine_ticketId_displayOrder_idx"
  ON "TicketLine" ("ticketId", "displayOrder");
