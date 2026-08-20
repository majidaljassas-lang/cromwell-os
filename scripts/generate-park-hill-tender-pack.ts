import { PrismaClient, Prisma } from "../src/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import puppeteer from "puppeteer";
import fs from "fs";

const TICKET_ID = "914d46fb-7884-4a8b-82e0-afb4622af2ee";
const MARGIN = 0.175;
const OUT = "/tmp/26-park-hill-tender-pack-client.pdf";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

function gbp(n: number | null | undefined): string {
  if (n == null) return "—";
  return `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

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

  // Apply margin to priced lines: suggestedSaleUnit = cost / (1 - margin)
  let updated = 0;
  for (const l of lines) {
    if (l.expectedCostUnit == null) continue;
    const cost = Number(l.expectedCostUnit);
    const sellUnit = +(cost / (1 - MARGIN)).toFixed(4);
    await prisma.ticketLine.update({
      where: { id: l.id },
      data: { suggestedSaleUnit: new Prisma.Decimal(sellUnit) },
    });
    updated++;
  }
  console.log(`Updated suggestedSaleUnit on ${updated} lines.`);

  // Re-read for PDF (with fresh suggestedSaleUnit)
  const fresh = await prisma.ticketLine.findMany({
    where: { ticketId: TICKET_ID },
    orderBy: { createdAt: "asc" },
  });

  const rows = fresh.map((l, i) => {
    const qty = Number(l.qty);
    const costUnit = l.expectedCostUnit != null ? Number(l.expectedCostUnit) : null;
    const sellUnit = l.suggestedSaleUnit != null ? Number(l.suggestedSaleUnit) : null;
    const sellTotal = sellUnit != null ? +(sellUnit * qty).toFixed(2) : null;
    return {
      n: i + 1,
      code: l.productCode || "",
      desc: l.description,
      qty,
      unit: l.unit,
      costUnit,
      sellUnit,
      sellTotal,
      priced: costUnit != null,
    };
  });

  const subtotal = rows.reduce((s, r) => s + (r.sellTotal ?? 0), 0);
  const vat = +(subtotal * 0.2).toFixed(2);
  const total = +(subtotal + vat).toFixed(2);
  const pricedCount = rows.filter((r) => r.priced).length;
  const unpricedCount = rows.length - pricedCount;

  const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(ticket.title)}</title>
<style>
  @page { size: A4; margin: 18mm 14mm 18mm 14mm; }
  body { font-family: -apple-system, "Helvetica Neue", Arial, sans-serif; font-size: 9.5pt; color: #111; }
  h1 { font-size: 16pt; margin: 0 0 4pt 0; }
  .meta { display: flex; justify-content: space-between; margin-bottom: 14pt; font-size: 9pt; }
  .meta .col { line-height: 1.45; }
  .meta b { display: inline-block; min-width: 90px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 5pt 6pt; text-align: left; vertical-align: top; border-bottom: 1px solid #e5e5e5; }
  th { background: #f5f5f5; font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.3pt; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  td.code { font-family: "SF Mono", Menlo, monospace; font-size: 8.5pt; white-space: nowrap; }
  tr.bom td { color: #555; font-size: 8.8pt; }
  tr.bom td.desc { padding-left: 18pt; }
  tr.bom td.desc::before { content: "↳ "; color: #999; }
  tr.bom td.included { font-style: italic; color: #888; }
  .totals { margin-top: 12pt; width: 50%; margin-left: auto; }
  .totals td { padding: 4pt 6pt; border: none; }
  .totals tr.grand td { border-top: 1.5pt solid #111; font-weight: 700; font-size: 11pt; }
  .footer { margin-top: 14pt; font-size: 8pt; color: #555; line-height: 1.4; }
  .legend { font-size: 8.5pt; color: #666; margin-bottom: 8pt; }
  .legend .swatch { display: inline-block; width: 10px; height: 10px; background: #fff8e6; border: 1px solid #e5c98e; vertical-align: middle; margin-right: 4px; }
</style></head><body>

<h1>${escapeHtml(ticket.title)}</h1>
<div class="meta">
  <div class="col">
    <div><b>Customer:</b> ${escapeHtml(ticket.payingCustomer?.name || "—")}</div>
    <div><b>Site:</b> ${escapeHtml(ticket.site?.siteName || "26 Park Hill")}</div>
    <div><b>Ticket No:</b> #${ticket.ticketNo}</div>
  </div>
  <div class="col">
    <div><b>Date:</b> ${today}</div>
    <div><b>Lines:</b> ${rows.length} (${pricedCount} priced, ${unpricedCount} included)</div>
  </div>
</div>


<table>
  <thead>
    <tr>
      <th style="width:4%">#</th>
      <th style="width:11%">Code</th>
      <th>Description</th>
      <th class="num" style="width:7%">Qty</th>
      <th style="width:6%">Unit</th>
      <th class="num" style="width:12%">Unit Price</th>
      <th class="num" style="width:13%">Line Total</th>
    </tr>
  </thead>
  <tbody>
    ${rows.map(r => r.priced ? `
      <tr>
        <td>${r.n}</td>
        <td class="code">${escapeHtml(r.code)}</td>
        <td>${escapeHtml(r.desc)}</td>
        <td class="num">${r.qty}</td>
        <td>${r.unit}</td>
        <td class="num">${gbp(r.sellUnit)}</td>
        <td class="num">${gbp(r.sellTotal)}</td>
      </tr>` : `
      <tr class="bom">
        <td>${r.n}</td>
        <td class="code">${escapeHtml(r.code)}</td>
        <td class="desc">${escapeHtml(r.desc)}</td>
        <td class="num">${r.qty}</td>
        <td>${r.unit}</td>
        <td class="num included">Included</td>
        <td class="num included">Included</td>
      </tr>`).join("")}
  </tbody>
</table>

<table class="totals">
  <tr><td>Subtotal (priced lines, ex VAT)</td><td class="num">${gbp(subtotal)}</td></tr>
  <tr><td>VAT @ 20%</td><td class="num">${gbp(vat)}</td></tr>
  <tr class="grand"><td>Total inc VAT</td><td class="num">${gbp(total)}</td></tr>
</table>

<div class="footer">
  Cromwell Plumbing · 26 Park Hill Tender Pack (04-2026) · Generated ${today}.
  Component items shown indented with "Included" form part of the priced parent assemblies above.
</div>

</body></html>`;

  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "networkidle0" });
  await page.pdf({ path: OUT, format: "A4", printBackground: true });
  await browser.close();

  const stat = fs.statSync(OUT);
  console.log(`PDF written: ${OUT} (${(stat.size / 1024).toFixed(1)} KB)`);
  console.log(`  Lines: ${rows.length}  Priced: ${pricedCount}  TBC: ${unpricedCount}`);
  console.log(`  Subtotal ex VAT: £${subtotal.toFixed(2)}  VAT: £${vat.toFixed(2)}  Total: £${total.toFixed(2)}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
