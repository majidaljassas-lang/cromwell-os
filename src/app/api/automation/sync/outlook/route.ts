import { prisma } from "@/lib/prisma";
import { refreshAccessToken, fetchEmails, fetchAttachments, graphGetByUrl } from "@/lib/microsoft/graph-client";
import { processEmailAttachments } from "@/lib/ingestion/email-attachments";
import { classifyMessage } from "@/lib/ingestion/classifier";
import { enqueueDocument } from "@/lib/intake/queue";
import { looksLikeBillBody, subjectLooksLikeBill } from "@/lib/intake/email-body-detector";
import { attachEventToThread } from "@/lib/inbox/thread-builder";
import { resolveLink } from "@/lib/ingestion/link-resolver";
import { CUTOVER_DATE } from "@/lib/sync-constants";
import { checkSchedulerSecret } from "@/lib/scheduler/secret";
import fs from "fs";
import path from "path";

type EmailFilterEntry = { type: string; matchType: string; value: string };
function loadEmailBlacklist(): EmailFilterEntry[] {
  try { return JSON.parse(fs.readFileSync(path.join(process.cwd(), "email-filter.json"), "utf-8")).filter((f: EmailFilterEntry) => f.type === "BLACKLIST"); }
  catch { return []; }
}
function isEmailBlocked(senderEmail: string): boolean {
  const blacklist = loadEmailBlacklist();
  const email = senderEmail.toLowerCase();
  const domain = email.split("@")[1] ?? "";
  return blacklist.some((f) => {
    if (f.matchType === "EMAIL") return email === f.value.toLowerCase();
    if (f.matchType === "EMAIL_DOMAIN") return domain === f.value.toLowerCase();
    return false;
  });
}

/**
 * Check if email sender domain matches a known supplier.
 * Supplier invoices originate from the supplier's own domain.
 * Built from actual successful bills, so it's highly accurate.
 */
function isKnownSupplierDomain(senderEmail: string, supplierDomains: Set<string>): boolean {
  const email = senderEmail.toLowerCase();
  const domain = email.split("@")[1] ?? "";

  // Exact domain match (e.g., "appeng.co.uk")
  if (supplierDomains.has(domain)) return true;

  // Partial match on first part (e.g., "appeng" from "appeng.co.uk")
  const firstPart = domain.split(".")[0];
  if (firstPart && supplierDomains.has(firstPart)) return true;

  return false;
}

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
  const unauthorized = checkSchedulerSecret(request);
  if (unauthorized) return unauthorized;
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

    // Load known supplier email domains from successful bills
    // Query IngestionEvent records linked to SupplierBill to extract real domains
    const supplierEmailDomains = await prisma.$queryRaw<Array<{ email: string }>>`
      SELECT DISTINCT
        (ie."rawPayload"->'from'->>'address')::text as email
      FROM "IngestionEvent" ie
      JOIN "IntakeDocument" id ON id."ingestionEventId" = ie.id
      JOIN "SupplierBill" sb ON sb."intakeDocumentId" = id.id
      WHERE (ie."rawPayload"->'from'->>'address') IS NOT NULL
    `;
    const supplierDomains = new Set<string>();
    for (const record of supplierEmailDomains) {
      const email = (record.email || "").toLowerCase();
      const domain = email.split("@")[1];
      if (domain) {
        supplierDomains.add(domain);
        // Also add the first part (company name) for partial matching
        const parts = domain.split(".");
        if (parts.length > 0 && parts[0].length > 2) {
          supplierDomains.add(parts[0]);
        }
      }
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

        // Fetch emails since: explicit override > max(lastSyncAt, CUTOVER_DATE).
        // Floor at CUTOVER_DATE so we always backfill from the cutover on first
        // run and never fetch pre-cutover data.
        const sinceDate = sinceOverride
          ? new Date(sinceOverride)
          : source.lastSyncAt && source.lastSyncAt > CUTOVER_DATE
            ? source.lastSyncAt
            : CUTOVER_DATE;
        const since = sinceDate.toISOString();

        // Page through a mailbox folder (follow @odata.nextLink — Graph caps each page at 1000)
        async function pullAll(folder: "inbox" | "sentitems") {
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
        // Pull INBOX + SENT — both directions needed to build complete threads.
        // Sent emails are RFQs, POs, quotes, invoices — half the thread.
        const inboxList = await pullAll("inbox");
        const sentList = await pullAll("sentitems");
        const emails = [
          ...inboxList.map((e) => ({ ...e, _folder: "INBOX" as const })),
          ...sentList.map((e) => ({ ...e, _folder: "SENT" as const })),
        ];

        // Deduplicate against existing ingestion events
        const existingIds = new Set(
          (await prisma.ingestionEvent.findMany({
            where: { sourceId: source.id, externalMessageId: { in: emails.map((e) => e.internetMessageId || e.id) } },
            select: { externalMessageId: true },
          })).map((e) => e.externalMessageId)
        );

        // Also check deleted message IDs — these were explicitly deleted by the user
        const deletedIds = new Set(
          (await prisma.deletedMessageId.findMany({
            where: { externalMessageId: { in: emails.map((e) => e.internetMessageId || e.id) } },
            select: { externalMessageId: true },
          })).map((d) => d.externalMessageId)
        );

        const newEmails = emails.filter((e) => {
          const msgId = e.internetMessageId || e.id;
          return !existingIds.has(msgId) && !deletedIds.has(msgId);
        });

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

          // Check email block list — skip silently if blocked
          if (!isSent && isEmailBlocked(senderEmail)) continue;

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

          // Attach to inbox thread (emails + WhatsApp go through the same threading pipe).
          // The thread-level auto-linker runs contact + content scoring against
          // open tickets; HIGH auto-links, MEDIUM surfaces as a suggestion.
          await attachEventToThread(event.id).catch((err) =>
            console.warn(`attachEventToThread failed for ${event.id}:`, err instanceof Error ? err.message : err)
          );

          // Also score this email at the event level: creates an InboundEvent
          // with linkStatus + linkConfidence against all open tickets/enquiries
          // using references, site/customer mentions, products, timeline.
          // This feeds the review queue; thread-level linking above drives the
          // inbox UI. Never creates a ticket.
          const e = email as any;
          resolveLink({
            eventType: "EMAIL",
            sourceType: "OUTLOOK",
            sender: senderEmail || null,
            senderEmail: senderEmail || null,
            receivedAt: new Date(e.receivedDateTime),
            rawText: bodyText,
            subject: e.subject ?? null,
            ingestionEventId: event.id,
          }).catch((err) =>
            console.warn(`resolveLink failed for ${event.id}:`, err instanceof Error ? err.message : err)
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
                // Only enqueue if sender is from a known supplier domain
                if (!isKnownSupplierDomain(senderEmail, supplierDomains)) continue;

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
          if (!email.hasAttachments && looksLikeBillBody(bodyText, senderEmail) && isKnownSupplierDomain(senderEmail, supplierDomains)) {
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

          // Classify the message — pass subject separately so the bill-rule
          // (subjectLooksLikeBill) wins over body-keyword DISPUTE / DELIVERY
          // matches. Without this, "Sales Invoice 2434457" gets mis-tagged
          // as DISPUTE if the body mentions "credit" or "return".
          const classText = `${email.subject || ""} ${fullText.substring(0, 1000)}`;
          const classification = classifyMessage(classText, { subject: email.subject });

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
export async function GET(request: Request) {
  const unauthorized = checkSchedulerSecret(request);
  if (unauthorized) return unauthorized;
  const sources = await prisma.ingestionSource.findMany({
    where: { sourceType: "OUTLOOK" },
    select: { id: true, externalRef: true, displayName: true, status: true, lastSyncAt: true, isActive: true },
  });
  return Response.json(sources);
}
