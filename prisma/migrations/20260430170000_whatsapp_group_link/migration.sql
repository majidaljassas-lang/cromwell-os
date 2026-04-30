-- WhatsApp group → customer/site mapping. The OS learns the link the first
-- time a user classifies a message with a ticket selected.

CREATE TABLE IF NOT EXISTS "WhatsAppGroupLink" (
  "id"                   TEXT NOT NULL,
  "chatId"               TEXT NOT NULL,
  "groupName"            TEXT,
  "customerId"           TEXT,
  "siteId"               TEXT,
  "siteCommercialLinkId" TEXT,
  "source"               TEXT NOT NULL DEFAULT 'INFERRED_FROM_TICKET',
  "confirmedAt"          TIMESTAMP(3),
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WhatsAppGroupLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "WhatsAppGroupLink_chatId_key" ON "WhatsAppGroupLink"("chatId");
CREATE INDEX IF NOT EXISTS "WhatsAppGroupLink_customerId_idx" ON "WhatsAppGroupLink"("customerId");
CREATE INDEX IF NOT EXISTS "WhatsAppGroupLink_siteId_idx" ON "WhatsAppGroupLink"("siteId");
