/**
 * POST /api/supplier-bills/parse-pdf
 *
 * Accepts multipart form upload with a PDF file.
 * Extracts text via pdf-parse, then parses into structured bill data.
 * Returns the parsed structure for the client to auto-fill the form.
 */

// Import lib directly to skip pdf-parse's test-file-read on module load
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require("pdf-parse/lib/pdf-parse");

import { parseBillText } from "@/lib/ingestion/bill-parser";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return Response.json({ error: "No file provided" }, { status: 400 });
    }

    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext !== "pdf") {
      return Response.json(
        { error: "Only PDF files are supported" },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // Extract text from PDF
    let rawText = "";
    try {
      const pdfData = await pdfParse(buffer);
      rawText = pdfData.text || "";
    } catch (pdfError) {
      console.error("[BILL PARSE] PDF extraction failed:", pdfError);
      return Response.json(
        { error: "Failed to extract text from PDF. The file may be image-based or corrupted." },
        { status: 422 }
      );
    }

    if (!rawText.trim()) {
      return Response.json(
        {
          error: "No text could be extracted from the PDF. It may be a scanned image — OCR is not yet supported for bills.",
          rawText: "",
          parsed: null,
        },
        { status: 422 }
      );
    }

    // Parse the extracted text into structured bill data
    const parsed = parseBillText(rawText);

    return Response.json({
      parsed,
      rawTextPreview: rawText.substring(0, 2000),
      rawTextLength: rawText.length,
      fileName: file.name,
    });
  } catch (error) {
    console.error("[BILL PARSE] Unexpected error:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to parse bill PDF" },
      { status: 500 }
    );
  }
}
