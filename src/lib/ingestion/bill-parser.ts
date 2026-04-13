/**
 * Supplier Bill PDF Text Parser
 *
 * Extracts structured data from raw text extracted from supplier bill PDFs.
 * Handles common plumbing supplier formats:
 * - Tabular: Qty | Description | Unit Price | Amount
 * - Tabular: Product Code | Description | Qty | Price | VAT | Total
 * - Misc variations with different column orders
 */

export interface ParsedBillLine {
  description: string;
  productCode: string | null;
  qty: number;
  unitCost: number;
  lineTotal: number;
  vatAmount: number | null;
}

export interface ParsedBill {
  billNo: string | null;
  billDate: string | null;       // ISO date string YYYY-MM-DD
  supplierName: string | null;
  subtotal: number | null;
  vatTotal: number | null;
  grandTotal: number | null;
  lines: ParsedBillLine[];
}

// ─── Main Entry Point ───────────────────────────────────────────────────────

export function parseBillText(rawText: string): ParsedBill {
  const result: ParsedBill = {
    billNo: null,
    billDate: null,
    supplierName: null,
    subtotal: null,
    vatTotal: null,
    grandTotal: null,
    lines: [],
  };

  if (!rawText || rawText.trim().length === 0) return result;

  const lines = rawText.split("\n").map((l) => l.trim());

  result.billNo = extractBillNumber(lines);
  result.billDate = extractBillDate(lines);
  result.supplierName = extractSupplierName(lines);

  // Extract totals
  const totals = extractTotals(lines);
  result.subtotal = totals.subtotal;
  result.vatTotal = totals.vatTotal;
  result.grandTotal = totals.grandTotal;

  // Extract line items
  result.lines = extractLineItems(lines);

  // If no grand total found but we have lines, sum them
  if (result.grandTotal === null && result.lines.length > 0) {
    result.grandTotal = result.lines.reduce((sum, l) => sum + l.lineTotal, 0);
  }

  return result;
}

// ─── Bill Number Extraction ─────────────────────────────────────────────────

function extractBillNumber(lines: string[]): string | null {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // "Invoice No: 12345", "Invoice Number: INV-12345", "Bill No: B-001"
    const patterns = [
      /(?:invoice|inv|bill|document|doc|credit\s*note|debit\s*note)\s*(?:no|number|#|ref|reference)\s*[:.]?\s*([A-Z0-9][\w\-\/]+)/i,
      /(?:our\s*ref|your\s*ref|reference)\s*[:.]?\s*([A-Z0-9][\w\-\/]+)/i,
      /#\s*(INV[-\s]?\d+[\w-]*)/i,
      /\b(INV[-]?\d{3,}[\w-]*)\b/i,
    ];

    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match) {
        return match[1].trim();
      }
    }

    // Handle "Invoice Number" on one line, number on nearby line (Kerridge K8)
    // The number may not be immediately next — scan ahead up to 5 lines
    if (/invoice\s*number/i.test(line)) {
      for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
        const candidate = lines[j].trim();
        if (/^\d{4}\/\d{5,}$/.test(candidate)) {
          return candidate;
        }
      }
    }
  }
  return null;
}

// ─── Date Extraction ────────────────────────────────────────────────────────

function extractBillDate(lines: string[]): string | null {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // "Invoice Date: 08/04/2026", "Date: 2026-04-08", "Bill Date: 08 Apr 2026"
    const inlineMatch = line.match(
      /(?:invoice\s*date|bill\s*date|tax\s*point|date|dated)\s*[:.]?\s*(\d{1,2}[\s\/\-\.]\w{3,9}[\s\/\-\.]\d{2,4}|\d{1,2}[\s\/\-\.]\d{1,2}[\s\/\-\.]\d{2,4}|\d{4}[\-\/]\d{2}[\-\/]\d{2})/i
    );
    if (inlineMatch) {
      const parsed = tryParseDate(inlineMatch[1]);
      if (parsed) return parsed;
    }

    // Label on one line, date on next
    if (/(?:invoice\s*date|bill\s*date|date)\s*:?\s*$/i.test(line)) {
      for (let j = i + 1; j < Math.min(i + 3, lines.length); j++) {
        if (lines[j].trim()) {
          const parsed = tryParseDate(lines[j].trim());
          if (parsed) return parsed;
        }
      }
    }
  }
  return null;
}

function tryParseDate(s: string): string | null {
  const clean = s.trim();

  // YYYY-MM-DD (ISO)
  const isoMatch = clean.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  // DD Mon YYYY or DD-Mon-YYYY
  const namedMonth = clean.match(/(\d{1,2})[\s\/.\-](\w{3,9})[\s\/.\-](\d{2,4})/);
  if (namedMonth) {
    const months: Record<string, string> = {
      jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
      jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
      january: "01", february: "02", march: "03", april: "04", june: "06",
      july: "07", august: "08", september: "09", october: "10", november: "11", december: "12",
    };
    const mon = months[namedMonth[2].toLowerCase()];
    if (mon) {
      const year = namedMonth[3].length === 2 ? `20${namedMonth[3]}` : namedMonth[3];
      return `${year}-${mon}-${namedMonth[1].padStart(2, "0")}`;
    }
  }

  // DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY (UK format)
  const numDate = clean.match(/(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/);
  if (numDate) {
    const year = numDate[3].length === 2 ? `20${numDate[3]}` : numDate[3];
    return `${year}-${numDate[2].padStart(2, "0")}-${numDate[1].padStart(2, "0")}`;
  }

  return null;
}

// ─── Supplier Name Extraction ───────────────────────────────────────────────

function extractSupplierName(lines: string[]): string | null {
  // Often the supplier name is the first non-empty line, or appears after "From:"
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // "From: Supplier Name" or "Supplier: Name"
    const fromMatch = line.match(/(?:from|supplier|vendor|sold\s*by)\s*[:.]?\s*(.+)/i);
    if (fromMatch && fromMatch[1].trim().length > 2) {
      return fromMatch[1].trim();
    }
  }

  // Fallback: first non-empty line that looks like a company name (not a date, not numbers-only)
  for (const line of lines.slice(0, 10)) {
    if (
      line.length > 3 &&
      !/^\d/.test(line) &&
      !/^(invoice|bill|date|page|tel|fax|email|vat|company|reg)/i.test(line) &&
      !/^(to|from|ship|deliver)/i.test(line) &&
      !/@/.test(line)
    ) {
      return line;
    }
  }

  return null;
}

// ─── Totals Extraction ──────────────────────────────────────────────────────

function extractTotals(lines: string[]): {
  subtotal: number | null;
  vatTotal: number | null;
  grandTotal: number | null;
} {
  let subtotal: number | null = null;
  let vatTotal: number | null = null;
  let grandTotal: number | null = null;

  for (const line of lines) {
    // Grand total — match last to allow overwriting with more specific patterns
    const grandMatch = line.match(
      /(?:grand\s*total|total\s*(?:inc(?:l)?\.?\s*vat|amount\s*due|due|payable|to\s*pay))\s*[:.]?\s*£?\s*([\d,]+\.?\d*)/i
    );
    if (grandMatch) {
      grandTotal = parseNum(grandMatch[1]);
      continue;
    }

    // Subtotal / Net
    const subMatch = line.match(
      /(?:sub\s*total|net\s*(?:total|amount)|total\s*(?:ex(?:cl)?\.?\s*vat|net|goods))\s*[:.]?\s*£?\s*([\d,]+\.?\d*)/i
    );
    if (subMatch) {
      subtotal = parseNum(subMatch[1]);
      continue;
    }

    // VAT total
    const vatMatch = line.match(
      /(?:vat\s*(?:total|amount)?|total\s*vat)\s*[:.]?\s*£?\s*([\d,]+\.?\d*)/i
    );
    if (vatMatch) {
      vatTotal = parseNum(vatMatch[1]);
      continue;
    }

    // Generic "Total" at bottom (no qualifier)
    const totalMatch = line.match(
      /^total\s*[:.]?\s*£?\s*([\d,]+\.?\d*)$/i
    );
    if (totalMatch && grandTotal === null) {
      grandTotal = parseNum(totalMatch[1]);
    }
  }

  return { subtotal, vatTotal, grandTotal };
}

// ─── Line Items Extraction ──────────────────────────────────────────────────

function extractLineItems(lines: string[]): ParsedBillLine[] {
  const parsed: ParsedBillLine[] = [];

  // Step 0: Kerridge K8 / VERDIS format (F W Hipkin, etc.)
  // Lines start with product code (K-number), description, then "qty EA  price EA  total V"
  parseKerridgeK8(lines, parsed);

  // Step 1: Find header row to determine column layout
  if (parsed.length === 0) {
    const headerInfo = findHeaderRow(lines);
    if (headerInfo) {
      parseFromHeader(lines, headerInfo.headerIndex, parsed);
    }
  }

  // Step 2: Fallback — generic tabular parsing
  if (parsed.length === 0) {
    parseGenericTabular(lines, parsed);
  }

  // Step 3: Fallback — Zoho-style concatenated numbers
  if (parsed.length === 0) {
    parseZohoStyle(lines, parsed);
  }

  return parsed;
}

interface HeaderInfo {
  headerIndex: number;
  hasProductCode: boolean;
  hasVat: boolean;
}

function findHeaderRow(lines: string[]): HeaderInfo | null {
  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].toLowerCase();

    // Must contain at least "description" or "item" AND some numeric column
    const hasDesc = /\b(description|item|product|material|particulars)\b/.test(lower);
    const hasQty = /\b(qty|quantity|quant|qnty)\b/.test(lower);
    const hasPrice = /\b(price|cost|rate|unit\s*cost|each)\b/.test(lower);
    const hasAmount = /\b(amount|total|value|line\s*total|ext|extended|net)\b/.test(lower);

    if (hasDesc && (hasQty || hasPrice || hasAmount)) {
      return {
        headerIndex: i,
        hasProductCode: /\b(code|product\s*code|part\s*no|sku|ref)\b/.test(lower),
        hasVat: /\b(vat|tax)\b/.test(lower),
      };
    }
  }
  return null;
}

function parseFromHeader(
  lines: string[],
  headerIndex: number,
  parsed: ParsedBillLine[]
) {
  // Start parsing from the line after the header
  for (let i = headerIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    // Stop at totals section
    if (/^(sub\s*total|total|net|vat|grand|amount\s*due|balance|payment|thank|bank|notes)/i.test(line.trim())) {
      break;
    }

    // Try to extract a line item
    const item = parseTableRow(line);
    if (item) {
      parsed.push(item);
    }
  }
}

function parseTableRow(line: string): ParsedBillLine | null {
  // Pattern 1: Product code + description + numbers
  // "ABC123  28mm Copper Tube 3m  10  28.18  281.80"
  const withCode = line.match(
    /^([A-Z0-9][\w\-]{2,})\s{2,}(.+?)\s{2,}([\d,]+\.?\d*)\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)(?:\s+([\d,]+\.?\d*))?$/
  );
  if (withCode) {
    const nums = [withCode[3], withCode[4], withCode[5], withCode[6]].filter(Boolean).map(parseNum);
    const resolved = resolveColumns(nums);
    if (resolved && withCode[2].trim().length > 2) {
      return {
        description: withCode[2].trim(),
        productCode: withCode[1].trim(),
        qty: resolved.qty,
        unitCost: resolved.unitCost,
        lineTotal: resolved.lineTotal,
        vatAmount: resolved.vatAmount,
      };
    }
  }

  // Pattern 2: Description + 3-4 numbers at end
  // "28mm Copper Tube 3m  10  28.18  281.80"
  const descNums = line.match(
    /^(.+?)\s{2,}([\d,]+\.?\d*)\s+([\d,]+\.?\d*)\s+([\d,]+\.?\d*)(?:\s+([\d,]+\.?\d*))?$/
  );
  if (descNums) {
    const desc = descNums[1].trim();
    const nums = [descNums[2], descNums[3], descNums[4], descNums[5]].filter(Boolean).map(parseNum);
    const resolved = resolveColumns(nums);
    if (resolved && desc.length > 2) {
      // Check if first part of desc is actually a product code
      const codeMatch = desc.match(/^([A-Z0-9][\w\-]{2,})\s+(.+)/);
      return {
        description: codeMatch ? codeMatch[2] : desc,
        productCode: codeMatch ? codeMatch[1] : null,
        qty: resolved.qty,
        unitCost: resolved.unitCost,
        lineTotal: resolved.lineTotal,
        vatAmount: resolved.vatAmount,
      };
    }
  }

  // Pattern 3: Numbers + description + numbers (qty at start)
  // "10  28mm Copper Tube 3m  28.18  281.80"
  const numDescNum = line.match(
    /^([\d,]+\.?\d*)\s{2,}(.+?)\s{2,}([\d,]+\.?\d*)\s+([\d,]+\.?\d*)(?:\s+([\d,]+\.?\d*))?$/
  );
  if (numDescNum) {
    const desc = numDescNum[2].trim();
    const qty = parseNum(numDescNum[1]);
    const remaining = [numDescNum[3], numDescNum[4], numDescNum[5]].filter(Boolean).map(parseNum);

    if (desc.length > 2 && qty > 0) {
      let unitCost: number, lineTotal: number, vatAmount: number | null = null;

      if (remaining.length >= 3) {
        unitCost = remaining[0];
        vatAmount = remaining[1];
        lineTotal = remaining[2];
      } else if (remaining.length === 2) {
        unitCost = remaining[0];
        lineTotal = remaining[1];
      } else {
        lineTotal = remaining[0];
        unitCost = qty > 0 ? lineTotal / qty : lineTotal;
      }

      return {
        description: desc,
        productCode: null,
        qty,
        unitCost: unitCost!,
        lineTotal,
        vatAmount,
      };
    }
  }

  // Pattern 4: Two numbers only (description + qty + total, no unit price)
  const twoNums = line.match(
    /^(.+?)\s{2,}([\d,]+\.?\d*)\s+([\d,]+\.?\d*)$/
  );
  if (twoNums) {
    const desc = twoNums[1].trim();
    const n1 = parseNum(twoNums[2]);
    const n2 = parseNum(twoNums[3]);

    if (desc.length > 2 && n2 > 0) {
      // Smaller number is qty, larger is total
      const qty = n1 < n2 ? n1 : 1;
      const lineTotal = n2;
      const unitCost = qty > 0 ? lineTotal / qty : lineTotal;
      return {
        description: desc,
        productCode: null,
        qty,
        unitCost: Math.round(unitCost * 100) / 100,
        lineTotal,
        vatAmount: null,
      };
    }
  }

  return null;
}

function resolveColumns(nums: number[]): {
  qty: number;
  unitCost: number;
  lineTotal: number;
  vatAmount: number | null;
} | null {
  if (nums.length < 2) return null;

  if (nums.length === 4) {
    // qty, unit cost, vat, total  OR  qty, unit cost, total, vat
    // The largest is usually the total; vat is ~20% of subtotal
    const [a, b, c, d] = nums;
    if (d >= c) {
      // Last is biggest: qty, unitCost, vat, total
      return { qty: a, unitCost: b, vatAmount: c, lineTotal: d };
    } else {
      // Third is biggest: qty, unitCost, total, vat
      return { qty: a, unitCost: b, lineTotal: c, vatAmount: d };
    }
  }

  if (nums.length === 3) {
    // qty, unit cost, total
    const [a, b, c] = nums;
    // Validate: qty * unitCost should approximately equal total
    if (a > 0 && Math.abs(a * b - c) < c * 0.05 + 0.5) {
      return { qty: a, unitCost: b, lineTotal: c, vatAmount: null };
    }
    // Maybe total is last regardless
    return { qty: a, unitCost: b, lineTotal: c, vatAmount: null };
  }

  if (nums.length === 2) {
    // qty and total
    const qty = nums[0] < nums[1] ? nums[0] : 1;
    const lineTotal = nums[1];
    return {
      qty,
      unitCost: qty > 0 ? Math.round((lineTotal / qty) * 100) / 100 : lineTotal,
      lineTotal,
      vatAmount: null,
    };
  }

  return null;
}

// ─── Kerridge K8 / VERDIS Format ───────────────────────────────────────────
// Used by F W Hipkin, and other Kerridge-based suppliers.
// Pattern: product code starts line, description follows, trailing numbers are qty/price/total.
// Multi-line descriptions: continuation lines don't start with a product code.
// Example: "K08170 KP-MR15 - 15mm Munsen Ring (50) 50 EA 0.24 EA 12.00 S"
// Or spread across lines:
//   "K09933    K09933 - Galvanised Band - 12mm x"
//   "          10m (10)"
//   followed by "6 EA 2.00 EA 12.00 S"

function parseKerridgeK8(lines: string[], parsed: ParsedBillLine[]) {
  // Detect if this is a K8 format: look for product code pattern at line starts
  const productCodePattern = /^[A-Z]\d{4,}/;
  const k8Lines = lines.filter(l => productCodePattern.test(l.trim()));
  if (k8Lines.length < 2) return; // Not a K8 format

  // Skip non-product lines
  const skipPatterns = [
    /^product\s*code/i, /^advice\s*note/i, /^continued/i,
    /^invoice/i, /^deliver/i, /^account/i, /^mobile/i, /^tel\s*no/i,
    /^reg\s*no/i, /^verdis/i, /^powered/i, /^page/i,
    /^\s*$/, /^cromwell/i, /^harrow/i, /^north\s*kensington/i,
    /^london/i, /^w10/i, /^net\s*goods/i, /^vat/i, /^total/i,
    /^carriage/i, /^sub\s*total/i, /^\d{4,}\/\d+$/, /^0\d{9,}/,
    /^your\s*(contact|reference)/i, /^taxpoint/i, /^order\s*number/i,
    /^email/i, /^our\s*operator/i, /^majid/i,
  ];

  function shouldSkip(line: string): boolean {
    return skipPatterns.some(p => p.test(line.trim()));
  }

  // Regex for trailing numbers: "qty EA price EA [-discount%] total V"
  // Handles: "50 EA  0.24 EA   12.00  S"
  // Handles: "6 EA  1.88 EA  -72.00%          3.18  S"  (discount with spaces before total)
  const trailingNumbersPattern = /(\d+)\s+EA\s+([\d.]+)\s+EA\s+(?:-?[\d.]+%\s+)?\s*([\d.]+)\s+[A-Z]\s*$/;

  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    if (shouldSkip(line) || !line) { i++; continue; }

    // Check if line starts with a product code
    const codeMatch = line.match(/^([A-Z]\d{4,})\s+(.*)/);
    if (!codeMatch) { i++; continue; }

    const productCode = codeMatch[1];
    let restOfLine = codeMatch[2];

    // Check if this line itself has trailing numbers
    let numbersMatch = restOfLine.match(trailingNumbersPattern);

    if (numbersMatch) {
      // Numbers on same line as product code
      let description = restOfLine.replace(trailingNumbersPattern, "").trim();
      // Check if next line(s) are description continuation (not a product code, not numbers-only)
      let j = i + 1;
      while (j < lines.length) {
        const nextL = lines[j].trim();
        if (!nextL || shouldSkip(nextL) || productCodePattern.test(nextL)) break;
        // If it has trailing numbers pattern, it's a new item that was on a continuation — stop
        if (trailingNumbersPattern.test(nextL)) break;
        if (/^\d+\s+EA\s+/.test(nextL)) break;
        description += " " + nextL;
        j++;
      }
      parsed.push({
        description: cleanDescription(description),
        productCode,
        qty: parseInt(numbersMatch[1]),
        unitCost: parseFloat(numbersMatch[2]),
        lineTotal: parseFloat(numbersMatch[3]),
        vatAmount: null,
      });
      i = j;
      continue;
    }

    // Numbers might be on a subsequent line — collect description continuation
    let fullDescription = restOfLine;
    i++;

    // Look ahead for continuation lines (don't start with product code, don't have numbers yet)
    while (i < lines.length) {
      const nextLine = lines[i].trim();
      if (!nextLine || shouldSkip(nextLine)) { i++; continue; }
      if (productCodePattern.test(nextLine)) break; // Next product

      // Check if this continuation has the trailing numbers
      numbersMatch = nextLine.match(trailingNumbersPattern);
      if (numbersMatch) {
        const extraDesc = nextLine.replace(trailingNumbersPattern, "").trim();
        if (extraDesc) fullDescription += " " + extraDesc;
        parsed.push({
          description: cleanDescription(fullDescription),
          productCode,
          qty: parseInt(numbersMatch[1]),
          unitCost: parseFloat(numbersMatch[2]),
          lineTotal: parseFloat(numbersMatch[3]),
          vatAmount: null,
        });
        i++;
        break;
      }

      // Also check simpler pattern: just "qty EA price EA total S" on its own line
      const simpleMatch = nextLine.match(/^(\d+)\s+EA\s+([\d.]+)\s+EA\s+(?:-?[\d.]+%\s+)?\s*([\d.]+)\s+[A-Z]\s*$/);
      if (simpleMatch) {
        parsed.push({
          description: cleanDescription(fullDescription),
          productCode,
          qty: parseInt(simpleMatch[1]),
          unitCost: parseFloat(simpleMatch[2]),
          lineTotal: parseFloat(simpleMatch[3]),
          vatAmount: null,
        });
        i++;
        break;
      }

      // It's a description continuation line
      fullDescription += " " + nextLine;
      i++;
    }
  }
}

function cleanDescription(desc: string): string {
  // Remove leading product code reference if duplicated (e.g., "K09933 - Galvanised Band")
  // Keep the human-readable part
  return desc.replace(/^[A-Z]\d{4,}\s*[-–]\s*/, "").replace(/\s+/g, " ").trim();
}

// ─── Fallback: Generic Tabular ──────────────────────────────────────────────

function parseGenericTabular(lines: string[], parsed: ParsedBillLine[]) {
  for (const line of lines) {
    if (!line.trim()) continue;

    // Skip header/footer/label lines
    if (/^(description|item|product|qty|quantity|unit|price|total|amount|vat|sub|net)/i.test(line.trim())) continue;
    if (/^(invoice|bill|date|deliver|ship|page|tel|fax|email|www|from|to|address|company|reg|bank|sort|account|thank|payment|terms|due|balance|discount|credit|note)/i.test(line.trim())) continue;

    // Same patterns as parseTableRow
    const item = parseTableRow(line);
    if (item) {
      parsed.push(item);
    }
  }
}

// ─── Fallback: Zoho-style concatenated numbers ──────────────────────────────

function parseZohoStyle(lines: string[], parsed: ParsedBillLine[]) {
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Detect: "{number} Materials" or similar
    const itemStart = line.match(/^(\d+)\s+(Materials?|Labour|Labor|Service|Expense)/i);
    if (itemStart) {
      const descParts: string[] = [];
      let j = i + 1;

      while (j < lines.length) {
        const nextLine = lines[j].trim();
        if (!nextLine) { j++; continue; }

        const isNumbersLine = /^[\d,.]+$/.test(nextLine) && (nextLine.match(/\.\d{2}/g) || []).length >= 2;

        if (isNumbersLine) {
          const nums = parseZohoNumbers(nextLine);
          if (nums) {
            const desc = descParts.join(" ").trim();
            if (desc.length > 0) {
              parsed.push({
                description: desc,
                productCode: null,
                qty: nums.qty,
                unitCost: nums.rate,
                lineTotal: nums.amount,
                vatAmount: null,
              });
            }
          }
          i = j + 1;
          break;
        }

        if (/^\d+\s+(Materials?|Labour|Labor|Service|Expense)/i.test(nextLine)) break;

        descParts.push(nextLine);
        j++;
      }

      if (j >= lines.length) i = j;
      continue;
    }

    i++;
  }
}

function parseZohoNumbers(raw: string): { qty: number; rate: number; amount: number } | null {
  const s = raw.replace(/,/g, "");

  // Try to use "20.00" as VAT% anchor
  const candidates: number[] = [];
  let searchFrom = 0;
  while (true) {
    const idx = s.indexOf("20.00", searchFrom);
    if (idx === -1) break;
    candidates.push(idx);
    searchFrom = idx + 1;
  }

  for (const vatIdx of candidates) {
    const before = s.substring(0, vatIdx);
    const after = s.substring(vatIdx + 5);

    const beforeParts = splitDecimals(before);
    const afterParts = splitDecimals(after);
    if (beforeParts.length >= 2 && afterParts.length >= 2) {
      const qty = beforeParts[0];
      const rate = beforeParts[1];
      const amount = afterParts[afterParts.length - 1];
      if (qty > 0 && amount > 0) {
        const expected = qty * rate;
        if (Math.abs(expected - amount) <= Math.max(amount * 0.02, 0.5)) {
          return { qty, rate, amount };
        }
      }
    }
  }

  // Fallback without VAT anchor
  const parts = splitDecimals(s);
  if (parts.length >= 3) {
    return { qty: parts[0], rate: parts[1], amount: parts[parts.length - 1] };
  }

  return null;
}

function splitDecimals(s: string): number[] {
  if (!s) return [];
  // Match decimal numbers like "123.45" or "0.01"
  const matches = s.match(/\d+\.?\d*/g);
  if (!matches) return [];
  return matches.map(Number).filter((n) => !isNaN(n));
}

// ─── Utility ────────────────────────────────────────────────────────────────

function parseNum(s: string): number {
  return Number(s.replace(/,/g, "")) || 0;
}
