#!/usr/bin/env node
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse/lib/pdf-parse");
import "dotenv/config";
import { parsePOWithAI } from "../src/lib/ingestion/ai-po-parser";

async function main() {
  const pdf = process.argv[2] || "public/email-attachments/d40ed1bb_PO2594_Cromwell.pdf";
  const buf = fs.readFileSync(pdf);
  const { text } = await pdfParse(buf);
  const result = await parsePOWithAI(text);
  if (!result) {
    console.log("parser returned null");
    process.exit(1);
  }
  console.log(JSON.stringify(result, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
