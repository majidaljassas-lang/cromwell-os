import { PrismaClient } from "../src/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import * as XLSX from "xlsx";
import fs from "fs";

const TICKET_ID = "914d46fb-7884-4a8b-82e0-afb4622af2ee";
const MARGIN = 0.175;
const OUT = "/tmp/26-park-hill-tender-pack-client.xlsx";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

async function main() {
  const ticket = await prisma.ticket.findUnique({
    where: { id: TICKET_ID },
    include: { site: true, payingCustomer: true },
  });
  if (!ticket) throw new Error("Ticket not found");

  const lines = await prisma.ticketLine.findMany({
    where: { ticketId: TICKET_ID },
    orderBy: { createdAt: "asc" },
  });

  const rows = lines.map((l, i) => {
    const qty = Number(l.qty);
    const costUnit = l.expectedCostUnit != null ? Number(l.expectedCostUnit) : null;
    let sellUnit = l.suggestedSaleUnit != null ? Number(l.suggestedSaleUnit) : null;
    if (sellUnit == null && costUnit != null) {
      sellUnit = +(costUnit / (1 - MARGIN)).toFixed(4);
    }
    const priced = costUnit != null;
    const sellTotal = priced && sellUnit != null ? +(sellUnit * qty).toFixed(2) : null;
    return {
      n: i + 1,
      code: l.productCode || "",
      desc: l.description,
      qty,
      unit: l.unit,
      sellUnit,
      sellTotal,
      priced,
    };
  });

  const subtotal = +rows.reduce((s, r) => s + (r.sellTotal ?? 0), 0).toFixed(2);
  const vat = +(subtotal * 0.2).toFixed(2);
  const total = +(subtotal + vat).toFixed(2);
  const pricedCount = rows.filter((r) => r.priced).length;
  const unpricedCount = rows.length - pricedCount;
  const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  const aoa: (string | number | null)[][] = [];

  aoa.push([ticket.title]);
  aoa.push([]);
  aoa.push(["Customer:", ticket.payingCustomer?.name || "—", "", "Date:", today]);
  aoa.push(["Site:", ticket.site?.siteName || "26 Park Hill", "", "Lines:", `${rows.length} (${pricedCount} priced, ${unpricedCount} included)`]);
  aoa.push(["Ticket No:", `#${ticket.ticketNo}`]);
  aoa.push([]);

  const headerRowIndex = aoa.length;
  aoa.push(["#", "Code", "Description", "Qty", "Unit", "Unit Price (£)", "Line Total (£)"]);

  for (const r of rows) {
    if (r.priced) {
      aoa.push([r.n, r.code, r.desc, r.qty, r.unit, r.sellUnit, r.sellTotal]);
    } else {
      aoa.push([r.n, r.code, `    ↳ ${r.desc}`, r.qty, r.unit, "Included", "Included"]);
    }
  }

  aoa.push([]);
  aoa.push(["", "", "", "", "", "Subtotal (ex VAT)", subtotal]);
  aoa.push(["", "", "", "", "", "VAT @ 20%", vat]);
  aoa.push(["", "", "", "", "", "Total inc VAT", total]);
  aoa.push([]);
  aoa.push([`Cromwell Plumbing · 26 Park Hill Tender Pack (04-2026) · Generated ${today}.`]);
  aoa.push(["Component items shown indented with \"Included\" form part of the priced parent assemblies above."]);

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  ws["!cols"] = [
    { wch: 5 },
    { wch: 14 },
    { wch: 60 },
    { wch: 8 },
    { wch: 8 },
    { wch: 16 },
    { wch: 16 },
  ];

  // Number formats for price columns on the data rows
  const firstDataRow = headerRowIndex + 1; // 0-indexed
  const lastDataRow = firstDataRow + rows.length - 1;
  for (let r = firstDataRow; r <= lastDataRow; r++) {
    for (const col of [5, 6]) {
      const addr = XLSX.utils.encode_cell({ r, c: col });
      const cell = ws[addr];
      if (cell && typeof cell.v === "number") {
        cell.z = "#,##0.00";
      }
    }
  }
  // Totals block number formats
  const totalsStart = lastDataRow + 2;
  for (let r = totalsStart; r <= totalsStart + 2; r++) {
    const addr = XLSX.utils.encode_cell({ r, c: 6 });
    const cell = ws[addr];
    if (cell && typeof cell.v === "number") cell.z = "#,##0.00";
  }

  // Merge title across columns A-G
  ws["!merges"] = ws["!merges"] || [];
  ws["!merges"].push({ s: { r: 0, c: 0 }, e: { r: 0, c: 6 } });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Quotation");

  XLSX.writeFile(wb, OUT);

  const stat = fs.statSync(OUT);
  console.log(`XLSX written: ${OUT} (${(stat.size / 1024).toFixed(1)} KB)`);
  console.log(`  Lines: ${rows.length}  Priced: ${pricedCount}  Included: ${unpricedCount}`);
  console.log(`  Subtotal ex VAT: £${subtotal.toFixed(2)}  VAT: £${vat.toFixed(2)}  Total: £${total.toFixed(2)}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
