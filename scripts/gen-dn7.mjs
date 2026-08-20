import puppeteer from "puppeteer";

// DN #7 — PO 11842 back-order release. 4 released (delivered), 2 remain on back order.
const LINES = [
  { desc: "MSTR42 - Rubber Lined Clip - 38 - 43mm (20)", del: 5, bo: 0 },
  { desc: "MSTR48 - Rubber Lined Clip - 47 - 51mm (20)", del: 5, bo: 0 },
  { desc: "Jet-Lube V2 Plus Jointing Compound - 300g", del: 1, bo: 0 },
  { desc: '15mm x 1/2" Press Fit Straight Service Valve "M" Profile PN10', del: 1, bo: 0 },
  { desc: "Pushfit Water Filter 3/4 inch to 6mm Pipe Adaptor - 17000012", del: 0, bo: 1 },
  { desc: 'John Guest Female Adapter - 1/4" Female BSP x 8mm Push Fit', del: 0, bo: 1 },
];
const N = { dn: 7, ref: "Back-order release (ref. DN #2, 29 May)", date: "12 June 2026" };
const FILE = "/Users/majidaljassas/Desktop/DeliveryNote-7_PO11842_BackorderRelease_ParkMansions.pdf";

const delivered = LINES.filter((l) => l.bo === 0).length;
const backorder = LINES.filter((l) => l.bo > 0).length;

const rows = LINES.map((l, i) => {
  const isBO = l.bo > 0;
  return `<tr${i % 2 ? ' class="alt"' : ""}>
      <td class="cb">${isBO ? "☐" : "☑"}</td>
      <td class="desc">${l.desc}</td>
      <td class="num">${l.del || "—"}</td>
      <td class="num bo">${l.bo || ""}</td>
      <td class="unit">EA</td>
      <td class="status ${isBO ? "bos" : ""}">${isBO ? "⏳ Back Order" : "✓ Delivered"}</td>
    </tr>`;
}).join("");

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: A4; margin: 14mm; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body { font-family: "Helvetica Neue", Arial, sans-serif; color: #1d1d1f; font-size: 11px; }
    .head { display: flex; justify-content: space-between; align-items: flex-start; }
    .brand .co { font-size: 21px; font-weight: 700; letter-spacing: .2px; }
    .brand .sub { color: #777; font-size: 10px; margin-top: 2px; }
    .docbox { border: 1.2px solid #2a2a2a; border-radius: 4px; padding: 8px 14px; text-align: right; min-width: 190px; }
    .docbox .t { font-size: 11px; letter-spacing: 1.5px; color: #555; font-weight: 700; }
    .docbox .no { font-size: 20px; font-weight: 700; margin-top: 1px; }
    .docbox .dt { font-size: 10px; color: #555; margin-top: 3px; }
    .rule { border: none; border-top: 1.4px solid #2a2a2a; margin: 12px 0 10px; }
    .job { font-weight: 700; font-size: 13px; }
    .meta { color: #666; font-size: 10.5px; margin-top: 2px; }
    .section { font-weight: 700; font-size: 10px; letter-spacing: 1px; color: #444; margin: 12px 0 6px; }
    table { width: 100%; border-collapse: collapse; }
    thead th { text-align: left; font-size: 9px; letter-spacing: .6px; color: #fff; background: #2a2a2a; padding: 6px 10px; }
    thead th.num, thead th.unit, thead th.cb { text-align: center; }
    thead th.bo { color: #ffb27a; }
    tbody td { padding: 6px 10px; border-bottom: 1px solid #ececec; font-size: 10.5px; }
    tbody tr.alt td { background: #fafafa; }
    td.cb { width: 24px; text-align: center; color: #2a2a2a; font-size: 12px; }
    td.num { text-align: center; width: 90px; }
    td.num.bo { color: #e8730c; font-weight: 700; }
    td.unit { text-align: center; width: 60px; color: #555; }
    td.status { width: 130px; font-weight: 700; color: #1a7f37; }
    td.status.bos { color: #e8730c; }
    .summary { margin-top: 14px; padding: 8px 12px; background: #f5f5f5; border-radius: 4px; font-size: 10.5px; display: flex; gap: 26px; }
    .summary b { font-weight: 700; }
    .sign { margin-top: 16px; display: flex; gap: 36px; }
    .sign .cell { flex: 1; border-top: 1px solid #555; padding-top: 5px; color: #777; font-size: 9.5px; letter-spacing: .4px; }
    .foot { margin-top: 12px; text-align: center; color: #999; font-size: 8.5px; }
  </style></head><body>
    <div class="head">
      <div class="brand">
        <div class="co">Cromwell Plumbing Ltd</div>
        <div class="sub">Plumbing &amp; Construction Materials</div>
      </div>
      <div class="docbox">
        <div class="t">DELIVERY NOTE</div>
        <div class="no">No. ${N.dn}</div>
        <div class="dt">${N.date}</div>
      </div>
    </div>
    <hr class="rule">
    <div class="job">003-Park Mansion-Plumbing Materials</div>
    <div class="meta">Customer PO: <b>11842</b> &nbsp;·&nbsp; ${N.ref} &nbsp;·&nbsp; Deliver to: Park Mansions, 24–26 Brompton Road, Westminster, SW1X 7QN</div>
    <div class="section">DELIVERED BY CROMWELL</div>
    <table>
      <thead><tr>
        <th class="cb"></th><th>DESCRIPTION</th><th class="num">DELIVERED</th>
        <th class="num bo">BACK ORDER</th><th class="unit">UNIT</th><th>STATUS</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="summary">
      <span><b>Delivered:</b> ${delivered}</span>
      <span><b>Partial:</b> 0</span>
      <span><b>Back Order:</b> ${backorder}</span>
      <span><b>Total Lines:</b> ${LINES.length}</span>
    </div>
    <div class="sign">
      <div class="cell">Received By (Print Name)</div>
      <div class="cell">Signature</div>
      <div class="cell">Date</div>
    </div>
    <div class="foot">Cromwell Plumbing Ltd · This delivery note confirms goods despatched against the above customer purchase order.</div>
  </body></html>`;

const browser = await puppeteer.launch({ headless: "new" });
const page = await browser.newPage();
await page.setContent(html, { waitUntil: "networkidle0" });
await page.pdf({ path: FILE, printBackground: true, preferCSSPageSize: true });
await browser.close();
console.log("WROTE", FILE);
