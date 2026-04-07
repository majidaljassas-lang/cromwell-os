const { readFileSync } = require("fs");
const { Client } = require("pg");
const { join } = require("path");

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const sql = readFileSync(join(__dirname, "seed.sql"), "utf-8");

  const statements = sql
    .split("\n")
    .filter((line) => line.trim() && !line.startsWith("--"));

  console.log(`Running ${statements.length} statements...`);

  let success = 0;
  let skipped = 0;
  for (const stmt of statements) {
    if (stmt.trim()) {
      try {
        await client.query(stmt);
        success++;
      } catch (e) {
        if (e.code === "23505") {
          skipped++; // duplicate key - already seeded
        } else {
          console.error(`Failed: ${stmt.substring(0, 120)}...`);
          console.error(e.message);
        }
      }
    }
  }

  console.log(`Seed complete. ${success} applied, ${skipped} skipped (already exist).`);
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
