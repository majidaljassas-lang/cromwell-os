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

function buildHtml(cn: {
  creditNoteNo: string | null;
  issueDate: Date;
  reason: string | null;
  subtotal: unknown;
  vatAmount: unknown;
  total: unknown;
  customer: { name: string; billingAddress?: string | null };
  salesInvoice: { invoiceNo: string | null } | null;
  lines: Array<{ description: string; qty: unknown; unitPrice: unknown; lineTotal: unknown }>;
}, fontBase64: string): string {
  const ref = cn.creditNoteNo || "DRAFT";
  const dateStr = new Date(cn.issueDate).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const addressLines = (cn.customer.billingAddress || "")
    .split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  const lineRows = cn.lines.map((line, i) => `<tr style="border-bottom:1px solid #eee">
      <td style="padding:8px 10px;color:#888;font-size:12px;width:35px">${i + 1}</td>
      <td style="padding:8px 10px;font-size:12px">${line.description}</td>
      <td style="padding:8px 10px;text-align:center;font-size:12px;white-space:nowrap">${Number(line.qty)}</td>
      <td style="padding:8px 10px;text-align:right;font-size:12px;font-variant-numeric:tabular-nums">${fmt(line.unitPrice)}</td>
      <td style="padding:8px 10px;text-align:right;font-size:12px;font-variant-numeric:tabular-nums;font-weight:700">${fmt(line.lineTotal)}</td>
    </tr>`).join("");

  const appliedNote = cn.salesInvoice?.invoiceNo
    ? `Credit applied against Invoice ${cn.salesInvoice.invoiceNo}.`
    : "";
  const footer = [cn.reason, appliedNote].filter(Boolean).join(" ");

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  @font-face { font-family:'Geist'; src:url(data:font/woff2;base64,${fontBase64}) format('woff2'); font-weight:100 900; font-style:normal; }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:'Geist',-apple-system,'Helvetica Neue',Arial,sans-serif; color:#111; padding:40px 50px 30px; font-size:12px; line-height:1.4; }
  table { width:100%; border-collapse:collapse; }
</style></head><body>
<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px">
  <div>
    <div style="font-size:20px;font-weight:800;letter-spacing:-0.02em">Cromwell Plumbing Ltd</div>
    <div style="font-size:10px;color:#555;margin-top:4px">Company ID: 10611686 | VAT: 262 6274 02</div>
    <div style="font-size:10px;color:#555">423 Harrow Road, Westminster, London W10 4RE</div>
  </div>
  <div style="text-align:right">
    <div style="font-size:32px;font-weight:300;font-style:italic;color:#111">Credit Note</div>
    <div style="font-size:11px;color:#555;margin-top:2px"># ${ref}</div>
  </div>
</div>
<hr style="border:none;border-top:1px solid #ddd;margin:0" />
<div style="display:flex;justify-content:space-between;padding:16px 0 20px">
  <div>
    <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.12em;color:#999;margin-bottom:4px">Credit To</div>
    <div style="font-size:14px;font-weight:700">${cn.customer.name}</div>
    ${addressLines.map((l) => `<div style="font-size:11px;color:#444;margin-top:1px">${l}</div>`).join("")}
  </div>
  <div style="text-align:right;font-size:11px;line-height:1.8">
    <div><span style="color:#888">Date:</span> ${dateStr}</div>
    ${cn.salesInvoice?.invoiceNo ? `<div><span style="color:#888">Against:</span> ${cn.salesInvoice.invoiceNo}</div>` : ""}
  </div>
</div>
<table>
  <thead><tr style="background:#222;color:#fff">
    <th style="padding:8px 10px;font-size:9px;text-transform:uppercase;letter-spacing:0.1em;font-weight:600;width:35px;text-align:left">#</th>
    <th style="padding:8px 10px;font-size:9px;text-transform:uppercase;letter-spacing:0.1em;font-weight:600;text-align:left">Description</th>
    <th style="padding:8px 10px;font-size:9px;text-transform:uppercase;letter-spacing:0.1em;font-weight:600;text-align:center">Qty</th>
    <th style="padding:8px 10px;font-size:9px;text-transform:uppercase;letter-spacing:0.1em;font-weight:600;text-align:right">Rate</th>
    <th style="padding:8px 10px;font-size:9px;text-transform:uppercase;letter-spacing:0.1em;font-weight:600;text-align:right">Amount</th>
  </tr></thead>
  <tbody>${lineRows}</tbody>
</table>
<div style="display:flex;justify-content:flex-end;margin-top:20px">
  <div style="width:280px">
    <div style="display:flex;justify-content:space-between;padding:6px 0">
      <span style="font-size:11px;color:#555">Sub Total</span>
      <span style="font-size:11px;font-variant-numeric:tabular-nums">${fmt(cn.subtotal)}</span>
    </div>
    <div style="display:flex;justify-content:space-between;padding:6px 0">
      <span style="font-size:11px;color:#555">VAT (20%)</span>
      <span style="font-size:11px;font-variant-numeric:tabular-nums">${fmt(cn.vatAmount)}</span>
    </div>
    <div style="display:flex;justify-content:space-between;padding:8px 10px;background:#0a7a39;color:#fff;margin-top:6px">
      <span style="font-weight:700;font-size:12px">Total Credit</span>
      <span style="font-weight:700;font-size:12px;font-variant-numeric:tabular-nums">${fmt(cn.total)}</span>
    </div>
  </div>
</div>
${footer ? `<div style="border-top:1px solid #ddd;padding-top:16px;margin-top:30px;font-size:10px;color:#555;line-height:1.7">${footer}</div>` : ""}
</body></html>`;
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const cn = await prisma.salesCreditNote.findUnique({
      where: { id },
      include: {
        customer: true,
        salesInvoice: { select: { invoiceNo: true } },
        lines: true,
      },
    });
    if (!cn) return Response.json({ error: "Credit note not found" }, { status: 404 });

    const html = buildHtml(cn as Parameters<typeof buildHtml>[0], getGeistFontBase64());

    const puppeteer = await import("puppeteer");
    const browser = await puppeteer.default.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    await page.evaluate(() => document.fonts.ready);

    const fileName = `Cromwell-CreditNote-${(cn.creditNoteNo || "DRAFT").replace(/[^a-zA-Z0-9-]/g, "_")}.pdf`;
    const outputDir = path.join(process.cwd(), "public", "credit-notes");
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    const filePath = path.join(outputDir, fileName);

    await page.pdf({
      path: filePath,
      format: "A4",
      margin: { top: "20mm", bottom: "25mm", left: "15mm", right: "15mm" },
      printBackground: true,
    });
    await browser.close();

    return Response.json({ fileName, path: `/credit-notes/${fileName}`, generatedAt: new Date().toISOString() }, { status: 201 });
  } catch (error) {
    console.error("Failed to generate credit note PDF:", error);
    return Response.json({ error: "PDF generation failed: " + (error instanceof Error ? error.message : "unknown") }, { status: 500 });
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const cn = await prisma.salesCreditNote.findUnique({
      where: { id },
      select: { creditNoteNo: true },
    });
    if (!cn) return Response.json({ error: "Credit note not found" }, { status: 404 });

    const fileName = `Cromwell-CreditNote-${(cn.creditNoteNo || "DRAFT").replace(/[^a-zA-Z0-9-]/g, "_")}.pdf`;
    const filePath = path.join(process.cwd(), "public", "credit-notes", fileName);
    if (!fs.existsSync(filePath)) {
      return Response.json({ error: "PDF not generated yet. Generate first." }, { status: 404 });
    }
    const fileBuffer = fs.readFileSync(filePath);
    return new Response(fileBuffer, {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${fileName}"` },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Failed" }, { status: 500 });
  }
}
