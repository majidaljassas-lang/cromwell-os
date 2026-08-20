/**
 * Generic ticket-lines → XLSX exporter.
 *
 * Usage: npx tsx scripts/export-ticket-lines.ts <ticketId> [out.xlsx]
 *   - ticketId: full UUID or 8-char prefix
 *   - out.xlsx: optional output path (default /tmp/<slug>-ticket-lines.xlsx)
 */
import { PrismaClient } from "../src/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import * as XLSX from "xlsx";

const arg = process.argv[2];
if (!arg) {
  console.error("Usage: npx tsx scripts/export-ticket-lines.ts <ticketId> [out.xlsx]");
  process.exit(2);
}
const customOut = process.argv[3];

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

async function main() {
  // Resolve ticket — accept full UUID or prefix
  const ticket =
    arg.length >= 36
      ? await prisma.ticket.findUnique({
          where: { id: arg },
          include: { site: true, payingCustomer: true },
        })
      : await prisma.ticket.findFirst({
          where: { id: { startsWith: arg } },
          include: { site: true, payingCustomer: true },
        });
  if (!ticket) throw new Error(`Ticket not found: ${arg}`);

  const lines = await prisma.ticketLine.findMany({
    where: { ticketId: ticket.id },
    orderBy: { createdAt: "asc" },
    include: {
      supplier: { select: { name: true } },
      parentLine: { select: { id: true, description: true } },
    },
  });

  // Group children under their parent for stable output ordering
  const parents = lines.filter((l) => l.parentLineId === null);
  const childrenByParent = new Map<string, typeof lines>();
  for (const l of lines) {
    if (l.parentLineId) {
      const arr = childrenByParent.get(l.parentLineId) ?? [];
      arr.push(l);
      childrenByParent.set(l.parentLineId, arr);
    }
  }
  const ordered: Array<{ line: typeof lines[number]; isBomChild: boolean }> = [];
  for (const p of parents) {
    ordered.push({ line: p, isBomChild: false });
    const kids = childrenByParent.get(p.id) ?? [];
    kids.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    for (const k of kids) ordered.push({ line: k, isBomChild: true });
  }
  // Append any orphan children (parent on another ticket / deleted)
  for (const l of lines) {
    if (l.parentLineId && !parents.find((p) => p.id === l.parentLineId)) {
      if (!ordered.find((o) => o.line.id === l.id)) {
        ordered.push({ line: l, isBomChild: true });
      }
    }
  }

  const rows = ordered.map(({ line, isBomChild }, i) => {
    const qty = Number(line.qty);
    const costUnit =
      line.expectedCostUnit != null ? Number(line.expectedCostUnit) : null;
    const costTotal =
      line.expectedCostTotal != null ? Number(line.expectedCostTotal) : null;
    const saleUnit =
      line.actualSaleUnit != null
        ? Number(line.actualSaleUnit)
        : line.suggestedSaleUnit != null
        ? Number(line.suggestedSaleUnit)
        : null;
    const saleTotal =
      line.actualSaleTotal != null
        ? Number(line.actualSaleTotal)
        : saleUnit != null
        ? +(saleUnit * qty).toFixed(2)
        : null;
    const margin =
      saleTotal != null && costTotal != null
        ? +(saleTotal - costTotal).toFixed(2)
        : null;
    const marginPct =
      saleTotal != null && saleTotal > 0 && margin != null
        ? +((margin / saleTotal) * 100).toFixed(2)
        : null;
    return {
      "#": i + 1,
      "BOM": isBomChild
        ? "Component"
        : line.isBomParent
        ? "BOM Parent"
        : "",
      "Section": line.sectionLabel ?? "",
      "Product Code": line.productCode ?? "",
      "Description": (isBomChild ? "↳ " : "") + line.description,
      "Supplier": line.supplier?.name ?? line.supplierName ?? "",
      "Qty": qty,
      "Unit": line.unit,
      "Cost / Unit": isBomChild ? null : costUnit,
      "Cost Total": isBomChild ? null : costTotal,
      "Sale / Unit": isBomChild ? null : saleUnit,
      "Sale Total": isBomChild ? null : saleTotal,
      "Margin": isBomChild ? null : margin,
      "Margin %": isBomChild ? null : marginPct,
      "From Stock": line.fromStock ?? 0,
      "To Order": line.toOrder ?? 0,
      "Status": line.status,
    };
  });

  const totals = {
    "#": "",
    "BOM": "",
    "Section": "",
    "Product Code": "",
    "Description": "TOTALS",
    "Supplier": "",
    "Qty": "",
    "Unit": "",
    "Cost / Unit": "",
    "Cost Total": rows.reduce((s, r) => s + (Number(r["Cost Total"]) || 0), 0),
    "Sale / Unit": "",
    "Sale Total": rows.reduce((s, r) => s + (Number(r["Sale Total"]) || 0), 0),
    "Margin": rows.reduce((s, r) => s + (Number(r["Margin"]) || 0), 0),
    "Margin %": "",
    "From Stock": "",
    "To Order": "",
    "Status": "",
  };

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet([...rows, totals]);
  ws["!cols"] = [
    { wch: 4 },
    { wch: 11 },
    { wch: 18 },
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
    ["Mode", ticket.ticketMode],
    ["Lines", lines.length.toString()],
    ["BOM Parents", lines.filter((l) => l.isBomParent).length.toString()],
    ["BOM Children", lines.filter((l) => l.parentLineId !== null).length.toString()],
    ["Exported At", new Date().toISOString()],
  ]);
  meta["!cols"] = [{ wch: 16 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(wb, meta, "Meta");

  const out = customOut ?? `/tmp/${slug(ticket.title)}-ticket-lines.xlsx`;
  XLSX.writeFile(wb, out);
  console.log(`Wrote ${out}: ${lines.length} lines (${ordered.length} ordered)`);
  console.log(`  Title: ${ticket.title}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
