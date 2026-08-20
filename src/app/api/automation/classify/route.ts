import { prisma } from "@/lib/prisma";
import { classifyMessage } from "@/lib/ingestion/classifier";
import { checkSchedulerSecret } from "@/lib/scheduler/secret";
import { attachEventToThread } from "@/lib/inbox/thread-builder";

/**
 * POST /api/automation/classify
 * Reclassify all PARSED ingestion events that haven't been classified yet,
 * and bridge WHATSAPP_SENT events stuck in NEEDS_TRIAGE back into the
 * classified stream so auto-action can pick them up. Noisy WhatsApp chatter
 * (GENERAL_CHATTER with no keyword match) is dismissed directly rather than
 * re-entering the auto-action fallback path.
 */
export async function POST(request: Request) {
  const unauthorized = checkSchedulerSecret(request);
  if (unauthorized) return unauthorized;
  try {
    const events = await prisma.ingestionEvent.findMany({
      where: { status: "PARSED" },
      include: { parsedMessages: { select: { extractedText: true } } },
    });

    const counts: Record<string, number> = {};
    for (const event of events) {
      const text = event.parsedMessages?.[0]?.extractedText || "";
      const subject = (event.rawPayload as Record<string, unknown> | null)?.subject as string | undefined;
      const result = classifyMessage(text, { subject: subject ?? null });
      const kind = event.eventKind === "OUTLOOK_SENT" ? "OUTLOOK_SENT" : result.classification;

      counts[kind] = (counts[kind] || 0) + 1;

      await prisma.ingestionEvent.update({
        where: { id: event.id },
        data: { eventKind: kind, status: "CLASSIFIED" },
      });
    }

    // ── WhatsApp bridge (Fix 2B) ─────────────────────────────────────────
    // WHATSAPP_SENT events stuck in NEEDS_TRIAGE had no consumer. Routing:
    //   GENERAL_CHATTER  -> status=DISMISSED
    //   UNKNOWN          -> left in NEEDS_TRIAGE (no signal yet)
    //   any other kind   -> status=CLASSIFIED (auto-action picks up next)
    // After promoting to CLASSIFIED, attempt to link the event to an open
    // ticket by the sender's phone number (Contact.phone). Confidence =
    // 60 base + recency boost + content overlap. Unlinked events are
    // attached to the InboxThread so they surface for manual triage.
    // Event status update + IngestionLink create run in a single
    // $transaction for stricter idempotency. sourceRecordType=WHATSAPP
    // is preserved (not touched). Outbound (isSent) messages are not
    // filtered — they carry order instructions that need linking.
    const whatsappStuck = await prisma.ingestionEvent.findMany({
      where: { status: "NEEDS_TRIAGE", eventKind: "WHATSAPP_SENT" },
      include: {
        parsedMessages: {
          orderBy: { parseVersion: "desc" },
          take: 1,
          select: { id: true, extractedText: true, structuredData: true },
        },
      },
    });

    const whatsappCounts: Record<string, number> = {};
    let whatsappDismissed = 0;
    let whatsappClassified = 0;
    let whatsappLeftAlone = 0;
    let whatsappLinked = 0;
    let whatsappThreaded = 0;

    for (const event of whatsappStuck) {
      const parsed = event.parsedMessages?.[0];
      const text = parsed?.extractedText || "";
      const result = classifyMessage(text);
      const kind = result.classification;

      whatsappCounts[kind] = (whatsappCounts[kind] || 0) + 1;

      // UNKNOWN: leave the event alone entirely (per spec).
      if (kind === "UNKNOWN") {
        whatsappLeftAlone++;
        continue;
      }

      // GENERAL_CHATTER: status+kind update only, no linking.
      if (kind === "GENERAL_CHATTER") {
        await prisma.ingestionEvent.update({
          where: { id: event.id },
          data: { eventKind: kind, status: "DISMISSED" },
        });
        whatsappDismissed++;
        continue;
      }

      // Anything else → CLASSIFIED. Resolve contact + ticket (reads
      // outside the transaction) before writing.
      let ticketMatch: { id: string; confidence: number } | null = null;

      if (parsed) {
        const structured = (parsed.structuredData ?? {}) as Record<string, unknown>;
        const rawPhone =
          typeof structured.senderPhone === "string" ? structured.senderPhone : "";
        const cleanPhone = rawPhone
          .replace(/@.+$/, "")
          .replace(/^\+/, "")
          .slice(-10);

        if (cleanPhone.length >= 7) {
          const contact = await prisma.contact.findFirst({
            where: { phone: { contains: cleanPhone } },
            select: { id: true },
          });

          if (contact) {
            const ticket = await prisma.ticket.findFirst({
              where: {
                OR: [
                  { requestedByContactId: contact.id },
                  { actingOnBehalfOfContactId: contact.id },
                ],
                status: { notIn: ["CLOSED", "INVOICED"] as any },
              },
              orderBy: { updatedAt: "desc" },
              select: { id: true, title: true, updatedAt: true },
            });

            if (ticket) {
              const ageDays = Math.max(
                0,
                (Date.now() - ticket.updatedAt.getTime()) / 86_400_000,
              );
              const recencyBoost = ageDays <= 7 ? 15 : ageDays <= 30 ? 8 : 0;

              const titleWords = ticket.title
                .toLowerCase()
                .split(/\s+/)
                .filter((w) => w.length >= 4);
              const lowerText = text.toLowerCase();
              const hits = titleWords.filter((w) => lowerText.includes(w)).length;
              const contentBoost = hits >= 2 ? 15 : hits === 1 ? 7 : 0;

              ticketMatch = {
                id: ticket.id,
                confidence: Math.min(95, 60 + recencyBoost + contentBoost),
              };
            }
          }
        }
      }

      try {
        await prisma.$transaction(async (tx) => {
          await tx.ingestionEvent.update({
            where: { id: event.id },
            data: { eventKind: kind, status: "CLASSIFIED" },
          });

          if (ticketMatch && parsed) {
            await tx.ingestionLink.create({
              data: {
                parsedMessageId: parsed.id,
                ticketId: ticketMatch.id,
                linkConfidence: ticketMatch.confidence,
                linkStatus: "AUTO_LINKED",
              },
            });
          }
        });

        whatsappClassified++;
        if (ticketMatch) {
          whatsappLinked++;
        } else {
          try {
            await attachEventToThread(event.id);
            whatsappThreaded++;
          } catch (err) {
            console.warn(
              `[classify:wa] attachEventToThread failed for ${event.id}:`,
              err,
            );
          }
        }
      } catch (err) {
        console.warn(
          `[classify:wa] classify+link transaction failed for ${event.id}:`,
          err,
        );
      }
    }

    // ── Stale NEEDS_TRIAGE backfill ──────────────────────────────────────
    // One-time catch-up for events that were classified before the PDF
    // fallback existed — UNKNOWN and GENERAL_CHATTER events stuck in
    // NEEDS_TRIAGE may now classify correctly because the classifier now
    // scans attachment text. Re-runs every invocation; becomes a no-op
    // once every stuck event has been rescued or re-settled.
    // Excludes WHATSAPP_SENT (already handled by the bridge above) and
    // OUTLOOK_SENT (we preserve outbound mail as its own kind).
    const staleTriage = await prisma.ingestionEvent.findMany({
      where: {
        status: "NEEDS_TRIAGE",
        eventKind: { in: ["UNKNOWN", "GENERAL_CHATTER"] },
      },
      include: { parsedMessages: { select: { extractedText: true } } },
    });

    const staleCounts: Record<string, number> = {};
    let staleRescued = 0;
    let staleUnchanged = 0;

    for (const event of staleTriage) {
      const text = event.parsedMessages?.[0]?.extractedText || "";
      const result = classifyMessage(text);
      const kind = result.classification;

      staleCounts[kind] = (staleCounts[kind] || 0) + 1;

      if (kind === "UNKNOWN" || kind === "GENERAL_CHATTER") {
        // No new signal — leave the event as-is (still NEEDS_TRIAGE).
        staleUnchanged++;
        continue;
      }

      await prisma.ingestionEvent.update({
        where: { id: event.id },
        data: { eventKind: kind, status: "CLASSIFIED" },
      });
      staleRescued++;
    }

    return Response.json({
      classified: events.length,
      breakdown: counts,
      whatsapp: {
        scanned: whatsappStuck.length,
        classified: whatsappClassified,
        dismissed: whatsappDismissed,
        leftAlone: whatsappLeftAlone,
        linkedToTicket: whatsappLinked,
        threadedToInbox: whatsappThreaded,
        breakdown: whatsappCounts,
      },
      stale: {
        scanned: staleTriage.length,
        rescued: staleRescued,
        unchanged: staleUnchanged,
        breakdown: staleCounts,
      },
    });
  } catch (error) {
    console.error("Classification failed:", error);
    return Response.json({ error: "Classification failed" }, { status: 500 });
  }
}
