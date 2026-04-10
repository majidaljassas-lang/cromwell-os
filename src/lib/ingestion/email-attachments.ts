/**
 * Email attachment processor.
 *
 * Given an Outlook message id and an access token, fetches all non-inline
 * attachments via Microsoft Graph, saves them to disk under
 * public/email-attachments/, runs pdf-parse on PDFs and tesseract on images,
 * and returns the concatenated extracted text plus a list of saved files.
 *
 * Used by:
 *  - the live Outlook sync route (every new email)
 *  - the backfill route (existing emails whose attachments were never pulled)
 *
 * Pure helper — does NOT touch the database. The caller decides what to do
 * with the returned text (e.g. write to ParsedMessage.extractedText).
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fetchAttachments } from "@/lib/microsoft/graph-client";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require("pdf-parse/lib/pdf-parse");

export interface ProcessedAttachment {
  name: string;
  contentType: string;
  size: number;
  savedPath: string;
  extractedText: string;
  parser: "pdf" | "ocr" | "skipped";
  error?: string;
}

export interface AttachmentResult {
  attachmentText: string;
  attachments: ProcessedAttachment[];
  count: number;
}

/**
 * Fetch and process all attachments for one Outlook message.
 *
 * @param accessToken     A valid Microsoft Graph access token
 * @param outlookMessageId The Outlook message id (NOT the internetMessageId)
 * @param eventIdForFolder Optional id used in the saved filename for traceability
 * @returns Concatenated extracted text + per-attachment metadata
 */
export async function processEmailAttachments(
  accessToken: string,
  outlookMessageId: string,
  eventIdForFolder?: string
): Promise<AttachmentResult> {
  let attachData;
  try {
    attachData = await fetchAttachments(accessToken, outlookMessageId);
  } catch (err) {
    return {
      attachmentText: "",
      attachments: [],
      count: 0,
      // Throwing would block the whole sync — prefer empty result + log
      ...(err instanceof Error
        ? { error: `fetchAttachments failed: ${err.message}` }
        : {}),
    } as AttachmentResult & { error?: string };
  }

  const uploadDir = path.join(process.cwd(), "public", "email-attachments");
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

  const out: ProcessedAttachment[] = [];
  let attachmentText = "";

  for (const att of attachData.value || []) {
    if (att.isInline || !att.contentBytes) continue;

    const ext = (att.name.split(".").pop() || "").toLowerCase();
    const buffer = Buffer.from(att.contentBytes, "base64");

    const safeName = att.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const tag = eventIdForFolder ? eventIdForFolder.slice(0, 8) : Date.now().toString();
    const fileName = `${tag}_${safeName}`;
    const savedPath = path.join(uploadDir, fileName);

    try {
      fs.writeFileSync(savedPath, buffer);
    } catch (err) {
      out.push({
        name: att.name,
        contentType: att.contentType,
        size: att.size,
        savedPath: "",
        extractedText: "",
        parser: "skipped",
        error: err instanceof Error ? err.message : "write failed",
      });
      continue;
    }

    let extractedText = "";
    let parser: "pdf" | "ocr" | "skipped" = "skipped";
    let error: string | undefined;

    if (ext === "pdf") {
      parser = "pdf";
      try {
        const pdfData = await pdfParse(buffer);
        extractedText = pdfData.text || "";
        attachmentText += `\n--- ${att.name} ---\n${extractedText}`;
      } catch (e) {
        error = e instanceof Error ? e.message : "pdf-parse failed";
      }
    } else if (["png", "jpg", "jpeg", "tiff", "tif"].includes(ext)) {
      parser = "ocr";
      try {
        const tmpPath = path.join(uploadDir, `ocr_${Date.now()}.${ext}`);
        const outBase = tmpPath.replace(/\.\w+$/, "_out");
        fs.writeFileSync(tmpPath, buffer);
        execSync(`tesseract "${tmpPath}" "${outBase}" --psm 6 -l eng`, {
          timeout: 30000,
        });
        extractedText = fs.readFileSync(`${outBase}.txt`, "utf-8");
        attachmentText += `\n--- ${att.name} ---\n${extractedText}`;
        try {
          fs.unlinkSync(tmpPath);
          fs.unlinkSync(`${outBase}.txt`);
        } catch {}
      } catch (e) {
        error = e instanceof Error ? e.message : "tesseract failed";
      }
    }

    out.push({
      name: att.name,
      contentType: att.contentType,
      size: att.size,
      savedPath: `/email-attachments/${fileName}`,
      extractedText,
      parser,
      error,
    });
  }

  return {
    attachmentText,
    attachments: out,
    count: out.length,
  };
}
