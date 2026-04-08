import { prisma } from "@/lib/prisma";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { parseAcknowledgementText } from "@/lib/procurement/parse-acknowledgement";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require("pdf-parse/lib/pdf-parse");

/**
 * POST /api/procurement-orders/[id]/reparse
 * Re-scan upload directory for this PO's file and parse line items.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const po = await prisma.procurementOrder.findUnique({
      where: { id },
      include: { supplier: true, ticket: { select: { lines: { select: { id: true, description: true, qty: true } } } } },
    });
    if (!po) return Response.json({ error: "PO not found" }, { status: 404 });

    const uploadDir = path.join(process.cwd(), "public", "procurement-uploads");
    const allFiles = fs.readdirSync(uploadDir);
    const poRef = po.poNo.replace(/\//g, "_");
    const files = allFiles.filter((f) => f.toLowerCase().includes(poRef.toLowerCase()));

    if (files.length === 0) {
      return Response.json({ error: `No upload file found for ${po.poNo}`, tried: poRef, available: allFiles }, { status: 404 });
    }

    const filePath = path.join(uploadDir, files[files.length - 1]);
    const ext = filePath.split(".").pop()?.toLowerCase() || "";
    const buf = fs.readFileSync(filePath);

    let text = "";
    if (ext === "pdf") {
      const data = await pdfParse(buf);
      text = data.text;
    } else if (["png", "jpg", "jpeg"].includes(ext)) {
      const outBase = filePath.replace(/\.\w+$/, "_ocr");
      try {
        execSync(`tesseract "${filePath}" "${outBase}" --psm 4 -l eng`, { timeout: 20000 });
        text = fs.readFileSync(`${outBase}.txt`, "utf-8");
        try { fs.unlinkSync(`${outBase}.txt`); } catch {}
      } catch {}
    }

    if (!text) {
      return Response.json({ error: "No text extracted from file", file: files[files.length - 1] }, { status: 400 });
    }

    const parsed = parseAcknowledgementText(text);

    // Delete existing lines and recreate
    await prisma.procurementOrderLine.deleteMany({ where: { procurementOrderId: id } });

    const ticketLines = po.ticket?.lines || [];
    let matched = 0;

    for (const pl of parsed.lines) {
      const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, " ").trim();
      const plNorm = normalize(pl.description);
      let matchedId: string | null = null;

      for (const tl of ticketLines) {
        const tlNorm = normalize(tl.description);
        const tokens = plNorm.split(" ").filter((t) => t.length > 3);
        const matches = tokens.filter((t) => tlNorm.includes(t)).length;
        if (matches >= 2 || tlNorm.includes(plNorm) || plNorm.includes(tlNorm)) {
          matchedId = tl.id;
          matched++;
          break;
        }
      }

      await prisma.procurementOrderLine.create({
        data: {
          procurementOrderId: id,
          ticketLineId: matchedId,
          description: pl.description,
          qty: pl.qty,
          unitCost: pl.unitCost,
          lineTotal: pl.lineTotal,
          matchStatus: matchedId ? "MATCHED" : "UNMATCHED",
        },
      });
    }

    return Response.json({
      poNo: po.poNo,
      file: files[files.length - 1],
      textLength: text.length,
      linesExtracted: parsed.lines.length,
      linesMatched: matched,
    });
  } catch (error) {
    console.error("Reparse failed:", error);
    return Response.json({ error: "Reparse failed" }, { status: 500 });
  }
}
