// Customer-facing "Call-off Amendment" confirmation sheet. Pure HTML builder —
// the route (substitutions/[id]/pdf) renders it to PDF via puppeteer, mirroring
// src/app/api/quotes/[id]/generate-pdf/route.ts.

export type SubstitutionPdfData = {
  title: string;
  createdAt: Date;
  notes: string | null;
  po: { poNo: string };
  customer: { name: string; billingAddress: string | null };
  site: { siteName: string } | null;
  lines: Array<{
    oldDescription: string;
    oldCode: string | null;
    newDescription: string;
    newCode: string | null;
    qtyToSwap: number;
    frozenQty: number;
    unit: string | null;
    note: string | null;
  }>;
};

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
}

export function buildSubstitutionHtml(data: SubstitutionPdfData, fontBase64: string): string {
  const dateStr = new Date(data.createdAt).toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric",
  });

  const rows = data.lines
    .map((l) => {
      const frozenNote = l.frozenQty > 0
        ? `<div style="font-size:10px;color:#B45309;margin-top:3px">${l.frozenQty} ${esc(l.unit ?? "")} already called off — remains as ${esc(l.oldCode ?? l.oldDescription)}</div>`
        : "";
      const noteCell = l.note ? `<div style="font-size:10px;color:#666;margin-top:3px">${esc(l.note)}</div>` : "";
      return `<tr style="border-bottom:1px solid #eee">
        <td style="padding:10px;vertical-align:top">
          <div style="font-weight:600">${esc(l.oldDescription)}</div>
          ${l.oldCode ? `<div style="font-size:11px;color:#888">${esc(l.oldCode)}</div>` : ""}
        </td>
        <td style="padding:10px;text-align:center;vertical-align:top;color:#0066CC;font-size:18px">&rarr;</td>
        <td style="padding:10px;vertical-align:top">
          <div style="font-weight:600">${esc(l.newDescription)}</div>
          ${l.newCode ? `<div style="font-size:11px;color:#888">${esc(l.newCode)}</div>` : ""}
          ${frozenNote}${noteCell}
        </td>
        <td style="padding:10px;text-align:center;vertical-align:top;white-space:nowrap">${l.qtyToSwap} ${esc(l.unit ?? "")}</td>
      </tr>`;
    })
    .join("");

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @font-face { font-family: 'Geist'; src: url(data:font/woff2;base64,${fontBase64}) format('woff2'); }
    * { box-sizing: border-box; }
    body { font-family: 'Geist', system-ui, sans-serif; color: #1a1a1a; margin: 0; font-size: 13px; }
    h1 { font-size: 20px; margin: 0 0 4px; }
    .muted { color: #888; }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; }
    th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #555; padding: 8px 10px; border-bottom: 2px solid #555; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #1a1a1a; padding-bottom: 14px; }
    .signoff { margin-top: 40px; border-top: 1px solid #ddd; padding-top: 20px; }
    .sigline { display: inline-block; border-bottom: 1px solid #333; width: 240px; height: 28px; }
  </style></head><body>
    <div class="header">
      <div>
        <h1>Call-off Amendment</h1>
        <div class="muted">Line substitution — customer confirmation</div>
      </div>
      <div style="text-align:right">
        <div style="font-weight:700">Cromwell</div>
        <div class="muted">${dateStr}</div>
      </div>
    </div>

    <div style="margin-top:16px;display:flex;gap:40px">
      <div>
        <div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em">Customer</div>
        <div style="font-weight:600">${esc(data.customer.name)}</div>
        ${data.customer.billingAddress ? `<div class="muted" style="font-size:11px">${esc(data.customer.billingAddress)}</div>` : ""}
      </div>
      <div>
        <div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em">PO / Site</div>
        <div style="font-weight:600">${esc(data.po.poNo)}</div>
        ${data.site ? `<div class="muted" style="font-size:11px">${esc(data.site.siteName)}</div>` : ""}
      </div>
    </div>

    <div style="margin-top:14px;font-weight:600">${esc(data.title)}</div>
    ${data.notes ? `<div class="muted" style="margin-top:2px">${esc(data.notes)}</div>` : ""}

    <table>
      <thead><tr>
        <th style="width:38%">Original item</th>
        <th style="width:6%"></th>
        <th style="width:38%">Replacement item</th>
        <th style="width:18%;text-align:center">Qty amended</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>

    <div class="signoff">
      <div class="muted" style="font-size:12px">Please confirm the above substitutions. Quantities already called off remain against the original item and are unaffected.</div>
      <div style="margin-top:26px;display:flex;gap:60px">
        <div><div class="sigline"></div><div class="muted" style="font-size:11px;margin-top:4px">Signed</div></div>
        <div><div class="sigline" style="width:160px"></div><div class="muted" style="font-size:11px;margin-top:4px">Name</div></div>
        <div><div class="sigline" style="width:120px"></div><div class="muted" style="font-size:11px;margin-top:4px">Date</div></div>
      </div>
    </div>
  </body></html>`;
}
