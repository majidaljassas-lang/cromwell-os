import prismaPkg from '../src/generated/prisma/index.js';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import 'dotenv/config';

const { PrismaClient } = prismaPkg;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const p = new PrismaClient({ adapter });

try {
  const ev = await p.ingestionEvent.findUnique({
    where: { id: 'dd11aa3e-d6d7-4138-9b3e-0f55cd7e26fb' },
    include: { parsedMessages: true, source: { select: { sourceType: true, accountName: true } } },
  });
  if (!ev) { console.log('Not found'); process.exit(0); }

  const rp = ev.rawPayload ?? {};
  const body = rp.body ?? rp.bodyPreview ?? null;
  const text = ev.parsedMessages?.[0]?.extractedText ?? null;

  console.log(JSON.stringify({
    id: ev.id,
    receivedAt: ev.receivedAt,
    from: rp.from?.emailAddress?.address,
    to: rp.toRecipients ?? rp.to,
    cc: rp.ccRecipients ?? rp.cc,
    subject: rp.subject,
    bodyPreview: rp.bodyPreview,
    attachments: rp.attachments?.map(a => ({ name: a.name, contentType: a.contentType, size: a.size })) ?? [],
    body,
    extractedText: text,
  }, null, 2));
} finally { await p.$disconnect(); await pool.end(); }
