import { prisma } from "@/lib/prisma";
import path from "path";
import fs from "fs";
import { execSync } from "child_process";
import { parseAcknowledgementText } from "@/lib/procurement/parse-acknowledgement";

// Import pdf-parse directly to avoid test-file-read on module load
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require("pdf-parse/lib/pdf-parse");

/**
 * POST /api/tickets/[id]/log-purchase
 *
 * Log a supplier order acknowledgement against a ticket.
 * Accepts multipart form data with optional file upload.
 * If a PDF or image is uploaded, extracts text and parses line items.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: ticketId } = await params;
  try {
    const formData = await request.formData();
    const supplierName = formData.get("supplierName") as string;
    const orderRef = formData.get("orderRef") as string;
    const totalNet = Number(formData.get("totalNet") || 0);
    const totalVat = Number(formData.get("totalVat") || 0);
    const notes = formData.get("notes") as string | null;
    const file = formData.get("file") as File | null;

    if (!supplierName?.trim() || !orderRef?.trim()) {
      return Response.json({ error: "Supplier name and order reference are required" }, { status: 400 });
    }

    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { id: true, title: true },
    });

    if (!ticket) {
      return Response.json({ error: "Ticket not found" }, { status: 404 });
    }

    // Save uploaded file if present
    let filePath: string | null = null;
    let fileName: string | null = null;
    let extractedText: string | null = null;

    if (file && file.size > 0) {
      const outputDir = path.join(process.cwd(), "public", "procurement-uploads");
      if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

      const ext = (file.name.split(".").pop() || "pdf").toLowerCase();
      fileName = `${orderRef.replace(/[^a-zA-Z0-9-]/g, "_")}_${Date.now()}.${ext}`;
      filePath = `/procurement-uploads/${fileName}`;
      const buffer = Buffer.from(await file.arrayBuffer());
      fs.writeFileSync(path.join(outputDir, fileName), buffer);

      // Extract text from file
      try {
        if (ext === "pdf") {
          const pdfData = await pdfParse(buffer);
          extractedText = pdfData.text;
        } else if (["png", "jpg", "jpeg", "tiff", "tif", "bmp", "webp"].includes(ext)) {
          extractedText = ocrImage(path.join(outputDir, fileName));
        }
      } catch (err) {
        console.error("Text extraction failed:", err);
        // Continue — we still create the PO, just without parsed lines
      }
    }

    // Find or create supplier
    let supplier = await prisma.supplier.findFirst({
      where: { name: { contains: supplierName.trim(), mode: "insensitive" } },
      select: { id: true },
    });
    if (!supplier) {
      supplier = await prisma.supplier.create({
        data: { name: supplierName.trim() },
      });
    }
    const supplierId = supplier.id;

    // Parse line items from extracted text
    let parsedLineCount = 0;
    const parsed = extractedText ? parseAcknowledgementText(extractedText) : null;

    // Create procurement order
    const po = await prisma.procurementOrder.create({
      data: {
        ticketId,
        supplierId,
        poNo: orderRef.trim(),
        supplierRef: orderRef.trim(),
        status: "ACKNOWLEDGED",
        totalCostExpected: parsed?.totalNet ?? totalNet,
        siteRef: notes || undefined,
      },
    });

    // Create line items from parsed text
    if (parsed && parsed.lines.length > 0) {
      // Get ticket lines for auto-matching
      const ticketLines = await prisma.ticketLine.findMany({
        where: { ticketId },
        select: { id: true, description: true, qty: true, unit: true },
      });

      for (const pl of parsed.lines) {
        // Try to match to a ticket line by description similarity
        const matchedTicketLine = findBestMatch(pl.description, ticketLines);

        await prisma.procurementOrderLine.create({
          data: {
            procurementOrderId: po.id,
            ticketLineId: matchedTicketLine?.id || null,
            description: pl.description,
            qty: pl.qty,
            unitCost: pl.unitCost,
            lineTotal: pl.lineTotal,
            matchStatus: matchedTicketLine ? "MATCHED" : "UNMATCHED",
          },
        });
        parsedLineCount++;
      }
    }

    // Log event
    const totalInc = totalNet + totalVat;
    await prisma.event.create({
      data: {
        ticketId,
        eventType: "PURCHASE_ORDER_SENT",
        timestamp: new Date(),
        sourceRef: orderRef.trim(),
        notes: `Order acknowledgement from ${supplierName.trim()} — Ref: ${orderRef.trim()} — £${totalNet.toFixed(2)} + VAT £${totalVat.toFixed(2)} = £${totalInc.toFixed(2)}${parsedLineCount > 0 ? ` — ${parsedLineCount} line items extracted` : ""}${filePath ? " [Document attached]" : ""}`,
      },
    });

    return Response.json({
      ok: true,
      procurementOrderId: po.id,
      supplierName: supplierName.trim(),
      orderRef: orderRef.trim(),
      totalNet,
      totalVat,
      filePath,
      linesExtracted: parsedLineCount,
      rawText: extractedText ? extractedText.substring(0, 500) : null,
    }, { status: 201 });
  } catch (error) {
    console.error("Failed to log purchase:", error);
    return Response.json({ error: error instanceof Error ? error.message : "Failed to log purchase" }, { status: 500 });
  }
}

/**
 * OCR an image file using tesseract.
 */
function ocrImage(imagePath: string): string {
  const outBase = imagePath.replace(/\.\w+$/, "_ocr");
  try {
    execSync(`tesseract "${imagePath}" "${outBase}" --psm 6 -l eng`, {
      timeout: 30000,
    });
    const text = fs.readFileSync(`${outBase}.txt`, "utf-8");
    try { fs.unlinkSync(`${outBase}.txt`); } catch { /* ignore */ }
    return text;
  } catch (err) {
    console.error("Tesseract OCR failed:", err);
    // Try with different page segmentation mode for tables
    try {
      execSync(`tesseract "${imagePath}" "${outBase}" --psm 4 -l eng`, {
        timeout: 30000,
      });
      const text = fs.readFileSync(`${outBase}.txt`, "utf-8");
      try { fs.unlinkSync(`${outBase}.txt`); } catch { /* ignore */ }
      return text;
    } catch {
      return "";
    }
  }
}

/**
 * Simple fuzzy match: find the ticket line whose description best matches
 * the acknowledgement line description.
 */
function findBestMatch(
  ackDesc: string,
  ticketLines: Array<{ id: string; description: string; qty: unknown; unit: string }>
): { id: string } | null {
  if (ticketLines.length === 0) return null;

  const normalize = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();

  const ackNorm = normalize(ackDesc);
  const ackTokens = new Set(ackNorm.split(" ").filter((t) => t.length > 2));

  let bestScore = 0;
  let bestMatch: { id: string } | null = null;

  for (const tl of ticketLines) {
    const tlNorm = normalize(tl.description);
    const tlTokens = new Set(tlNorm.split(" ").filter((t) => t.length > 2));

    // Count matching tokens
    let matches = 0;
    for (const token of ackTokens) {
      if (tlTokens.has(token)) matches++;
    }

    // Score: proportion of ack tokens that match ticket line tokens
    const score = ackTokens.size > 0 ? matches / ackTokens.size : 0;

    // Also check containment
    const contained = ackNorm.includes(tlNorm) || tlNorm.includes(ackNorm);

    const effectiveScore = contained ? Math.max(score, 0.8) : score;

    if (effectiveScore > bestScore && effectiveScore >= 0.4) {
      bestScore = effectiveScore;
      bestMatch = { id: tl.id };
    }
  }

  return bestMatch;
}
