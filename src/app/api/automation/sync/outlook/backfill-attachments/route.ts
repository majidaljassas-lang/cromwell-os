import { prisma } from "@/lib/prisma";
import { refreshAccessToken } from "@/lib/microsoft/graph-client";
import { processEmailAttachments } from "@/lib/ingestion/email-attachments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST /api/automation/sync/outlook/backfill-attachments
 *
 * Finds existing IngestionEvents that have hasAttachments=true on their
 * rawPayload but never had their attachments downloaded (no ParsedMessage
 * row, OR ParsedMessage exists but extractedText doesn't include attachment
 * markers like "--- file.pdf ---"). Pulls the attachments via Microsoft
 * Graph, runs pdf-parse / OCR, and writes the result into ParsedMessage.
 *
 * This closes the gap where the original sync route created ParsedMessage
 * BEFORE downloading attachments, leaving every email's attachment text
 * permanently absent from the DB.
 *
 * Idempotent — re-running on an event that already has attachment text
 * will skip it.
 *
 * Wired into trickle-down so it self-heals every cycle. Can also be POSTed
 * directly to backfill on demand.
 */
export async function POST(request: Request) {
  const startedAt = Date.now();
  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get("limit") || 25), 100);

  try {
    // Find IngestionEvents with attachments but no parsed attachment text yet.
    // Use raw SQL because rawPayload is JSON.
    const candidates = await prisma.$queryRaw<
      Array<{
        id: string;
        sourceId: string;
        outlookId: string | null;
        subject: string | null;
      }>
    >`
      SELECT
        ie.id,
        ie."sourceId",
        ie."rawPayload"->>'id'      AS "outlookId",
        ie."rawPayload"->>'subject' AS subject
      FROM "IngestionEvent" ie
      WHERE ie."rawPayload"->>'hasAttachments' = 'true'
        AND ie."sourceRecordType" = 'EMAIL'
        AND NOT EXISTS (
          SELECT 1 FROM "ParsedMessage" pm
          WHERE pm."ingestionEventId" = ie.id
            AND pm."extractedText" LIKE '%--- %'
        )
      ORDER BY ie."createdAt" DESC
      LIMIT ${limit}
    `;

    if (candidates.length === 0) {
      return Response.json({
        ok: true,
        scanned: 0,
        processed: 0,
        message: "Nothing to backfill",
        durationMs: Date.now() - startedAt,
      });
    }

    // Group by source so we only refresh tokens once per source
    const bySource = new Map<string, typeof candidates>();
    for (const c of candidates) {
      const arr = bySource.get(c.sourceId) || [];
      arr.push(c);
      bySource.set(c.sourceId, arr);
    }

    let processed = 0;
    let failed = 0;
    const results: Array<{
      eventId: string;
      subject: string | null;
      attachments: number;
      textChars: number;
      error?: string;
    }> = [];

    for (const [sourceId, items] of bySource.entries()) {
      const source = await prisma.ingestionSource.findUnique({
        where: { id: sourceId },
        select: { refreshToken: true, externalRef: true },
      });
      if (!source?.refreshToken) {
        for (const it of items) {
          results.push({
            eventId: it.id,
            subject: it.subject,
            attachments: 0,
            textChars: 0,
            error: "no refresh token on source",
          });
          failed++;
        }
        continue;
      }

      let accessToken: string;
      try {
        const tokens = await refreshAccessToken(source.refreshToken);
        accessToken = tokens.access_token;
        // Persist the refreshed tokens
        await prisma.ingestionSource.update({
          where: { id: sourceId },
          data: {
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token,
            tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
          },
        });
      } catch (err) {
        for (const it of items) {
          results.push({
            eventId: it.id,
            subject: it.subject,
            attachments: 0,
            textChars: 0,
            error: err instanceof Error ? `token refresh: ${err.message}` : "token refresh failed",
          });
          failed++;
        }
        continue;
      }

      for (const item of items) {
        if (!item.outlookId) {
          failed++;
          results.push({
            eventId: item.id,
            subject: item.subject,
            attachments: 0,
            textChars: 0,
            error: "no outlook id in rawPayload",
          });
          continue;
        }

        try {
          const attResult = await processEmailAttachments(
            accessToken,
            item.outlookId,
            item.id
          );

          if (attResult.attachmentText.length === 0) {
            // No useful text — record but don't create empty ParsedMessage
            results.push({
              eventId: item.id,
              subject: item.subject,
              attachments: attResult.count,
              textChars: 0,
            });
            processed++;
            continue;
          }

          // Get the existing ParsedMessage (if any) to merge
          const existing = await prisma.parsedMessage.findFirst({
            where: { ingestionEventId: item.id },
            select: { id: true, extractedText: true },
          });

          const newText =
            (existing?.extractedText || `Subject: ${item.subject || ""}`) +
            "\n\n" +
            attResult.attachmentText;

          if (existing) {
            await prisma.parsedMessage.update({
              where: { id: existing.id },
              data: {
                extractedText: newText.substring(0, 32000),
                structuredData: {
                  attachmentCount: attResult.count,
                  hasAttachmentText: true,
                  backfilled: true,
                  backfilledAt: new Date().toISOString(),
                },
              },
            });
          } else {
            await prisma.parsedMessage.create({
              data: {
                ingestionEventId: item.id,
                messageType: "EMAIL",
                extractedText: newText.substring(0, 32000),
                structuredData: {
                  attachmentCount: attResult.count,
                  hasAttachmentText: true,
                  backfilled: true,
                  backfilledAt: new Date().toISOString(),
                },
              },
            });
          }

          processed++;
          results.push({
            eventId: item.id,
            subject: item.subject,
            attachments: attResult.count,
            textChars: attResult.attachmentText.length,
          });
        } catch (err) {
          failed++;
          results.push({
            eventId: item.id,
            subject: item.subject,
            attachments: 0,
            textChars: 0,
            error: err instanceof Error ? err.message : "unknown",
          });
        }
      }
    }

    return Response.json({
      ok: true,
      scanned: candidates.length,
      processed,
      failed,
      durationMs: Date.now() - startedAt,
      results,
    });
  } catch (error) {
    console.error("Attachment backfill failed:", error);
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Backfill failed",
      },
      { status: 500 }
    );
  }
}
