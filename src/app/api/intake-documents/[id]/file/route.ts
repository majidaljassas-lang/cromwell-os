import fs from "fs";
import path from "path";
import { prisma } from "@/lib/prisma";
import { refreshAccessToken, fetchAttachment } from "@/lib/microsoft/graph-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_DIR = path.join(process.cwd(), "var", "cache", "intake-pdfs");

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function pdfResponse(buf: Buffer) {
  // Copy into a fresh ArrayBuffer-backed Uint8Array so it satisfies BlobPart
  // across TS lib variants (Node Buffer's underlying ArrayBufferLike isn't
  // accepted directly).
  const ab = new ArrayBuffer(buf.byteLength);
  new Uint8Array(ab).set(buf);
  const body = new Blob([ab], { type: "application/pdf" });
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(buf.byteLength),
      "Cache-Control": "private, max-age=3600",
    },
  });
}

/**
 * GET /api/intake-documents/[id]/file
 *
 * Streams the source PDF for an IntakeDocument.
 *
 * IntakeDocument.fileRef holds the Outlook attachment ID; the message ID lives
 * on the linked IngestionEvent.rawPayload.id, and the access/refresh token on
 * IngestionSource. We mirror the poller: refresh token → fetchAttachment →
 * cache to disk → serve.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const doc = await prisma.intakeDocument.findUnique({
    where: { id },
    select: { id: true, fileRef: true, ingestionEventId: true },
  });

  if (!doc) {
    return Response.json({ error: "IntakeDocument not found" }, { status: 404 });
  }

  if (!doc.fileRef) {
    return Response.json({ error: "no fileRef" }, { status: 404 });
  }

  // Cache hit
  ensureCacheDir();
  const cachePath = path.join(CACHE_DIR, `${doc.id}.pdf`);
  if (fs.existsSync(cachePath)) {
    try {
      const buf = fs.readFileSync(cachePath);
      if (buf.byteLength > 0) return pdfResponse(buf);
    } catch {
      // fall through to refetch
    }
  }

  // Need the IngestionEvent (for the Outlook message id) and its source (for tokens).
  if (!doc.ingestionEventId) {
    return Response.json(
      { error: "no ingestionEventId on document" },
      { status: 502 }
    );
  }

  const event = await prisma.ingestionEvent.findUnique({
    where: { id: doc.ingestionEventId },
    select: { id: true, sourceId: true, rawPayload: true },
  });

  if (!event) {
    return Response.json({ error: "IngestionEvent not found" }, { status: 502 });
  }

  const messageId = (event.rawPayload as { id?: string } | null)?.id;
  if (!messageId) {
    return Response.json(
      { error: "no Outlook message id in rawPayload" },
      { status: 502 }
    );
  }

  const source = await prisma.ingestionSource.findUnique({
    where: { id: event.sourceId },
    select: { id: true, refreshToken: true },
  });

  if (!source?.refreshToken) {
    return Response.json(
      { error: "no refresh token on ingestion source" },
      { status: 502 }
    );
  }

  try {
    const tokens = await refreshAccessToken(source.refreshToken);
    // Persist refreshed tokens (poller does the same).
    await prisma.ingestionSource.update({
      where: { id: source.id },
      data: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      },
    });

    const buf = await fetchAttachment(tokens.access_token, messageId, doc.fileRef);

    try {
      fs.writeFileSync(cachePath, buf);
    } catch (err) {
      // Cache write failure must not block serving the PDF.
      console.warn(`intake-pdf cache write failed for ${doc.id}:`, err);
    }

    return pdfResponse(buf);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Graph fetch failed";
    return Response.json({ error: message }, { status: 502 });
  }
}
