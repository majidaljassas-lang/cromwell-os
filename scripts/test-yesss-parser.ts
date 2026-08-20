#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse/lib/pdf-parse");
// Compile TS on-the-fly for test via tsx would be heavier — just import the raw parser by mirroring logic. Instead we'll shell out to the compiled route later. For now, re-implement the small bit we need.
// Simpler: use esbuild to transpile. Even simpler: use tsx to run a ts script.

// Cheap path: copy the parseYesssPoText function here so we can test without tsx.
// But that doubles maintenance. So use dynamic TS import via jiti if available.

import { parseYesssPoText } from "../src/lib/ingestion/yesss-po-parser";

const SAMPLES = [
  "public/email-attachments/manual-upload_Purchase_Order_0061_015333.pdf",
  "public/email-attachments/2b5d1eb0_Purchase_Order_0088_110204__Ref._URGEBT_DELIVERY_.pdf",
  "public/email-attachments/0439a196_Purchase_Order_0088_110047__Ref.__.pdf",
  "public/email-attachments/630133e8_Purchase_Order_0088_110038__Ref.__.pdf",
  "public/email-attachments/58af1cdc_Purchase_Order_0088_109901__Ref._URGENT_DELIVERY_.pdf",
];

const EXPECTED = {
  "0061/015333": { lines: 5, total: 2460.18 },
  "0088/110204": { lines: 2, total: 595.35 },
  "0088/110047": { lines: 3, total: 105.0 },
  "0088/110038": { lines: 2, total: 87.5 },
  "0088/109901": { lines: 1, total: 350.0 },
};

async function main() {
  let allPassed = true;
  for (const rel of SAMPLES) {
    const abs = path.join(process.cwd(), rel);
    const buf = fs.readFileSync(abs);
    const { text } = await pdfParse(buf);
    const parsed = parseYesssPoText(text);
    if (!parsed) {
      console.log(`[FAIL] ${rel} — parser returned null`);
      allPassed = false;
      continue;
    }
    const expected = (EXPECTED as Record<string, {lines:number; total:number}>)[parsed.poNo];
    const linesOk = parsed.lines.length === expected?.lines;
    const totalOk = Math.abs(parsed.totalExVat - (expected?.total ?? 0)) < 0.01;
    const sumOk = Math.abs(parsed.lines.reduce((s, l) => s + l.lineTotal, 0) - parsed.totalExVat) < 0.01;
    const status = linesOk && totalOk && sumOk ? "PASS" : "FAIL";
    console.log(`[${status}] ${parsed.poNo} · ${parsed.branch} · ${parsed.issuer} · ${parsed.poDate}`);
    console.log(`       lines=${parsed.lines.length}/${expected?.lines} · total=£${parsed.totalExVat}/£${expected?.total} · sumMatches=${sumOk}`);
    for (const l of parsed.lines) {
      console.log(`       ${l.qty}× ${l.productCode.padEnd(14)} £${l.unitPrice.toFixed(2).padStart(8)} = £${l.lineTotal.toFixed(2).padStart(9)}  │ ${l.description.slice(0, 70)}`);
    }
    if (status === "FAIL") allPassed = false;
  }
  process.exit(allPassed ? 0 : 1);
}
main();
