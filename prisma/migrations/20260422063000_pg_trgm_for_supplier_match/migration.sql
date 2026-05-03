-- Enable trigram similarity for fuzzy supplier name matching ("Rcoa" → "Roca").
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS "Supplier_name_trgm_idx" ON "Supplier" USING gin ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "SupplierAlias_alias_trgm_idx" ON "SupplierAlias" USING gin ("alias" gin_trgm_ops);
