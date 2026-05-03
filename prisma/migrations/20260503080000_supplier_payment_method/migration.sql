-- Default payment method per supplier. Free-text so it can hold rare values,
-- but UI offers a fixed dropdown (BACS, FASTER_PAYMENT, CASH, CARD,
-- DIRECT_DEBIT, CHEQUE, CREDIT_ACCOUNT).
ALTER TABLE "Supplier" ADD COLUMN IF NOT EXISTS "paymentMethod" TEXT;
