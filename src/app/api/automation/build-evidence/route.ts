import { prisma } from "@/lib/prisma";

// Mirror the Prisma enums as string-literal types so the file compiles
// even when the generated client has not been materialised in this worktree.
type EvidenceType =
  | "INSTRUCTION"
  | "APPROVAL"
  | "PRICING"
  | "DELIVERY"
  | "DISPUTE"
  | "PO_REQUEST"
  | "PO_RECEIVED"
  | "SUPPLIER_CONFIRMATION"
  | "PHOTO"
  | "CALL_NOTE";

type SourceType =
  | "WHATSAPP"
  | "OUTLOOK"
  | "ZOHO_BOOKS"
  | "EMAIL"
  | "PDF_UPLOAD"
  | "IMAGE_UPLOAD"
  | "MANUAL"
  | "API";

interface ExistingFragment {
  id: string;
  fragmentType: string;
  sourceRef: string | null;
}

/**
 * Maps EventType values to EvidenceType values for auto-evidence creation.
 */
const EVENT_TO_EVIDENCE: Record<
  string,
  { evidenceType: EvidenceType; sourceType: SourceType }
> = {
  QUOTE_SENT: {
    evidenceType: "PRICING",
    sourceType: "API",
  },
  QUOTE_APPROVED: {
    evidenceType: "APPROVAL",
    sourceType: "API",
  },
  PO_RECEIVED: {
    evidenceType: "PO_RECEIVED",
    sourceType: "API",
  },
  SUPPLIER_CONFIRMED: {
    evidenceType: "SUPPLIER_CONFIRMATION",
    sourceType: "API",
  },
  GOODS_DELIVERED: {
    evidenceType: "DELIVERY",
    sourceType: "API",
  },
};

export async function POST() {
  try {
    const tickets = await prisma.ticket.findMany({
      where: {
        status: { notIn: ["CLOSED"] },
      },
      include: {
        events: {
          select: {
            id: true,
            eventType: true,
            timestamp: true,
            sourceRef: true,
            notes: true,
          },
        },
        ingestionLinks: {
          select: {
            id: true,
            parsedMessageId: true,
            evidenceFragmentId: true,
            parsedMessage: {
              select: {
                extractedText: true,
                messageType: true,
                ingestionEvent: {
                  select: {
                    sourceRecordType: true,
                    eventKind: true,
                  },
                },
              },
            },
          },
        },
        evidenceFragments: {
          select: {
            id: true,
            fragmentType: true,
            sourceRef: true,
          },
        },
      },
    });

    let evidenceCreated = 0;

    for (const ticket of tickets) {
      const existingFragments =
        ticket.evidenceFragments as ExistingFragment[];

      // -- 1. Create evidence from Events --
      for (const event of ticket.events) {
        const mapping =
          EVENT_TO_EVIDENCE[event.eventType as string];
        if (!mapping) continue;

        // Check if evidence already exists for this event (by sourceRef)
        const eventRef = `event:${event.id}`;
        const alreadyExists = existingFragments.some(
          (ef: ExistingFragment) =>
            ef.fragmentType === mapping.evidenceType &&
            ef.sourceRef === eventRef
        );
        if (alreadyExists) continue;

        await prisma.evidenceFragment.create({
          data: {
            ticketId: ticket.id,
            sourceType: mapping.sourceType as any,
            sourceRef: eventRef,
            timestamp: event.timestamp,
            fragmentType: mapping.evidenceType as any,
            fragmentText:
              event.notes ??
              `${event.eventType} at ${(event.timestamp as Date).toISOString()}`,
          },
        });
        evidenceCreated++;
      }

      // -- 2. Create evidence from IngestionLinks (emails/WhatsApp) --
      for (const link of ticket.ingestionLinks) {
        // Skip links that already have an evidence fragment attached
        if (link.evidenceFragmentId) continue;

        const parsedMsg = link.parsedMessage as {
          extractedText: string;
          messageType: string;
          ingestionEvent: {
            sourceRecordType: string | null;
            eventKind: string | null;
          } | null;
        };

        const eventKind = parsedMsg.ingestionEvent?.eventKind ?? "";
        const sourceRecordType =
          parsedMsg.ingestionEvent?.sourceRecordType ?? "";

        // Determine source type
        let sourceType: SourceType = "EMAIL";
        if (
          sourceRecordType.toLowerCase().includes("whatsapp") ||
          eventKind.toLowerCase().includes("whatsapp")
        ) {
          sourceType = "WHATSAPP";
        } else if (
          sourceRecordType.toLowerCase().includes("outlook") ||
          eventKind.toLowerCase().includes("outlook")
        ) {
          sourceType = "OUTLOOK";
        }

        // Determine evidence type from message content
        const evidenceType: EvidenceType = "INSTRUCTION";

        const linkRef = `ingestion:${link.id}`;
        const alreadyExists = existingFragments.some(
          (ef: ExistingFragment) => ef.sourceRef === linkRef
        );
        if (alreadyExists) continue;

        const text = parsedMsg.extractedText;
        if (!text || text.trim().length === 0) continue;

        const fragment = await prisma.evidenceFragment.create({
          data: {
            ticketId: ticket.id,
            sourceType: sourceType as any,
            sourceRef: linkRef,
            timestamp: new Date(),
            fragmentType: evidenceType as any,
            fragmentText:
              text.length > 2000 ? text.substring(0, 2000) : text,
          },
        });
        evidenceCreated++;

        // Link the ingestion link to the new evidence fragment
        await prisma.ingestionLink.update({
          where: { id: link.id },
          data: { evidenceFragmentId: fragment.id },
        });
      }
    }

    return Response.json({
      ok: true,
      ticketsScanned: tickets.length,
      evidenceCreated,
    });
  } catch (error) {
    console.error("build-evidence failed:", error);
    return Response.json(
      { error: "Failed to build evidence" },
      { status: 500 }
    );
  }
}
