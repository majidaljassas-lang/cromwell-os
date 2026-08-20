#!/usr/bin/env node
// One-shot historical import of Zoho Books bills (with line items)
// from CSV exports. Lands in ZohoImportedBill + ZohoImportedBillLine
// (quarantine layer — never read by GL/AP/reports).
//
// Usage:
//   node scripts/zoho-import-bills-csv.mjs <file1.csv> [<file2.csv> ...]

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
  console.error("usage: zoho-import-bills-csv.mjs <file1.csv> [<file2.csv> ...]");
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

// Header columns (bill-level — same on every line of a given bill)
const HEADER_KEYS = new Set([
  "Bill Date","Due Date","Bill ID","Vendor Name","Entity Discount Percent",
  "Payment Terms","Payment Terms Label","Bill Number","PurchaseOrder",
  "Currency Code","Exchange Rate","SubTotal","Total","Balance",
  "TotalRetentionAmountFCY","TotalRetentionAmountBCY","Vendor Notes",
  "Terms & Conditions","Adjustment","Adjustment Description","Bill Type",
  "Branch ID","Branch Name","Is Inclusive Tax","Submitted By","Approved By",
  "Submitted Date","Approved Date","Bill Status","Created By","Customer Name",
  "Project Name","Purchase Invoices","Pending approval","Fully billed",
  "To be ordered","CF.Site","CF.Bill status",
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

  // Group rows by Bill ID
  const byBill = new Map(); // zohoId -> { header: row, lines: row[] }
  let totalRows = 0;

  for (const f of files) {
    const abs = path.resolve(f);
    const rows = readCsvRows(abs);
    totalRows += rows.length;
    console.log(`  ${path.basename(abs)}: ${rows.length} rows`);
    for (const row of rows) {
      const zohoId = asStr(row["Bill ID"]);
      if (!zohoId) continue;
      let entry = byBill.get(zohoId);
      if (!entry) {
        entry = { header: row, lines: [] };
        byBill.set(zohoId, entry);
      }
      entry.lines.push(row);
    }
  }

  console.log(`[zoho-csv] ${totalRows} rows → ${byBill.size} unique bills`);

  let billCount = 0;
  let lineCount = 0;
  for (const [zohoId, { header, lines }] of byBill) {
    const headerPayload = pickHeader(header);

    const headerData = {
      zohoId,
      zohoNumber: asStr(header["Bill Number"]),
      // Bill CSV doesn't include Vendor ID directly — vendor identified by name
      zohoVendorId: null,
      vendorName: asStr(header["Vendor Name"]),
      billDate: asDate(header["Bill Date"]),
      dueDate: asDate(header["Due Date"]),
      total: asNum(header["Total"]),
      balance: asNum(header["Balance"]),
      currencyCode: asStr(header["Currency Code"]),
      status: asStr(header["Bill Status"]),
      payload: headerPayload,
    };

    const lineData = lines.map((r, i) => ({
      id: randomUUID(),
      lineNumber: i + 1,
      itemName: asStr(r["Item Name"]),
      itemDesc: asStr(r["Description"]),
      productId: asStr(r["Product ID"]),
      sku: asStr(r["SKU"]),
      quantity: asNum(r["Quantity"]),
      usageUnit: asStr(r["Usage unit"]),
      rate: asNum(r["Rate"]),
      itemTotal: asNum(r["Item Total"]),
      account: asStr(r["Account"]),
      accountCode: asStr(r["Account Code"]),
      itemTaxPercent: asNum(r["Tax Percentage"]),
      itemTaxAmount: asNum(r["Tax Amount"]),
      cfSite: asStr(r["CF.Site"]),
      customerName: asStr(r["Customer Name"]),
      payload: sanitize(r),
    }));

    await prisma.$transaction(async (tx) => {
      const existing = await tx.zohoImportedBill.findUnique({ where: { zohoId } });
      let billId;
      if (existing) {
        await tx.zohoImportedBill.update({ where: { zohoId }, data: headerData });
        billId = existing.id;
        await tx.zohoImportedBillLine.deleteMany({ where: { billId } });
      } else {
        const created = await tx.zohoImportedBill.create({ data: headerData });
        billId = created.id;
      }
      await tx.zohoImportedBillLine.createMany({
        data: lineData.map((l) => ({ ...l, billId })),
      });
    });

    billCount++;
    lineCount += lineData.length;
    if (billCount % 200 === 0) {
      console.log(`  upserted ${billCount}/${byBill.size} bills (${lineCount} lines)`);
    }
  }

  const ms = Date.now() - startedAt;
  console.log(`[zoho-csv] done — ${billCount} bills, ${lineCount} lines in ${(ms / 1000).toFixed(1)}s`);
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
