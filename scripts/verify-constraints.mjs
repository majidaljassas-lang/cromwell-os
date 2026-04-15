import "dotenv/config";
import pg from "pg";

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const res = await client.query(`
  SELECT table_name, column_name, is_nullable
  FROM information_schema.columns
  WHERE (table_name, column_name) IN (
    ('CustomerPO','siteId'),
    ('SalesInvoice','siteId'),
    ('OrderGroup','customerId'),
    ('OrderEvent','customerId')
  )
  ORDER BY table_name, column_name
`);
console.log("Column NOT NULL status:");
for (const r of res.rows) {
  console.log(`  ${r.table_name}.${r.column_name.padEnd(12)} nullable=${r.is_nullable}`);
}

const fks = await client.query(`
  SELECT conname, conrelid::regclass AS tbl, confdeltype
  FROM pg_constraint
  WHERE conname IN (
    'CustomerPO_siteId_fkey',
    'SalesInvoice_siteId_fkey',
    'OrderGroup_customerId_fkey',
    'OrderEvent_customerId_fkey'
  )
  ORDER BY conname
`);
console.log("\nForeign keys:");
for (const r of fks.rows) {
  console.log(`  ${r.conname.padEnd(36)} ${r.tbl}  onDelete=${r.confdeltype}`);
}

await client.end();
