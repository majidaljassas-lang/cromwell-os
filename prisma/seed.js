const { readFileSync } = require("fs");
const { Client } = require("pg");
const { join } = require("path");

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const sql = readFileSync(join(__dirname, "seed.sql"), "utf-8");

  // Split on semicolons that end a statement (not inside quoted strings)
  const statements = [];
  let current = "";
  let inString = false;
  let escape = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (escape) {
      current += ch;
      escape = false;
      continue;
    }
    if (ch === "'") {
      // Handle '' (escaped quote in PostgreSQL)
      if (inString && sql[i + 1] === "'") {
        current += "''";
        i++;
        continue;
      }
      inString = !inString;
    }
    // Strip single-line comments outside strings
    if (ch === "-" && sql[i + 1] === "-" && !inString) {
      // Skip to end of line
      while (i < sql.length && sql[i] !== "\n") i++;
      continue;
    }
    if (ch === ";" && !inString) {
      const trimmed = current.trim();
      if (trimmed) {
        statements.push(trimmed);
      }
      current = "";
      continue;
    }
    current += ch;
  }
  // Handle last statement without trailing semicolon
  const last = current.trim();
  if (last) {
    statements.push(last);
  }

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
