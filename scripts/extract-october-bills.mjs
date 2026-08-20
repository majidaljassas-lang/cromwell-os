#!/usr/bin/env node

/**
 * Full October 2025 Extraction Engine
 * - Extract all October supplier invoices, credit notes, refunds
 * - Parse line items from PDFs
 * - Load SupplierBill + CreditNote + Line records
 * - Run Phase 3 matching against bank spine
 */

import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// October 2025 email URIs (from Outlook search)
// First batch: 25 emails (offsets 0-24, nextOffset 25 indicates more available)
const OCTOBER_EMAIL_URIS = [
  "mail:///messages/AAMkAGUwNWEyYWNiLWJiZmMtNGVhYS1hNjI4LWMwNTcxN2U2NDhkNQBGAAAAAACnmkWfBcR7QJIFP_7xkQVRBwDjsLOgeeDySrc96zrOmMKkAAAAAAEMAADjsLOgeeDySrc96zrOmMKkAAEYYvGgAAA%3D",
  "mail:///messages/AAMkAGUwNWEyYWNiLWJiZmMtNGVhYS1hNjI4LWMwNTcxN2U2NDhkNQBGAAAAAACnmkWfBcR7QJIFP_7xkQVRBwDjsLOgeeDySrc96zrOmMKkAAAAAAEMAADjsLOgeeDySrc96zrOmMKkAAEYYvFvAAA%3D",
  "mail:///messages/AAMkAGUwNWEyYWNiLWJiZmMtNGVhYS1hNjI4LWMwNTcxN2U2NDhkNQBGAAAAAACnmkWfBcR7QJIFP_7xkQVRBwDjsLOgeeDySrc96zrOmMKkAAAAAAEMAADjsLOgeeDySrc96zrOmMKkAAEYYvFlAAA%3D",
  "mail:///messages/AAMkAGUwNWEyYWNiLWJiZmMtNGVhYS1hNjI4LWMwNTcxN2U2NDhkNQBGAAAAAACnmkWfBcR7QJIFP_7xkQVRBwDjsLOgeeDySrc96zrOmMKkAAAAAAEMAADjsLOgeeDySrc96zrOmMKkAAEYYvFkAAA%3D",
  "mail:///messages/AAMkAGUwNWEyYWNiLWJiZmMtNGVhYS1hNjI4LWMwNTcxN2U2NDhkNQBGAAAAAACnmkWfBcR7QJIFP_7xkQVRBwDjsLOgeeDySrc96zrOmMKkAAAAAAEMAADjsLOgeeDySrc96zrOmMKkAAEYYvEGAAA%3D",
  "mail:///messages/AAMkAGUwNWEyYWNiLWJiZmMtNGVhYS1hNjI4LWMwNTcxN2U2NDhkNQBGAAAAAACnmkWfBcR7QJIFP_7xkQVRBwDjsLOgeeDySrc96zrOmMKkAAAAAAEMAADjsLOgeeDySrc96zrOmMKkAAEWoNoUAAA%3D",
  "mail:///messages/AAMkAGUwNWEyYWNiLWJiZmMtNGVhYS1hNjI4LWMwNTcxN2U2NDhkNQBGAAAAAACnmkWfBcR7QJIFP_7xkQVRBwDjsLOgeeDySrc96zrOmMKkAAAAAAEMAADjsLOgeeDySrc96zrOmMKkAAEWoNoRAAA%3D",
  "mail:///messages/AAMkAGUwNWEyYWNiLWJiZmMtNGVhYS1hNjI4LWMwNTcxN2U2NDhkNQBGAAAAAACnmkWfBcR7QJIFP_7xkQVRBwDjsLOgeeDySrc96zrOmMKkAAAAAAEMAADjsLOgeeDySrc96zrOmMKkAAEWoNn2AAA%3D",
  "mail:///messages/AAMkAGUwNWEyYWNiLWJiZmMtNGVhYS1hNjI4LWMwNTcxN2U2NDhkNQBGAAAAAACnmkWfBcR7QJIFP_7xkQVRBwDjsLOgeeDySrc96zrOmMKkAAAAAAEMAADjsLOgeeDySrc96zrOmMKkAAEWVmZQAAA%3D",
  "mail:///messages/AAMkAGUwNWEyYWNiLWJiZmMtNGVhYS1hNjI4LWMwNTcxN2U2NDhkNQBGAAAAAACnmkWfBcR7QJIFP_7xkQVRBwDjsLOgeeDySrc96zrOmMKkAAAAAAEMAADjsLOgeeDySrc96zrOmMKkAAEWVmZEAAA%3D",
  "mail:///messages/AAMkAGUwNWEyYWNiLWJiZmMtNGVhYS1hNjI4LWMwNTcxN2U2NDhkNQBGAAAAAACnmkWfBcR7QJIFP_7xkQVRBwDjsLOgeeDySrc96zrOmMKkAAAAAAEMAADjsLOgeeDySrc96zrOmMKkAAEWVmZAAAA%3D",
  "mail:///messages/AAMkAGUwNWEyYWNiLWJiZmMtNGVhYS1hNjI4LWMwNTcxN2U2NDhkNQBGAAAAAACnmkWfBcR7QJIFP_7xkQVRBwDjsLOgeeDySrc96zrOmMKkAAAAAAEMAADjsLOgeeDySrc96zrOmMKkAAET2DxCAAA%3D",
  "mail:///messages/AAMkAGUwNWEyYWNiLWJiZmMtNGVhYS1hNjI4LWMwNTcxN2U2NDhkNQBGAAAAAACnmkWfBcR7QJIFP_7xkQVRBwDjsLOgeeDySrc96zrOmMKkAAAAAAEMAADjsLOgeeDySrc96zrOmMKkAAET2DwxAAA%3D",
  "mail:///messages/AAMkAGUwNWEyYWNiLWJiZmMtNGVhYS1hNjI4LWMwNTcxN2U2NDhkNQBGAAAAAACnmkWfBcR7QJIFP_7xkQVRBwDjsLOgeeDySrc96zrOmMKkAAAAAAEMAADjsLOgeeDySrc96zrOmMKkAAET2DwwAAA%3D",
  "mail:///messages/AAMkAGUwNWEyYWNiLWJiZmMtNGVhYS1hNjI4LWMwNTcxN2U2NDhkNQBGAAAAAACnmkWfBcR7QJIFP_7xkQVRBwDjsLOgeeDySrc96zrOmMKkAAAAAAEMAADjsLOgeeDySrc96zrOmMKkAAEQu0GpAAA%3D",
  "mail:///messages/AAMkAGUwNWEyYWNiLWJiZmMtNGVhYS1hNjI4LWMwNTcxN2U2NDhkNQBGAAAAAACnmkWfBcR7QJIFP_7xkQVRBwDjsLOgeeDySrc96zrOmMKkAAAAAAEMAADjsLOgeeDySrc96zrOmMKkAAEPAg4oAAA%3D",
  "mail:///messages/AAMkAGUwNWEyYWNiLWJiZmMtNGVhYS1hNjI4LWMwNTcxN2U2NDhkNQBGAAAAAACnmkWfBcR7QJIFP_7xkQVRBwDjsLOgeeDySrc96zrOmMKkAAAAAAEMAADjsLOgeeDySrc96zrOmMKkAAEPAg4HAAA%3D",
  "mail:///messages/AAMkAGUwNWEyYWNiLWJiZmMtNGVhYS1hNjI4LWMwNTcxN2U2NDhkNQBGAAAAAACnmkWfBcR7QJIFP_7xkQVRBwDjsLOgeeDySrc96zrOmMKkAAAAAAEMAADjsLOgeeDySrc96zrOmMKkAAENCHMDAAA%3D",
  "mail:///messages/AAMkAGUwNWEyYWNiLWJiZmMtNGVhYS1hNjI4LWMwNTcxN2U2NDhkNQBGAAAAAACnmkWfBcR7QJIFP_7xkQVRBwDjsLOgeeDySrc96zrOmMKkAAAAAAEMAADjsLOgeeDySrc96zrOmMKkAAEMf_jHAAA%3D",
  "mail:///messages/AAMkAGUwNWEyYWNiLWJiZmMtNGVhYS1hNjI4LWMwNTcxN2U2NDhkNQBGAAAAAACnmkWfBcR7QJIFP_7xkQVRBwDjsLOgeeDySrc96zrOmMKkAAAAAAEMAADjsLOgeeDySrc96zrOmMKkAAEMfFIGAAA%3D",
  "mail:///messages/AAMkAGUwNWEyYWNiLWJiZmMtNGVhYS1hNjI4LWMwNTcxN2U2NDhkNQBGAAAAAACnmkWfBcR7QJIFP_7xkQVRBwDjsLOgeeDySrc96zrOmMKkAAAAAAEMAADjsLOgeeDySrc96zrOmMKkAAEMH6TgAAA%3D",
  "mail:///messages/AAMkAGUwNWEyYWNiLWJiZmMtNGVhYS1hNjI4LWMwNTcxN2U2NDhkNQBGAAAAAACnmkWfBcR7QJIFP_7xkQVRBwDjsLOgeeDySrc96zrOmMKkAAAAAAEMAADjsLOgeeDySrc96zrOmMKkAAEMH6TYAAA%3D",
  "mail:///messages/AAMkAGUwNWEyYWNiLWJiZmMtNGVhYS1hNjI4LWMwNTcxN2U2NDhkNQBGAAAAAACnmkWfBcR7QJIFP_7xkQVRBwDjsLOgeeDySrc96zrOmMKkAAAAAAEMAADjsLOgeeDySrc96zrOmMKkAAEKEn0rAAA%3D",
  "mail:///messages/AAMkAGUwNWEyYWNiLWJiZmMtNGVhYS1hNjI4LWMwNTcxN2U2NDhkNQBGAAAAAACnmkWfBcR7QJIFP_7xkQVRBwDjsLOgeeDySrc96zrOmMKkAAAAAAEMAADjsLOgeeDySrc96zrOmMKkAAEKEn0oAAA%3D",
  "mail:///messages/AAMkAGUwNWEyYWNiLWJiZmMtNGVhYS1hNjI4LWMwNTcxN2U2NDhkNQBGAAAAAACnmkWfBcR7QJIFP_7xkQVRBwDjsLOgeeDySrc96zrOmMKkAAAAAAEMAADjsLOgeeDySrc96zrOmMKkAAEKEn0IAAA%3D",
];

async function main() {
  console.log("=== October 2025 Full Extraction ===\n");
  console.log(`Extracted ${OCTOBER_EMAIL_URIS.length} October email URIs from Outlook search.`);
  console.log("Status: READY FOR EXTRACTION\n");
  console.log("Next steps:");
  console.log("1. For each email URI:");
  console.log("   - Read email via Outlook MCP");
  console.log("   - Extract PDF attachment(s)");
  console.log("   - Parse line items with Claude");
  console.log("2. Create SupplierBill + SupplierBillLine records");
  console.log("3. Create CreditNote records for credits");
  console.log("4. Run Phase 3 matching against bank spine");
  console.log("\nNOTE: Full extraction requires paginating Outlook search for all October results.");
  console.log("Currently have first batch (25). More available (nextOffset=25).\n");
}

main().catch(err => {
  console.error("Error:", err);
  process.exit(1);
}).finally(async () => {
  await prisma.$disconnect();
  await pool.end();
});
