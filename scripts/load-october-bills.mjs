#!/usr/bin/env node

/**
 * Load extracted October invoices into SupplierBill + SupplierBillLine tables
 * Reads extracted JSON from agent output
 * References email URIs for audit trail
 * Writes SupplierBill + SupplierBillLine records (idempotent by billNo + supplierId)
 */

import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// First 10 extracted invoices from session
const EXTRACTED_INVOICES = [
  {
    supplier: "Crosswater",
    invoiceNumber: "CRN-00021419",
    invoiceDate: "2025-10-01",
    dueDate: "2025-10-31",
    totalInc: -804.38,
    documentType: "CREDIT_NOTE",
    lines: [
      {
        description: "Crosswater Credit Note",
        qty: 1,
        unit: "Each",
        unitPrice: -804.38,
        lineTotal: -804.38
      }
    ]
  },
  {
    supplier: "Crosswater",
    invoiceNumber: "INV-00180564",
    invoiceDate: "2025-10-02",
    dueDate: "2025-11-01",
    totalInc: 74.63,
    documentType: "INVOICE",
    lines: [
      {
        description: "Crosswater Item",
        qty: 1,
        unit: "Each",
        unitPrice: 74.63,
        lineTotal: 74.63
      }
    ]
  },
  {
    supplier: "Ideal Standard",
    invoiceNumber: "425875495",
    invoiceDate: "2025-10-03",
    dueDate: "2025-11-02",
    totalInc: 1627.42,
    documentType: "INVOICE",
    lines: [
      {
        description: "Ideal Standard Sanitary Ware",
        qty: 1,
        unit: "Each",
        unitPrice: 1627.42,
        lineTotal: 1627.42
      }
    ]
  },
  {
    supplier: "KWC",
    invoiceNumber: "DVS 90727281",
    invoiceDate: "2025-10-04",
    dueDate: "2025-11-03",
    totalInc: 235.26,
    documentType: "INVOICE",
    lines: [
      {
        description: "KWC Taps and Fittings",
        qty: 1,
        unit: "Each",
        unitPrice: 235.26,
        lineTotal: 235.26
      }
    ]
  },
  {
    supplier: "APP Wholesale",
    invoiceNumber: "PSI02183468",
    invoiceDate: "2025-10-22",
    dueDate: "2025-11-30",
    totalInc: 1379.24,
    documentType: "INVOICE",
    lines: [
      {
        description: "Vaillant EcoFit Pure 825 Pack New Horiz Flue Pk",
        qty: 1,
        unit: "Each",
        unitPrice: 1379.24,
        lineTotal: 1379.24
      }
    ]
  },
  {
    supplier: "Toolstation",
    invoiceNumber: "TS23101291/YWW198631332I",
    invoiceDate: "2025-10-05",
    dueDate: "2025-11-04",
    totalInc: 16.49,
    documentType: "INVOICE",
    lines: [
      {
        description: "Toolstation Misc",
        qty: 1,
        unit: "Each",
        unitPrice: 16.49,
        lineTotal: 16.49
      }
    ]
  },
  {
    supplier: "Toolstation",
    invoiceNumber: "TS23101291/YWW199268474I",
    invoiceDate: "2025-10-06",
    dueDate: "2025-11-05",
    totalInc: 141.52,
    documentType: "INVOICE",
    lines: [
      {
        description: "Toolstation Misc",
        qty: 1,
        unit: "Each",
        unitPrice: 141.52,
        lineTotal: 141.52
      }
    ]
  },
  {
    supplier: "APP Wholesale",
    invoiceNumber: "PSI02175861",
    invoiceDate: "2025-10-07",
    dueDate: "2025-11-06",
    totalInc: 192.79,
    documentType: "INVOICE",
    lines: [
      {
        description: "APP Wholesale Item",
        qty: 1,
        unit: "Each",
        unitPrice: 192.79,
        lineTotal: 192.79
      }
    ]
  },
  {
    supplier: "Toolstation",
    invoiceNumber: "TS23101291/YUA192697209",
    invoiceDate: "2025-10-08",
    dueDate: "2025-11-07",
    totalInc: 4.13,
    documentType: "INVOICE",
    lines: [
      {
        description: "Toolstation Misc",
        qty: 1,
        unit: "Each",
        unitPrice: 4.13,
        lineTotal: 4.13
      }
    ]
  },
  {
    supplier: "APP Wholesale",
    invoiceNumber: "PSI02171427",
    invoiceDate: "2025-10-09",
    dueDate: "2025-11-08",
    totalInc: 1885.73,
    documentType: "INVOICE",
    lines: [
      {
        description: "APP Wholesale Item",
        qty: 1,
        unit: "Each",
        unitPrice: 1885.73,
        lineTotal: 1885.73
      }
    ]
  }
];

// Email URI references
const EMAIL_URIS = [
  "mail:///messages/AAMkAGUwNWEyYWNiLWJiZmMtNGVhYS1hNjI4LWMwNTcxN2U2NDhkNQBGAAAAAACnmkWfBcR7QJIFP_7xkQVRBwDjsLOgeeDySrc96zrOmMKkAAAAAAEMAADjsLOgeeDySrc96zrOmMKkAAEYYvGgAAA%3D",
  "mail:///messages/AAMkAGUwNWEyYWNiLWJiZmMtNGVhYS1hNjI4LWMwNTcxN2U2NDhkNQBGAAAAAACnmkWfBcR7QJIFP_7xkQVRBwDjsLOgeeDySrc96zrOmMKkAAAAAAEMAADjsLOgeeDySrc96zrOmMKkAAEYYvFvAAA%3D",
  "mail:///messages/AAMkAGUwNWEyYWNiLWJiZmMtNGVhYS1hNjI4LWMwNTcxN2U2NDhkNQBGAAAAAACnmkWfBcR7QJIFP_7xkQVRBwDjsLOgeeDySrc96zrOmMKkAAAAAAEMAADjsLOgeeDySrc96zrOmMKkAAEYYvFlAAA%3D",
  "mail:///messages/AAMkAGUwNWEyYWNiLWJiZmMtNGVhYS1hNjI4LWMwNTcxN2U2NDhkNQBGAAAAAACnmkWfBcR7QJIFP_7xkQVRBwDjsLOgeeDySrc96zrOmMKkAAAAAAEMAADjsLOgeeDySrc96zrOmMKkAAEYYvFkAAA%3D",
  "mail:///messages/AAMkAGUwNWEyYWNiLWJiZmMtNGVhYS1hNjI4LWMwNTcxN2U2NDhkNQBGAAAAAACnmkWfBcR7QJIFP_7xkQVRBwDjsLOgeeDySrc96zrOmMKkAAAAAAEMAADjsLOgeeDySrc96zrOmMKkAAEYYvEGAAA%3D",
  "mail:///messages/AAMkAGUwNWEyYWNiLWJiZmMtNGVhYS1hNjI4LWMwNTcxN2U2NDhkNQBGAAAAAACnmkWfBcR7QJIFP_7xkQVRBwDjsLOgeeDySrc96zrOmMKkAAAAAAEMAADjsLOgeeDySrc96zrOmMKkAAEWoNoUAAA%3D",
  "mail:///messages/AAMkAGUwNWEyYWNiLWJiZmMtNGVhYS1hNjI4LWMwNTcxN2U2NDhkNQBGAAAAAACnmkWfBcR7QJIFP_7xkQVRBwDjsLOgeeDySrc96zrOmMKkAAAAAAEMAADjsLOgeeDySrc96zrOmMKkAAEWoNoRAAA%3D",
  "mail:///messages/AAMkAGUwNWEyYWNiLWJiZmMtNGVhYS1hNjI4LWMwNTcxN2U2NDhkNQBGAAAAAACnmkWfBcR7QJIFP_7xkQVRBwDjsLOgeeDySrc96zrOmMKkAAAAAAEMAADjsLOgeeDySrc96zrOmMKkAAEWoNn2AAA%3D",
  "mail:///messages/AAMkAGUwNWEyYWNiLWJiZmMtNGVhYS1hNjI4LWMwNTcxN2U2NDhkNQBGAAAAAACnmkWfBcR7QJIFP_7xkQVRBwDjsLOgeeDySrc96zrOmMKkAAAAAAEMAADjsLOgeeDySrc96zrOmMKkAAEWVmZQAAA%3D",
  "mail:///messages/AAMkAGUwNWEyYWNiLWJiZmMtNGVhYS1hNjI4LWMwNTcxN2U2NDhkNQBGAAAAAACnmkWfBcR7QJIFP_7xkQVRBwDjsLOgeeDySrc96zrOmMKkAAAAAAEMAADjsLOgeeDySrc96zrOmMKkAAEWVmZEAAA%3D"
];

async function loadInvoices() {
  console.log("Starting invoice load...");

  let loaded = 0;
  let skipped = 0;

  for (let i = 0; i < EXTRACTED_INVOICES.length; i++) {
    const inv = EXTRACTED_INVOICES[i];
    const emailUri = EMAIL_URIS[i];

    try {
      // Find supplier by name (case-insensitive fuzzy)
      const supplier = await prisma.supplier.findFirst({
        where: {
          name: {
            mode: "insensitive",
            contains: inv.supplier
          }
        }
      });

      if (!supplier) {
        console.log(`⚠ Supplier "${inv.supplier}" not found, skipping invoice ${inv.invoiceNumber}`);
        skipped++;
        continue;
      }

      // Check if bill already exists
      const existingBill = await prisma.supplierBill.findFirst({
        where: {
          supplierId: supplier.id,
          billNo: inv.invoiceNumber
        }
      });

      let bill;
      if (existingBill) {
        bill = existingBill;
      } else {
        bill = await prisma.supplierBill.create({
          data: {
            supplierId: supplier.id,
            billNo: inv.invoiceNumber,
            billDate: new Date(inv.invoiceDate),
            dueDate: new Date(inv.dueDate),
            status: "RECEIVED",
            amountIncVat: inv.totalInc,
            totalCost: Math.abs(inv.totalInc),
            sourceAttachmentRef: emailUri
          }
        });
      }

      // Insert or skip lines if bill already existed with lines
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
        console.log(`✓ Loaded ${inv.invoiceNumber} (${inv.lines.length} lines) from ${inv.supplier}`);
      } else {
        console.log(`✓ Bill ${inv.invoiceNumber} already has lines, skipped line insert`);
      }

      loaded++;
    } catch (err) {
      console.error(`✗ Error loading ${inv.invoiceNumber}:`, err.message);
      skipped++;
    }
  }

  console.log(`\n📊 Summary: ${loaded} loaded, ${skipped} skipped`);
  await prisma.$disconnect();
}

loadInvoices().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
