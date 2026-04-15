-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN "bankAccount" TEXT,
ADD COLUMN "sortCode" TEXT,
ADD COLUMN "iban" TEXT,
ADD COLUMN "bankLastVerifiedAt" TIMESTAMP(3),
ADD COLUMN "bankLastVerifiedBy" TEXT;
