import { prisma } from "@/lib/prisma";
import { refreshAccessToken, fetchEmails, fetchUserProfile, fetchAttachments } from "@/lib/microsoft/graph-client";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require("pdf-parse/lib/pdf-parse");
import { classifyMessage } from "@/lib/ingestion/classifier";
import { resolveLink } from "@/lib/ingestion/link-resolver";

/**
 * POST /api/automation/sync/outlook
 *
 * Polls Outlook for new emails since last sync, transforms them into
 * the ingestion pipeline format, and feeds them to the existing
 * WhatsApp/Outlook import routes.
 *
 * Can be triggered manually or by a cron job.
 */
export async function POST() {
  try {
    // Get all active Outlook sources
    const sources = await prisma.ingestionSource.findMany({
      where: { sourceType: "OUTLOOK", isActive: true, refreshToken: { not: null } },
    });

    if (sources.length === 0) {
      return Response.json({ error: "No Outlook accounts connected. Visit /api/auth/outlook/connect" }, { status: 404 });
    }

    const results = [];

    for (const source of sources) {
      try {
        // Refresh access token
        const tokens = await refreshAccessToken(source.refreshToken!);

        // Update stored tokens
        await prisma.ingestionSource.update({
          where: { id: source.id },
          data: {
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token,
            tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
          },
        });

        // Fetch emails since last sync (or last 7 days for first sync)
        const since = source.lastSyncAt
          ? source.lastSyncAt.toISOString()
          : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

        // Pull from both inbox AND sent items
        const [inboxData, sentData] = await Promise.all([
          fetchEmails(tokens.access_token, { folder: "inbox", since, top: 50 }),
          fetchEmails(tokens.access_token, { folder: "sentitems", since, top: 50 }),
        ]);
        const emails = [
          ...(inboxData.value || []).map((e) => ({ ...e, _folder: "INBOX" as const })),
          ...(sentData.value || []).map((e) => ({ ...e, _folder: "SENT" as const })),
        ];

        // Deduplicate against existing ingestion events
        const existingIds = new Set(
          (await prisma.ingestionEvent.findMany({
            where: { sourceId: source.id, externalMessageId: { in: emails.map((e) => e.internetMessageId || e.id) } },
            select: { externalMessageId: true },
          })).map((e) => e.externalMessageId)
        );

        const newEmails = emails.filter((e) => !existingIds.has(e.internetMessageId || e.id));

        // Process each new email
        let processed = 0;
        for (const email of newEmails) {
          // Strip HTML from body
          const bodyText = email.body.contentType === "html"
            ? email.body.content.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim()
            : email.body.content;

          const folder = (email as any)._folder || "INBOX";
          const isSent = folder === "SENT";

          // Create ingestion event
          const event = await prisma.ingestionEvent.create({
            data: {
              sourceId: source.id,
              externalMessageId: email.internetMessageId || email.id,
              sourceRecordType: "EMAIL",
              eventKind: isSent ? "OUTLOOK_SENT" : "OUTLOOK_EMAIL",
              rawPayload: email as unknown as Record<string, unknown>,
              receivedAt: new Date(email.receivedDateTime),
              status: "PARSED",
            },
          });

          // Create parsed message with full text including attachments
          await prisma.parsedMessage.create({
            data: {
              ingestionEventId: event.id,
              messageType: "EMAIL",
              extractedText: `Subject: ${email.subject}\nFrom: ${email.from?.emailAddress?.name} <${email.from?.emailAddress?.address}>\nDate: ${email.receivedDateTime}\n\n${fullText.substring(0, 8000)}`,
              structuredData: {
                subject: email.subject,
                from: email.from?.emailAddress,
                to: email.toRecipients?.map((r) => r.emailAddress),
                cc: email.ccRecipients?.map((r) => r.emailAddress),
                hasAttachments: email.hasAttachments,
                attachmentCount: email.hasAttachments ? 1 : 0,
                hasAttachmentText: attachmentText.length > 0,
                conversationId: email.conversationId,
              },
            },
          });

          // Download and parse attachments
          let attachmentText = "";
          if (email.hasAttachments) {
            try {
              const attachData = await fetchAttachments(tokens.access_token, email.id);
              const uploadDir = path.join(process.cwd(), "public", "email-attachments");
              if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

              for (const att of (attachData.value || [])) {
                if (att.isInline || !att.contentBytes) continue;
                const ext = (att.name.split(".").pop() || "").toLowerCase();
                const buffer = Buffer.from(att.contentBytes, "base64");

                // Save attachment
                const fileName = `${Date.now()}_${att.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
                fs.writeFileSync(path.join(uploadDir, fileName), buffer);

                // Extract text from PDFs
                if (ext === "pdf") {
                  try {
                    const pdfData = await pdfParse(buffer);
                    attachmentText += `\n--- ${att.name} ---\n${pdfData.text.substring(0, 3000)}`;
                  } catch { /* skip unparseable PDFs */ }
                }
                // OCR images
                else if (["png", "jpg", "jpeg", "tiff"].includes(ext)) {
                  try {
                    const tmpPath = path.join(uploadDir, `ocr_${Date.now()}.${ext}`);
                    const outBase = tmpPath.replace(/\.\w+$/, "_out");
                    fs.writeFileSync(tmpPath, buffer);
                    execSync(`tesseract "${tmpPath}" "${outBase}" --psm 6 -l eng`, { timeout: 15000 });
                    const ocrText = fs.readFileSync(`${outBase}.txt`, "utf-8");
                    attachmentText += `\n--- ${att.name} ---\n${ocrText.substring(0, 3000)}`;
                    try { fs.unlinkSync(tmpPath); fs.unlinkSync(`${outBase}.txt`); } catch {}
                  } catch { /* skip failed OCR */ }
                }
              }
            } catch { /* attachment fetch failed — continue without */ }
          }

          // Combine body + attachment text for classification
          const fullText = `${bodyText}\n${attachmentText}`.trim();

          // Classify the message
          const classText = `${email.subject || ""} ${fullText.substring(0, 1000)}`;
          const classification = classifyMessage(classText);

          // NOTE: Auto-linking DISABLED — everything lands in inbox for manual triage
          try {
            // Just create a basic InboundEvent, no auto-linking
            await prisma.inboundEvent.create({
              data: {
                eventType: "EMAIL",
                sourceType: "OUTLOOK",
                externalRef: email.internetMessageId || email.id,
                sender: isSent ? email.toRecipients?.[0]?.emailAddress?.name : email.from?.emailAddress?.name,
                senderEmail: isSent ? email.toRecipients?.[0]?.emailAddress?.address : email.from?.emailAddress?.address,
                receivedAt: new Date(email.receivedDateTime),
                rawText: bodyText.substring(0, 5000),
                subject: `${isSent ? "[SENT] " : ""}${email.subject}`,
                linkStatus: "UNPROCESSED",
                ingestionEventId: event.id,
              },
            });
          } catch {
            // Inbound event creation failed — continue anyway
          }

          // Update event with classification
          const kind = isSent ? "OUTLOOK_SENT" : classification.classification;
          await prisma.ingestionEvent.update({
            where: { id: event.id },
            data: {
              eventKind: kind,
              status: "CLASSIFIED",
            },
          });

          // Auto-action based on classification
          // ORDER_ACK → auto-create procurement order if linked to a ticket
          // PO_DOCUMENT → flag for PO register
          // QUOTE_REQUEST → create new enquiry if unlinked
          // These are logged as events on the ticket timeline

          processed++;
        }

        // Update last sync time
        await prisma.ingestionSource.update({
          where: { id: source.id },
          data: { lastSyncAt: new Date() },
        });

        results.push({
          source: source.externalRef,
          fetched: emails.length,
          new: newEmails.length,
          processed,
        });
      } catch (err) {
        console.error(`Sync failed for ${source.externalRef}:`, err);
        results.push({
          source: source.externalRef,
          error: err instanceof Error ? err.message : "unknown",
        });
      }
    }

    return Response.json({ synced: results, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error("Outlook sync failed:", error);
    return Response.json({ error: "Sync failed" }, { status: 500 });
  }
}

/**
 * GET /api/automation/sync/outlook
 * Returns sync status for all Outlook sources.
 */
export async function GET() {
  const sources = await prisma.ingestionSource.findMany({
    where: { sourceType: "OUTLOOK" },
    select: { id: true, externalRef: true, displayName: true, status: true, lastSyncAt: true, isActive: true },
  });
  return Response.json(sources);
}
