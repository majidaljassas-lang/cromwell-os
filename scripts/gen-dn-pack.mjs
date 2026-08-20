import puppeteer from "puppeteer";

const QUARTER = [
  ["M10 Hex Nuts BZP", 40],
  ["Pressfit Coupler - 15mm", 20],
  ["Pressfit Coupler - 22mm", 10],
  ["Pressfit Coupler - 28mm", 3],
  ['Pressfit Female Iron Coupler - 15mm x 1/2"', 15],
  ['Pressfit Male Iron Coupler - 15mm x 1/2"', 16],
  ['Pressfit Male Iron Coupler - 22mm x 3/4"', 12],
  ['Pressfit Male Iron Coupler - 28mm x 1"', 3],
  ["Pressfit Fitting Reducer - 22mm x 15mm", 6],
  ["Pressfit Fitting Reducer - 28mm x 22mm", 6],
  ["Pressfit 90 Deg. Bend - 15mm", 30],
  ["Pressfit 90 Deg. Bend - 22mm", 25],
  ["Pressfit 90 Deg. Bend - 28mm", 6],
  ["15MM 90 STREET ELBOW", 10],
  ["22MM 90 STREET ELBOW", 5],
  ["28MM 90 STREET ELBOW", 2],
  ["Pressfit 45 Deg. Bend - 15mm", 10],
  ["Pressfit 90 Deg. Bend - 22mm", 5],
  ["Pressfit 45 Deg. Bend - 28mm", 2],
  ["Pressfit 45 Deg. Street Bend - 15mm", 10],
  ["Pressfit 45 Deg. Street Bend - 22mm", 6],
  ["Pressfit 45 Deg. Street Bend - 28mm", 4],
  ["Pressfit Equal Tee - 15mm", 6],
  ["Pressfit Equal Tee - 22mm", 3],
  ['22X3/4" STRT UNION CONN M', 2],
  ['Press Fit 28mm x 1" C x MI Union Coupler', 2],
  ['Press Fit 22mm x 3/4" Straight Tap Connector', 2],
];
// DN #3 = back-order release: only the 3 union/tap connectors, all delivered.
const BACKORDER_RELEASE = [
  ['22X3/4" STRT UNION CONN M', 2],
  ['Press Fit 28mm x 1" C x MI Union Coupler', 2],
  ['Press Fit 22mm x 3/4" Straight Tap Connector', 2],
];

const NOTES = [
  { dn: 3, ref: "Call-off #1 — back-order release", date: "12 June 2026", lines: BACKORDER_RELEASE, file: "/Users/majidaljassas/Desktop/DeliveryNote-3_PO11838_ParkMansions.pdf" },
  { dn: 4, ref: "Call-off #2 of 4", date: "12 June 2026", lines: QUARTER, file: "/Users/majidaljassas/Desktop/DeliveryNote-4_PO11838_CallOff2_ParkMansions.pdf" },
  { dn: 5, ref: "Call-off #3 of 4", date: "12 June 2026", lines: QUARTER, file: "/Users/majidaljassas/Desktop/DeliveryNote-5_PO11838_CallOff3_ParkMansions.pdf" },
  { dn: 6, ref: "Call-off #4 of 4", date: "15 June 2026", lines: QUARTER, file: "/Users/majidaljassas/Desktop/DeliveryNote-6_PO11838_CallOff4_ParkMansions.pdf" },
];

function buildHtml(n) {
  const total = n.lines.length;
  const rows = n.lines
    .map(([desc, qty], i) => `<tr${i % 2 ? ' class="alt"' : ""}>
        <td class="cb">☑</td>
        <td class="desc">${desc}</td>
        <td class="num">${qty}</td>
        <td class="num bo"></td>
        <td class="unit">EA</td>
        <td class="status">✓ Delivered</td>
      </tr>`)
    .join("");

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: A4; margin: 14mm; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body { font-family: "Helvetica Neue", Arial, sans-serif; color: #1d1d1f; font-size: 11px; }
    .frame { padding: 0; }
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
    thead th { text-align: left; font-size: 9px; letter-spacing: .6px; color: #fff; background: #2a2a2a;
               padding: 6px 10px; }
    thead th.num, thead th.unit, thead th.cb { text-align: center; }
    thead th.bo { color: #ffb27a; }
    tbody td { padding: 5.5px 10px; border-bottom: 1px solid #ececec; font-size: 10.5px; }
    tbody tr.alt td { background: #fafafa; }
    td.cb { width: 24px; text-align: center; color: #2a2a2a; font-size: 12px; }
    td.num { text-align: center; width: 90px; }
    td.num.bo { color: #e8730c; font-weight: 700; }
    td.unit { text-align: center; width: 60px; color: #555; }
    td.status { width: 130px; font-weight: 700; color: #1a7f37; }
    .spacer { flex: 1 1 auto; }
    .summary { margin-top: 12px; padding: 8px 12px; background: #f5f5f5; border-radius: 4px;
               font-size: 10.5px; display: flex; gap: 26px; }
    .summary b { font-weight: 700; }
    .sign { margin-top: 16px; display: flex; gap: 36px; }
    .sign .cell { flex: 1; border-top: 1px solid #555; padding-top: 5px; color: #777; font-size: 9.5px; letter-spacing: .4px; }
    .foot { margin-top: 12px; text-align: center; color: #999; font-size: 8.5px; }
  </style></head><body>
    <div class="frame">
      <div class="head">
        <div class="brand">
          <div class="co">Cromwell Plumbing Ltd</div>
          <div class="sub">Plumbing &amp; Construction Materials</div>
        </div>
        <div class="docbox">
          <div class="t">DELIVERY NOTE</div>
          <div class="no">No. ${n.dn}</div>
          <div class="dt">${n.date}</div>
        </div>
      </div>
      <hr class="rule">
      <div class="job">003-Park Mansion-Plumbing Materials</div>
      <div class="meta">Customer PO: <b>11838</b> &nbsp;·&nbsp; ${n.ref} &nbsp;·&nbsp; Deliver to: Park Mansions, 24–26 Brompton Road, Westminster, SW1X 7QN</div>
      <div class="section">DELIVERED BY CROMWELL</div>
      <table>
        <thead><tr>
          <th class="cb"></th><th>DESCRIPTION</th><th class="num">DELIVERED</th>
          <th class="num bo">BACK ORDER</th><th class="unit">UNIT</th><th>STATUS</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="spacer"></div>
      <div class="summary">
        <span><b>Delivered:</b> ${total}</span>
        <span><b>Partial:</b> 0</span>
        <span><b>Back Order:</b> 0</span>
        <span><b>Total Lines:</b> ${total}</span>
      </div>
      <div class="sign">
        <div class="cell">Received By (Print Name)</div>
        <div class="cell">Signature</div>
        <div class="cell">Date</div>
      </div>
      <div class="foot">Cromwell Plumbing Ltd · This delivery note confirms goods despatched against the above customer purchase order.</div>
    </div>
  </body></html>`;
}

const browser = await puppeteer.launch({ headless: "new" });
for (const n of NOTES) {
  const page = await browser.newPage();
  await page.setContent(buildHtml(n), { waitUntil: "networkidle0" });
  await page.pdf({ path: n.file, printBackground: true, preferCSSPageSize: true });
  await page.close();
  console.log("WROTE DN#" + n.dn, "->", n.file);
}
await browser.close();
