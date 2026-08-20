#!/usr/bin/env node
// One-shot historical import of Zoho Books invoices (with line items)
// from CSV exports. Lands in ZohoImportedInvoice + ZohoImportedInvoiceLine
// (quarantine layer — never read by GL/AR/reports).
//
// Usage:
//   node scripts/zoho-import-invoices-csv.mjs <file1.csv> [<file2.csv> ...]

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: zoho-import-invoices-csv.mjs <file1.csv> [<file2.csv> ...]");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const NUL = String.fromCharCode(0);
const stripNul = (s) => (typeof s === "string" ? s.split(NUL).join("") : s);
const asStr = (v) => {
  if (v == null) return null;
  const s = stripNul(String(v)).trim();
  return s.length > 0 ? s : null;
};
const sanitize = (obj) => {
  const out = {};
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    out[k] = typeof v === "string" ? stripNul(v) : v;
  }
  return out;
};
const asNum = (v) => {
  const s = asStr(v);
  if (s == null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const asDate = (v) => {
  const s = asStr(v);
  if (s == null) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};

// Header columns (invoice-level — same on every line of a given invoice)
const HEADER_KEYS = new Set([
  "Invoice Date","Invoice ID","Invoice Number","Issued Date","Invoice Status",
  "Customer ID","Customer Name","Company Registration Number","Is Inclusive Tax",
  "Due Date","PurchaseOrder","Currency Code","Exchange Rate","Discount Type",
  "Is Discount Before Tax","Template Name","Entity Discount Percent","SubTotal",
  "Total","TotalRetentionAmountFCY","TotalRetentionAmountBCY","Balance",
  "Adjustment","Adjustment Description","Expected Payment Date","Last Payment Date",
  "Payment Terms","Payment Terms Label","Early Payment Discount Percentage",
  "Early Payment Discount Amount","Early Payment Discount Due Days","Notes",
  "Terms & Conditions","Entity Discount Amount","Branch ID","Branch Name",
  "Shipping Charge","Shipping Charge Tax ID","Shipping Charge Tax Amount",
  "Shipping Charge Tax Name","Shipping Charge Tax %","Shipping Charge Tax Type",
  "Billing Attention","Billing Address","Billing Street2","Billing City",
  "Billing State","Billing Country","Billing Code","Billing Phone","Billing Fax",
  "Shipping Attention","Shipping Address","Shipping Street2","Shipping City",
  "Shipping State","Shipping Country","Shipping Code","Shipping Fax",
  "Shipping Phone Number","Reverse Charge Tax Name","Reverse Charge Tax Rate",
  "Reverse Charge Tax Type","CIS Deduction Name","CIS Deduction Percentage",
  "CIS Deduction Amount","Is Reverse Charge Applied","Project ID","Project Name",
  "Round Off","Sales person","Primary Contact EmailID","Primary Contact Mobile",
  "Primary Contact Phone","Estimate Number","Purchase Invoices","Pending approval",
  "Fully billed","To be ordered","Custom Charges","Shipping Bill#",
  "Shipping Bill Date","Shipping Bill Total","PortCode","CF.Linked invoice label",
]);

function pickHeader(row) {
  const out = {};
  for (const k of Object.keys(row)) {
    if (HEADER_KEYS.has(k)) out[k] = typeof row[k] === "string" ? stripNul(row[k]) : row[k];
  }
  return out;
}

function readCsvRows(filePath) {
  const buf = fs.readFileSync(filePath);
  const wb = XLSX.read(buf, { type: "buffer", raw: false });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
}

async function main() {
  const startedAt = Date.now();
  console.log(`[zoho-csv] reading ${files.length} file(s)…`);

  // Group rows by Invoice ID
  const byInvoice = new Map(); // zohoId -> { header: row, lines: row[] }
  let totalRows = 0;

  for (const f of files) {
    const abs = path.resolve(f);
    const rows = readCsvRows(abs);
    totalRows += rows.length;
    console.log(`  ${path.basename(abs)}: ${rows.length} rows`);
    for (const row of rows) {
      const zohoId = asStr(row["Invoice ID"]);
      if (!zohoId) continue;
      let entry = byInvoice.get(zohoId);
      if (!entry) {
        entry = { header: row, lines: [] };
        byInvoice.set(zohoId, entry);
      }
      entry.lines.push(row);
    }
  }

  console.log(`[zoho-csv] ${totalRows} rows → ${byInvoice.size} unique invoices`);

  let inv = 0;
  let lineCount = 0;
  for (const [zohoId, { header, lines }] of byInvoice) {
    const headerPayload = pickHeader(header);

    const headerData = {
      zohoId,
      zohoNumber: asStr(header["Invoice Number"]),
      zohoCustomerId: asStr(header["Customer ID"]),
      customerName: asStr(header["Customer Name"]),
      invoiceDate: asDate(header["Invoice Date"]),
      dueDate: asDate(header["Due Date"]),
      total: asNum(header["Total"]),
      balance: asNum(header["Balance"]),
      currencyCode: asStr(header["Currency Code"]),
      status: asStr(header["Invoice Status"]),
      payload: headerPayload,
    };

    const lineData = lines.map((r, i) => ({
      id: randomUUID(),
      lineNumber: i + 1,
      itemName: asStr(r["Item Name"]),
      itemDesc: asStr(r["Item Desc"]),
      productId: asStr(r["Product ID"]),
      sku: asStr(r["SKU"]),
      quantity: asNum(r["Quantity"]),
      usageUnit: asStr(r["Usage unit"]),
      itemPrice: asNum(r["Item Price"]),
      itemTotal: asNum(r["Item Total"]),
      account: asStr(r["Account"]),
      accountCode: asStr(r["Account Code"]),
      itemTaxPercent: asNum(r["Item Tax %"]),
      itemTaxAmount: asNum(r["Item Tax Amount"]),
      cfSite: asStr(r["CF.Site"]),
      payload: sanitize(r),
    }));

    await prisma.$transaction(async (tx) => {
      const existing = await tx.zohoImportedInvoice.findUnique({ where: { zohoId } });
      let invoiceId;
      if (existing) {
        await tx.zohoImportedInvoice.update({ where: { zohoId }, data: headerData });
        invoiceId = existing.id;
        await tx.zohoImportedInvoiceLine.deleteMany({ where: { invoiceId } });
      } else {
        const created = await tx.zohoImportedInvoice.create({ data: headerData });
        invoiceId = created.id;
      }
      await tx.zohoImportedInvoiceLine.createMany({
        data: lineData.map((l) => ({ ...l, invoiceId })),
      });
    });

    inv++;
    lineCount += lineData.length;
    if (inv % 100 === 0) {
      console.log(`  upserted ${inv}/${byInvoice.size} invoices (${lineCount} lines)`);
    }
  }

  const ms = Date.now() - startedAt;
  console.log(`[zoho-csv] done — ${inv} invoices, ${lineCount} lines in ${(ms / 1000).toFixed(1)}s`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
