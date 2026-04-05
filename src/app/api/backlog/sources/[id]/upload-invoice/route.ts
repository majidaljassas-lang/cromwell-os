import { prisma } from "@/lib/prisma";
import fs from "fs";
import path from "path";
// Import lib directly to skip pdf-parse's test-file-read on module load
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require("pdf-parse/lib/pdf-parse");
import { normalizeProduct, convertToBase } from "@/lib/reconciliation/normalizer";
import { canonicalizeSiteAsync } from "@/lib/reconciliation/site-aliases";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * POST: Upload PDF invoice file(s) to a DOCUMENT/INVOICE type source.
 * Content-Type: multipart/form-data with field "files" (multiple)
 *
 * Flow per file:
 * 1. Store raw PDF to disk (zero data loss)
 * 2. Extract text via pdf-parse
 * 3. Parse invoice structure (number, date, customer, site, line items)
 * 4. Create BacklogInvoiceDocument record
 * 5. Create BacklogInvoiceLine records (normalized, site-aliased)
 * 6. Update source status
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: sourceId } = await params;
  try {
    const source = await prisma.backlogSource.findUnique({
      where: { id: sourceId },
      include: { group: { select: { caseId: true } } },
    });
    if (!source) return Response.json({ error: "Source not found" }, { status: 404 });

    const caseId = source.group.caseId;
    const formData = await request.formData();
    const files = formData.getAll("files") as File[];

    if (files.length === 0) {
      // Single file fallback
      const single = formData.get("file") as File | null;
      if (single) files.push(single);
    }

    if (files.length === 0) {
      return Response.json({ error: "No PDF files provided" }, { status: 400 });
    }

    const uploadDir = path.join(process.cwd(), "public", "backlog-uploads");
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

    const results: Array<{
      filename: string;
      documentId: string;
      status: string;
      invoiceNumber: string | null;
      lineCount: number;
      error?: string;
    }> = [];

    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const filename = file.name;

      // 1. Store raw PDF to disk
      const diskFilename = `${sourceId}_${Date.now()}_${filename}`;
      const diskPath = path.join(uploadDir, diskFilename);
      fs.writeFileSync(diskPath, buffer);

      // 2. Create document record immediately (UPLOADED status)
      const doc = await prisma.backlogInvoiceDocument.create({
        data: {
          caseId,
          sourceId,
          rawFileName: filename,
          rawFileRef: `/backlog-uploads/${diskFilename}`,
          fileBytes: buffer.length,
          parseStatus: "UPLOADED",
        },
      });

      try {
        // 3. Extract text from PDF
        const pdfData = await pdfParse(buffer);
        const rawText: string = pdfData.text;
        const pageCount: number = pdfData.numpages;

        await prisma.backlogInvoiceDocument.update({
          where: { id: doc.id },
          data: { rawText, pageCount, parseStatus: "PARSING" },
        });

        console.log(`[INVOICE PARSE] ${filename}: ${pageCount} pages, ${rawText.length} chars`);

        // 4. Parse invoice structure
        const parsed = parseInvoiceText(rawText, filename);

        // 5. Site aliasing
        const siteMatch = await canonicalizeSiteAsync(parsed.site);

        // 6. Create line items
        let totalAmount = 0;
        for (const line of parsed.lines) {
          const { normalized, confidence } = normalizeProduct(line.description);
          const qty = line.quantity || 0;
          const unit = line.unit || "EA";
          const base = convertToBase(normalized, qty, unit);
          const amount = line.amount || 0;
          totalAmount += amount;

          const isMaterials = true; // PDF invoices from Zoho are materials invoices
          const billingConfidence = confidence >= 70 ? "HIGH" : confidence > 0 ? "MEDIUM" : "LOW";

          await prisma.backlogInvoiceLine.create({
            data: {
              caseId,
              documentId: doc.id,
              sourceId,
              invoiceNumber: parsed.invoiceNumber || filename,
              invoiceDate: parsed.invoiceDate || new Date(),
              customer: parsed.customerName,
              site: parsed.site,
              canonicalSite: siteMatch.canonical,
              siteAliasUsed: siteMatch.aliasUsed,
              productDescription: line.description,
              normalizedProduct: normalized,
              qty,
              unit,
              qtyBase: base.qtyBase,
              baseUnit: base.baseUnit,
              rate: line.rate,
              amount: amount || undefined,
              lineHeaderText: "Materials",
              isMaterialsHeader: isMaterials,
              isBillLinked: isMaterials,
              invoiceLineType: "BILL_LINKED",
              billingConfidence,
            },
          });
        }

        // 7. Update document with parsed data
        await prisma.backlogInvoiceDocument.update({
          where: { id: doc.id },
          data: {
            invoiceNumber: parsed.invoiceNumber,
            invoiceDate: parsed.invoiceDate,
            customerName: parsed.customerName,
            site: parsed.site,
            totalAmount: totalAmount || undefined,
            lineCount: parsed.lines.length,
            parseStatus: parsed.lines.length > 0 ? "PARSED" : "ERROR",
            parseError: parsed.lines.length === 0 ? "No line items extracted" : null,
          },
        });

        results.push({
          filename,
          documentId: doc.id,
          status: parsed.lines.length > 0 ? "PARSED" : "ERROR",
          invoiceNumber: parsed.invoiceNumber,
          lineCount: parsed.lines.length,
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : "Unknown parse error";
        console.error(`[INVOICE PARSE] Failed for ${filename}:`, err);

        await prisma.backlogInvoiceDocument.update({
          where: { id: doc.id },
          data: { parseStatus: "ERROR", parseError: errMsg },
        });

        results.push({
          filename,
          documentId: doc.id,
          status: "ERROR",
          invoiceNumber: null,
          lineCount: 0,
          error: errMsg,
        });
      }
    }

    // Update source status
    const totalLines = results.reduce((sum, r) => sum + r.lineCount, 0);
    const parsedCount = results.filter((r) => r.status === "PARSED").length;

    await prisma.backlogSource.update({
      where: { id: sourceId },
      data: {
        status: parsedCount > 0 ? "PARSED" : "UPLOADED",
        parseStatus: parsedCount === results.length ? "COMPLETE" : parsedCount > 0 ? "PARTIAL" : "FAILED",
        messageCount: totalLines,
        importCompletedAt: new Date(),
      },
    });

    return Response.json({
      sourceId,
      filesProcessed: results.length,
      totalLinesExtracted: totalLines,
      results,
    }, { status: 201 });
  } catch (error) {
    console.error("Invoice upload failed:", error);
    return Response.json({ error: "Upload failed: " + (error instanceof Error ? error.message : "unknown") }, { status: 500 });
  }
}

/**
 * GET: List all invoice documents for this source
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: sourceId } = await params;
  try {
    const documents = await prisma.backlogInvoiceDocument.findMany({
      where: { sourceId },
      include: {
        lines: {
          select: {
            id: true,
            productDescription: true,
            normalizedProduct: true,
            qty: true,
            unit: true,
            rate: true,
            amount: true,
            billingConfidence: true,
          },
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return Response.json(documents);
  } catch (error) {
    return Response.json({ error: "Failed" }, { status: 500 });
  }
}

/**
 * DELETE: Delete invoice document(s) and their line items.
 * Query: ?documentId=xxx  (single) or ?all=true (all for this source)
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: sourceId } = await params;
  try {
    const { searchParams } = new URL(request.url);
    const documentId = searchParams.get("documentId");
    const all = searchParams.get("all");

    if (documentId) {
      await prisma.backlogInvoiceLine.deleteMany({ where: { documentId } });
      await prisma.backlogInvoiceDocument.delete({ where: { id: documentId } });
      return Response.json({ deleted: 1 });
    }

    if (all === "true") {
      const docs = await prisma.backlogInvoiceDocument.findMany({ where: { sourceId }, select: { id: true } });
      const docIds = docs.map(d => d.id);
      if (docIds.length > 0) {
        await prisma.backlogInvoiceLine.deleteMany({ where: { documentId: { in: docIds } } });
        await prisma.backlogInvoiceDocument.deleteMany({ where: { sourceId } });
      }
      return Response.json({ deleted: docIds.length });
    }

    return Response.json({ error: "documentId or all=true required" }, { status: 400 });
  } catch (error) {
    console.error("Delete invoice failed:", error);
    return Response.json({ error: "Failed to delete" }, { status: 500 });
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Zoho Invoice Text Parser
//
// Zoho PDF text extraction produces a specific format where line items appear as:
//   {lineNum} Materials
//   {description line 1}
//   {description line 2 (optional)}
//   {qty}{rate}{vat%}{vat}{amount}  ← numbers concatenated without spaces!
//
// Example: "100.002.8820.0057.60288.00" = qty=100.00, rate=2.88, vat%=20.00, vat=57.60, amount=288.00
// ──────────────────────────────────────────────────────────────────────────────

interface ParsedLine {
  description: string;
  quantity: number;
  unit: string;
  rate: number | null;
  amount: number | null;
}

interface ParsedInvoice {
  invoiceNumber: string | null;
  invoiceDate: Date | null;
  customerName: string | null;
  site: string | null;
  lines: ParsedLine[];
}

function parseInvoiceText(rawText: string, filename: string): ParsedInvoice {
  const lines = rawText.split("\n").map((l) => l.trim());

  let invoiceNumber: string | null = null;
  let invoiceDate: Date | null = null;
  let customerName: string | null = null;
  let site: string | null = null;
  const parsedLines: ParsedLine[] = [];

  // Extract invoice number: "# INV-004499" or "INV-004499"
  for (const line of lines) {
    const invMatch = line.match(/#\s*(INV[-\s]?\d+[\w-]*)/i)
      || line.match(/\b(INV[-]?\d{3,}[\w-]*)\b/i);
    if (invMatch) {
      invoiceNumber = invMatch[1].replace(/\s+/g, "").trim();
      break;
    }
  }

  // Extract invoice date — Zoho format: "Invoice Date :" on one line, date on next
  for (let i = 0; i < lines.length; i++) {
    if (/Invoice\s*Date\s*:?\s*$/i.test(lines[i])) {
      // Date is on the next non-empty line
      for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
        if (lines[j].trim()) {
          const parsed = tryParseDate(lines[j].trim());
          if (parsed) { invoiceDate = parsed; break; }
        }
      }
      if (invoiceDate) break;
    }
    // Also try inline: "Invoice Date : 14 Oct 2025"
    const inlineDate = lines[i].match(/Invoice\s*Date\s*:?\s*(\d{1,2}\s+\w{3,9}\s+\d{4})/i);
    if (inlineDate) {
      invoiceDate = tryParseDate(inlineDate[1]);
      if (invoiceDate) break;
    }
  }

  // Extract customer name — Zoho format: "Bill To" on one line, name on next
  for (let i = 0; i < lines.length; i++) {
    if (/^Bill\s*To\s*$/i.test(lines[i])) {
      for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
        const name = lines[j].trim();
        if (name.length > 2 && !/^\d/.test(name)) { customerName = name; break; }
      }
      if (customerName) break;
    }
  }

  // Extract site — Zoho format: "Site :" on one line, value on next
  for (let i = 0; i < lines.length; i++) {
    if (/^Site\s*:?\s*$/i.test(lines[i])) {
      for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
        const s = lines[j].trim();
        if (s.length > 2 && !/^\d/.test(s) && !/^(Cromwell|Company|VAT|Invoice)/i.test(s)) { site = s; break; }
      }
      if (site) break;
    }
    // Inline: "Site : Shuttleworth - Stratford"
    const inlineSite = lines[i].match(/^Site\s*:\s*(.+)/i);
    if (inlineSite && inlineSite[1].trim().length > 2) {
      site = inlineSite[1].trim();
      break;
    }
  }

  // ─── Zoho Line Item Extraction ────────────────────────────────────────────
  // Pattern: line starting with "{number} Materials" marks start of a line item.
  // Description follows on next line(s).
  // Numbers line: concatenated qty+rate+vat%+vat+amount (5 numbers, no spaces).

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Detect line item start: "{number} Material" or "{number} Materials" or "{number} Labour"
    const itemStart = line.match(/^(\d+)\s+(Materials?|Labour|Labor|Service|Expense)/i);
    if (itemStart) {
      // Collect description lines until we hit the numbers line
      const descParts: string[] = [];
      let j = i + 1;

      while (j < lines.length) {
        const nextLine = lines[j].trim();
        if (!nextLine) { j++; continue; }

        // Check if this line is the concatenated numbers line
        // Pattern: starts with digits, contains only digits/dots/commas,
        // and has at least 3 decimal numbers mashed together
        const isNumbersLine = /^[\d,.]+$/.test(nextLine) && (nextLine.match(/\.\d{2}/g) || []).length >= 2;

        if (isNumbersLine) {
          // Parse the concatenated numbers: qty, rate, vat%, vat, amount
          const parsed = parseZohoNumbersLine(nextLine);
          if (parsed) {
            const desc = descParts.join(" ").trim();
            if (desc.length > 0) {
              parsedLines.push({
                description: desc,
                quantity: parsed.qty,
                unit: guessUnit(desc),
                rate: parsed.rate,
                amount: parsed.amount,
              });
            }
          }
          i = j + 1;
          break;
        }

        // Check if next item starts (another numbered Materials line)
        if (/^\d+\s+(Materials?|Labour|Labor|Service|Expense)/i.test(nextLine)) {
          break; // Don't advance i past j — let outer loop handle it
        }

        // It's a description line
        descParts.push(nextLine);
        j++;
      }

      if (j >= lines.length) i = j; // Reached end
      continue;
    }

    i++;
  }

  // Fallback: try generic tabular parsing if Zoho-specific found nothing
  if (parsedLines.length === 0) {
    parseGenericLines(lines, parsedLines);
  }

  // Fallback: extract from filename
  if (!invoiceNumber) {
    const fnMatch = filename.match(/(INV[-_]?\d+[\w-]*)/i);
    if (fnMatch) invoiceNumber = fnMatch[1];
  }

  console.log(`[INVOICE PARSE] ${filename}: inv=${invoiceNumber}, date=${invoiceDate?.toISOString()}, customer=${customerName}, site=${site}, lines=${parsedLines.length}`);

  return { invoiceNumber, invoiceDate, customerName, site, lines: parsedLines };
}

/**
 * Parse Zoho concatenated numbers line.
 * Example: "100.002.8820.0057.60288.00" → qty=100.00, rate=2.88, vat%=20.00, vat=57.60, amount=288.00
 * Example: "1,000.000.0185920.003.7218.59" → qty=1000.00, rate=0.01859, vat%=20.00, vat=3.72, amount=18.59
 *
 * Strategy: The VAT% is always 20.00 (or 0.00 for exempt). Use that as anchor.
 * Split: qty | rate | 20.00 | vat | amount
 * We know amount is at the end. Work backwards.
 */
function parseZohoNumbersLine(raw: string): { qty: number; rate: number; amount: number } | null {
  // Remove commas for easier parsing
  const s = raw.replace(/,/g, "");

  // Find ALL positions of "20.00" as VAT% anchor candidates
  const candidates: number[] = [];
  let searchFrom = 0;
  while (true) {
    const idx = s.indexOf("20.00", searchFrom);
    if (idx === -1) break;
    candidates.push(idx);
    searchFrom = idx + 1;
  }

  // Try each candidate and pick the one that gives qty * rate ≈ amount
  for (const vatIdx of candidates) {
    const beforeVat = s.substring(0, vatIdx);
    const afterVat = s.substring(vatIdx + 5);

    const afterParts = splitDecimalNumbers(afterVat);
    if (afterParts.length < 2) continue;
    const amount = afterParts[afterParts.length - 1];

    const beforeParts = splitDecimalNumbers(beforeVat);
    if (beforeParts.length < 2) continue;

    const qty = beforeParts[0];
    const rate = beforeParts[1];

    if (qty > 0 && amount > 0) {
      // Validate: qty * rate should be close to amount
      const expected = qty * rate;
      const tolerance = Math.max(amount * 0.02, 0.5); // 2% or 0.50
      if (Math.abs(expected - amount) <= tolerance) {
        return { qty, rate, amount };
      }
    }
  }

  // No valid "20.00" anchor found — try without
  if (candidates.length === 0) {
    return parseNumbersWithoutVatAnchor(s);
  }

  // Fallback: use first candidate even if validation fails
  if (candidates.length > 0) {
    const vatIdx = candidates[0];
    const beforeParts = splitDecimalNumbers(s.substring(0, vatIdx));
    const afterParts = splitDecimalNumbers(s.substring(vatIdx + 5));
    if (beforeParts.length >= 2 && afterParts.length >= 2) {
      return { qty: beforeParts[0], rate: beforeParts[1], amount: afterParts[afterParts.length - 1] };
    }
  }

  return parseNumbersWithoutVatAnchor(s);
}

function parseNumbersWithoutVatAnchor(s: string): { qty: number; rate: number; amount: number } | null {
  // Try to split into numbers by finding decimal number patterns
  const parts = splitDecimalNumbers(s);
  if (parts.length >= 3) {
    // Assume: qty, rate, amount (last three if more)
    const amount = parts[parts.length - 1];
    const rate = parts.length >= 5 ? parts[1] : parts[parts.length - 2];
    const qty = parts[0];
    if (qty > 0 && amount > 0) return { qty, rate, amount };
  }
  return null;
}

/**
 * Split a string of concatenated decimal numbers.
 * "100.002.88" → [100.00, 2.88]
 * "1000.000.01859" → [1000.00, 0.01859]
 *
 * Strategy: Find all positions where a decimal point occurs,
 * then figure out where one number ends and the next begins.
 * Key insight: numbers transition at the point where digits after one decimal
 * are followed by a new whole number part.
 */
function splitDecimalNumbers(s: string): number[] {
  if (!s) return [];

  // Find all decimal points
  const dotPositions: number[] = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === ".") dotPositions.push(i);
  }

  if (dotPositions.length === 0) {
    // No decimals — single integer
    const n = Number(s);
    return isNaN(n) ? [] : [n];
  }

  if (dotPositions.length === 1) {
    const n = Number(s);
    return isNaN(n) ? [] : [n];
  }

  // Multiple dots — need to split
  // Strategy: each number has exactly one dot with digits after it.
  // Scan left to right, greedily take digits until we hit a dot,
  // then take the fractional part. The fractional part ends where
  // the next number's integer part begins.
  //
  // Heuristic: Most prices/quantities have 2 decimal places (XX.XX).
  // Some rates have more (e.g., 0.01859 for per-unit screws).
  //
  // Better approach: try all possible splits and pick the one where
  // qty * rate ≈ amount.

  const numbers: number[] = [];
  let pos = 0;

  while (pos < s.length) {
    // Find next dot from pos
    let nextDot = -1;
    for (let d = 0; d < dotPositions.length; d++) {
      if (dotPositions[d] >= pos) { nextDot = dotPositions[d]; break; }
    }

    if (nextDot === -1) {
      // No more dots — remaining is an integer (shouldn't happen in practice)
      const remaining = s.substring(pos);
      if (remaining) { const n = Number(remaining); if (!isNaN(n)) numbers.push(n); }
      break;
    }

    // Integer part = pos..nextDot
    // Fractional part = nextDot+1..?
    // Default: take 2 decimal places
    let fracEnd = nextDot + 3; // .XX

    // But if taking 2 decimals would put us at a dot (meaning next number has no int part),
    // we need more decimal places. Check if character at fracEnd is a dot.
    while (fracEnd < s.length && s[fracEnd] === ".") {
      // The "dot" we hit is actually part of a very small number like 0.01859
      // Extend until we hit a non-digit or a position before the next dot
      fracEnd++;
    }

    // Also handle rates with more than 2 decimal places (e.g., 0.01859)
    // If the integer part is "0", extend fractional part further
    const intPart = s.substring(pos, nextDot);
    if (intPart === "0" || intPart === "") {
      // Small number like 0.01859 — extend until next dot or we have enough digits
      const nextDotAfter = dotPositions.find((d) => d > nextDot);
      if (nextDotAfter !== undefined) {
        // Take up to just before the integer part of the next number
        // The next number's integer part starts where digits begin before nextDotAfter
        // Walk backwards from nextDotAfter to find where the integer starts
        let intStart = nextDotAfter;
        while (intStart > fracEnd && /\d/.test(s[intStart - 1])) intStart--;
        // But we need at least one digit for the next number's integer part
        if (intStart > nextDot + 1) {
          fracEnd = intStart;
        }
      } else {
        fracEnd = s.length;
      }
    }

    // Ensure we don't go past the string
    fracEnd = Math.min(fracEnd, s.length);

    const numStr = s.substring(pos, fracEnd);
    const n = Number(numStr);
    if (!isNaN(n)) numbers.push(n);

    pos = fracEnd;
  }

  return numbers;
}

/** Fallback generic line item parser for non-Zoho invoices */
function parseGenericLines(lines: string[], parsedLines: ParsedLine[]) {
  for (const line of lines) {
    if (!line.trim()) continue;
    // Skip header/footer lines
    if (/^(item|#|description|qty|rate|amount|total|sub|tax|vat|balance|discount|payment|invoice|bill|date|due|terms|customer|from|to|tel|notes|bank|thank)/i.test(line.trim())) continue;

    // Pattern: "Description  123.00  45.00  5,535.00"
    const match = line.match(/^(.+?)\s{2,}([\d,]+\.?\d*)\s{2,}([\d,]+\.?\d*)\s{2,}([\d,]+\.?\d*)\s*$/);
    if (match) {
      const desc = match[1].trim();
      if (desc.length > 2) {
        parsedLines.push({
          description: desc,
          quantity: parseNum(match[2]),
          unit: guessUnit(desc),
          rate: parseNum(match[3]),
          amount: parseNum(match[4]),
        });
      }
    }
  }
}

function parseNum(s: string): number {
  return Number(s.replace(/,/g, "")) || 0;
}

function tryParseDate(s: string): Date | null {
  const clean = s.trim();

  // DD Mon YYYY
  const namedMonth = clean.match(/(\d{1,2})[\s/.-](\w{3,9})[\s/.-](\d{2,4})/);
  if (namedMonth) {
    const months: Record<string, number> = {
      jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
      jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
      january: 0, february: 1, march: 2, april: 3, june: 5,
      july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
    };
    const mon = months[namedMonth[2].toLowerCase()];
    if (mon !== undefined) {
      const year = namedMonth[3].length === 2 ? 2000 + parseInt(namedMonth[3]) : parseInt(namedMonth[3]);
      return new Date(year, mon, parseInt(namedMonth[1]));
    }
  }

  // DD/MM/YYYY
  const numDate = clean.match(/(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})/);
  if (numDate) {
    const year = numDate[3].length === 2 ? 2000 + parseInt(numDate[3]) : parseInt(numDate[3]);
    return new Date(year, parseInt(numDate[2]) - 1, parseInt(numDate[1]));
  }

  const d = new Date(clean);
  return isNaN(d.getTime()) ? null : d;
}

function guessUnit(desc: string): string {
  const lower = desc.toLowerCase();
  if (/\blength\b/i.test(lower)) return "LENGTH";
  if (/\bm\b|\bmetre|\bmeter|\blinear/i.test(lower)) return "M";
  if (/\bm2\b|\bsq\s*m/i.test(lower)) return "M2";
  if (/\bkg\b|\bkilo/i.test(lower)) return "KG";
  if (/\bpack|\bbox|\bbag/i.test(lower)) return "PACK";
  return "EA";
}
