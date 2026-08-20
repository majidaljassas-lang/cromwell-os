import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
const CUST="970ca49f-4f5a-4308-9c9f-396c3054a251", SITE="2988269f-1583-4671-8283-5b127b642fa6";
const ZCUST="565105000000453001";

const pos = await prisma.customerPO.findMany({ where:{ OR:[{customerId:CUST},{siteId:SITE}] }, include:{ lines:true, allocations:true, cashPayments:true } });
console.log(`CustomerPO: ${pos.length}`);
for(const p of pos) console.log(`  ${p.poNo} | ${p.poType} | ${p.status} | limit £${p.poLimitValue||p.totalValue||'-'} | consumed £${p.poConsumedValue} | remaining £${p.poRemainingValue} | ${p.lines.length}L ${p.allocations.length}alloc ${p.cashPayments.length}cashpmt`);

const si = await prisma.salesInvoice.findMany({ where:{ OR:[{customerId:CUST},{siteId:SITE}] }, include:{ lines:true, payments:true } });
console.log(`\nSalesInvoice (OS-issued): ${si.length} | net £${si.reduce((s,i)=>s+Number(i.totalNet),0).toFixed(2)}`);
for(const i of si) console.log(`  ${i.invoiceNo||i.id.slice(0,8)} | ${i.status} | PO ${i.poNo||'-'} | net £${Number(i.totalNet).toFixed(2)} | ${i.lines.length}L | ${i.payments.length}pmt`);

const tix = await prisma.ticket.findMany({ where:{ OR:[{payingCustomerId:CUST},{siteId:SITE}] }, include:{ lines:true } });
console.log(`\nTickets: ${tix.length}`);

const zi = await prisma.zohoImportedInvoice.count({ where:{ zohoCustomerId:ZCUST } });
const zp = await prisma.zohoImportedPayment.findMany({ where:{ zohoContactId:ZCUST } });
console.log(`\nZohoImportedInvoice (mirror): ${zi}`);
console.log(`ZohoImportedPayment (mirror): ${zp.length} | total £${zp.reduce((s,p)=>s+Number(p.amount||0),0).toFixed(2)}`);
if(zp.length){ const ds=zp.map(p=>p.paymentDate).filter(Boolean).sort(); console.log(`  payment date range: ${ds[0]?.toISOString().slice(0,10)} -> ${ds[ds.length-1]?.toISOString().slice(0,10)}`); }

await prisma.$disconnect(); await pool.end();
