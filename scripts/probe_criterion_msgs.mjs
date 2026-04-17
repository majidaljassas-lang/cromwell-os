import prismaPkg from '../src/generated/prisma/index.js';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import 'dotenv/config';

const { PrismaClient } = prismaPkg;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const p = new PrismaClient({ adapter });

try {
  // Use raw SQL for JSON pattern matching — cleaner than Prisma's path idioms
  const gilbeyEvents = await p.$queryRawUnsafe(`
    SELECT id, "externalMessageId", "receivedAt", status,
           "rawPayload"->'from'->'emailAddress'->>'address' AS from_addr,
           "rawPayload"->'from'->'emailAddress'->>'name' AS from_name,
           "rawPayload"->>'subject' AS subject
    FROM "IngestionEvent"
    WHERE "receivedAt" >= '2025-10-01'
      AND ("rawPayload"::text ILIKE '%gilbey%' OR "rawPayload"::text ILIKE '%criterioncapital%' OR "rawPayload"::text ILIKE '%criterion capital%' OR "rawPayload"::text ILIKE '%criterion developments%')
    ORDER BY "receivedAt" ASC
    LIMIT 300
  `);

  const othEvents = await p.$queryRawUnsafe(`
    SELECT id, "externalMessageId", "receivedAt", status,
           "rawPayload"->'from'->'emailAddress'->>'address' AS from_addr,
           "rawPayload"->'from'->'emailAddress'->>'name' AS from_name,
           "rawPayload"->>'subject' AS subject
    FROM "IngestionEvent"
    WHERE "receivedAt" >= '2025-10-01'
      AND ("rawPayload"::text ILIKE '%onlinetoolhire%' OR "rawPayload"::text ILIKE '%renaldas%' OR "rawPayload"::text ILIKE '%online tool hire%')
    ORDER BY "receivedAt" ASC
    LIMIT 300
  `);

  const drillEvents = await p.$queryRawUnsafe(`
    SELECT id, "receivedAt", status,
           "rawPayload"->'from'->'emailAddress'->>'address' AS from_addr,
           "rawPayload"->>'subject' AS subject
    FROM "IngestionEvent"
    WHERE "receivedAt" >= '2025-10-01'
      AND ("rawPayload"->>'subject' ILIKE '%drill%' OR "rawPayload"::text ILIKE '%core drill%')
    ORDER BY "receivedAt" ASC
    LIMIT 100
  `);

  const minMaxIngestion = await p.$queryRawUnsafe(`
    SELECT MIN("receivedAt") AS min_received, MAX("receivedAt") AS max_received, COUNT(*) AS total
    FROM "IngestionEvent"
  `);

  const replacer = (_k, v) => typeof v === 'bigint' ? Number(v) : v;
  console.log(JSON.stringify({
    gilbeyEventsCount: gilbeyEvents.length,
    othEventsCount: othEvents.length,
    drillEventsCount: drillEvents.length,
    minMaxIngestion,
    gilbeyEvents,
    othEvents,
    drillEvents,
  }, replacer, 2));
} finally { await p.$disconnect(); await pool.end(); }
