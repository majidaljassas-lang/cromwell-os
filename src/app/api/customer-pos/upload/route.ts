import { prisma } from "@/lib/prisma";
import path from "path";
import fs from "fs";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const customerId = formData.get("customerId") as string | null;
    const ticketId = formData.get("ticketId") as string | null;
    const siteId = formData.get("siteId") as string | null;
    const issuedByContactId = formData.get("issuedByContactId") as string | null;

    if (!file) {
      return Response.json({ error: "No file provided" }, { status: 400 });
    }

    // Save file to disk
    const uploadDir = path.join(process.cwd(), "public", "po-uploads");
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

    const buffer = Buffer.from(await file.arrayBuffer());
    const ext = path.extname(file.name) || ".pdf";
    const diskFilename = `po_${Date.now()}${ext}`;
    const filePath = path.join(uploadDir, diskFilename);
    fs.writeFileSync(filePath, buffer);

    // Extract text
    let rawText = "";
    if (ext.toLowerCase() === ".pdf") {
      const pdfParse = require("pdf-parse/lib/pdf-parse");
      const data = await pdfParse(buffer);
      rawText = data.text;
    } else {
      // Image — OCR
      const { execSync } = require("child_process");
      const tmpBase = path.join(process.cwd(), "public", "tmp-ocr", `po_${Date.now()}`);
      const tmpDir = path.dirname(tmpBase);
      if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
      try {
        execSync(`tesseract "${filePath}" "${tmpBase}" --psm 4 -l eng`, { timeout: 30000 });
        rawText = fs.readFileSync(`${tmpBase}.txt`, "utf-8");
      } catch {
        rawText = "";
      }
    }

    // Parse the PO text
    const parsed = parsePOText(rawText);

    // Use parsed PO number or generate one
    const poNo = parsed.poNo || `PO-${Date.now().toString(36).toUpperCase()}`;

    // If customerId provided, create PO immediately
    if (customerId) {
      const totalExVat = parsed.lines.reduce((s, l) => s + (l.lineTotal || 0), 0) || parsed.totalAmount || 0;

      const po = await prisma.customerPO.create({
        data: {
          customerId,
          ticketId: ticketId || undefined,
          siteId: siteId || undefined,
          issuedByContactId: issuedByContactId || undefined,
          poNo,
          poType: "STANDARD_FIXED",
          poDate: parsed.poDate ? new Date(parsed.poDate) : new Date(),
          status: "RECEIVED",
          totalValue: totalExVat,
          poLimitValue: totalExVat,
          poRemainingValue: totalExVat,
          sourceAttachmentRef: `/po-uploads/${diskFilename}`,
          notes: `Uploaded from: ${file.name}`,
        },
      });

      if (parsed.lines.length > 0) {
        await prisma.customerPOLine.createMany({
          data: parsed.lines.map((l) => ({
            customerPOId: po.id,
            description: l.description,
            qty: l.qty || undefined,
            agreedUnitPrice: l.unitPrice || undefined,
            agreedTotal: l.lineTotal || undefined,
          })),
        });
      }

      return Response.json({ id: po.id, poNo, parsed, linesCreated: parsed.lines.length }, { status: 201 });
    }

    // No customer — return parsed data for review
    return Response.json({
      status: "REVIEW",
      parsed,
      poNo,
      fileRef: `/po-uploads/${diskFilename}`,
      fileName: file.name,
      rawTextPreview: rawText.substring(0, 1000),
    });
  } catch (error) {
    console.error("Failed to upload PO:", error);
    return Response.json({ error: "Failed to upload PO" }, { status: 500 });
  }
}

interface ParsedPOLine {
  description: string;
  qty: number | null;
  unitPrice: number | null;
  lineTotal: number | null;
}

interface ParsedPO {
  poNo: string | null;
  poDate: string | null;
  customerName: string | null;
  siteName: string | null;
  totalAmount: number | null;
  lines: ParsedPOLine[];
}

function parsePOText(text: string): ParsedPO {
  const result: ParsedPO = {
    poNo: null,
    poDate: null,
    customerName: null,
    siteName: null,
    totalAmount: null,
    lines: [],
  };

  if (!text || text.trim().length === 0) return result;

  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

  // Extract PO number — common patterns
  for (const line of lines) {
    // "Purchase Order: PO-12345" or "PO Number: W11PO3922" or "Order No: 12345"
    const poMatch = line.match(/(?:purchase\s*order|p\.?o\.?\s*(?:number|no|ref|#)?|order\s*(?:number|no|ref|#))\s*[:.]?\s*([A-Z0-9][\w\-\/]+)/i);
    if (poMatch && !result.poNo) {
      result.poNo = poMatch[1].trim();
    }
  }

  // Extract date
  for (const line of lines) {
    // "Date: 08/04/2026" or "PO Date: 2026-04-08"
    const dateMatch = line.match(/(?:date|issued|order date)\s*[:.]?\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/i);
    if (dateMatch && !result.poDate) {
      const parts = dateMatch[1].split(/[\/\-]/);
      if (parts.length === 3) {
        const [a, b, c] = parts;
        // Assume DD/MM/YYYY for UK format
        const year = c.length === 2 ? `20${c}` : c;
        result.poDate = `${year}-${b.padStart(2, "0")}-${a.padStart(2, "0")}`;
      }
    }
  }

  // Extract total
  for (const line of lines) {
    const totalMatch = line.match(/(?:total|sub\s*total|net\s*total|amount)\s*(?:ex(?:cl)?\.?\s*vat)?\s*[:.]?\s*£?\s*([\d,]+\.?\d*)/i);
    if (totalMatch) {
      result.totalAmount = parseFloat(totalMatch[1].replace(/,/g, ""));
    }
  }

  // Extract line items — look for tabular rows with description + numbers
  // Common patterns:
  // "10  28mm Copper Tube  28.18  281.80"
  // "28mm Copper Tube  10  28.18  281.80"
  for (const line of lines) {
    // Skip header-like lines
    if (/^(description|item|product|qty|quantity|unit|price|total|amount|vat|sub|net)/i.test(line)) continue;
    if (/^(purchase|order|date|deliver|ship|bill|invoice|page|tel|fax|email|www)/i.test(line)) continue;

    // Try to match: description followed by numbers (qty, unit price, total)
    // Pattern: text ... number ... number ... number
    const match = line.match(/^(.+?)\s{2,}([\d,]+\.?\d*)\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)$/);
    if (match) {
      const desc = match[1].trim();
      const nums = [match[2], match[3], match[4]].map((n) => parseFloat(n.replace(/,/g, "")));

      // Determine which is qty, unit, total — total should be largest
      let qty: number, unitPrice: number, lineTotal: number;
      if (nums[2] >= nums[0] && nums[2] >= nums[1]) {
        // Last number is total
        qty = nums[0];
        unitPrice = nums[1];
        lineTotal = nums[2];
      } else {
        qty = nums[0];
        unitPrice = nums[1];
        lineTotal = nums[2];
      }

      if (desc.length > 2 && lineTotal > 0) {
        result.lines.push({ description: desc, qty, unitPrice, lineTotal });
      }
      continue;
    }

    // Two-number pattern: description ... qty ... total (no unit price)
    const match2 = line.match(/^(.+?)\s{2,}([\d,]+\.?\d*)\s+([\d,]+\.?\d*)$/);
    if (match2) {
      const desc = match2[1].trim();
      const n1 = parseFloat(match2[2].replace(/,/g, ""));
      const n2 = parseFloat(match2[3].replace(/,/g, ""));

      if (desc.length > 2 && n2 > 0) {
        const qty = n1 < n2 ? n1 : 1;
        const lineTotal = n2;
        const unitPrice = qty > 0 ? lineTotal / qty : lineTotal;
        result.lines.push({ description: desc, qty, unitPrice, lineTotal });
      }
    }
  }

  return result;
}
