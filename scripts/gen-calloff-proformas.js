/**
 * Generate pro-forma PDFs from recorded call-offs against group PO 11785.
 * Fully data-driven: every figure comes from the CallOff/CallOffLine rows and
 * the bill-to Customer. Renders with the same template as the OS proforma route.
 *   CO #13 -> PF-2026-0030 (Haymarket / West End)
 *   CO #14 -> PF-2026-0031 (Park Lane / Criterion Developments)
 */
require("dotenv").config({ path: __dirname + "/../.env" });
const path = require("path");
const fs = require("fs");
const { PrismaClient } = require("../src/generated/prisma");
const { PrismaPg } = require("@prisma/adapter-pg");
const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const p = new PrismaClient({ adapter: new PrismaPg(pool) });

const fontBase64 = fs.readFileSync(path.join(__dirname, "..", "node_modules/geist/dist/fonts/geist-sans/Geist-Variable.woff2")).toString("base64");
const fmt = (v) => `£${Number(v).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dateStr = (d) => d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

function buildHtml({ proformaNumber, sourceRef, billTo, site, customerPoNo, issued, validUntil, lines }) {
  const subTotal = lines.reduce((s, l) => s + Math.round(l.qty * l.rate * 100) / 100, 0);
  const vat = Math.round(subTotal * 0.2 * 100) / 100;
  const grand = subTotal + vat;
  const addr = (billTo.billingAddress || "").split(/\r?\n/).map((x) => x.trim()).filter(Boolean)
    .map((x) => `<div style="font-size:11px;color:#444;margin-top:1px">${x}</div>`).join("");
  const rows = lines.map((l, i) => {
    const amt = Math.round(l.qty * l.rate * 100) / 100;
    return `<tr style="border-bottom:1px solid #eee;">
      <td style="padding:8px 10px;color:#888;font-size:12px;width:35px">${i + 1}</td>
      <td style="padding:8px 10px;font-size:12px">${l.desc}</td>
      <td style="padding:8px 10px;text-align:center;font-size:12px;white-space:nowrap">${l.qty} EA</td>
      <td style="padding:8px 10px;text-align:right;font-size:12px;font-variant-numeric:tabular-nums">${fmt(l.rate)}</td>
      <td style="padding:8px 10px;text-align:right;font-size:12px;font-variant-numeric:tabular-nums;font-weight:700">${fmt(amt)}</td>
    </tr>`;
  }).join("");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  @font-face{font-family:'Geist';src:url(data:font/woff2;base64,${fontBase64}) format('woff2');font-weight:100 900;font-style:normal;}
  *{margin:0;padding:0;box-sizing:border-box;}
  body{font-family:'Geist',-apple-system,'Helvetica Neue',Arial,sans-serif;color:#111;padding:40px 50px 30px;font-size:12px;line-height:1.4;}
  table{width:100%;border-collapse:collapse;}
  </style></head><body>
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px">
    <div>
      <div style="font-size:20px;font-weight:800;letter-spacing:-0.02em">Cromwell Plumbing Ltd</div>
      <div style="font-size:10px;color:#555;margin-top:4px">Company ID: 10611686 | VAT: 262 6274 02</div>
      <div style="font-size:10px;color:#555">423 Harrow Road, Westminster, London W10 4RE</div>
    </div>
    <div style="text-align:right">
      <div style="font-size:32px;font-weight:300;font-style:italic;color:#111">Pro-Forma Invoice</div>
      <div style="font-size:11px;color:#555;margin-top:2px"># ${proformaNumber}</div>
      <div style="font-size:9px;color:#999;margin-top:1px">${sourceRef}</div>
    </div>
  </div>
  <hr style="border:none;border-top:1px solid #ddd;margin:0" />
  <div style="display:flex;justify-content:space-between;padding:16px 0 20px">
    <div>
      <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.12em;color:#999;margin-bottom:4px">Bill To</div>
      <div style="font-size:14px;font-weight:700">${billTo.name}</div>
      ${addr}
      ${billTo.companyNumber ? `<div style="font-size:10px;color:#777;margin-top:3px">Company No: ${billTo.companyNumber}</div>` : ""}
    </div>
    <div style="text-align:right;font-size:11px;line-height:1.8">
      <div><span style="color:#888">Issued:</span> ${dateStr(issued)}</div>
      <div><span style="color:#888">Valid Until:</span> <strong>${dateStr(validUntil)}</strong></div>
      <div><span style="color:#888">Terms:</span> Pro-Forma (paid before delivery)</div>
      <div><span style="color:#888">Site:</span> ${site}</div>
      <div><span style="color:#888">Customer PO:</span> <strong>${customerPoNo}</strong></div>
    </div>
  </div>
  <table><thead><tr style="background:#222;color:#fff">
    <th style="padding:8px 10px;font-size:9px;text-transform:uppercase;letter-spacing:0.1em;font-weight:600;width:35px;text-align:left">#</th>
    <th style="padding:8px 10px;font-size:9px;text-transform:uppercase;letter-spacing:0.1em;font-weight:600;text-align:left">Description</th>
    <th style="padding:8px 10px;font-size:9px;text-transform:uppercase;letter-spacing:0.1em;font-weight:600;text-align:center">Qty</th>
    <th style="padding:8px 10px;font-size:9px;text-transform:uppercase;letter-spacing:0.1em;font-weight:600;text-align:right">Rate</th>
    <th style="padding:8px 10px;font-size:9px;text-transform:uppercase;letter-spacing:0.1em;font-weight:600;text-align:right">Amount</th>
  </tr></thead><tbody>${rows}</tbody></table>
  <div style="display:flex;justify-content:flex-end;margin-top:20px"><div style="width:260px">
    <div style="display:flex;justify-content:space-between;padding:6px 0"><span style="font-size:11px;color:#555">Sub Total</span><span style="font-size:11px;font-variant-numeric:tabular-nums">${fmt(subTotal)}</span></div>
    <div style="display:flex;justify-content:space-between;padding:6px 0"><span style="font-size:11px;color:#555">VAT (20%)</span><span style="font-size:11px;font-variant-numeric:tabular-nums">${fmt(vat)}</span></div>
    <div style="display:flex;justify-content:space-between;padding:8px 0;border-top:1px solid #ddd;margin-top:2px"><span style="font-weight:700;font-size:13px">Total</span><span style="font-weight:700;font-size:13px;font-variant-numeric:tabular-nums">${fmt(grand)}</span></div>
    <div style="display:flex;justify-content:space-between;padding:8px 10px;background:#222;color:#fff;margin-top:6px"><span style="font-weight:700;font-size:12px">Amount to Pay</span><span style="font-weight:700;font-size:12px;font-variant-numeric:tabular-nums">${fmt(grand)}</span></div>
  </div></div>
  <div style="border-top:1px solid #ddd;padding-top:16px;margin-top:30px;font-size:10px;color:#555;line-height:1.7">
    <div><strong style="color:#333">Payment Details:</strong> Cromwell Plumbing Ltd | Barclays Bank PLC | Sort Code: 20-45-45 | Account: 93602001</div>
    <div>Please use <strong style="color:#111">${proformaNumber}</strong> as your payment reference.</div>
  </div>
  <div style="border:1px solid #ddd;padding:10px 14px;margin-top:16px;font-size:9px;color:#666;line-height:1.5;background:#fafafa">
    <strong style="color:#111">This is a Pro-Forma Invoice — not a tax invoice.</strong>
    No VAT may be reclaimed against this document. A formal VAT invoice will be issued on receipt of payment and / or delivery of goods. Prices and availability are valid until the date shown above.
  </div>
  </body></html>`;
}

(async () => {
  const puppeteer = require("puppeteer");
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  const issued = new Date();
  const validUntil = new Date(issued); validUntil.setMonth(validUntil.getMonth() + 1);

  const jobs = [
    { no: 13, pf: "PF-2026-0030", file: "Cromwell-Proforma-PF-2026-0030-Haymarket-WestEnd.pdf" },
    { no: 14, pf: "PF-2026-0031", file: "Cromwell-Proforma-PF-2026-0031-ParkLane-CriterionDevelopments.pdf" },
  ];
  for (const j of jobs) {
    const co = await p.callOff.findFirst({ where: { callOffNo: j.no }, include: { lines: { orderBy: { displayOrder: "asc" } } } });
    const bt = await p.customer.findUnique({ where: { id: co.billToCustomerId } });
    const st = await p.site.findUnique({ where: { id: co.siteId }, select: { siteName: true } });
    const html = buildHtml({
      proformaNumber: j.pf,
      sourceRef: `From PO 11785 · Call-off #${co.callOffNo}`,
      billTo: { name: bt.legalName || bt.name, companyNumber: bt.companyNumber, billingAddress: bt.billingAddress },
      site: st.siteName.trim(),
      customerPoNo: "11785",
      issued, validUntil,
      lines: co.lines.map((l) => ({ desc: l.description, qty: Number(l.requestedQty), rate: Number(l.agreedUnitPrice) })),
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    await page.evaluate(() => document.fonts.ready);
    const out = path.join("/Users/majidaljassas/Desktop", j.file);
    await page.pdf({ path: out, format: "A4", margin: { top: "20mm", bottom: "20mm", left: "15mm", right: "15mm" }, printBackground: true });
    await page.close();
    const sub = co.lines.reduce((s, l) => s + Math.round(Number(l.requestedQty) * Number(l.agreedUnitPrice) * 100) / 100, 0);
    console.log(`${j.pf} -> ${bt.legalName || bt.name} @ ${st.siteName.trim()} | net ${fmt(sub)} | gross ${fmt(sub * 1.2)} -> ${out}`);
  }
  await browser.close();
  await pool.end();
})().catch(async (e) => { console.log("ERR:", e.message); try { await pool.end(); } catch {} process.exit(1); });
