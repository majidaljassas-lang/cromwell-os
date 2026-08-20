/**
 * One-off: regenerate PF-2026-0022 at 50% (deposit proforma), issued today.
 * Mirrors src/app/api/quotes/[id]/generate-proforma/route.ts exactly so the
 * output is pixel-identical to the original — only the figures + dates change.
 * Does NOT touch the database.
 */
const path = require("path");
const fs = require("fs");

function getGeistFontBase64() {
  const fontPath = path.join(__dirname, "..", "node_modules/geist/dist/fonts/geist-sans/Geist-Variable.woff2");
  return fs.readFileSync(fontPath).toString("base64");
}

function fmt(val) {
  if (val == null) return "—";
  return `£${Number(val).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Rate shown to enough precision that qty*rate reconciles to the halved amount.
function rate(val) {
  const n = Number(val);
  const s = n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 3 });
  return `£${s}`;
}

// ---- Data captured from the original PF-2026-0022, every value halved ----
const proformaNumber = "PF-2026-0022";
const quoteRef = "Q-1780294974841 v1";
const issuedStr = "22 June 2026";   // today
const validStr = "22 July 2026";    // same 1-month window
const siteName = "Haymarket";
const customerPoNo = "11799";

const billTo = {
  name: "WEST END (LONDON) PROPERTY LTD",
  address: [
    "C/O Zedwell Hotel Great Windmill Street",
    "London Trocadero",
    "London",
    "W1D 7DH",
    "United Kingdom",
  ],
  companyNumber: "14220127",
};

// Standalone proforma for HALF the order, whole units: full unit rates, qty
// rounded to 243 EA (half of 485, rounded up). Amounts computed = qty * rate.
const QTY = 243;
const lines = [
  { desc: "PRO110DNT CW PRO110DNT MPro Basin Monobloc Slate", qty: QTY, rate: 48.68 },
  { desc: "CW PRO200T MPro Mpr0 200mm Fixed Head Slate",       qty: QTY, rate: 38.95 },
  { desc: "CW FH620T Fixed Heads Ceiling Shower Arm 200mm Slate", qty: QTY, rate: 14.61 },
  { desc: "CW TS963ST 3ONE6 Design Shower Handset Hose and Wall Outlet Stainless Slate", qty: QTY, rate: 38.96 },
  { desc: "MPROSPLATET MPRO Stainless Steel Flush Plate Slate with Zedwell Logo", qty: QTY, rate: 43.82 },
  { desc: "Basin Waste - Slate", qty: QTY, rate: 18.63 },
].map((l) => ({ ...l, amount: Math.round(l.qty * l.rate * 100) / 100 }));

const subTotal = lines.reduce((s, l) => s + l.amount, 0);
const vatAmount = Math.round(subTotal * 0.2 * 100) / 100;
const grandTotal = subTotal + vatAmount;

function buildHtml(fontBase64) {
  const lineRows = lines.map((line, i) => `<tr style="border-bottom:1px solid #eee;">
      <td style="padding:8px 10px;color:#888;font-size:12px;width:35px">${i + 1}</td>
      <td style="padding:8px 10px;font-size:12px">${line.desc}</td>
      <td style="padding:8px 10px;text-align:center;font-size:12px;white-space:nowrap">${line.qty} EA</td>
      <td style="padding:8px 10px;text-align:right;font-size:12px;font-variant-numeric:tabular-nums">${rate(line.rate)}</td>
      <td style="padding:8px 10px;text-align:right;font-size:12px;font-variant-numeric:tabular-nums;font-weight:700">${fmt(line.amount)}</td>
    </tr>`).join("");

  const addrHtml = billTo.address.map((l) => `<div style="font-size:11px;color:#444;margin-top:1px">${l}</div>`).join("");

  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<style>
  @font-face {
    font-family: 'Geist';
    src: url(data:font/woff2;base64,${fontBase64}) format('woff2');
    font-weight: 100 900;
    font-style: normal;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Geist', -apple-system, 'Helvetica Neue', Arial, sans-serif; color: #111; padding: 40px 50px 30px; font-size: 12px; line-height: 1.4; }
  table { width: 100%; border-collapse: collapse; }
</style>
</head><body>

<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px">
  <div>
    <div style="font-size:20px;font-weight:800;letter-spacing:-0.02em">Cromwell Plumbing Ltd</div>
    <div style="font-size:10px;color:#555;margin-top:4px">Company ID: 10611686 | VAT: 262 6274 02</div>
    <div style="font-size:10px;color:#555">423 Harrow Road, Westminster, London W10 4RE</div>
  </div>
  <div style="text-align:right">
    <div style="font-size:32px;font-weight:300;font-style:italic;color:#111">Pro-Forma Invoice</div>
    <div style="font-size:11px;color:#555;margin-top:2px"># ${proformaNumber}</div>
    <div style="font-size:9px;color:#999;margin-top:1px">From quote ${quoteRef}</div>
  </div>
</div>

<hr style="border:none;border-top:1px solid #ddd;margin:0" />

<div style="display:flex;justify-content:space-between;padding:16px 0 20px">
  <div>
    <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.12em;color:#999;margin-bottom:4px">Bill To</div>
    <div style="font-size:14px;font-weight:700">${billTo.name}</div>
    ${addrHtml}
    <div style="font-size:10px;color:#777;margin-top:3px">Company No: ${billTo.companyNumber}</div>
  </div>
  <div style="text-align:right;font-size:11px;line-height:1.8">
    <div><span style="color:#888">Issued:</span> ${issuedStr}</div>
    <div><span style="color:#888">Valid Until:</span> <strong>${validStr}</strong></div>
    <div><span style="color:#888">Terms:</span> Pro-Forma (paid before delivery)</div>
    <div><span style="color:#888">Site:</span> ${siteName}</div>
    <div><span style="color:#888">Customer PO:</span> <strong>${customerPoNo}</strong></div>
  </div>
</div>

<table>
  <thead>
    <tr style="background:#222;color:#fff">
      <th style="padding:8px 10px;font-size:9px;text-transform:uppercase;letter-spacing:0.1em;font-weight:600;width:35px;text-align:left">#</th>
      <th style="padding:8px 10px;font-size:9px;text-transform:uppercase;letter-spacing:0.1em;font-weight:600;text-align:left">Description</th>
      <th style="padding:8px 10px;font-size:9px;text-transform:uppercase;letter-spacing:0.1em;font-weight:600;text-align:center">Qty</th>
      <th style="padding:8px 10px;font-size:9px;text-transform:uppercase;letter-spacing:0.1em;font-weight:600;text-align:right">Rate</th>
      <th style="padding:8px 10px;font-size:9px;text-transform:uppercase;letter-spacing:0.1em;font-weight:600;text-align:right">Amount</th>
    </tr>
  </thead>
  <tbody>${lineRows}</tbody>
</table>

<div style="display:flex;justify-content:flex-end;margin-top:20px">
  <div style="width:260px">
    <div style="display:flex;justify-content:space-between;padding:6px 0">
      <span style="font-size:11px;color:#555">Sub Total</span>
      <span style="font-size:11px;font-variant-numeric:tabular-nums">${fmt(subTotal)}</span>
    </div>
    <div style="display:flex;justify-content:space-between;padding:6px 0">
      <span style="font-size:11px;color:#555">VAT (20%)</span>
      <span style="font-size:11px;font-variant-numeric:tabular-nums">${fmt(vatAmount)}</span>
    </div>
    <div style="display:flex;justify-content:space-between;padding:8px 0;border-top:1px solid #ddd;margin-top:2px">
      <span style="font-weight:700;font-size:13px">Total</span>
      <span style="font-weight:700;font-size:13px;font-variant-numeric:tabular-nums">${fmt(grandTotal)}</span>
    </div>
    <div style="display:flex;justify-content:space-between;padding:8px 10px;background:#222;color:#fff;margin-top:6px">
      <span style="font-weight:700;font-size:12px">Amount to Pay</span>
      <span style="font-weight:700;font-size:12px;font-variant-numeric:tabular-nums">${fmt(grandTotal)}</span>
    </div>
  </div>
</div>

<div style="border-top:1px solid #ddd;padding-top:16px;margin-top:30px;font-size:10px;color:#555;line-height:1.7">
  <div><strong style="color:#333">Payment Details:</strong> Cromwell Plumbing Ltd | Barclays Bank PLC | Sort Code: 20-45-45 | Account: 93602001</div>
  <div>Please use <strong style="color:#111">${proformaNumber}</strong> as your payment reference.</div>
</div>

<div style="border:1px solid #ddd;padding:10px 14px;margin-top:16px;font-size:9px;color:#666;line-height:1.5;background:#fafafa">
  <strong style="color:#111">This is a Pro-Forma Invoice — not a tax invoice.</strong>
  No VAT may be reclaimed against this document. A formal VAT invoice will be issued
  on receipt of payment and / or delivery of goods. Prices and availability are valid
  until the date shown above.
</div>

</body></html>`;
}

(async () => {
  const puppeteer = require("puppeteer");
  const html = buildHtml(getGeistFontBase64());
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "networkidle0" });
  await page.evaluate(() => document.fonts.ready);
  const outPath = "/Users/majidaljassas/Desktop/Cromwell-Proforma-PF-2026-0022-50pc.pdf";
  await page.pdf({
    path: outPath,
    format: "A4",
    margin: { top: "20mm", bottom: "20mm", left: "15mm", right: "15mm" },
    printBackground: true,
  });
  await browser.close();
  console.log("Sub Total :", fmt(subTotal));
  console.log("VAT (20%) :", fmt(vatAmount));
  console.log("Total     :", fmt(grandTotal));
  console.log("Written   :", outPath);
})();
