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

function buildHtml(quote: {
  quoteNo: string;
  versionNo: number;
  createdAt: Date;
  notes: string | null;
  customer: { name: string };
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
  const dateStr = new Date(quote.createdAt).toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric",
  });

  const lineRows = quote.lines.map((line, i) => {
    const sectionHeader = line.ticketLine?.sectionLabel
      ? `<tr style="border-top:2px solid #555"><td colspan="5" style="padding:10px 10px 6px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#555;background:#f5f5f5">${line.ticketLine.sectionLabel}</td></tr>`
      : "";
    return `${sectionHeader}<tr style="border-bottom:1px solid #eee">
      <td style="padding:12px 10px;color:#999;font-size:13px">${i + 1}</td>
      <td style="padding:12px 10px;font-size:13px;font-weight:500">${line.description}</td>
      <td style="padding:12px 10px;text-align:center;font-size:13px">${Number(line.qty)} ${line.ticketLine?.unit || "LOT"}</td>
      <td style="padding:12px 10px;text-align:right;font-size:13px;font-variant-numeric:tabular-nums">${fmt(line.unitPrice)}</td>
      <td style="padding:12px 10px;text-align:right;font-size:13px;font-variant-numeric:tabular-nums;font-weight:600">${fmt(line.lineTotal)}</td>
    </tr>`;
  }).join("");

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
  body { font-family: 'Geist', -apple-system, 'Helvetica Neue', Arial, sans-serif; color: #111; padding: 50px 60px; font-size: 13px; line-height: 1.5; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; padding: 12px 10px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.12em; color: #888; border-bottom: 2px solid #111; font-weight: 600; }
  .r { text-align: right; }
  .c { text-align: center; }
</style>
</head><body>

<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:45px">
  <div>
    <div style="font-size:22px;font-weight:800;color:#111">Cromwell Plumbing Ltd</div>
    <div style="font-size:11px;color:#555;margin-top:8px;line-height:1.6">
      <div>Company ID : 10611686</div>
      <div>423 Harrow Road</div>
      <div>Westminster London W10 4RE</div>
      <div>United Kingdom</div>
      <div>VAT 262 6274 02</div>
    </div>
  </div>
  <div style="text-align:right">
    <div style="font-size:22px;font-weight:700;color:#111">QUOTATION</div>
    <div style="font-size:12px;color:#555;margin-top:5px">${quote.quoteNo}</div>
    <div style="font-size:12px;color:#555">Version ${quote.versionNo}</div>
    <div style="font-size:12px;color:#555">${dateStr}</div>
  </div>
</div>

<div style="border-top:1px solid #ddd;padding-top:24px;margin-bottom:35px">
  <div style="display:flex;justify-content:space-between">
    <div>
      <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.15em;color:#999;margin-bottom:5px">Prepared For</div>
      <div style="font-size:15px;font-weight:600">${quote.customer.name}</div>
      ${quote.site ? `<div style="font-size:12px;color:#666;margin-top:3px">Site: ${quote.site.siteName}</div>` : ""}
    </div>
    <div style="text-align:right;max-width:280px">
      <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.15em;color:#999;margin-bottom:5px">Reference</div>
      <div style="font-size:11px;color:#666">${quote.ticket.title}</div>
    </div>
  </div>
</div>

<table>
  <thead>
    <tr>
      <th style="width:35px">#</th>
      <th>Description</th>
      <th class="c">Qty</th>
      <th class="r">Unit Price</th>
      <th class="r">Total</th>
    </tr>
  </thead>
  <tbody>${lineRows}</tbody>
</table>

<div style="display:flex;justify-content:flex-end;margin-top:25px">
  <div style="width:280px">
    <div style="display:flex;justify-content:space-between;padding:10px 0;border-top:1px solid #ddd">
      <span style="font-size:13px;color:#555">Sub Total</span>
      <span style="font-size:13px;font-variant-numeric:tabular-nums">${fmt(totalSale)}</span>
    </div>
    <div style="display:flex;justify-content:space-between;padding:10px 0;border-top:1px solid #eee">
      <span style="font-size:13px;color:#555">Standard Rate (20%)</span>
      <span style="font-size:13px;font-variant-numeric:tabular-nums">${fmt(totalSale * 0.2)}</span>
    </div>
    <div style="display:flex;justify-content:space-between;padding:12px 0;border-top:2px solid #111">
      <span style="font-weight:700;font-size:14px">Total</span>
      <span style="font-weight:700;font-size:14px;font-variant-numeric:tabular-nums">${fmt(totalSale * 1.2)}</span>
    </div>
  </div>
</div>

${quote.notes ? `
<div style="border-top:1px solid #ddd;padding-top:18px;margin-top:35px">
  <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.15em;color:#999;margin-bottom:5px">Notes</div>
  <div style="font-size:12px;color:#555;white-space:pre-line">${quote.notes}</div>
</div>` : ""}

<div style="border-top:1px solid #ddd;padding-top:18px;margin-top:45px;text-align:center">
  <div style="font-size:10px;color:#aaa">This quotation is valid for 30 days from the date of issue.</div>
  <div style="font-size:10px;color:#aaa;margin-top:3px">All prices include VAT at 20% where applicable.</div>
</div>

</body></html>`;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const quote = await prisma.quote.findUnique({
      where: { id },
      include: {
        lines: { include: { ticketLine: { select: { unit: true, sectionLabel: true } } } },
        customer: true,
        site: true,
        ticket: { select: { title: true } },
      },
    });

    if (!quote) {
      return Response.json({ error: "Quote not found" }, { status: 404 });
    }

    const totalSale = quote.lines.reduce((s, l) => s + Number(l.lineTotal), 0);
    const fontBase64 = getGeistFontBase64();
    const html = buildHtml(quote as Parameters<typeof buildHtml>[0], totalSale, fontBase64);

    // Generate PDF via Puppeteer
    const puppeteer = await import("puppeteer");
    const browser = await puppeteer.default.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    // Wait for embedded font to load
    await page.evaluate(() => document.fonts.ready);

    const fileName = `Cromwell-Quote-${quote.quoteNo.replace(/[^a-zA-Z0-9-]/g, "_")}_v${quote.versionNo}.pdf`;
    const outputDir = path.join(process.cwd(), "public", "quotes");
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    const filePath = path.join(outputDir, fileName);

    await page.pdf({
      path: filePath,
      format: "A4",
      margin: { top: "20mm", bottom: "20mm", left: "15mm", right: "15mm" },
      printBackground: true,
    });

    await browser.close();

    // Update quote record with PDF reference
    await prisma.quote.update({
      where: { id },
      data: {
        pdfFileName: fileName,
        pdfPath: `/quotes/${fileName}`,
        pdfGeneratedAt: new Date(),
      },
    });

    return Response.json({
      fileName,
      path: `/quotes/${fileName}`,
      generatedAt: new Date().toISOString(),
      totalSale,
    }, { status: 201 });
  } catch (error) {
    console.error("Failed to generate PDF:", error);
    return Response.json({ error: "PDF generation failed: " + (error instanceof Error ? error.message : "unknown") }, { status: 500 });
  }
}

// GET to download existing PDF
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const quote = await prisma.quote.findUnique({
      where: { id },
      select: { pdfFileName: true, pdfPath: true },
    });

    if (!quote?.pdfPath) {
      return Response.json({ error: "No PDF generated yet" }, { status: 404 });
    }

    const filePath = path.join(process.cwd(), "public", quote.pdfPath);
    if (!fs.existsSync(filePath)) {
      return Response.json({ error: "PDF file not found on disk" }, { status: 404 });
    }

    const fileBuffer = fs.readFileSync(filePath);
    return new Response(fileBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${quote.pdfFileName}"`,
      },
    });
  } catch (error) {
    console.error("Failed to serve PDF:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Failed to serve PDF" }, { status: 500 });
  }
}
