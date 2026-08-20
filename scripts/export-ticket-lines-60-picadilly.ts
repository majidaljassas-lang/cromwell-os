import { PrismaClient } from "../src/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import * as XLSX from "xlsx";

const TICKET_ID = "33f3be3d-aab6-402c-92d8-e053c9a01a27";
const OUT = "/tmp/60-picadilly-ticket-lines.xlsx";

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
    include: { supplier: { select: { name: true } } },
  });

  const rows = lines.map((l, i) => {
    const qty = Number(l.qty);
    const costUnit = l.expectedCostUnit != null ? Number(l.expectedCostUnit) : null;
    const costTotal = l.expectedCostTotal != null ? Number(l.expectedCostTotal) : null;
    const saleUnit = l.actualSaleUnit != null ? Number(l.actualSaleUnit) : l.suggestedSaleUnit != null ? Number(l.suggestedSaleUnit) : null;
    const saleTotal = l.actualSaleTotal != null ? Number(l.actualSaleTotal) : saleUnit != null ? +(saleUnit * qty).toFixed(2) : null;
    const margin = saleTotal != null && costTotal != null ? +(saleTotal - costTotal).toFixed(2) : null;
    const marginPct = saleTotal != null && saleTotal > 0 && margin != null ? +((margin / saleTotal) * 100).toFixed(2) : null;
    return {
      "#": i + 1,
      "Product Code": l.productCode ?? "",
      "Description": l.description,
      "Supplier": l.supplier?.name ?? l.supplierName ?? "",
      "Qty": qty,
      "Unit": l.unit,
      "Cost / Unit": costUnit,
      "Cost Total": costTotal,
      "Sale / Unit": saleUnit,
      "Sale Total": saleTotal,
      "Margin": margin,
      "Margin %": marginPct,
      "From Stock": l.fromStock ?? 0,
      "To Order": l.toOrder ?? 0,
      "Status": l.status,
    };
  });

  const totals = {
    "#": "",
    "Product Code": "",
    "Description": "TOTALS",
    "Supplier": "",
    "Qty": "",
    "Unit": "",
    "Cost / Unit": "",
    "Cost Total": rows.reduce((s, r) => s + (r["Cost Total"] ?? 0), 0),
    "Sale / Unit": "",
    "Sale Total": rows.reduce((s, r) => s + (r["Sale Total"] ?? 0), 0),
    "Margin": rows.reduce((s, r) => s + (r["Margin"] ?? 0), 0),
    "Margin %": "",
    "From Stock": "",
    "To Order": "",
    "Status": "",
  };

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet([...rows, totals]);
  ws["!cols"] = [
    { wch: 4 },
    { wch: 18 },
    { wch: 60 },
    { wch: 18 },
    { wch: 6 },
    { wch: 6 },
    { wch: 11 },
    { wch: 11 },
    { wch: 11 },
    { wch: 11 },
    { wch: 11 },
    { wch: 9 },
    { wch: 10 },
    { wch: 9 },
    { wch: 14 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, "Ticket Lines");

  const meta = XLSX.utils.aoa_to_sheet([
    ["Ticket", ticket.title],
    ["Customer", ticket.payingCustomer?.name ?? ""],
    ["Site", ticket.site?.siteName ?? ""],
    ["Ticket ID", ticket.id],
    ["Status", ticket.status],
    ["Lines", lines.length.toString()],
    ["Exported At", new Date().toISOString()],
  ]);
  meta["!cols"] = [{ wch: 14 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(wb, meta, "Meta");

  XLSX.writeFile(wb, OUT);
  console.log(`Wrote ${OUT}: ${lines.length} lines`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
