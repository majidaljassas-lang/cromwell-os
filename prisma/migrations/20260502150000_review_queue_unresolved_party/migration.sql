-- Add UNRESOLVED_SUPPLIER and UNRESOLVED_CUSTOMER to ReviewQueueType enum.
-- Used to park unknown senders / parsed names for human triage instead of
-- silently auto-creating Customer / Supplier records.

ALTER TYPE "ReviewQueueType" ADD VALUE IF NOT EXISTS 'UNRESOLVED_SUPPLIER';
ALTER TYPE "ReviewQueueType" ADD VALUE IF NOT EXISTS 'UNRESOLVED_CUSTOMER';
