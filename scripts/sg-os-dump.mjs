import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import fs from "fs";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
const CUST="970ca49f-4f5a-4308-9c9f-396c3054a251", SITE="2988269f-1583-4671-8283-5b127b642fa6";
const pos = await prisma.customerPO.findMany({ where:{ OR:[{customerId:CUST},{siteId:SITE}] }, include:{ lines:true } });
const si = await prisma.salesInvoice.findMany({ where:{ OR:[{customerId:CUST},{siteId:SITE}] }, include:{ lines:true } });
const num=(v)=>v==null?null:Number(v);
fs.writeFileSync("/tmp/sg_os.json", JSON.stringify({
  customerPOs: pos.map(p=>({poNo:p.poNo,poType:p.poType,status:p.status,poDate:p.poDate,totalValue:num(p.totalValue),poLimitValue:num(p.poLimitValue),poConsumedValue:num(p.poConsumedValue),poRemainingValue:num(p.poRemainingValue),lines:p.lines.map(l=>({description:l.description,qty:num(l.quantity),unitPrice:num(l.unitSell??l.unitCost),total:num(l.lineTotal)}))})),
  salesInvoices: si.map(i=>({invoiceNo:i.invoiceNo,poNo:i.poNo,status:i.status,issuedAt:i.issuedAt,totalNet:num(i.totalNet),totalVat:num(i.totalVat),totalGross:num(i.totalGross),lines:i.lines.map(l=>({description:l.description,qty:num(l.quantity),unitPrice:num(l.unitSell??l.unitPrice),total:num(l.lineTotal)}))}))
},null,1));
console.log("OS dump: POs",pos.length,"SalesInvoices",si.length);
await prisma.$disconnect(); await pool.end();
