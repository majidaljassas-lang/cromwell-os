import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

const custs = await prisma.customer.findMany({ where:{ name:{ contains:"eorge", mode:"insensitive" } }, select:{id:true,name:true} });
const sites = await prisma.site.findMany({ where:{ siteName:{ contains:"eorge", mode:"insensitive" } }, select:{id:true,siteName:true} });
console.log("Customers matching 'george':"); custs.forEach(c=>console.log("  ",c.id,c.name));
console.log("Sites matching 'george':"); sites.forEach(s=>console.log("  ",s.id,s.siteName));
const cIds=custs.map(c=>c.id), sIds=sites.map(s=>s.id);

const si = await prisma.salesInvoice.findMany({ where:{ OR:[{customerId:{in:cIds}},{siteId:{in:sIds}}] }, select:{invoiceNo:true,customerId:true,siteId:true,ticketId:true,status:true,invoiceType:true,totalNet:true,totalGross:true,issuedAt:true} });
console.log("\nSalesInvoice (by cust/site):", si.length);
si.forEach(i=>console.log("  ",i.invoiceNo, i.status, i.invoiceType, "net£"+i.totalNet, (i.issuedAt||'').toString().slice(0,10)));

const tix = await prisma.ticket.findMany({ where:{ OR:[{payingCustomerId:{in:cIds}},{siteId:{in:sIds}}] }, select:{id:true} });
const tIds=tix.map(t=>t.id);
const siT = await prisma.salesInvoice.findMany({ where:{ ticketId:{in:tIds} }, select:{invoiceNo:true} });
console.log("\nTickets linked to St Georges:", tix.length, "| SalesInvoices via those tickets:", siT.length);

const ziTotal = await prisma.zohoImportedInvoice.count({ where:{ zohoCustomerId:"565105000000453001" } });
const ziProm  = await prisma.zohoImportedInvoice.count({ where:{ zohoCustomerId:"565105000000453001", promotedToId:{not:null} } });
console.log("\nZohoImportedInvoice for St Georges (mirror):", ziTotal, "| promoted to OS SalesInvoice:", ziProm);
const siAll = await prisma.salesInvoice.count();
console.log("Total SalesInvoice rows in OS (all customers):", siAll);
await prisma.$disconnect(); await pool.end();
