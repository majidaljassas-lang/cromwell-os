import { prisma } from "@/lib/prisma";
import path from "path";
import fs from "fs";
import { buildSubstitutionHtml, type SubstitutionPdfData } from "@/lib/calloffs/substitution/pdf";

function getGeistFontBase64(): string {
  const fontPath = path.join(
    process.cwd(),
    "node_modules/geist/dist/fonts/geist-sans/Geist-Variable.woff2",
  );
  return fs.readFileSync(fontPath).toString("base64");
}

async function loadPdfData(id: string): Promise<SubstitutionPdfData | null> {
  const sub = await prisma.callOffSubstitution.findUnique({
    where: { id },
    include: {
      lines: { orderBy: { displayOrder: "asc" } },
      customerPO: {
        select: {
          poNo: true,
          customer: { select: { name: true, billingAddress: true } },
          site: { select: { siteName: true } },
        },
      },
    },
  });
  if (!sub) return null;

  // Unit comes from the old ticket line.
  const oldTlIds = sub.lines.map((l) => l.oldTicketLineId);
  const tls = await prisma.ticketLine.findMany({
    where: { id: { in: oldTlIds } },
    select: { id: true, unit: true },
  });
  const unitById = new Map(tls.map((t) => [t.id, t.unit as string]));

  return {
    title: sub.title,
    createdAt: sub.createdAt,
    notes: sub.notes,
    po: { poNo: sub.customerPO.poNo },
    customer: {
      name: sub.customerPO.customer.name,
      billingAddress: sub.customerPO.customer.billingAddress,
    },
    site: sub.customerPO.site ? { siteName: sub.customerPO.site.siteName } : null,
    lines: sub.lines.map((l) => ({
      oldDescription: l.oldDescription,
      oldCode: l.oldCode,
      newDescription: l.newDescription,
      newCode: l.newCode,
      qtyToSwap: Number(l.qtyToSwap),
      frozenQty: Number(l.frozenQtySnapshot),
      unit: unitById.get(l.oldTicketLineId) ?? null,
      note: l.note,
    })),
  };
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const data = await loadPdfData(id);
    if (!data) return Response.json({ error: "Not found" }, { status: 404 });

    const fontBase64 = getGeistFontBase64();
    const html = buildSubstitutionHtml(data, fontBase64);

    const puppeteer = await import("puppeteer");
    const browser = await puppeteer.default.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    await page.evaluate(() => document.fonts.ready);

    const fileName = `Cromwell-Call-off-Amendment-${data.po.poNo.replace(/[^a-zA-Z0-9-]/g, "_")}-${id.slice(0, 8)}.pdf`;
    const outputDir = path.join(process.cwd(), "public", "substitutions");
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    const filePath = path.join(outputDir, fileName);

    await page.pdf({
      path: filePath,
      format: "A4",
      margin: { top: "18mm", bottom: "18mm", left: "15mm", right: "15mm" },
      printBackground: true,
    });
    await browser.close();

    await prisma.callOffSubstitution.update({
      where: { id },
      data: { pdfFileName: fileName, pdfPath: `/substitutions/${fileName}` },
    });

    return Response.json({ fileName, path: `/substitutions/${fileName}` }, { status: 201 });
  } catch (error) {
    return Response.json(
      { error: "PDF generation failed: " + (error instanceof Error ? error.message : "unknown") },
      { status: 500 },
    );
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const sub = await prisma.callOffSubstitution.findUnique({
    where: { id },
    select: { pdfFileName: true, pdfPath: true },
  });
  if (!sub?.pdfPath) return Response.json({ error: "No PDF generated yet" }, { status: 404 });

  const filePath = path.join(process.cwd(), "public", sub.pdfPath);
  if (!fs.existsSync(filePath)) {
    return Response.json({ error: "PDF file not found on disk" }, { status: 404 });
  }
  const fileBuffer = fs.readFileSync(filePath);
  return new Response(new Uint8Array(fileBuffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${sub.pdfFileName}"`,
    },
  });
}
