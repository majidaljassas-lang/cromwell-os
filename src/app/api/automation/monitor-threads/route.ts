import { prisma } from "@/lib/prisma";
import { randomUUID } from "node:crypto";

/**
 * Thread monitor.
 *
 * Watches WhatsApp/email conversations that are already linked to a ticket
 * (via IngestionLink) and folds NEW unactioned messages from the same
 * chat into the same ticket — adding any extracted line items, marking
 * the message ACTIONED, and creating the audit-trail link.
 *
 * The "thread identity" comes from `rawPayload.chat_id` (WhatsApp) or
 * `rawPayload.from` / `rawPayload.sender` (email). Once any message from
 * a chat is linked to a ticket, every future message from that chat gets
 * routed to the same ticket automatically.
 *
 * This endpoint is idempotent — running it twice produces the same result.
 */

export const dynamic = "force-dynamic";

interface ExtractedLine {
  description: string;
  qty: number;
  unit: "EA" | "PACK" | "M" | "SET" | "LOT" | "LENGTH";
}

/**
 * Extract line items from free-text messages.
 *
 * Handles the common WhatsApp/email pattern:
 *   "32mm drywall screws 2 box  50mm wood screws 1 box  70mm wood screws 1 box"
 *
 * Strategy: find every "<digits> <known unit>" marker, treat the text
 * BEFORE the marker (back to the previous marker or start of string)
 * as the description, the digits as qty, the unit as unit.
 *
 * Conservative — only matches known unit words. Won't accidentally
 * extract from "5m of 15mm copper" because 'mm' isn't a unit word.
 */
function extractLineItems(text: string): ExtractedLine[] {
  if (!text || typeof text !== "string") return [];

  const out: ExtractedLine[] = [];

  // Strip common preambles
  const cleaned = text
    .replace(/^(also\s+(?:please\s+)?add|please\s+add|can\s+you\s+(?:please\s+)?add|need|add)\s*[:,]?\s*/i, "")
    .trim();

  // Map any matched unit word to our enum
  const unitMap: Record<string, ExtractedLine["unit"]> = {
    box: "PACK", boxes: "PACK",
    bag: "PACK", bags: "PACK",
    pack: "PACK", packs: "PACK", pk: "PACK", pks: "PACK",
    each: "EA", ea: "EA",
    no: "EA", nr: "EA", number: "EA",
    set: "SET", sets: "SET",
    pcs: "EA", piece: "EA", pieces: "EA",
    lot: "LOT",
  };

  const unitPattern = "(?:box(?:es)?|bag(?:s)?|pack(?:s)?|pks?|each|ea|no|nr|number|set(?:s)?|pcs|piece(?:s)?|lot)";
  // Capture: (description) (qty) (unit)  — non-greedy so the description is short
  const re = new RegExp(
    `([\\s\\S]+?)(\\d+(?:\\.\\d+)?)\\s*(${unitPattern})\\b`,
    "gi"
  );

  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) {
    const description = m[1]
      .trim()
      .replace(/^[,\s]+|[,\s]+$/g, "")
      .replace(/\s+/g, " ");
    const qty = parseFloat(m[2]);
    const unit = unitMap[m[3].toLowerCase()] || "EA";
    if (description && qty > 0 && description.length > 1) {
      out.push({ description, qty, unit });
    }
  }

  return out;
}

interface MonitorResult {
  ok: boolean;
  scanned: number;
  threadsActive: number;
  newMessages: number;
  linesExtracted: number;
  linesInserted: number;
  messagesActioned: number;
  linksCreated: number;
  details: Array<{
    chatId: string;
    chatName: string;
    ticketId: string;
    eventId: string;
    extractedLines: ExtractedLine[];
    action: "lines_added" | "evidence_only" | "no_text";
  }>;
}

export async function POST() {
  const result: MonitorResult = {
    ok: true,
    scanned: 0,
    threadsActive: 0,
    newMessages: 0,
    linesExtracted: 0,
    linesInserted: 0,
    messagesActioned: 0,
    linksCreated: 0,
    details: [],
  };

  try {
    // ── Step 1: find all chat_id → ticket mappings from existing IngestionLinks
    // Use raw SQL because rawPayload is JSON and Prisma's JSON filters are awkward.
    const links = await prisma.$queryRaw<
      Array<{ chat_id: string; ticket_id: string; chat_name: string | null }>
    >`
      SELECT DISTINCT
        ie."rawPayload"->>'chat_id' AS chat_id,
        il."ticketId" AS ticket_id,
        ie."rawPayload"->>'chat_name' AS chat_name
      FROM "IngestionLink" il
      JOIN "ParsedMessage" pm ON pm.id = il."parsedMessageId"
      JOIN "IngestionEvent" ie ON ie.id = pm."ingestionEventId"
      WHERE il."linkStatus" = 'CONFIRMED'
        AND il."ticketId" IS NOT NULL
        AND ie."rawPayload"->>'chat_id' IS NOT NULL
    `;

    result.threadsActive = links.length;

    if (links.length === 0) {
      return Response.json({
        ...result,
        message: "No active threads to monitor",
      });
    }

    // ── Step 2: for each (chat_id, ticket_id), find unactioned events from that chat
    for (const link of links) {
      const newEvents = await prisma.$queryRaw<
        Array<{
          id: string;
          message_text: string | null;
          chat_name: string | null;
          createdAt: Date;
        }>
      >`
        SELECT
          ie.id,
          ie."rawPayload"->>'message_text' AS message_text,
          ie."rawPayload"->>'chat_name' AS chat_name,
          ie."createdAt"
        FROM "IngestionEvent" ie
        WHERE ie."rawPayload"->>'chat_id' = ${link.chat_id}
          AND ie.status NOT IN ('ACTIONED', 'DISMISSED')
          AND NOT EXISTS (
            SELECT 1 FROM "ParsedMessage" pm
            JOIN "IngestionLink" il ON il."parsedMessageId" = pm.id
            WHERE pm."ingestionEventId" = ie.id
              AND il."ticketId" = ${link.ticket_id}
          )
        ORDER BY ie."createdAt" ASC
      `;

      result.scanned += newEvents.length;

      if (newEvents.length === 0) continue;

      // ── Step 3: load the linked ticket to get payingCustomer, site, etc.
      const ticket = await prisma.ticket.findUnique({
        where: { id: link.ticket_id },
        select: {
          id: true,
          payingCustomerId: true,
          siteId: true,
          siteCommercialLinkId: true,
          status: true,
        },
      });

      if (!ticket) continue;

      // Skip closed/invoiced tickets — don't add to a finished job
      if (
        ticket.status === "CLOSED" ||
        ticket.status === "INVOICED" ||
        ticket.status === "CANCELLED"
      ) {
        continue;
      }

      // ── Step 4: process each new event
      for (const event of newEvents) {
        result.newMessages++;

        const text = event.message_text || "";
        const lines = extractLineItems(text);
        result.linesExtracted += lines.length;

        const today = new Date().toISOString().slice(0, 10);
        const chatLabel = link.chat_name || event.chat_name || "thread";
        const sectionLabel = `EXTRA - ${chatLabel} ${today}`;

        let action: "lines_added" | "evidence_only" | "no_text" = "no_text";

        if (lines.length > 0) {
          // Insert each extracted line
          for (const line of lines) {
            await prisma.ticketLine.create({
              data: {
                id: randomUUID(),
                ticketId: ticket.id,
                lineType: "MATERIAL",
                description: line.description,
                qty: line.qty,
                unit: line.unit,
                payingCustomerId: ticket.payingCustomerId,
                siteId: ticket.siteId,
                siteCommercialLinkId: ticket.siteCommercialLinkId,
                status: "CAPTURED",
                isLocked: false,
                sectionLabel,
                internalNotes: `Auto-extracted from ${chatLabel} message ${event.id.slice(0, 8)}`,
              },
            });
            result.linesInserted++;
          }
          action = "lines_added";

          // Timeline event on the ticket
          await prisma.event.create({
            data: {
              ticketId: ticket.id,
              eventType: "EXTRA_ORDER_ADDED",
              timestamp: new Date(),
              notes: `Auto-monitor added ${lines.length} line(s) from ${chatLabel}: ${lines.map((l) => `${l.description} ×${l.qty}`).join(", ")}`,
            },
          });
        } else if (text.trim().length > 0) {
          // No lines but there's content — log as evidence on the ticket
          action = "evidence_only";
          await prisma.event.create({
            data: {
              ticketId: ticket.id,
              eventType: "EXTRA_ORDER_ADDED",
              timestamp: new Date(),
              notes: `Auto-monitor: new message in ${chatLabel} thread (no line items extracted): "${text.slice(0, 200)}"`,
            },
          });
        }

        // ── Step 5: mark IngestionEvent ACTIONED + create IngestionLink
        await prisma.ingestionEvent.update({
          where: { id: event.id },
          data: { status: "ACTIONED" },
        });
        result.messagesActioned++;

        const parsedMessage = await prisma.parsedMessage.findFirst({
          where: { ingestionEventId: event.id },
          select: { id: true },
        });

        if (parsedMessage) {
          // Avoid duplicate links
          const existingLink = await prisma.ingestionLink.findFirst({
            where: {
              parsedMessageId: parsedMessage.id,
              ticketId: ticket.id,
            },
            select: { id: true },
          });
          if (!existingLink) {
            await prisma.ingestionLink.create({
              data: {
                id: randomUUID(),
                parsedMessageId: parsedMessage.id,
                ticketId: ticket.id,
                linkStatus: "CONFIRMED",
              },
            });
            result.linksCreated++;
          }
        }

        result.details.push({
          chatId: link.chat_id,
          chatName: chatLabel,
          ticketId: ticket.id,
          eventId: event.id,
          extractedLines: lines,
          action,
        });
      }
    }

    return Response.json({
      ...result,
      message: `Scanned ${result.scanned} new messages across ${result.threadsActive} active threads, inserted ${result.linesInserted} lines, actioned ${result.messagesActioned} messages`,
    });
  } catch (error) {
    console.error("Thread monitor failed:", error);
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Thread monitor failed",
      },
      { status: 500 }
    );
  }
}
