import * as XLSX from "xlsx";

/**
 * POST /api/rfq/upload-excel
 * Accepts a multipart form with an Excel file and converts it to structured text
 * that the RFQ exploder can parse.
 *
 * Returns: { text: string, rows: Array<{ qty, unit, description, size, spec }> }
 */
export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;
    if (!file) {
      return Response.json({ error: "No file provided" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const workbook = XLSX.read(buffer, { type: "buffer" });

    // Process all sheets
    const allRows: Array<Record<string, unknown>> = [];
    const textLines: string[] = [];

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(sheet, { defval: "" }) as Record<string, unknown>[];

      if (jsonData.length === 0) continue;

      // Try to identify qty, description, unit columns by header names
      const headers = Object.keys(jsonData[0]);
      const qtyCol = headers.find((h) => /^(qty|quantity|qnty|amount|count|no\.|units)$/i.test(String(h).trim()));
      const descCol = headers.find((h) => /^(desc|description|item|product|material|name|item.description|item & description)$/i.test(String(h).trim()));
      const unitCol = headers.find((h) => /^(unit|uom|u\/m|measure)$/i.test(String(h).trim()));
      const sizeCol = headers.find((h) => /^(size|diameter|dim|specification)$/i.test(String(h).trim()));
      const priceCol = headers.find((h) => /^(price|rate|cost|unit.price|unit.cost|£)$/i.test(String(h).trim()));

      for (const row of jsonData) {
        const qty = qtyCol ? String(row[qtyCol]).trim() : "";
        const desc = descCol ? String(row[descCol]).trim() : "";
        const unit = unitCol ? String(row[unitCol]).trim() : "";
        const size = sizeCol ? String(row[sizeCol]).trim() : "";
        const price = priceCol ? String(row[priceCol]).trim() : "";

        // If we identified a description column, use structured output
        if (desc && desc !== "undefined") {
          const parts = [qty, desc, size].filter(Boolean);
          textLines.push(parts.join(" "));
          allRows.push({ qty: qty || null, description: desc, unit: unit || "EA", size: size || null, price: price || null });
        } else {
          // No clear description column — concatenate all non-empty cells
          const values = headers
            .map((h) => String(row[h]).trim())
            .filter((v) => v && v !== "undefined" && v !== "0");
          if (values.length > 0) {
            textLines.push(values.join(" "));
          }
        }
      }
    }

    return Response.json({
      text: textLines.join("\n"),
      rows: allRows,
      fileName: file.name,
      rowCount: allRows.length,
      textLineCount: textLines.length,
    });
  } catch (error) {
    console.error("Excel parse failed:", error);
    return Response.json({ error: "Failed to parse Excel file: " + (error instanceof Error ? error.message : "unknown") }, { status: 500 });
  }
}
