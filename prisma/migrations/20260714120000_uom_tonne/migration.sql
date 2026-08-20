-- Add TONNE to UnitOfMeasure enum (bulk materials sold by the tonne).
ALTER TYPE "UnitOfMeasure" ADD VALUE IF NOT EXISTS 'TONNE';
