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

function termsToDays(terms: string | null | undefined): number {
  if (!terms) return 30;
  const t = terms.toLowerCase().replace(/\s+/g, "");
  if (t.includes("net7")) return 7;
  if (t.includes("net14")) return 14;
  if (t.includes("net30")) return 30;
  if (t.includes("net45")) return 45;
  if (t.includes("net60")) return 60;
  if (t.includes("eom") || t.includes("endofmonth")) {
    // due last day of current month
    return -1; // sentinel — handled below
  }
  if (t.includes("endofnext") || t.includes("eonm")) return -2; // due last day of next month
  if (t.includes("cash") || t.includes("onreceipt")) return 0;
  if (t.includes("proforma")) return 0;
  const m = t.match(/net(\d+)/);
  if (m) return parseInt(m[1]);
  return 30;
}

function buildHtml(invoice: {
  invoiceNo: string | null;
  invoiceType: string;
  issuedAt: Date | null;
  poNo: string | null;
  notes: string | null;
  customer: { name: string; billingAddress?: string | null; paymentTerms?: string | null };
  site: { siteName: string } | null;
  ticket: { title: string };
  lines: Array<{
    description: string;
    qty: unknown;
    unitPrice: unknown;
    lineTotal: unknown;
    ticketLine: { unit: string; sectionLabel: string | null } | null;
  }>;
}, totalSale: number, fontBase64: string): string {
  const invoiceDate = invoice.issuedAt ? new Date(invoice.issuedAt) : new Date();
  const dateStr = invoiceDate.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  // Determine payment terms (proforma overrides customer terms)
  const customerTerms = invoice.customer.paymentTerms || "Net 30";
  const termsLabel = invoice.invoiceType === "PROFORMA" ? "Pro-Forma" : customerTerms;
  const termsDays = invoice.invoiceType === "PROFORMA" ? 0 : termsToDays(customerTerms);

  // Compute due date
  let dueDate = new Date(invoiceDate);
  if (termsDays === -1) {
    // EOM = end of current month
    dueDate = new Date(invoiceDate.getFullYear(), invoiceDate.getMonth() + 1, 0);
  } else if (termsDays === -2) {
    // End of next month
    dueDate = new Date(invoiceDate.getFullYear(), invoiceDate.getMonth() + 2, 0);
  } else {
    dueDate.setDate(dueDate.getDate() + termsDays);
  }

  const dueDateStr = invoice.invoiceType === "PROFORMA"
    ? "On Receipt"
    : dueDate.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  const title = invoice.invoiceType === "PROFORMA" ? "Proforma Invoice" : "Invoice";

  /* Customer address: split on newlines or commas to render each part on its own line */
  const addressLines = (invoice.customer.billingAddress || "")
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);

  const firstSection = invoice.lines[0]?.ticketLine?.sectionLabel;

  const lineRows = invoice.lines.map((line, i) => {
    const prevSection = i > 0 ? invoice.lines[i - 1].ticketLine?.sectionLabel : null;
    const sectionHeader = line.ticketLine?.sectionLabel && line.ticketLine.sectionLabel !== prevSection && line.ticketLine.sectionLabel !== firstSection
      ? `<tr><td colspan="5" style="padding:8px 10px 4px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#555;background:#f5f5f5;border-top:2px solid #ddd">${line.ticketLine.sectionLabel}</td></tr>`
      : "";
    return `${sectionHeader}<tr style="border-bottom:1px solid #eee">
      <td style="padding:8px 10px;color:#888;font-size:12px;width:35px">${i + 1}</td>
      <td style="padding:8px 10px;font-size:12px">${line.description}</td>
      <td style="padding:8px 10px;text-align:center;font-size:12px;white-space:nowrap">${Number(line.qty)}</td>
      <td style="padding:8px 10px;text-align:right;font-size:12px;font-variant-numeric:tabular-nums">${fmt(line.unitPrice)}</td>
      <td style="padding:8px 10px;text-align:right;font-size:12px;font-variant-numeric:tabular-nums;font-weight:700">${fmt(line.lineTotal)}</td>
    </tr>`;
  }).join("");

  const vatAmount = totalSale * 0.2;
  const grandTotal = totalSale * 1.2;
  const invRef = invoice.invoiceNo || "DRAFT";

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

<!-- Header -->
<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px">
  <div>
    <div style="font-size:20px;font-weight:800;letter-spacing:-0.02em">Cromwell Plumbing Ltd</div>
    <div style="font-size:10px;color:#555;margin-top:4px">Company ID: 10611686 | VAT: 262 6274 02</div>
    <div style="font-size:10px;color:#555">423 Harrow Road, Westminster, London W10 4RE</div>
  </div>
  <div style="text-align:right">
    <div style="font-size:32px;font-weight:300;font-style:italic;color:#111">${title}</div>
    <div style="font-size:11px;color:#555;margin-top:2px"># ${invRef}</div>
  </div>
</div>

<hr style="border:none;border-top:1px solid #ddd;margin:0" />

<!-- Bill To + Invoice meta -->
<div style="display:flex;justify-content:space-between;padding:16px 0 20px">
  <div>
    <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.12em;color:#999;margin-bottom:4px">Bill To</div>
    <div style="font-size:14px;font-weight:700">${invoice.customer.name}</div>
    ${addressLines.map(l => `<div style="font-size:11px;color:#444;margin-top:1px">${l}</div>`).join("")}
  </div>
  <div style="text-align:right;font-size:11px;line-height:1.8">
    <div><span style="color:#888">Date:</span> ${dateStr}</div>
    <div><span style="color:#888">Due:</span> ${dueDateStr}</div>
    <div><span style="color:#888">Terms:</span> ${termsLabel}</div>
    ${invoice.poNo ? `<div><span style="color:#888">PO:</span> <strong>${invoice.poNo}</strong></div>` : ""}
    ${invoice.site ? `<div><span style="color:#888">Site:</span> ${invoice.site.siteName}</div>` : ""}
  </div>
</div>

<!-- Line items -->
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

<!-- Totals -->
<div style="display:flex;justify-content:flex-end;margin-top:20px">
  <div style="width:260px">
    <div style="display:flex;justify-content:space-between;padding:6px 0">
      <span style="font-size:11px;color:#555">Sub Total</span>
      <span style="font-size:11px;font-variant-numeric:tabular-nums">${fmt(totalSale)}</span>
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
      <span style="font-weight:700;font-size:12px">Balance Due</span>
      <span style="font-weight:700;font-size:12px;font-variant-numeric:tabular-nums">${fmt(grandTotal)}</span>
    </div>
  </div>
</div>

<!-- Payment details -->
<div style="border-top:1px solid #ddd;padding-top:16px;margin-top:30px;font-size:10px;color:#555;line-height:1.7">
  <div><strong style="color:#333">Payment Details:</strong> Cromwell Plumbing Ltd | Barclays Bank PLC | Sort Code: 20-45-45 | Account: 93602001</div>
  <div>Please use <strong style="color:#111">${invRef}</strong> as your payment reference.</div>
</div>

${invoice.notes ? `<div style="border-top:1px solid #eee;padding-top:12px;margin-top:16px;font-size:10px;color:#555;white-space:pre-line">${invoice.notes}</div>` : ""}

</body></html>`;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const invoice = await prisma.salesInvoice.findUnique({
      where: { id },
      include: {
        lines: {
          include: { ticketLine: { select: { unit: true, sectionLabel: true, createdAt: true } } },
          orderBy: { createdAt: "asc" },
        },
        customer: true,
        site: true,
        ticket: { select: { title: true } },
      },
    });

    if (!invoice) {
      return Response.json({ error: "Invoice not found" }, { status: 404 });
    }

    // Sort lines by ticket line creation order to match ticket
    invoice.lines.sort((a, b) => {
      const ta = a.ticketLine?.createdAt ? new Date(a.ticketLine.createdAt).getTime() : 0;
      const tb = b.ticketLine?.createdAt ? new Date(b.ticketLine.createdAt).getTime() : 0;
      return ta - tb;
    });

    const totalSale = invoice.lines.reduce((s, l) => s + Number(l.lineTotal), 0);
    const fontBase64 = getGeistFontBase64();
    const html = buildHtml(invoice as Parameters<typeof buildHtml>[0], totalSale, fontBase64);

    const puppeteer = await import("puppeteer");
    const browser = await puppeteer.default.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    await page.evaluate(() => document.fonts.ready);

    const fileName = `Cromwell-Invoice-${(invoice.invoiceNo || "DRAFT").replace(/[^a-zA-Z0-9-]/g, "_")}.pdf`;
    const outputDir = path.join(process.cwd(), "public", "invoices");
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    const filePath = path.join(outputDir, fileName);

    await page.pdf({
      path: filePath,
      format: "A4",
      margin: { top: "20mm", bottom: "25mm", left: "15mm", right: "15mm" },
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate: `<div style="width:100%;text-align:center;font-size:9px;color:#aaa;font-family:'Helvetica Neue',Arial,sans-serif;padding-bottom:4mm">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>`,
    });

    await browser.close();

    return Response.json({
      fileName,
      path: `/invoices/${fileName}`,
      generatedAt: new Date().toISOString(),
      totalSale,
    }, { status: 201 });
  } catch (error) {
    console.error("Failed to generate invoice PDF:", error);
    return Response.json({ error: "PDF generation failed: " + (error instanceof Error ? error.message : "unknown") }, { status: 500 });
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    // Generate fresh PDF then serve it
    const invoice = await prisma.salesInvoice.findUnique({
      where: { id },
      select: { invoiceNo: true },
    });

    if (!invoice) {
      return Response.json({ error: "Invoice not found" }, { status: 404 });
    }

    const fileName = `Cromwell-Invoice-${(invoice.invoiceNo || "DRAFT").replace(/[^a-zA-Z0-9-]/g, "_")}.pdf`;
    const filePath = path.join(process.cwd(), "public", "invoices", fileName);

    if (!fs.existsSync(filePath)) {
      return Response.json({ error: "PDF not generated yet. Generate first." }, { status: 404 });
    }

    const fileBuffer = fs.readFileSync(filePath);
    return new Response(fileBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${fileName}"`,
      },
    });
  } catch (error) {
    console.error("Failed to serve invoice PDF:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Failed" }, { status: 500 });
  }
}
