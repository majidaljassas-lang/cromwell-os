import "dotenv/config";
import fs from "node:fs";
import pg from "pg";

const file = process.argv[2];
if (!file) { console.error("usage: apply-migration.mjs <sql file>"); process.exit(1); }

const sql = fs.readFileSync(file, "utf8");
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query("BEGIN");
  await client.query(sql);
  await client.query("COMMIT");
  console.log(`Applied ${file}`);
} catch (e) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("FAILED:", e.message);
  process.exit(1);
} finally {
  await client.end();
}
