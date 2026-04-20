/**
 * Pro-forma renderer off a Quote.
 *
 * A pro-forma is NOT a posted SalesInvoice — it never lands in AR, never
 * gets a due date, never affects the aging report. It is a styled PDF
 * derived from the Quote so customers who insist on receiving a
 * "proforma invoice" before paying have something to pay against.
 *
 * Pricing, lines, customer + site all come from the Quote. The only
 * proforma-specific state we persist is:
 *   - proformaNumber (PF-YYYY-NNNN, allocated on first generation)
 *   - proformaIssuedAt (timestamp of first generation)
 *   - proformaPdfFileName / proformaPdfPath (so re-download works)
 *   - expiresAt (re-used as "Valid Until" — caller may update it)
 */
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

async function allocateProformaNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `PF-${year}-`;
  // Count existing proformas this year, then format. Race-safe enough at
  // single-user scale; the unique index on proformaNumber will catch dupes.
  const count = await prisma.quote.count({
    where: { proformaNumber: { startsWith: prefix } },
  });
  return `${prefix}${String(count + 1).padStart(4, "0")}`;
}

type ProformaQuote = {
  id: string;
  quoteNo: string;
  versionNo: number;
  expiresAt: Date | null;
  proformaNumber: string | null;
  proformaIssuedAt: Date | null;
  notes: string | null;
  customer: {
    name: string;
    legalName: string | null;
    billingAddress: string | null;
    companyNumber: string | null;
    vatNumber: string | null;
  };
  site: { siteName: string } | null;
  ticket: { title: string };
  lines: Array<{
    description: string;
    qty: unknown;
    unitPrice: unknown;
    lineTotal: unknown;
    ticketLine: { unit: string; sectionLabel: string | null } | null;
  }>;
};

function buildHtml(
  quote: ProformaQuote,
  proformaNumber: string,
  validUntil: Date | null,
  totalSale: number,
  fontBase64: string,
  customerPO?: { poNo: string; customer: { name: string; billingAddress: string | null } } | null
): string {
  const issuedDate = quote.proformaIssuedAt ?? new Date();
  const dateStr = issuedDate.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const validStr = validUntil
    ? validUntil.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
    : "Until withdrawn";

  const addressLines = (quote.customer.billingAddress || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const firstSection = quote.lines[0]?.ticketLine?.sectionLabel;

  const lineRows = quote.lines.map((line, i) => {
    const prevSection = i > 0 ? quote.lines[i - 1].ticketLine?.sectionLabel : null;
    const sectionHeader =
      line.ticketLine?.sectionLabel &&
      line.ticketLine.sectionLabel !== prevSection &&
      line.ticketLine.sectionLabel !== firstSection
        ? `<tr><td colspan="5" style="padding:8px 10px 4px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#555;background:#f5f5f5;border-top:2px solid #ddd">${line.ticketLine.sectionLabel}</td></tr>`
        : "";
    return `${sectionHeader}<tr style="border-bottom:1px solid #eee">
      <td style="padding:8px 10px;color:#888;font-size:12px;width:35px">${i + 1}</td>
      <td style="padding:8px 10px;font-size:12px">${line.description}</td>
      <td style="padding:8px 10px;text-align:center;font-size:12px;white-space:nowrap">${Number(line.qty)} ${line.ticketLine?.unit || "LOT"}</td>
      <td style="padding:8px 10px;text-align:right;font-size:12px;font-variant-numeric:tabular-nums">${fmt(line.unitPrice)}</td>
      <td style="padding:8px 10px;text-align:right;font-size:12px;font-variant-numeric:tabular-nums;font-weight:700">${fmt(line.lineTotal)}</td>
    </tr>`;
  }).join("");

  const vatAmount = totalSale * 0.2;
  const grandTotal = totalSale * 1.2;

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
    <div style="font-size:32px;font-weight:300;font-style:italic;color:#111">Pro-Forma Invoice</div>
    <div style="font-size:11px;color:#555;margin-top:2px"># ${proformaNumber}</div>
    <div style="font-size:9px;color:#999;margin-top:1px">From quote ${quote.quoteNo} v${quote.versionNo}</div>
  </div>
</div>

<hr style="border:none;border-top:1px solid #ddd;margin:0" />

<!-- Bill To + Meta -->
<div style="display:flex;justify-content:space-between;padding:16px 0 20px">
  <div>
    <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.12em;color:#999;margin-bottom:4px">Bill To</div>
    <div style="font-size:14px;font-weight:700">${customerPO?.customer?.name || quote.customer.legalName || quote.customer.name}</div>
    ${(() => {
      const addr = customerPO?.customer?.billingAddress || quote.customer.billingAddress || "";
      return addr.split(/\r?\n/).map((l: string) => l.trim()).filter(Boolean).map((l: string) => `<div style="font-size:11px;color:#444;margin-top:1px">${l}</div>`).join("");
    })()}
    ${quote.customer.companyNumber ? `<div style="font-size:10px;color:#777;margin-top:3px">Company No: ${quote.customer.companyNumber}</div>` : ""}
    ${quote.customer.vatNumber ? `<div style="font-size:10px;color:#777">VAT: ${quote.customer.vatNumber}</div>` : ""}
  </div>
  <div style="text-align:right;font-size:11px;line-height:1.8">
    <div><span style="color:#888">Issued:</span> ${dateStr}</div>
    <div><span style="color:#888">Valid Until:</span> <strong>${validStr}</strong></div>
    <div><span style="color:#888">Terms:</span> Pro-Forma (paid before delivery)</div>
    ${quote.site ? `<div><span style="color:#888">Site:</span> ${quote.site.siteName}</div>` : ""}
    ${customerPO?.poNo ? `<div><span style="color:#888">Customer PO:</span> <strong>${customerPO.poNo}</strong></div>` : ""}
  </div>
</div>

<!-- Lines -->
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
      <span style="font-weight:700;font-size:12px">Amount to Pay</span>
      <span style="font-weight:700;font-size:12px;font-variant-numeric:tabular-nums">${fmt(grandTotal)}</span>
    </div>
  </div>
</div>

<!-- Payment details -->
<div style="border-top:1px solid #ddd;padding-top:16px;margin-top:30px;font-size:10px;color:#555;line-height:1.7">
  <div><strong style="color:#333">Payment Details:</strong> Cromwell Plumbing Ltd | Barclays Bank PLC | Sort Code: 20-45-45 | Account: 93602001</div>
  <div>Please use <strong style="color:#111">${proformaNumber}</strong> as your payment reference.</div>
</div>

<!-- Pro-forma disclaimer -->
<div style="border:1px solid #ddd;padding:10px 14px;margin-top:16px;font-size:9px;color:#666;line-height:1.5;background:#fafafa">
  <strong style="color:#111">This is a Pro-Forma Invoice — not a tax invoice.</strong>
  No VAT may be reclaimed against this document. A formal VAT invoice will be issued
  on receipt of payment and / or delivery of goods. Prices and availability are valid
  until the date shown above.
</div>

${quote.notes ? `<div style="border-top:1px solid #eee;padding-top:12px;margin-top:16px;font-size:10px;color:#555;white-space:pre-line">${quote.notes}</div>` : ""}

</body></html>`;
}

async function loadQuote(id: string) {
  return prisma.quote.findUnique({
    where: { id },
    include: {
      lines: {
        include: { ticketLine: { select: { unit: true, sectionLabel: true, createdAt: true } } },
      },
      customer: {
        select: {
          name: true,
          legalName: true,
          billingAddress: true,
          companyNumber: true,
          vatNumber: true,
        },
      },
      site: { select: { siteName: true } },
      ticket: { select: { title: true } },
    },
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const body = await request.json().catch(() => ({} as { expiresAt?: string }));

    // If caller supplied a new validity date, persist it on the quote first.
    if (body.expiresAt !== undefined) {
      const newExpiry = body.expiresAt === null || body.expiresAt === "" ? null : new Date(body.expiresAt);
      await prisma.quote.update({ where: { id }, data: { expiresAt: newExpiry } });
    }

    const quote = await loadQuote(id);
    if (!quote) {
      return Response.json({ error: "Quote not found" }, { status: 404 });
    }

    // Fetch linked Customer PO (if any)
    const customerPO = await prisma.customerPO.findFirst({
      where: { quoteId: id },
      select: { poNo: true, customerId: true, customer: { select: { name: true, billingAddress: true } } },
    });

    // Sort lines to match ticket order (matches the invoice generator's behaviour).
    quote.lines.sort((a, b) => {
      const ta = a.ticketLine?.createdAt ? new Date(a.ticketLine.createdAt).getTime() : 0;
      const tb = b.ticketLine?.createdAt ? new Date(b.ticketLine.createdAt).getTime() : 0;
      return ta - tb;
    });

    const proformaNumber = quote.proformaNumber || (await allocateProformaNumber());
    const proformaIssuedAt = quote.proformaIssuedAt || new Date();

    const totalSale = quote.lines.reduce((s, l) => s + Number(l.lineTotal), 0);
    const fontBase64 = getGeistFontBase64();
    const html = buildHtml(
      { ...quote, proformaNumber, proformaIssuedAt } as ProformaQuote,
      proformaNumber,
      quote.expiresAt,
      totalSale,
      fontBase64,
      customerPO
    );

    const puppeteer = await import("puppeteer");
    const browser = await puppeteer.default.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    await page.evaluate(() => document.fonts.ready);

    const fileName = `Cromwell-Proforma-${proformaNumber}.pdf`;
    const outputDir = path.join(process.cwd(), "public", "proformas");
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    const filePath = path.join(outputDir, fileName);

    await page.pdf({
      path: filePath,
      format: "A4",
      margin: { top: "20mm", bottom: "20mm", left: "15mm", right: "15mm" },
      printBackground: true,
    });
    await browser.close();

    await prisma.quote.update({
      where: { id },
      data: {
        proformaNumber,
        proformaIssuedAt,
        proformaPdfFileName: fileName,
        proformaPdfPath: `/proformas/${fileName}`,
      },
    });

    return Response.json(
      {
        proformaNumber,
        proformaIssuedAt: proformaIssuedAt.toISOString(),
        validUntil: quote.expiresAt ? quote.expiresAt.toISOString() : null,
        fileName,
        path: `/proformas/${fileName}`,
        totalSale,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Failed to generate proforma:", error);
    return Response.json(
      { error: "Proforma generation failed: " + (error instanceof Error ? error.message : "unknown") },
      { status: 500 }
    );
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const quote = await prisma.quote.findUnique({
      where: { id },
      select: { proformaPdfFileName: true, proformaPdfPath: true },
    });
    if (!quote?.proformaPdfPath) {
      return Response.json({ error: "No proforma generated yet" }, { status: 404 });
    }
    const filePath = path.join(process.cwd(), "public", quote.proformaPdfPath);
    if (!fs.existsSync(filePath)) {
      return Response.json({ error: "Proforma file not found on disk" }, { status: 404 });
    }
    const fileBuffer = fs.readFileSync(filePath);
    return new Response(new Uint8Array(fileBuffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${quote.proformaPdfFileName}"`,
      },
    });
  } catch (error) {
    console.error("Failed to serve proforma:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to serve proforma" },
      { status: 500 }
    );
  }
}
