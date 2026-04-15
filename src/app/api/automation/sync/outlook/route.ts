import { prisma } from "@/lib/prisma";
import { refreshAccessToken, fetchEmails, fetchAttachments, graphGetByUrl } from "@/lib/microsoft/graph-client";
import { processEmailAttachments } from "@/lib/ingestion/email-attachments";
import { classifyMessage } from "@/lib/ingestion/classifier";
import { enqueueDocument } from "@/lib/intake/queue";
import { looksLikeBillBody, subjectLooksLikeBill } from "@/lib/intake/email-body-detector";
import { attachEventToThread } from "@/lib/inbox/thread-builder";

const BILL_FILENAME_KEYWORDS = ["invoice", "bill", "statement", "inv", "credit", "ord-", "remittance"] as const;

/**
 * Return true when an attachment is a candidate for the bills intake engine.
 * Mirror of Majid's Outlook "Accounts Payable" rule: subject-driven, with
 * filename as a secondary signal. Sender domain is no longer used.
 */
function looksLikeBill(
  attachment: { name: string; contentType: string },
  emailSubject: string
): boolean {
  if (attachment.contentType !== "application/pdf" && !attachment.name.toLowerCase().endsWith(".pdf")) {
    return false;
  }
  // Primary: subject matches the Outlook accounts-payable rule
  if (subjectLooksLikeBill(emailSubject)) return true;
  // Secondary: filename itself contains a bill keyword
  const nameLower = attachment.name.toLowerCase();
  if (BILL_FILENAME_KEYWORDS.some((kw) => nameLower.includes(kw))) return true;
  return false;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * POST /api/automation/sync/outlook
 *
 * Polls Outlook for new emails since last sync, transforms them into
 * the ingestion pipeline format, and feeds them to the existing
 * WhatsApp/Outlook import routes.
 *
 * Can be triggered manually or by a cron job.
 */
export async function POST(request: Request) {
  try {
    // Optional override: ?since=YYYY-MM-DD (forces backfill from this date instead of lastSyncAt)
    const url = new URL(request.url);
    const sinceOverride = url.searchParams.get("since");

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

        // Fetch emails since: explicit override > lastSyncAt > 7 days ago
        const since = sinceOverride
          ? new Date(sinceOverride).toISOString()
          : source.lastSyncAt
            ? source.lastSyncAt.toISOString()
            : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

        // Page through inbox + sent items (follow @odata.nextLink — Graph caps each page at 1000)
        async function pullAll(folder: "inbox") {
          const out: Array<Record<string, unknown>> = [];
          let page = await fetchEmails(tokens.access_token, { folder, since, top: 200 });
          out.push(...(page.value || []));
          // Bound the loop so we never spin forever — 50 pages × 200 = 10k cap
          let safety = 50;
          while (page["@odata.nextLink"] && safety-- > 0) {
            page = await graphGetByUrl(tokens.access_token, page["@odata.nextLink"] as string) as typeof page;
            out.push(...(page.value || []));
          }
          return out;
        }
        // INBOX only — the Outlook "Accounts Payable" rule routes incoming mail; sent items
        // are out of scope for the bills intake engine.
        const inboxList = await pullAll("inbox");
        const emails = inboxList.map((e) => ({ ...e, _folder: "INBOX" as const }));

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
          const senderEmail = isSent
            ? (email.toRecipients?.[0]?.emailAddress?.address ?? "")
            : (email.from?.emailAddress?.address ?? "");

          // Create ingestion event FIRST so we have an id for attachment filenames
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

          // Attach to inbox thread (emails + WhatsApp go through the same threading pipe)
          await attachEventToThread(event.id).catch((err) =>
            console.warn(`attachEventToThread failed for ${event.id}:`, err instanceof Error ? err.message : err)
          );

          // Download and parse attachments BEFORE building the parsed text
          let attachmentText = "";
          let attachmentCount = 0;
          if (email.hasAttachments) {
            try {
              const result = await processEmailAttachments(
                tokens.access_token,
                email.id,
                event.id
              );
              attachmentText = result.attachmentText;
              attachmentCount = result.count;
            } catch (err) {
              console.error(`Attachment processing failed for ${event.id}:`, err);
            }

            // Bills intake: enqueue any PDF attachments that look like supplier bills
            try {
              const attachData = await fetchAttachments(tokens.access_token, email.id);
              for (const att of attachData.value || []) {
                if (att.isInline) continue;
                if (!looksLikeBill(att, email.subject ?? "")) continue;

                // enqueueDocument is idempotent on (ingestionEventId, fileRef)
                await enqueueDocument({
                  sourceType:       "EMAIL",
                  sourceRef:        email.subject ?? null,
                  fileRef:          att.id,        // Outlook attachment ID — resolved in pdf-parser
                  rawText:          bodyText ?? null,
                  ingestionEventId: event.id,
                }).catch((err) =>
                  console.error(`enqueueDocument failed for attachment ${att.id} on event ${event.id}:`, err)
                );
              }
            } catch (err) {
              console.error(`Bill intake enqueueing failed for event ${event.id}:`, err);
            }
          }

          // Body-bill path: no PDF attachments, but the email body itself looks like a bill.
          // Status is set to PARSED immediately — rawText is already available; skip the parser.
          if (!email.hasAttachments && looksLikeBillBody(bodyText, senderEmail)) {
            try {
              // Idempotency: one body-bill doc per ingestion event (fileRef is null for this path).
              const existingBodyDoc = await prisma.intakeDocument.findFirst({
                where: { ingestionEventId: event.id, fileRef: null },
                select: { id: true },
              });
              if (!existingBodyDoc) {
                const { doc } = await enqueueDocument({
                  sourceType:       "EMAIL",
                  sourceRef:        email.subject ?? null,
                  fileRef:          null,
                  rawText:          bodyText,
                  ingestionEventId: event.id,
                });
                // Advance immediately to PARSED — body text is the full content
                await prisma.intakeDocument.update({
                  where: { id: doc.id },
                  data: { status: "PARSED" },
                });
              }
            } catch (err) {
              console.error(`Body-bill enqueue failed for event ${event.id}:`, err);
            }
          }

          // Combine body + attachment text — this is the full searchable record
          const fullText = `${bodyText}\n${attachmentText}`.trim();

          // Create parsed message with the FULL text now that attachments are processed
          await prisma.parsedMessage.create({
            data: {
              ingestionEventId: event.id,
              messageType: "EMAIL",
              extractedText: `Subject: ${email.subject}\nFrom: ${email.from?.emailAddress?.name} <${email.from?.emailAddress?.address}>\nDate: ${email.receivedDateTime}\n\n${fullText.substring(0, 16000)}`,
              structuredData: {
                subject: email.subject,
                from: email.from?.emailAddress,
                to: email.toRecipients?.map((r) => r.emailAddress),
                cc: email.ccRecipients?.map((r) => r.emailAddress),
                hasAttachments: email.hasAttachments,
                attachmentCount,
                hasAttachmentText: attachmentText.length > 0,
                conversationId: email.conversationId,
              },
            },
          });

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
