/**
 * Parse supplier order acknowledgement text to extract line items.
 *
 * Supports multiple formats:
 * - F W HIPKIN / Verdis: "{code}  {desc}  Goods allocated  {qty} EA  {price} EA  {total}  S"
 * - Generic tabular: "Description  Qty  Price  Total" style tables
 * - Navigator MSL: "Item No  Description  Qty  Price  Total"
 * - Generic rows with description + qty + price patterns
 */

export interface ParsedAckLine {
  productCode: string | null;
  description: string;
  qty: number;
  unitCost: number;
  lineTotal: number;
}

export interface ParsedAcknowledgement {
  lines: ParsedAckLine[];
  supplierName: string | null;
  orderRef: string | null;
  totalNet: number | null;
}

export function parseAcknowledgementText(text: string): ParsedAcknowledgement {
  const lines: ParsedAckLine[] = [];
  let supplierName: string | null = null;
  let orderRef: string | null = null;
  let totalNet: number | null = null;

  const rawLines = text.split("\n").map((l) => l.trim());

  // Try format-specific parsers in order
  const hipkin = parseHipkinFormat(rawLines);
  if (hipkin.length > 0) {
    lines.push(...hipkin);
  } else {
    const generic = parseGenericTabular(rawLines);
    if (generic.length > 0) {
      lines.push(...generic);
    } else {
      const fallback = parseFallbackRows(rawLines);
      lines.push(...fallback);
    }
  }

  // Extract supplier name
  for (const line of rawLines) {
    if (/F\s*W\s*Hipkin|VERDIS|Verdis/i.test(line)) { supplierName = "F W HIPKIN"; break; }
    if (/Navigator\s*MSL/i.test(line)) { supplierName = "Navigator MSL"; break; }
    if (/Wolseley|Plumb\s*Center/i.test(line)) { supplierName = "Wolseley"; break; }
    if (/PTS|Pipe\s*Center/i.test(line)) { supplierName = "PTS"; break; }
    if (/APP\s*Wholesale/i.test(line)) { supplierName = "APP Wholesale"; break; }
    if (/City\s*Plumbing/i.test(line)) { supplierName = "City Plumbing"; break; }
  }

  // Extract order ref
  for (const line of rawLines) {
    const refMatch = line.match(/(?:Order\s*(?:Number|No|Ref)|Reference\s*(?:Number|No))\s*:?\s*([A-Z0-9/\-_.]+)/i)
      || line.match(/^(0001\/\d+)\s*$/);
    if (refMatch) { orderRef = refMatch[1].trim(); break; }
  }

  // Extract total
  for (const line of rawLines) {
    const totalMatch = line.match(/(?:Total\s*Goods|Sub\s*total|Subtotal|Net\s*Total|Total)\s*[£$]?\s*([\d,]+\.?\d*)/i);
    if (totalMatch) {
      const val = Number(totalMatch[1].replace(/,/g, ""));
      if (val > 0) { totalNet = val; break; }
    }
  }

  return { lines, supplierName, orderRef, totalNet };
}

/**
 * F W HIPKIN / Verdis format:
 * K08170        KP-MR15 - 15mm Munsen Ring (50)         Goods allocated    50 EA   0.24 EA    12.00  S
 * Multi-line descriptions are indented continuation lines.
 */
function parseHipkinFormat(rawLines: string[]): ParsedAckLine[] {
  const lines: ParsedAckLine[] = [];

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];

    // Match: ProductCode   Description   Goods allocated   Qty EA   Price EA   Total   S
    const match = line.match(
      /^([A-Z]\d{3,})\s{2,}(.+?)\s{2,}(?:Goods\s+allocated|Back\s+order|Due\s+in)\s+(\d+)\s+EA\s+([\d.]+)\s+EA\s+(?:-?\d+\.?\d*%)?\s*([\d,.]+)\s+[SZE]/i
    );

    if (match) {
      let desc = match[2].trim();

      // Check if next line(s) are continuation of description (indented, no product code)
      let j = i + 1;
      while (j < rawLines.length) {
        const next = rawLines[j];
        // Continuation: doesn't start with product code pattern, isn't another item, not a header/footer
        if (
          next &&
          !next.match(/^[A-Z]\d{3,}/) &&
          !next.match(/^Product\s+Code/i) &&
          !next.match(/^Document\s+Number/i) &&
          !next.match(/^Mobile\s+No/i) &&
          !next.match(/^Reg\s+No/i) &&
          !next.match(/^Account/i) &&
          !next.match(/^Rate\s+Goods/i) &&
          !next.match(/^\d{7,}/) &&
          !next.match(/^(Invoice|Deliver|Acknowledgement|Continued)/i) &&
          next.length > 1 &&
          next.length < 60
        ) {
          desc += " " + next;
          j++;
        } else {
          break;
        }
      }

      lines.push({
        productCode: match[1],
        description: cleanDescription(desc),
        qty: parseInt(match[3]),
        unitCost: parseFloat(match[4]),
        lineTotal: parseFloat(match[5].replace(/,/g, "")),
      });
    }
  }

  return lines;
}

/**
 * Generic tabular format — looks for rows with description + numbers.
 * Handles:
 * - "28mm x 3M Black Label Copper Tube    £963.00    10 Pcs    £963.00"
 * - "35mm LEVER BALL VALVE BLUE    2    £15.29    £30.58"
 * - "Description    Qty    Price    Total"
 */
function parseGenericTabular(rawLines: string[]): ParsedAckLine[] {
  const lines: ParsedAckLine[] = [];

  for (const line of rawLines) {
    if (!line || line.length < 10) continue;

    // Skip obvious header/footer lines
    if (/^(item|#|image|description|product|qty|quantity|price|total|sub|tax|vat|balance|discount|payment|invoice|bill|date|shipping|delivery|order\s*(?:number|no|ref|confirmation|details))/i.test(line)) continue;
    if (/^(thank|bank|account|sort|tel|mobile|email|page|reg\s*no|cromwell|your|our|deliver|address)/i.test(line)) continue;

    // Pattern 1: "Description  qty  price  total" with £ signs
    // e.g. "35mm LEVER BALL VALVE BLUE  2  £15.29  £30.58"
    const p1 = line.match(/^(.{10,}?)\s{2,}(\d+(?:\.\d+)?)\s+[£$]?([\d,]+\.?\d+)\s+[£$]?([\d,]+\.?\d+)\s*$/);
    if (p1) {
      const desc = p1[1].trim();
      if (desc.length > 3 && !/^\d+$/.test(desc)) {
        lines.push({
          productCode: null,
          description: cleanDescription(desc),
          qty: parseFloat(p1[2]),
          unitCost: parseFloat(p1[3].replace(/,/g, "")),
          lineTotal: parseFloat(p1[4].replace(/,/g, "")),
        });
        continue;
      }
    }

    // Pattern 2: "Description  £price  qty  £total"
    // e.g. "28mm x 3M Copper Tube  £963.00  10  £963.00"
    const p2 = line.match(/^(.{10,}?)\s{2,}[£$]?([\d,]+\.?\d+)\s+(\d+(?:\.\d+)?)\s*(?:Pcs|EA|pc|pcs|ea)?\s+[£$]?([\d,]+\.?\d+)\s*$/);
    if (p2) {
      const desc = p2[1].trim();
      if (desc.length > 3 && !/^\d+$/.test(desc)) {
        const price = parseFloat(p2[2].replace(/,/g, ""));
        const qty = parseFloat(p2[3]);
        const total = parseFloat(p2[4].replace(/,/g, ""));
        lines.push({
          productCode: null,
          description: cleanDescription(desc),
          qty,
          unitCost: qty > 0 ? price / qty : price,
          lineTotal: total,
        });
        continue;
      }
    }

    // Pattern 3: Code + Description + Qty + Price + Total
    // e.g. "BBLVR-35  35mm LEVER BALL VALVE RED  2  £15.29  £30.58"
    const p3 = line.match(/^([A-Z0-9][\w-]+)\s{2,}(.{5,}?)\s{2,}(\d+(?:\.\d+)?)\s+[£$]?([\d,]+\.?\d+)\s+[£$]?([\d,]+\.?\d+)\s*$/);
    if (p3) {
      lines.push({
        productCode: p3[1],
        description: cleanDescription(p3[2]),
        qty: parseFloat(p3[3]),
        unitCost: parseFloat(p3[4].replace(/,/g, "")),
        lineTotal: parseFloat(p3[5].replace(/,/g, "")),
      });
      continue;
    }

    // Pattern 4: Product code on its own then description with numbers on same line
    // e.g. "K08170  15mm Munsen Ring  50  0.24  12.00"
    const p4 = line.match(/^([A-Z]\w{3,})\s{2,}(.{5,}?)\s{2,}(\d+(?:\.\d+)?)\s+([\d.]+)\s+([\d,.]+)\s*$/);
    if (p4) {
      lines.push({
        productCode: p4[1],
        description: cleanDescription(p4[2]),
        qty: parseFloat(p4[3]),
        unitCost: parseFloat(p4[4]),
        lineTotal: parseFloat(p4[5].replace(/,/g, "")),
      });
    }
  }

  return lines;
}

/**
 * Last resort — find any line with a description + at least 2 numbers.
 */
function parseFallbackRows(rawLines: string[]): ParsedAckLine[] {
  const lines: ParsedAckLine[] = [];

  for (const line of rawLines) {
    if (!line || line.length < 15) continue;
    if (/^(item|#|product|qty|price|total|sub|tax|vat|shipping|delivery|order|thank|bank)/i.test(line)) continue;

    // Find lines with text followed by numbers: "Some Description 10 2.50 25.00"
    const match = line.match(/^(.{8,}?)\s+([\d,]+(?:\.\d+)?)\s+[£$]?([\d,]+\.?\d+)\s+[£$]?([\d,]+\.?\d+)\s*$/);
    if (match) {
      const desc = match[1].trim();
      // Filter out non-description text
      if (desc.length > 5 && !/^[\d.£$,]+$/.test(desc) && !/^(total|sub|net|gross|vat|tax)/i.test(desc)) {
        lines.push({
          productCode: null,
          description: cleanDescription(desc),
          qty: parseFloat(match[2].replace(/,/g, "")),
          unitCost: parseFloat(match[3].replace(/,/g, "")),
          lineTotal: parseFloat(match[4].replace(/,/g, "")),
        });
      }
    }
  }

  return lines;
}

function cleanDescription(desc: string): string {
  return desc
    .replace(/\s+/g, " ")
    .replace(/^[\s-]+/, "")
    .replace(/[\s-]+$/, "")
    .trim();
}
