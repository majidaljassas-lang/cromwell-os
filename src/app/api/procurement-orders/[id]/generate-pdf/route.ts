import { prisma } from "@/lib/prisma";
import path from "path";
import fs from "fs";

function getGeistFontBase64(): string {
  const fontPath = path.join(process.cwd(), "node_modules/geist/dist/fonts/geist-sans/Geist-Variable.woff2");
  return fs.readFileSync(fontPath).toString("base64");
}

function fmt(val: unknown): string {
  if (val == null) return "—";
  return `£${Number(val).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function buildHtml(po: any, expressCharge: number, fontBase64: string): string {
  const dateStr = new Date(po.issuedAt || Date.now()).toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric"
  });
  const deliveryDateStr = po.deliveryDateExpected
    ? new Date(po.deliveryDateExpected).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
    : "ASAP";

  const lines = po.lines || [];
  const subtotal = lines.reduce((s: number, l: any) => s + Number(l.lineTotal || 0), 0);
  const totalNet = subtotal + expressCharge;
  const vat = totalNet * 0.2;
  const grand = totalNet + vat;

  let lineNum = 0;
  const lineRows = lines.map((line: any) => {
    lineNum++;
    return `<tr style="border-bottom:1px solid #eee">
      <td style="padding:8px 10px;color:#888;font-size:11px;width:30px">${lineNum}</td>
      <td style="padding:8px 10px;font-size:12px">${line.description}</td>
      <td style="padding:8px 10px;text-align:center;font-size:12px;white-space:nowrap">${Number(line.qty)}</td>
      <td style="padding:8px 10px;text-align:right;font-size:12px;font-variant-numeric:tabular-nums">${fmt(line.unitCost)}</td>
      <td style="padding:8px 10px;text-align:right;font-size:12px;font-variant-numeric:tabular-nums;font-weight:700">${fmt(line.lineTotal)}</td>
    </tr>`;
  }).join("");

  const expressRow = expressCharge > 0 ? `<tr style="border-bottom:1px solid #eee;background:#fff8e8">
    <td style="padding:8px 10px;color:#888;font-size:11px">${lineNum + 1}</td>
    <td style="padding:8px 10px;font-size:12px;font-weight:600">Express / Same-day Delivery Charge</td>
    <td style="padding:8px 10px;text-align:center;font-size:12px">1</td>
    <td style="padding:8px 10px;text-align:right;font-size:12px;font-variant-numeric:tabular-nums">${fmt(expressCharge)}</td>
    <td style="padding:8px 10px;text-align:right;font-size:12px;font-variant-numeric:tabular-nums;font-weight:700">${fmt(expressCharge)}</td>
  </tr>` : "";

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
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: 'Geist', -apple-system, sans-serif; color:#111; padding:40px 50px; font-size:12px; line-height:1.4; }
  table { width:100%; border-collapse:collapse; }
</style>
</head><body>

<!-- Header -->
<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px">
  <div>
    <div style="font-size:20px;font-weight:800">Cromwell Plumbing Ltd</div>
    <div style="font-size:10px;color:#555;margin-top:4px">Company ID: 10611686 | VAT: 262 6274 02</div>
    <div style="font-size:10px;color:#555">423 Harrow Road, Westminster, London W10 4RE</div>
    <div style="font-size:10px;color:#555">orders@cromwellplumbing.co.uk | 07776 099987</div>
  </div>
  <div style="text-align:right">
    <div style="font-size:28px;font-weight:300;font-style:italic">Purchase Order</div>
    <div style="font-size:11px;color:#555;margin-top:2px"># ${po.poNo}</div>
  </div>
</div>

<hr style="border:none;border-top:1px solid #ddd;margin:0">

<!-- Supplier + meta -->
<div style="display:flex;justify-content:space-between;padding:16px 0;margin-bottom:16px">
  <div>
    <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.12em;color:#999;margin-bottom:4px">Supplier</div>
    <div style="font-size:14px;font-weight:700">${po.supplier?.name || "—"}</div>
    ${po.supplier?.email ? `<div style="font-size:11px;color:#444;margin-top:2px">${po.supplier.email}</div>` : ""}
    ${po.supplier?.phone ? `<div style="font-size:11px;color:#444">${po.supplier.phone}</div>` : ""}
  </div>
  <div style="text-align:right;font-size:11px;line-height:1.8">
    <div><span style="color:#888">Date:</span> <strong>${dateStr}</strong></div>
    <div><span style="color:#888">Delivery:</span> <strong>${deliveryDateStr}</strong></div>
    ${po.supplierRef ? `<div><span style="color:#888">Supplier Ref:</span> <strong>${po.supplierRef}</strong></div>` : ""}
    ${po.ticket?.title ? `<div><span style="color:#888">Job:</span> <strong>${po.ticket.title.substring(0, 50)}</strong></div>` : ""}
    ${po.ticket?.site?.siteName ? `<div><span style="color:#888">Site:</span> <strong>${po.ticket.site.siteName}</strong></div>` : ""}
  </div>
</div>

<!-- Lines table -->
<table>
  <thead>
    <tr style="background:#222;color:#fff">
      <th style="padding:8px 10px;font-size:9px;text-transform:uppercase;letter-spacing:0.1em;font-weight:600;text-align:left;width:30px">#</th>
      <th style="padding:8px 10px;font-size:9px;text-transform:uppercase;letter-spacing:0.1em;font-weight:600;text-align:left">Description</th>
      <th style="padding:8px 10px;font-size:9px;text-transform:uppercase;letter-spacing:0.1em;font-weight:600;text-align:center">Qty</th>
      <th style="padding:8px 10px;font-size:9px;text-transform:uppercase;letter-spacing:0.1em;font-weight:600;text-align:right">Unit Cost</th>
      <th style="padding:8px 10px;font-size:9px;text-transform:uppercase;letter-spacing:0.1em;font-weight:600;text-align:right">Line Total</th>
    </tr>
  </thead>
  <tbody>${lineRows}${expressRow}</tbody>
</table>

<!-- Totals -->
<div style="display:flex;justify-content:flex-end;margin-top:16px">
  <div style="width:260px">
    <div style="display:flex;justify-content:space-between;padding:6px 0;border-top:1px solid #ddd">
      <span style="font-size:11px;color:#555">Sub Total</span>
      <span style="font-size:11px;font-variant-numeric:tabular-nums">${fmt(subtotal)}</span>
    </div>
    ${expressCharge > 0 ? `<div style="display:flex;justify-content:space-between;padding:6px 0;border-top:1px solid #eee">
      <span style="font-size:11px;color:#FF6600">Express Charge</span>
      <span style="font-size:11px;color:#FF6600;font-variant-numeric:tabular-nums">${fmt(expressCharge)}</span>
    </div>` : ""}
    <div style="display:flex;justify-content:space-between;padding:6px 0;border-top:1px solid #eee">
      <span style="font-size:11px;color:#555">Net</span>
      <span style="font-size:11px;font-variant-numeric:tabular-nums">${fmt(totalNet)}</span>
    </div>
    <div style="display:flex;justify-content:space-between;padding:6px 0;border-top:1px solid #eee">
      <span style="font-size:11px;color:#555">VAT (20%)</span>
      <span style="font-size:11px;font-variant-numeric:tabular-nums">${fmt(vat)}</span>
    </div>
    <div style="display:flex;justify-content:space-between;padding:8px 0;border-top:2px solid #111;margin-top:2px;background:#222;color:#fff;padding-left:8px;padding-right:8px">
      <span style="font-weight:700;font-size:13px">TOTAL</span>
      <span style="font-weight:700;font-size:13px;font-variant-numeric:tabular-nums">${fmt(grand)}</span>
    </div>
  </div>
</div>

<!-- Notes -->
<div style="border-top:1px solid #ddd;padding-top:14px;margin-top:30px;font-size:10px;color:#555;line-height:1.6">
  <strong style="color:#333">Delivery Address:</strong> ${po.ticket?.site?.siteName || "TBC"}<br>
  <strong style="color:#333">Confirmation:</strong> Please acknowledge this order and confirm delivery date.<br>
  <strong style="color:#333">Invoicing:</strong> Please reference PO ${po.poNo} on all invoices and delivery notes.
</div>

<div style="position:fixed;bottom:20px;left:50px;right:50px;text-align:center;font-size:9px;color:#bbb;border-top:1px solid #eee;padding-top:8px">
  Cromwell Plumbing Ltd — Company Registration: 10611686 — VAT: 262 6274 02
</div>

</body></html>`;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await request.json().catch(() => ({}));
    const expressCharge = Number(body.expressCharge || 0);

    // Use raw queries to bypass Prisma's null validation on poNo
    const poRows = await prisma.$queryRaw<any[]>`
      SELECT po.*, s.name as supplier_name, s.email as supplier_email, s.phone as supplier_phone,
             t.title as ticket_title, st."siteName" as site_name
      FROM "ProcurementOrder" po
      LEFT JOIN "Supplier" s ON s.id = po."supplierId"
      LEFT JOIN "Ticket" t ON t.id = po."ticketId"
      LEFT JOIN "Site" st ON st.id = t."siteId"
      WHERE po.id = ${id}
      LIMIT 1
    `;
    if (poRows.length === 0) return Response.json({ error: "PO not found" }, { status: 404 });
    const poRow = poRows[0];

    const lineRows = await prisma.$queryRaw<any[]>`
      SELECT * FROM "ProcurementOrderLine" WHERE "procurementOrderId" = ${id}
    `;

    const po: any = {
      ...poRow,
      poNo: poRow.poNo || `PO-${id.substring(0, 8)}`,
      lines: lineRows,
      supplier: poRow.supplier_name ? { name: poRow.supplier_name, email: poRow.supplier_email, phone: poRow.supplier_phone } : null,
      ticket: poRow.ticket_title ? { title: poRow.ticket_title, site: poRow.site_name ? { siteName: poRow.site_name } : null } : null,
    };

    const fontBase64 = getGeistFontBase64();
    const html = buildHtml(po, expressCharge, fontBase64);

    const puppeteer = await import("puppeteer");
    const browser = await puppeteer.default.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    await page.evaluate(() => document.fonts.ready);

    const fileName = `Cromwell-PO-${po.poNo.replace(/[^a-zA-Z0-9-]/g, "_")}.pdf`;
    const outputDir = path.join(process.cwd(), "public", "po-pdfs");
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    const filePath = path.join(outputDir, fileName);

    await page.pdf({
      path: filePath,
      format: "A4",
      margin: { top: "20mm", bottom: "25mm", left: "15mm", right: "15mm" },
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: `<div style="width:100%;text-align:center;font-size:9px;color:#bbb;font-family:sans-serif;padding-bottom:4mm">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>`,
    });

    await browser.close();

    return Response.json({
      ok: true,
      fileName,
      path: `/po-pdfs/${fileName}`,
    }, { status: 201 });
  } catch (error) {
    console.error("PO PDF generation failed:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Failed" }, { status: 500 });
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    // Use raw query to avoid Prisma schema validation on null poNo
    const rows = await prisma.$queryRaw<{ poNo: string | null }[]>`
      SELECT "poNo" FROM "ProcurementOrder" WHERE id = ${id} LIMIT 1
    `;
    if (rows.length === 0) return Response.json({ error: "Not found" }, { status: 404 });
    const poNo = rows[0].poNo || `PO-${id.substring(0, 8)}`;
    const fileName = `Cromwell-PO-${poNo.replace(/[^a-zA-Z0-9-]/g, "_")}.pdf`;
    const filePath = path.join(process.cwd(), "public", "po-pdfs", fileName);
    if (!fs.existsSync(filePath)) {
      return Response.json({ error: "PDF not generated yet — POST first" }, { status: 404 });
    }
    return new Response(fs.readFileSync(filePath), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${fileName}"`,
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Failed" }, { status: 500 });
  }
}
