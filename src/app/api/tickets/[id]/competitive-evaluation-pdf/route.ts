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

function fmtPct(val: number): string {
  return `${val.toFixed(1)}%`;
}

interface EvalLine {
  description: string;
  qty: number;
  unit: string;
  competitorPrice: number;
  benchmarkPrice: number;
  ourPrice: number;
  saving: number;
  savingPct: number;
  cromwellBetter: boolean;
}

function buildHtml(
  ticket: { id: string; title: string },
  compSheet: { name: string; notes: string | null },
  evalLines: EvalLine[],
  competitorTotal: number,
  ourTotal: number,
  benchmarkTotal: number,
  totalSaving: number,
  totalSavingPct: number,
  fontBase64: string,
): string {
  const dateStr = new Date().toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const competitorName = compSheet.name || "Competitor";

  const lineRows = evalLines
    .map((line, i) => {
      const rowBg = line.cromwellBetter ? "background:#f0faf0;" : line.saving < 0 ? "background:#fef2f2;" : "";
      const savingStyle = line.cromwellBetter
        ? "color:#16803c;font-weight:700"
        : line.saving < 0
        ? "color:#dc2626;font-weight:700"
        : "color:#999";
      const savingText = line.saving > 0
        ? `${fmt(line.saving)} (${fmtPct(line.savingPct)})`
        : line.saving < 0
        ? `-${fmt(Math.abs(line.saving))} (${fmtPct(Math.abs(line.savingPct))})`
        : "—";
      return `<tr style="border-bottom:1px solid #eee;${rowBg}">
      <td style="padding:12px 10px;color:#999;font-size:12px">${i + 1}</td>
      <td style="padding:12px 10px;font-size:12px;font-weight:500">${line.description}</td>
      <td style="padding:12px 10px;text-align:center;font-size:12px">${line.qty} ${line.unit}</td>
      <td style="padding:12px 10px;text-align:right;font-size:12px;font-variant-numeric:tabular-nums">${fmt(line.competitorPrice)}</td>
      <td style="padding:12px 10px;text-align:right;font-size:12px;font-variant-numeric:tabular-nums;font-weight:600">${fmt(line.ourPrice)}</td>
      <td style="padding:12px 10px;text-align:right;font-size:12px;font-variant-numeric:tabular-nums;${savingStyle}">${savingText}</td>
    </tr>`;
    })
    .join("");

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
  th { text-align: left; padding: 12px 10px; font-size: 9px; text-transform: uppercase; letter-spacing: 0.12em; color: #888; border-bottom: 2px solid #111; font-weight: 600; }
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
    <div style="font-size:22px;font-weight:700;color:#111">COMPETITIVE EVALUATION</div>
    <div style="font-size:12px;color:#555;margin-top:5px">${ticket.title}</div>
    <div style="font-size:12px;color:#555">${dateStr}</div>
  </div>
</div>

<div style="border-top:1px solid #ddd;padding-top:24px;margin-bottom:35px">
  <div style="display:flex;justify-content:space-between">
    <div>
      <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.15em;color:#999;margin-bottom:5px">Evaluation Against</div>
      <div style="font-size:15px;font-weight:600">${competitorName}</div>
    </div>
    <div style="text-align:right;max-width:280px">
      <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.15em;color:#999;margin-bottom:5px">Reference</div>
      <div style="font-size:11px;color:#666">${ticket.title}</div>
    </div>
  </div>
</div>

<table>
  <thead>
    <tr>
      <th style="width:30px">#</th>
      <th>Item</th>
      <th class="c">Qty</th>
      <th class="r">${competitorName} Price</th>
      <th class="r">Our Price</th>
      <th class="r">Savings vs ${competitorName}</th>
    </tr>
  </thead>
  <tbody>${lineRows}</tbody>
</table>

<div style="display:flex;justify-content:flex-end;margin-top:30px">
  <div style="width:340px">
    <div style="display:flex;justify-content:space-between;padding:10px 0;border-top:1px solid #ddd">
      <span style="font-size:13px;color:#555">${competitorName} Total</span>
      <span style="font-size:13px;font-variant-numeric:tabular-nums">${fmt(competitorTotal)}</span>
    </div>
    <div style="display:flex;justify-content:space-between;padding:10px 0;border-top:1px solid #eee">
      <span style="font-size:13px;color:#555">Our Total</span>
      <span style="font-size:13px;font-variant-numeric:tabular-nums">${fmt(ourTotal)}</span>
    </div>
    <div style="display:flex;justify-content:space-between;padding:12px 0;border-top:2px solid #111;background:#f0faf0;padding-left:10px;padding-right:10px">
      <span style="font-weight:700;font-size:14px;color:#16803c">Total Savings</span>
      <span style="font-weight:700;font-size:14px;font-variant-numeric:tabular-nums;color:#16803c">${fmt(totalSaving)} (${fmtPct(totalSavingPct)})</span>
    </div>
  </div>
</div>

<div style="margin-top:35px;padding:20px 24px;background:#f0faf0;border:1px solid #b6e0b6;border-radius:6px;text-align:center">
  <div style="font-size:16px;font-weight:700;color:#16803c">You save ${fmt(totalSaving)} by choosing Cromwell Plumbing Ltd</div>
</div>

${compSheet.notes ? `
<div style="border-top:1px solid #ddd;padding-top:18px;margin-top:35px">
  <div style="font-size:9px;text-transform:uppercase;letter-spacing:0.15em;color:#999;margin-bottom:5px">Notes</div>
  <div style="font-size:12px;color:#555;white-space:pre-line">${compSheet.notes}</div>
</div>` : ""}

<div style="border-top:1px solid #ddd;padding-top:18px;margin-top:45px;text-align:center">
  <div style="font-size:10px;color:#aaa">This evaluation is valid for 30 days from the date of issue.</div>
  <div style="font-size:10px;color:#aaa;margin-top:3px">All prices include VAT at 20% where applicable.</div>
</div>

</body></html>`;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: ticketId } = await params;

  try {
    // Fetch ticket with comp sheets + lines
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      include: {
        compSheets: {
          include: {
            lines: {
              include: {
                ticketLine: true,
              },
            },
          },
        },
        lines: true,
      },
    });

    if (!ticket) {
      return Response.json({ error: "Ticket not found" }, { status: 404 });
    }

    // Use the first comp sheet (or allow selecting via query param)
    const url = new URL(request.url);
    const compSheetId = url.searchParams.get("compSheetId");

    const compSheet = compSheetId
      ? ticket.compSheets.find((cs) => cs.id === compSheetId)
      : ticket.compSheets[0];

    if (!compSheet) {
      return Response.json(
        { error: "No competitive evaluation sheet found for this ticket" },
        { status: 404 },
      );
    }

    // Build evaluation lines by joining comp sheet lines with ticket lines
    const evalLines: EvalLine[] = compSheet.lines.map((csLine) => {
      const tl = csLine.ticketLine;
      const qty = Number(tl.qty) || 1;

      // Parse competitor unit prices from notes JSON
      let meta: { competitorUnitPrice?: number; utopiaUnitPrice?: number; bestOnlineUnitPrice?: number } = {};
      try { if (csLine.notes) meta = JSON.parse(csLine.notes); } catch {}

      // Competitor price = unit price from the named competitor × qty
      const competitorUnitPrice = meta.competitorUnitPrice || 0;
      const competitorPrice = competitorUnitPrice * qty;
      // Best online from notes or ticket benchmark
      const bestOnlineUnit = meta.bestOnlineUnitPrice || Number(tl.benchmarkUnit) || 0;
      const benchmarkPrice = bestOnlineUnit * qty;
      // Our sale price
      const ourUnitPrice = Number(tl.actualSaleUnit) || 0;
      const ourPrice = ourUnitPrice * qty;
      // Saving = competitor - us
      const saving = competitorPrice - ourPrice;
      const savingPct = competitorPrice > 0 ? (saving / competitorPrice) * 100 : 0;
      const cromwellBetter = saving > 0;

      return {
        description: tl.description,
        qty,
        unit: tl.unit || "EA",
        competitorPrice,
        benchmarkPrice,
        ourPrice,
        saving,
        savingPct,
        cromwellBetter,
      };
    });

    const competitorTotal = evalLines.reduce((s, l) => s + l.competitorPrice, 0);
    const ourTotal = evalLines.reduce((s, l) => s + l.ourPrice, 0);
    const benchmarkTotal = evalLines.reduce((s, l) => s + l.benchmarkPrice, 0);
    const totalSaving = competitorTotal - ourTotal;
    const totalSavingPct = competitorTotal > 0 ? (totalSaving / competitorTotal) * 100 : 0;

    const fontBase64 = getGeistFontBase64();
    const html = buildHtml(
      { id: ticket.id, title: ticket.title },
      { name: compSheet.name, notes: compSheet.notes },
      evalLines,
      competitorTotal,
      ourTotal,
      benchmarkTotal,
      totalSaving,
      totalSavingPct,
      fontBase64,
    );

    // Generate PDF via Puppeteer
    const puppeteer = await import("puppeteer");
    const browser = await puppeteer.default.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    await page.evaluate(() => document.fonts.ready);

    const safeTitle = ticket.title.replace(/[^a-zA-Z0-9-]/g, "_").slice(0, 60);
    const fileName = `Cromwell-Competitive-Eval-${safeTitle}.pdf`;
    const outputDir = path.join(process.cwd(), "public", "competitive-evaluations");
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    const filePath = path.join(outputDir, fileName);

    await page.pdf({
      path: filePath,
      format: "A4",
      landscape: true,
      margin: { top: "15mm", bottom: "15mm", left: "12mm", right: "12mm" },
      printBackground: true,
    });

    await browser.close();

    return Response.json(
      {
        fileName,
        path: `/competitive-evaluations/${fileName}`,
        generatedAt: new Date().toISOString(),
        competitorName: compSheet.name,
        competitorTotal,
        ourTotal,
        totalSaving,
        totalSavingPct: Number(totalSavingPct.toFixed(1)),
        lineCount: evalLines.length,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Failed to generate competitive evaluation PDF:", error);
    return Response.json(
      {
        error:
          "PDF generation failed: " +
          (error instanceof Error ? error.message : "unknown"),
      },
      { status: 500 },
    );
  }
}

// GET to download existing PDF
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: ticketId } = await params;

  try {
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { title: true },
    });

    if (!ticket) {
      return Response.json({ error: "Ticket not found" }, { status: 404 });
    }

    const safeTitle = ticket.title.replace(/[^a-zA-Z0-9-]/g, "_").slice(0, 60);
    const fileName = `Cromwell-Competitive-Eval-${safeTitle}.pdf`;
    const filePath = path.join(
      process.cwd(),
      "public",
      "competitive-evaluations",
      fileName,
    );

    if (!fs.existsSync(filePath)) {
      return Response.json(
        { error: "No competitive evaluation PDF found. Generate one first via POST." },
        { status: 404 },
      );
    }

    const fileBuffer = fs.readFileSync(filePath);
    return new Response(fileBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${fileName}"`,
      },
    });
  } catch (error) {
    console.error("Failed to serve competitive evaluation PDF:", error);
    return Response.json(
      { error: "Failed to serve PDF" },
      { status: 500 },
    );
  }
}
