/**
 * Universal extractor (Universal Ingestion, Phase A)
 *
 * One entry point: any buffer + MIME → { rawText, structured }.
 * The contract is "everything in → usable structured data out". Unknown MIME
 * types still get a structured pass via the AI extractor — nothing is silent-dropped.
 *
 * Stage 1 (buffer → rawText): MIME-specific decode.
 *   - application/pdf            → pdf-parse
 *   - image/png|jpg|jpeg|tiff    → tesseract OCR (via /tmp file)
 *   - text/plain, text/csv, json → utf-8 decode
 *   - text/html                  → strip tags
 *   - anything else              → utf-8 decode + flag in note (AI may still extract)
 *
 * Stage 2 (rawText → structured): delegates to extractDocument().
 *
 * No disk persistence outside transient OCR temp files. Callers persist to DB.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { execSync } from "child_process";
import { extractDocument, type ExtractedDocument } from "./document-extractor";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require("pdf-parse/lib/pdf-parse");

export type DecodeStrategy = "pdf" | "ocr" | "text" | "html" | "fallback-utf8";

export interface ExtractAnyResult {
  rawText: string;
  structured: ExtractedDocument;
  mime: string;
  decode: DecodeStrategy;
  decodeError?: string;
  byteLength: number;
}

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "tif", "tiff", "webp"]);

function mimeFor(mime: string | undefined, filename?: string): { canonical: string; ext: string } {
  const ext = (filename?.split(".").pop() || "").toLowerCase();
  if (mime) return { canonical: mime.toLowerCase(), ext };
  if (ext === "pdf") return { canonical: "application/pdf", ext };
  if (IMAGE_EXTS.has(ext)) return { canonical: `image/${ext === "jpg" ? "jpeg" : ext}`, ext };
  if (ext === "html" || ext === "htm") return { canonical: "text/html", ext };
  if (ext === "csv") return { canonical: "text/csv", ext };
  if (ext === "json") return { canonical: "application/json", ext };
  return { canonical: "application/octet-stream", ext };
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

async function ocrBuffer(buffer: Buffer, ext: string): Promise<string> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cromwell-ocr-"));
  const inPath = path.join(tmpDir, `in.${ext || "png"}`);
  const outBase = path.join(tmpDir, "out");
  try {
    fs.writeFileSync(inPath, buffer);
    execSync(`tesseract "${inPath}" "${outBase}" --psm 6 -l eng`, { timeout: 30_000 });
    return fs.readFileSync(`${outBase}.txt`, "utf-8");
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

async function decodeToText(
  buffer: Buffer,
  mime: string,
  ext: string,
): Promise<{ rawText: string; decode: DecodeStrategy; decodeError?: string }> {
  // PDF
  if (mime === "application/pdf" || ext === "pdf") {
    try {
      const data = await pdfParse(buffer);
      return { rawText: (data.text || "").trim(), decode: "pdf" };
    } catch (e) {
      return {
        rawText: "",
        decode: "pdf",
        decodeError: e instanceof Error ? e.message : "pdf-parse failed",
      };
    }
  }

  // Images → OCR
  if (mime.startsWith("image/") || IMAGE_EXTS.has(ext)) {
    try {
      const text = await ocrBuffer(buffer, ext);
      return { rawText: text.trim(), decode: "ocr" };
    } catch (e) {
      return {
        rawText: "",
        decode: "ocr",
        decodeError: e instanceof Error ? e.message : "tesseract failed",
      };
    }
  }

  // HTML
  if (mime === "text/html" || ext === "html" || ext === "htm") {
    return { rawText: stripHtml(buffer.toString("utf-8")), decode: "html" };
  }

  // Plain text family
  if (mime.startsWith("text/") || mime === "application/json") {
    return { rawText: buffer.toString("utf-8"), decode: "text" };
  }

  // Unknown: best-effort utf-8 — AI may still pull fields from it
  return { rawText: buffer.toString("utf-8"), decode: "fallback-utf8" };
}

export interface ExtractAnyOptions {
  /** MIME type (preferred). If absent, falls back to filename extension. */
  mime?: string;
  /** Optional filename (used to infer MIME when missing). */
  filename?: string;
}

export async function extractAny(
  buffer: Buffer,
  options: ExtractAnyOptions = {},
): Promise<ExtractAnyResult> {
  const { canonical, ext } = mimeFor(options.mime, options.filename);
  const decoded = await decodeToText(buffer, canonical, ext);
  const structured = await extractDocument(decoded.rawText || "");
  return {
    rawText: decoded.rawText,
    structured,
    mime: canonical,
    decode: decoded.decode,
    decodeError: decoded.decodeError,
    byteLength: buffer.byteLength,
  };
}

/**
 * Extract from already-decoded text (e.g. an email body). Skips stage 1 and
 * runs stage 2 (AI extraction) directly.
 */
export async function extractFromText(rawText: string): Promise<ExtractAnyResult> {
  const structured = await extractDocument(rawText || "");
  return {
    rawText,
    structured,
    mime: "text/plain",
    decode: "text",
    byteLength: Buffer.byteLength(rawText || "", "utf-8"),
  };
}
