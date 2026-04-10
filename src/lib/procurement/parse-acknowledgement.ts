/**
 * Parse supplier order acknowledgement text to extract line items.
 *
 * Supports multiple formats:
 * - F W HIPKIN / Verdis: "{code}  {desc}  Goods allocated  {qty} EA  {price} EA  {total}  S"
 * - Hargreaves Foundry: 2-line items "{itemNo} {code} {qty} {listPrice} {discPct} {date} {netTotal}" + description on next line
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
  const isHargreaves = /Hargreaves\s*Foundry/i.test(text);

  // Try format-specific parsers in order
  if (isHargreaves) {
    const hargreaves = parseHargreavesFormat(rawLines);
    if (hargreaves.length > 0) lines.push(...hargreaves);
  }

  if (lines.length === 0) {
    // Barco "Item No:" format is unusual because description/qty/price all
    // run together on a single line — try it first, before the more-generic
    // Hipkin/tabular parsers that could accidentally grab footer rows.
    const barco = parseBarcoFormat(rawLines);
    if (barco.length > 0) {
      lines.push(...barco);
    } else {
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
    }
  }

  // Extract supplier name
  for (const line of rawLines) {
    if (/Hargreaves\s*Foundry/i.test(line)) { supplierName = "Hargreaves Foundry"; break; }
    if (/F\s*W\s*Hipkin|VERDIS|Verdis/i.test(line)) { supplierName = "F W HIPKIN"; break; }
    if (/Navigator\s*MSL/i.test(line)) { supplierName = "Navigator MSL"; break; }
    if (/Wolseley|Plumb\s*Center/i.test(line)) { supplierName = "Wolseley"; break; }
    if (/PTS|Pipe\s*Center/i.test(line)) { supplierName = "PTS"; break; }
    if (/APP\s*Wholesale/i.test(line)) { supplierName = "APP Wholesale"; break; }
    if (/City\s*Plumbing/i.test(line)) { supplierName = "City Plumbing"; break; }
    if (/Barco\s*Sales/i.test(line)) { supplierName = "Barco Sales"; break; }
    if (/Hertfords/i.test(line) && /Barco/i.test(text)) { supplierName = "Barco Sales"; break; }
    if (/Primaflow/i.test(line)) { supplierName = "Primaflow F&P"; break; }
    if (/Hertfords.*Barco|Barco.*Hertfords/i.test(text)) { supplierName = "Barco Sales"; break; }
    if (/Toolstation/i.test(line)) { supplierName = "Toolstation"; break; }
    if (/Crosswater/i.test(line)) { supplierName = "Crosswater"; break; }
    if (/Ideal\s*Bathrooms/i.test(line)) { supplierName = "Ideal Bathrooms"; break; }
  }

  // Extract order ref
  for (const line of rawLines) {
    // Hargreaves explicit: "Our reference No. : 200622"
    const hargRef = line.match(/Our\s*reference\s*No\.?\s*:?\s*(\d{4,})/i);
    if (hargRef) { orderRef = hargRef[1].trim(); break; }
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
 * Hargreaves Foundry format — each item is on TWO source lines:
 *
 *   001 TX4043 4.00 123.13 50.00 10/04/26 246.28
 *   100mm TX Round Dr Access Pipe
 *
 * Layout: itemNo  productCode  qty  listUnitPrice  discPct  despatchDate  netLineValue
 * Net unit cost is derived from netLineValue / qty (already discounted),
 * which is more reliable than recomputing from listPrice * (1 - disc/100).
 */
function parseHargreavesFormat(rawLines: string[]): ParsedAckLine[] {
  const out: ParsedAckLine[] = [];
  const itemRe =
    /^(\d{3})\s+([A-Z]{1,4}\d{2,}[A-Z\d]*)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+\d{2}\/\d{2}\/\d{2,4}\s+([\d,]+\.\d{2})\s*$/;

  for (let i = 0; i < rawLines.length; i++) {
    const m = rawLines[i].match(itemRe);
    if (!m) continue;

    const productCode = m[2];
    const qty = parseFloat(m[3]);
    const lineTotal = parseFloat(m[6].replace(/,/g, ""));
    const unitCost = qty > 0 ? lineTotal / qty : 0;

    // Description is the next non-empty line that is not another item row
    // and not a header/footer marker.
    let description = productCode;
    for (let j = i + 1; j < Math.min(i + 4, rawLines.length); j++) {
      const next = rawLines[j];
      if (!next) continue;
      if (itemRe.test(next)) break;
      if (
        /^(TOTAL|CARRIAGE|VAT|Total\s+order|Page|Continued)/i.test(next)
      ) {
        break;
      }
      description = `${productCode} ${next}`.trim();
      break;
    }

    out.push({
      productCode,
      description: cleanDescription(description),
      qty,
      unitCost,
      lineTotal,
    });
  }

  return out;
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

/**
 * Barco Sales "Item No:CODE" format:
 *
 *   1  Item No:PROCUT22 11/04/26 TBA EA 1 12.38 0.00 % 12.38 12.38
 *   Rothenberger Pro-Cut 22mm Pipe Slice
 *   2  Item No:ST15 11/04/26 TBA EA 10 5.65 58.05 % 2.37 23.70
 *   Jg 15mm Equal Tee Connector (pem0215w)
 *
 * The PDF-to-text pass runs everything together so whitespace varies
 * wildly. We look for the "Item No:<code>" marker, grab the code, then
 * find the first numeric run after a UoM token (EA/M/etc) and parse
 * qty / gross / disc / nett / line value from the trailing numbers.
 * The description is the *next* non-empty line that doesn't look like
 * another Item No row.
 */
function parseBarcoFormat(rawLines: string[]): ParsedAckLine[] {
  const out: ParsedAckLine[] = [];

  // Tight regex: "Item No:<code>" then anything, ending in numbers.
  // Capture: code, then last 4 numbers (qty gross_or_disc nett lineValue).
  // The line layout is: <n>  Item No:<code>[request][promise]<uom><qty><gross><disc %><nett><value>
  // Numbers may be stuck together with text (no spaces in rendered PDF).
  const re =
    /Item\s*No\s*:?\s*([A-Z0-9][A-Z0-9\/\-_.]*)\s*(?:\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})?\s*(?:TBA|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})?\s*(?:EA|M|PC|PCS|KG|SET|PK)\s*(\d+(?:\.\d+)?)\s*([\d.]+)\s*(?:[\d.]+\s*%\s*)?([\d.]+)\s*([\d,]+\.\d{1,2})\s*$/i;

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    if (!/Item\s*No\s*:/i.test(line)) continue;

    const m = line.match(re);
    if (!m) {
      // Loose fallback: just grab the code + the last number on the line as total.
      const codeMatch = line.match(/Item\s*No\s*:?\s*([A-Z0-9][A-Z0-9\/\-_.]*)/i);
      if (!codeMatch) continue;
      const code = codeMatch[1];
      const nums = line.match(/[\d,]+\.\d{2}/g);
      if (!nums || nums.length < 2) continue;

      // Best-guess: last number = line total, second-to-last = nett price.
      const lineTotal = parseFloat(nums[nums.length - 1].replace(/,/g, ""));
      const nett = parseFloat(nums[nums.length - 2].replace(/,/g, ""));
      // Qty: look for standalone integer preceding the price block
      const qtyMatch = line.match(/(?:EA|M|PC|PCS|KG|SET|PK)\s*(\d+)/i);
      const qty = qtyMatch ? parseInt(qtyMatch[1], 10) : 1;

      const desc = findBarcoDescription(rawLines, i, code);
      out.push({
        productCode: code,
        description: cleanDescription(desc),
        qty,
        unitCost: nett || lineTotal / Math.max(qty, 1),
        lineTotal,
      });
      continue;
    }

    const code = m[1];
    const qty = parseFloat(m[2]);
    const nett = parseFloat(m[4]);
    const lineTotal = parseFloat(m[5].replace(/,/g, ""));

    const desc = findBarcoDescription(rawLines, i, code);
    out.push({
      productCode: code,
      description: cleanDescription(desc),
      qty,
      unitCost: nett || lineTotal / Math.max(qty, 1),
      lineTotal,
    });
  }

  return out;
}

function findBarcoDescription(
  rawLines: string[],
  idx: number,
  fallbackCode: string
): string {
  for (let j = idx + 1; j < Math.min(idx + 4, rawLines.length); j++) {
    const next = rawLines[j];
    if (!next) continue;
    // Another item row — stop
    if (/Item\s*No\s*:/i.test(next)) break;
    // Header / footer — stop
    if (/^(Total|NET|VAT|All\s*prices|Page|Sub\s*total|Description)/i.test(next)) break;
    // Looks like a pure numeric row — skip
    if (/^[\d\s.,£$%]+$/.test(next)) continue;
    if (next.length >= 4) return next;
  }
  return fallbackCode;
}

function cleanDescription(desc: string): string {
  return desc
    .replace(/\s+/g, " ")
    .replace(/^[\s-]+/, "")
    .replace(/[\s-]+$/, "")
    .trim();
}
