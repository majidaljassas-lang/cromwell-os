import "dotenv/config";
import { PrismaClient } from "/Users/majidaljassas/cromwell-os/src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

// Resolve invoice line IDs for INV-004841 by lineNumber
const inv = await prisma.zohoImportedInvoice.findFirst({
  where: { zohoNumber: "INV-004841" },
  include: { lines: { orderBy: { lineNumber: "asc" } } },
});
if (!inv) { console.error("invoice not found"); process.exit(1); }

const invLineByNo = new Map(inv.lines.map(l => [l.lineNumber, l.id]));

// Pull the three bills + their lines
const bills = await prisma.zohoImportedBill.findMany({
  where: { zohoNumber: { in: ["2958/00774295", "0001/00346275", "SI00679501"] } },
  include: { lines: { orderBy: { lineNumber: "asc" } } },
});
const billByNo = new Map(bills.map(b => [b.zohoNumber, b]));

// Mappings — bill line (by description signature) → invoice line number
const mappings = [
  // Ashworth 2958/00774295 — five copper tube sizes
  { bill: "2958/00774295", billLineNo: 1, invLineNo: 1,  conf: 100, reason: "Ashworth same-job pipe run · 28mm × 10 exact qty" },
  { bill: "2958/00774295", billLineNo: 2, invLineNo: 2,  conf: 100, reason: "Ashworth same-job pipe run · 35mm × 10 exact qty" },
  { bill: "2958/00774295", billLineNo: 3, invLineNo: 6,  conf: 100, reason: "Ashworth same-job pipe run · 42mm × 4 exact qty" },
  { bill: "2958/00774295", billLineNo: 4, invLineNo: 3,  conf: 100, reason: "Ashworth same-job pipe run · 22mm × 20 exact qty" },
  { bill: "2958/00774295", billLineNo: 5, invLineNo: 4,  conf: 100, reason: "Ashworth same-job pipe run · 15mm × 20 exact qty" },
  // F W Hipkin 0001/00346275 — SKU exact matches
  { bill: "0001/00346275", billLineNo: 1, invLineNo: 10, conf: 100, reason: "SKU K07065 exact match · 22mm Cold Water Lever Ball Valve Blue" },
  { bill: "0001/00346275", billLineNo: 2, invLineNo: 11, conf: 100, reason: "SKU K07068 exact match · 22mm Lever Ball Valve Red WRAS" },
  { bill: "0001/00346275", billLineNo: 3, invLineNo: 7,  conf: 100, reason: "SKU C0260 exact match · Amtech Pipe Cutter 15mm" },
  { bill: "0001/00346275", billLineNo: 4, invLineNo: 8,  conf: 100, reason: "SKU C0265 exact match · Amtech Pipe Cutter 22mm" },
  { bill: "0001/00346275", billLineNo: 5, invLineNo: 9,  conf: 100, reason: "SKU C0270 exact match · Amtech Pipe Cutter 28mm" },
  // Navigator MSL SI00679501 — same day, exact qty
  { bill: "SI00679501",    billLineNo: 1, invLineNo: 12, conf: 95,  reason: "Same-day bill · GENBRA 35mm Lever Ball Valve BLUE qty 2 exact" },
  { bill: "SI00679501",    billLineNo: 2, invLineNo: 13, conf: 95,  reason: "Same-day bill · GENBRA 35mm Lever Ball Valve RED qty 2 exact" },
];

let updated = 0;
for (const m of mappings) {
  const b = billByNo.get(m.bill);
  if (!b) { console.error(`bill ${m.bill} missing`); continue; }
  const bl = b.lines.find(l => l.lineNumber === m.billLineNo);
  const ilId = invLineByNo.get(m.invLineNo);
  if (!bl || !ilId) { console.error(`mapping miss: ${m.bill} L${m.billLineNo} → INV L${m.invLineNo}`); continue; }
  await prisma.zohoImportedBillLine.update({
    where: { id: bl.id },
    data: {
      clearStatus: "CLEARED",
      matchedInvoiceLineId: ilId,
      matchConfidence: m.conf,
      matchReason: m.reason,
      matchedAt: new Date(),
    },
  });
  updated++;
}

console.log(`Persisted ${updated} bill-line → invoice-line matches for INV-004841\n`);

// Verify
const summary = await prisma.zohoImportedBillLine.findMany({
  where: { matchedInvoiceLineId: { in: inv.lines.map(l => l.id) } },
  include: { bill: { select: { zohoNumber: true, vendorName: true, billDate: true } } },
  orderBy: { matchedAt: "desc" },
});
console.log("Verified persisted matches:");
for (const s of summary) {
  console.log(`  ${s.bill.zohoNumber.padEnd(20)} L${s.lineNumber}  →  invLine ${s.matchedInvoiceLineId.slice(0,8)} · conf ${s.matchConfidence} · ${s.matchReason}`);
}

await prisma.$disconnect();
await pool.end();
