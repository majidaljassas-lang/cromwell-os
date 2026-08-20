import puppeteer from "puppeteer";

const ADAPTORS = new Set([
  "767910ea-223c-4f97-830c-39540bc2a5cb",
  "19ab9b21-e511-4e4a-9c8c-2e3cf834e6d4",
]);
const LINES = [
  ["e3035af0-0f59-4347-a6b4-41f4290cbb2c", "MSTR15 - Rubber Lined Clip - 14 - 19mm (20)", 100, 25],
  ["23fbdae8-04bf-464a-be71-b3ed6fd2e4b1", "MSTR22 - Rubber Lined Clip - 20 - 25mm (20)", 80, 20],
  ["ec9c09fd-ef71-4a20-8754-116978e7bdcc", "MSTR28 - Rubber Lined Clip - 26 - 30mm (20)", 20, 5],
  ["b8e5d582-eddf-4728-9247-15de602aef64", "MSTR42 - Rubber Lined Clip - 38 - 43mm (20)", 18, 5],
  ["ad1c8ed0-3d0c-4387-8f96-bc5ead0dd5f3", "MSTR48 - Rubber Lined Clip - 47 - 51mm (20)", 20, 5],
  ["77952446-4f17-494b-90b5-aa2966895949", "MSTR110 - Rubber Lined Clips - 107-112mm", 40, 10],
  ["a0fe8b46-f57a-455f-93cd-d2b30f1d02c5", "SC250 - FloPlast - Solvent Cement Glue - 250ml", 3, 1],
  ["e9641e99-c94c-4a4d-a4f8-b47ea1e64728", "40mm x 92.5 Degree Mupvc Swept Tee White", 40, 10],
  ["6a06b390-d0e8-4c89-9e82-ae9c85068e7b", "TS15 - Talon - Hinged Pipe Clips - 15mm - 100 Pack", 2, 1],
  ["843de9a3-5822-4d35-84c9-fd1c258a3343", "TS22 - Talon - Hinged Pipe Clips - 22mm - 100 Pack", 2, 1],
  ["95c0e354-6b29-4864-81b8-ace54755b991", "TS28 - Talon - Hinged Pipe Clips - 28mm - 50 Pack", 2, 1],
  ["5b41d486-cc55-4737-acfa-d1cdf3e42e75", "TSP1 - Talon Spacers for Talon Pipe Clips - 100 Pack", 2, 1],
  ["c8b271e6-6cc3-43eb-90e8-410c7f031ed8", "FE15 15mm FloFit+ Stopend", 80, 20],
  ["81a4821a-23d7-489c-bc94-c07ba59bee48", "Jet-Lube V2 Plus Jointing Compound - 300g", 2, 1],
  ["915cd3ea-0ea3-4654-83d7-30c349d01719", "Loctite 55 Pipe Sealing Cord 160mtr Pack 2959421", 2, 1],
  ["dc325e2e-4abe-44a5-a12e-1b36b326cf19", "15mm EXTENDED TAIL DRAIN OFF COCK TYPE A HEAVY PATTERN", 40, 10],
  ["2c9f5f7b-93a3-4cf3-b8d2-0a674d6d3b1e", '1" LEVER BALL VALVE BLUE', 4, 1],
  ["900da41c-0655-4f9c-af7b-5fc582f5c26d", "Universal Silicone Sealant - White - 280ml", 12, 3],
  ["8397f9d4-8eb0-46cb-b2a0-3aad1eb09ac8", '15mm x 1/2" Press Fit Straight Service Valve "M" Profile PN10', 5, 1],
  ["19d11eb1-c312-45fa-902b-77e9b5ec98bd", "TUN5-CL McAlpine Tunvalve Straight Through (Clear)", 4, 1],
  ["750930d7-fd24-49ad-b8b0-3390b914ebcb", "MACTUN-1 Tundish with self closing valve 15mm inlet x 22mm outlet", 4, 1],
  ["1dc937cb-56fd-4be8-8341-f62912544167", "FE22 22mm FloFit+ Stopend", 24, 6],
  ["b7fa858b-aa99-4ab3-a147-51e476267951", 'ASA10 - McAlpine - Adjustable P Trap - 1.25"', 8, 2],
  ["e01e1ae2-2d9d-4b3e-a8af-8313f0ae4ab8", 'SM10 McAlpine 1.5" Bath Trap No Overflow', 8, 2],
  ["c9703a63-c008-44cc-bc89-2bde7477b438", 'WM3 McAlpine 1.5" Washing Machine Standpipe Trap', 8, 2],
  ["bc539ecf-aced-4ba7-a02a-ac983dd9df75", 'MAC-1 McAlpine 4" Straight Pan Connector', 4, 1],
  ["969af282-06c3-4920-b022-a6b9816f85d1", 'MAC-4 McAlpine 4" 20mm Offset Pan Connector', 4, 1],
  ["3f31972b-b1df-4421-a57e-e635dbcad6c1", '1/2" CU Brass Double Check Valve - Female', 12, 3],
  ["fc3c1b52-8874-4320-ac09-efda059e394f", "Straight Washing Machine Valve L/P Comp WRAS", 12, 3],
  ["767910ea-223c-4f97-830c-39540bc2a5cb", "Pushfit Water Filter 3/4 inch to 6mm Pipe Adaptor - 17000012", 4, 1],
  ["19ab9b21-e511-4e4a-9c8c-2e3cf834e6d4", 'John Guest Female Adapter - 1/4" Female BSP x 8mm Push Fit', 4, 1],
];
const split = (o, q1) => { const r = o - q1, b = Math.floor(r / 3), m = r % 3; return [b + (m >= 1 ? 1 : 0), b + (m >= 2 ? 1 : 0), b]; };

const NOTES = [
  { idx: 0, dn: 8, of4: 2, date: "12 June 2026", file: "/Users/majidaljassas/Desktop/DeliveryNote_PO11842_CallOff2_ParkMansions.pdf" },
  { idx: 1, dn: 9, of4: 3, date: "12 June 2026", file: "/Users/majidaljassas/Desktop/DeliveryNote_PO11842_CallOff3_ParkMansions.pdf" },
  { idx: 2, dn: 10, of4: 4, date: "15 June 2026", file: "/Users/majidaljassas/Desktop/DeliveryNote_PO11842_CallOff4_ParkMansions.pdf" },
];

function html(dnNo, of4, date, rows) {
  const delivered = rows.filter((x) => !x.bo).length, backorder = rows.filter((x) => x.bo).length;
  const body = rows.map((x, i) => `<tr${i % 2 ? ' class="alt"' : ""}><td class="cb">${x.bo ? "☐" : "☑"}</td><td>${x.desc}</td><td class="num">${x.bo ? "—" : x.qty}</td><td class="num bo">${x.bo ? x.qty : ""}</td><td class="unit">EA</td><td class="status ${x.bo ? "bos" : ""}">${x.bo ? "⏳ Back Order" : "✓ Delivered"}</td></tr>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: A4; margin: 13mm; } * { box-sizing: border-box; } html,body{margin:0;padding:0;}
    body { font-family: "Helvetica Neue", Arial, sans-serif; color: #1d1d1f; font-size: 10px; }
    .head { display:flex; justify-content:space-between; align-items:flex-start; }
    .brand .co { font-size:20px; font-weight:700; } .brand .sub { color:#777; font-size:9.5px; margin-top:2px; }
    .docbox { border:1.2px solid #2a2a2a; border-radius:4px; padding:7px 13px; text-align:right; min-width:185px; }
    .docbox .t { font-size:10.5px; letter-spacing:1.5px; color:#555; font-weight:700; } .docbox .no { font-size:19px; font-weight:700; } .docbox .dt { font-size:9.5px; color:#555; margin-top:3px; }
    .rule { border:none; border-top:1.4px solid #2a2a2a; margin:10px 0 8px; }
    .job { font-weight:700; font-size:12.5px; } .meta { color:#666; font-size:10px; margin-top:2px; }
    .section { font-weight:700; font-size:9.5px; letter-spacing:1px; color:#444; margin:10px 0 5px; }
    table { width:100%; border-collapse:collapse; }
    thead th { text-align:left; font-size:8.5px; letter-spacing:.5px; color:#fff; background:#2a2a2a; padding:5px 10px; }
    thead th.num, thead th.unit, thead th.cb { text-align:center; } thead th.bo { color:#ffb27a; }
    tbody td { padding:3px 10px; border-bottom:1px solid #ededed; font-size:10px; }
    tbody tr.alt td { background:#fafafa; }
    td.cb { width:22px; text-align:center; color:#2a2a2a; font-size:11px; }
    td.num { text-align:center; width:88px; } td.num.bo { color:#e8730c; font-weight:700; }
    td.unit { text-align:center; width:56px; color:#555; }
    td.status { width:124px; font-weight:700; color:#1a7f37; } td.status.bos { color:#e8730c; }
    .summary { margin-top:11px; padding:7px 12px; background:#f5f5f5; border-radius:4px; font-size:10px; display:flex; gap:24px; }
    .sign { margin-top:14px; display:flex; gap:34px; } .sign .cell { flex:1; border-top:1px solid #555; padding-top:5px; color:#777; font-size:9px; }
    .foot { margin-top:10px; text-align:center; color:#999; font-size:8px; }
  </style></head><body>
    <div class="head"><div class="brand"><div class="co">Cromwell Plumbing Ltd</div><div class="sub">Plumbing &amp; Construction Materials</div></div>
    <div class="docbox"><div class="t">DELIVERY NOTE</div><div class="no">No. ${dnNo}</div><div class="dt">${date}</div></div></div>
    <hr class="rule">
    <div class="job">003-Park Mansion-Plumbing Materials</div>
    <div class="meta">Customer PO: <b>11842</b> &nbsp;·&nbsp; Call-off ${of4} of 4 &nbsp;·&nbsp; Deliver to: Park Mansions, 24–26 Brompton Road, Westminster, SW1X 7QN</div>
    <div class="section">DELIVERED BY CROMWELL</div>
    <table><thead><tr><th class="cb"></th><th>DESCRIPTION</th><th class="num">DELIVERED</th><th class="num bo">BACK ORDER</th><th class="unit">UNIT</th><th>STATUS</th></tr></thead><tbody>${body}</tbody></table>
    <div class="summary"><span><b>Delivered:</b> ${delivered}</span><span><b>Partial:</b> 0</span><span><b>Back Order:</b> ${backorder}</span><span><b>Total Lines:</b> ${rows.length}</span></div>
    <div class="sign"><div class="cell">Received By (Print Name)</div><div class="cell">Signature</div><div class="cell">Date</div></div>
    <div class="foot">Cromwell Plumbing Ltd · This delivery note confirms goods despatched against the above customer purchase order.</div>
  </body></html>`;
}

const browser = await puppeteer.launch({ headless: "new" });
for (const n of NOTES) {
  const rows = [];
  for (const [tl, desc, o, q1] of LINES) {
    const qty = split(o, q1)[n.idx];
    if (qty <= 0) continue;
    rows.push({ desc, qty, bo: ADAPTORS.has(tl) });
  }
  const page = await browser.newPage();
  await page.setContent(html(n.dn, n.of4, n.date, rows), { waitUntil: "networkidle0" });
  await page.pdf({ path: n.file, printBackground: true, preferCSSPageSize: true });
  await page.close();
  console.log("WROTE DN#" + n.dn, "(" + rows.length + " lines)", "->", n.file);
}
await browser.close();
