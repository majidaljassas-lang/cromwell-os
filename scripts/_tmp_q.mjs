import 'dotenv/config'
import pkg from './../src/generated/prisma/index.js'
import { PrismaPg } from '@prisma/adapter-pg'
import PgPkg from 'pg'
const { PrismaClient } = pkg
const { Pool } = PgPkg
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const p = new PrismaClient({ adapter: new PrismaPg(pool) })
const TL = '62b4e3ba-ce1e-4eac-9c35-b2eaf6168446'

const ql = await p.quoteLine.findMany({ where: { ticketLineId: TL }, select: { id: true, description: true, quote: { select: { id: true, quoteNo: true, status: true, version: true } } } })
console.log('QUOTE LINES referencing this ticket line:')
for (const q of ql) console.log(`  qline ${q.id} | quote ${q.quote?.quoteNo} v${q.quote?.version} status=${q.quote?.status}`)

const pol = await p.procurementOrderLine.findMany({ where: { ticketLineId: TL }, select: { id: true, description: true, procurementOrder: { select: { poNo: true, status: true, supplier: { select: { name: true } } } } } })
console.log('SUPPLIER PO LINES:')
for (const x of pol) console.log(`  poline ${x.id} | ${x.procurementOrder?.supplier?.name} PO ${x.procurementOrder?.poNo} status=${x.procurementOrder?.status}`)
await pool.end()
