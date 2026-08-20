#!/usr/bin/env node

/**
 * Load the 15 extracted October invoices (from agent extraction)
 */

import "dotenv/config";
import fs from "fs";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function loadInvoices() {
  const invoices = JSON.parse(
    fs.readFileSync(
      "/private/tmp/claude-501/-Users-majidaljassas/258d850b-0d48-4a84-8c17-2491a17659d5/scratchpad/october_2025_invoices.json",
      "utf8"
    )
  );

  console.log("📥 Loading 15 extracted October invoices...\n");

  let loaded = 0;
  let skipped = 0;

  for (const inv of invoices) {
    try {
      const supplier = await prisma.supplier.findFirst({
        where: { name: { mode: "insensitive", contains: inv.supplier.split(" ")[0] } }
      });

      if (!supplier) {
        console.log(`⚠️  Supplier "${inv.supplier}" not found, skipping ${inv.invoiceNumber}`);
        skipped++;
        continue;
      }

      const existingBill = await prisma.supplierBill.findFirst({
        where: { supplierId: supplier.id, billNo: inv.invoiceNumber }
      });

      let bill;
      if (!existingBill) {
        bill = await prisma.supplierBill.create({
          data: {
            supplierId: supplier.id,
            billNo: inv.invoiceNumber,
            billDate: new Date(inv.invoiceDate),
            dueDate: new Date(inv.dueDate),
            status: "RECEIVED",
            amountIncVat: inv.totalInc,
            totalCost: Math.abs(inv.totalInc)
          }
        });
      } else {
        bill = existingBill;
      }

      const existingLines = await prisma.supplierBillLine.count({
        where: { supplierBillId: bill.id }
      });

      if (existingLines === 0) {
        for (const line of inv.lines) {
          await prisma.supplierBillLine.create({
            data: {
              supplierBillId: bill.id,
              description: line.description,
              qty: line.qty,
              unitCost: line.unitPrice,
              lineTotal: line.lineTotal,
              allocationStatus: "UNALLOCATED"
            }
          });
        }
        console.log(`✅ ${inv.invoiceNumber} — £${inv.totalInc.toFixed(2)} (${inv.lines.length} lines)`);
      } else {
        console.log(`✓ ${inv.invoiceNumber} — already loaded`);
      }

      loaded++;
    } catch (err) {
      console.error(`✗ Error loading ${inv.invoiceNumber}:`, err.message);
      skipped++;
    }
  }

  console.log(`\n📊 Summary: ${loaded} loaded, ${skipped} skipped`);
  console.log(`\n📈 Total October value added: £${invoices.reduce((sum, i) => sum + i.totalInc, 0).toFixed(2)}`);

  await prisma.$disconnect();
}

loadInvoices().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
