import prismaPkg from '../src/generated/prisma/index.js';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import 'dotenv/config';

const { PrismaClient } = prismaPkg;
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const p = new PrismaClient({ adapter });

try {
  const criterion = await p.customer.findMany({
    where: { OR: [{ name: { contains: 'Criterion', mode: 'insensitive' } }, { legalName: { contains: 'Criterion', mode: 'insensitive' } }] },
    select: { id: true, name: true, legalName: true, parentCustomerEntityId: true, entityType: true, isBillingEntity: true, vatNumber: true, companyNumber: true, createdAt: true },
  });
  const gilbey = await p.contact.findMany({
    where: { fullName: { contains: 'Gilbey', mode: 'insensitive' } },
    select: { id: true, fullName: true, email: true, phone: true },
  });
  const oth = await p.supplier.findMany({
    where: { OR: [
      { legalName: { contains: 'Online Tool Hire', mode: 'insensitive' } },
      { name: { contains: 'Online Tool', mode: 'insensitive' } },
      { email: { contains: 'onlinetoolhire', mode: 'insensitive' } },
    ] },
    select: { id: true, name: true, legalName: true, email: true, phone: true, aliases: { select: { id: true, alias: true } } },
  });
  const renaldas = await p.contact.findMany({
    where: { OR: [{ fullName: { contains: 'Renaldas', mode: 'insensitive' } }, { email: { contains: 'onlinetoolhire', mode: 'insensitive' } }] },
    select: { id: true, fullName: true, email: true },
  });
  const criterionSites = await p.site.findMany({
    where: { OR: [{ siteName: { contains: 'Criterion', mode: 'insensitive' } }, { aliases: { hasSome: ['Criterion', 'criterion'] } }] },
    select: { id: true, siteName: true, siteCode: true, postcode: true, aliases: true },
  });
  const existingDrillTickets = await p.ticket.findMany({
    where: { OR: [
      { title: { contains: 'core drill', mode: 'insensitive' } },
      { title: { contains: 'Criterion', mode: 'insensitive' } },
      { description: { contains: 'core drill', mode: 'insensitive' } },
    ] },
    select: { id: true, ticketNo: true, title: true, status: true, payingCustomerId: true, createdAt: true },
    take: 10,
  });
  console.log(JSON.stringify({ criterion, gilbey, oth, renaldas, criterionSites, existingDrillTickets }, null, 2));
} finally { await p.$disconnect(); await pool.end(); }
