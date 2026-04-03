import { prisma } from "@/lib/prisma";

function fmt(val: unknown): string {
  if (val == null) return "—";
  return `£${Number(val).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
        lines: { include: { ticketLine: { select: { unit: true } } } },
        customer: true,
        site: true,
        ticket: { select: { title: true } },
      },
    });

    if (!quote) {
      return Response.json({ error: "Quote not found" }, { status: 404 });
    }

    const totalSale = quote.lines.reduce((s, l) => s + Number(l.lineTotal), 0);
    const dateStr = new Date(quote.createdAt).toLocaleDateString("en-GB", {
      day: "numeric", month: "long", year: "numeric",
    });

    // Generate HTML-based PDF content
    const lineRows = quote.lines.map((line, i) =>
      `<tr style="border-bottom:1px solid #eee">
        <td style="padding:10px 8px;color:#999">${i + 1}</td>
        <td style="padding:10px 8px;font-weight:500">${line.description}</td>
        <td style="padding:10px 8px;text-align:center">${Number(line.qty)} ${line.ticketLine?.unit || ""}</td>
        <td style="padding:10px 8px;text-align:right;font-variant-numeric:tabular-nums">${fmt(line.unitPrice)}</td>
        <td style="padding:10px 8px;text-align:right;font-variant-numeric:tabular-nums;font-weight:500">${fmt(line.lineTotal)}</td>
      </tr>`
    ).join("");

    const html = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<title>${quote.quoteNo} - Cromwell Quotation</title>
<style>
  body { font-family: -apple-system, 'Segoe UI', sans-serif; color: #111; margin: 0; padding: 48px; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; padding: 10px 8px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: #888; border-bottom: 2px solid #000; }
  .right { text-align: right; }
  .center { text-align: center; }
</style>
</head><body>
<div style="display:flex;justify-content:space-between;margin-bottom:40px">
  <div>
    <h1 style="margin:0;font-size:24px;letter-spacing:1px">CROMWELL</h1>
    <p style="margin:2px 0 0;color:#888;font-size:12px">Plumbing & Mechanical Services</p>
  </div>
  <div style="text-align:right">
    <h2 style="margin:0;font-size:20px">QUOTATION</h2>
    <p style="margin:4px 0 0;color:#666">${quote.quoteNo}</p>
    <p style="margin:2px 0 0;color:#666">Version ${quote.versionNo}</p>
    <p style="margin:2px 0 0;color:#666">${dateStr}</p>
  </div>
</div>

<div style="border-top:1px solid #ddd;padding-top:20px;margin-bottom:30px;display:flex;justify-content:space-between">
  <div>
    <p style="font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#999;margin:0 0 4px">To</p>
    <p style="font-weight:600;margin:0">${quote.customer.name}</p>
    ${quote.site ? `<p style="color:#666;margin:2px 0 0">Site: ${quote.site.siteName}</p>` : ""}
  </div>
  <div style="text-align:right">
    <p style="font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#999;margin:0 0 4px">Reference</p>
    <p style="color:#555;margin:0;font-size:12px">${quote.ticket.title}</p>
  </div>
</div>

<table>
  <thead>
    <tr>
      <th style="width:30px">#</th>
      <th>Description</th>
      <th class="center">Qty</th>
      <th class="right">Unit Price</th>
      <th class="right">Total</th>
    </tr>
  </thead>
  <tbody>${lineRows}</tbody>
</table>

<div style="display:flex;justify-content:flex-end;margin-top:20px">
  <div style="width:240px">
    <div style="display:flex;justify-content:space-between;padding:10px 0;border-top:2px solid #000;font-weight:700">
      <span>Total (Ex VAT)</span>
      <span style="font-variant-numeric:tabular-nums">${fmt(totalSale)}</span>
    </div>
  </div>
</div>

${quote.notes ? `<div style="border-top:1px solid #ddd;padding-top:16px;margin-top:30px">
  <p style="font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#999;margin:0 0 4px">Notes</p>
  <p style="color:#555;white-space:pre-line;margin:0">${quote.notes}</p>
</div>` : ""}

<div style="border-top:1px solid #ddd;padding-top:16px;margin-top:40px;text-align:center">
  <p style="color:#999;font-size:11px;margin:0">This quotation is valid for 30 days from the date of issue.</p>
  <p style="color:#999;font-size:11px;margin:4px 0 0">All prices are exclusive of VAT unless stated otherwise.</p>
</div>
</body></html>`;

    // Return HTML that can be printed to PDF via browser
    // Store the generated HTML reference on the quote
    await prisma.quote.update({
      where: { id },
      data: { notes: quote.notes }, // touch updatedAt
    });

    return new Response(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `inline; filename="${quote.quoteNo}.html"`,
      },
    });
  } catch (error) {
    console.error("Failed to generate PDF:", error);
    return Response.json({ error: "Failed to generate" }, { status: 500 });
  }
}
