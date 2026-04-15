/**
 * PDF Parser worker — NEW / DOWNLOADED → PARSED or OCR_REQUIRED.
 *
 * Reads fileRef (filesystem path) or existing rawText. If fileRef is a PDF and
 * we don't yet have extracted text, uses pdf-parse. If the resulting text is
 * empty/tiny, flips to OCR_REQUIRED so the OCR worker (or a human) can take over.
 *
 * EMAIL source type special handling:
 *   When sourceType is "EMAIL" and fileRef looks like an Outlook attachment ID
 *   (not a filesystem path — i.e. it doesn't start with "/" or "."), the worker
 *   fetches the raw PDF bytes directly from Microsoft Graph using
 *   fetchAttachment(accessToken, messageId, attachmentId).
 *
 *   The messageId is recovered from the IngestionEvent linked via ingestionEventId.
 *   The access token is fetched from the IngestionSource that owns the event.
 *   If the token has expired we attempt a refresh.
 */

import fs from "fs/promises";
import path from "path";
import { prisma } from "@/lib/prisma";
import { markStatus, bumpRetry } from "../queue";
import { fetchAttachment, refreshAccessToken } from "@/lib/microsoft/graph-client";

const MIN_TEXT_CHARS = 40;

/** True when fileRef looks like an Outlook attachment ID rather than a file path. */
function isOutlookAttachmentId(fileRef: string): boolean {
  return !fileRef.startsWith("/") && !fileRef.startsWith(".");
}

/**
 * Resolve the access token + Outlook messageId for an EMAIL-sourced IntakeDocument.
 *
 * Returns null if any of the required relations are missing.
 */
async function resolveOutlookContext(
  ingestionEventId: string
): Promise<{ accessToken: string; outlookMessageId: string } | null> {
  const event = await prisma.ingestionEvent.findUnique({
    where: { id: ingestionEventId },
    select: {
      sourceId: true,
      rawPayload: true,
    },
  });
  if (!event) return null;

  // The Outlook message ID is stored in rawPayload.id (the Graph message id,
  // not the internetMessageId). The sync route stores the full email object.
  const payload = event.rawPayload as Record<string, unknown> | null;
  const outlookMessageId = payload?.id as string | undefined;
  if (!outlookMessageId) return null;

  const source = await prisma.ingestionSource.findUnique({
    where: { id: event.sourceId },
    select: { accessToken: true, refreshToken: true, tokenExpiresAt: true },
  });
  if (!source) return null;

  let accessToken = source.accessToken ?? "";

  // Refresh if expired or missing
  const isExpired = !accessToken || (source.tokenExpiresAt && source.tokenExpiresAt <= new Date());
  if (isExpired && source.refreshToken) {
    try {
      const tokens = await refreshAccessToken(source.refreshToken);
      // Persist refreshed token so subsequent workers don't re-refresh
      await prisma.ingestionSource.update({
        where: { id: event.sourceId },
        data: {
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token,
          tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        },
      });
      accessToken = tokens.access_token;
    } catch {
      return null; // can't refresh — let caller mark OCR_REQUIRED
    }
  }

  if (!accessToken) return null;
  return { accessToken, outlookMessageId };
}

export async function runPdfParser(docId: string): Promise<"PARSED" | "OCR_REQUIRED" | "ERROR"> {
  const doc = await prisma.intakeDocument.findUnique({ where: { id: docId } });
  if (!doc) return "ERROR";

  try {
    let text = doc.rawText ?? "";

    if ((!text || text.trim().length < MIN_TEXT_CHARS) && doc.fileRef) {
      let buf: Buffer | null = null;

      if (doc.sourceType === "EMAIL" && isOutlookAttachmentId(doc.fileRef)) {
        // ── EMAIL path: fetch PDF bytes from Microsoft Graph ──────────────────
        if (!doc.ingestionEventId) {
          await markStatus(docId, "OCR_REQUIRED", {
            errorMessage: "EMAIL sourceType but no ingestionEventId — cannot fetch attachment",
          });
          return "OCR_REQUIRED";
        }

        const ctx = await resolveOutlookContext(doc.ingestionEventId);
        if (!ctx) {
          await markStatus(docId, "OCR_REQUIRED", {
            errorMessage: "Could not resolve Outlook access token for attachment download",
          });
          return "OCR_REQUIRED";
        }

        try {
          buf = await fetchAttachment(ctx.accessToken, ctx.outlookMessageId, doc.fileRef);
        } catch (e) {
          await markStatus(docId, "OCR_REQUIRED", {
            errorMessage: `Graph attachment download failed: ${e instanceof Error ? e.message : String(e)}`,
          });
          return "OCR_REQUIRED";
        }
      } else {
        // ── Filesystem path ───────────────────────────────────────────────────
        const resolved = path.isAbsolute(doc.fileRef)
          ? doc.fileRef
          : path.resolve(process.cwd(), doc.fileRef);
        try {
          buf = await fs.readFile(resolved);
        } catch (e) {
          await markStatus(docId, "OCR_REQUIRED", {
            errorMessage: `File read failed: ${e instanceof Error ? e.message : String(e)}`,
          });
          return "OCR_REQUIRED";
        }
      }

      if (buf) {
        try {
          // pdf-parse has no official types; treat as any to avoid declaration-file noise
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const mod: any = await import("pdf-parse" as string);
          const fn = (mod && (mod.default ?? mod)) as (b: Buffer) => Promise<{ text: string }>;
          const parsed = await fn(buf);
          text = parsed.text || "";
        } catch (e) {
          // pdf-parse failed — mark for OCR
          await markStatus(docId, "OCR_REQUIRED", {
            errorMessage: e instanceof Error ? e.message : "pdf-parse failed",
          });
          return "OCR_REQUIRED";
        }
      }
    }

    if (!text || text.trim().length < MIN_TEXT_CHARS) {
      await prisma.intakeDocument.update({ where: { id: docId }, data: { rawText: text } });
      await markStatus(docId, "OCR_REQUIRED", { errorMessage: "Text empty/too short — OCR required" });
      return "OCR_REQUIRED";
    }

    await prisma.intakeDocument.update({ where: { id: docId }, data: { rawText: text } });
    await markStatus(docId, "DOWNLOADED", { errorMessage: null });
    return "PARSED"; // next worker (bill-extractor) will transition DOWNLOADED → PARSED
  } catch (e) {
    await bumpRetry(docId, e instanceof Error ? e.message : "pdf-parser failed");
    return "ERROR";
  }
}
